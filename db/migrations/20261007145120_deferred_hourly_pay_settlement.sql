-- Records an actual separate lump-sum payment; no money is transferred here.
alter table public.admin_deferred_pay_plans
  add column if not exists paid_by uuid references public.profiles(id) on delete set null,
  add column if not exists payment_notes text,
  add column if not exists paid_eligible_milliseconds bigint,
  add column if not exists accounting_transaction_id uuid references public.accounting_transactions(id) on delete restrict;

create unique index if not exists admin_deferred_pay_plans_accounting_transaction_key
  on public.admin_deferred_pay_plans(accounting_transaction_id)
  where accounting_transaction_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.admin_deferred_pay_plans'::regclass
    and conname = 'admin_deferred_pay_plans_settlement_check') then
    alter table public.admin_deferred_pay_plans add constraint admin_deferred_pay_plans_settlement_check check (
      (paid_eligible_milliseconds is null or paid_eligible_milliseconds >= 0)
      and (paid_at is not null or (paid_by is null and paid_eligible_milliseconds is null and accounting_transaction_id is null))
    );
  end if;
end $$;

comment on column public.admin_deferred_pay_plans.accounting_transaction_id is
  'Dedicated bank outflow settling this plan, not a second payroll expense. A transaction may settle only one plan.';
comment on column public.admin_deferred_pay_plans.paid_eligible_milliseconds is
  'Eligible completed work duration verified when the full lump sum was recorded.';

create or replace function public.settle_deferred_hourly_pay(
  p_actor_id uuid,
  p_plan_id uuid,
  p_expected_amount_cents integer,
  p_paid_date date default null,
  p_payment_notes text default null,
  p_accounting_transaction_id uuid default null,
  p_link_only boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_plan public.admin_deferred_pay_plans%rowtype;
  v_before public.admin_deferred_pay_plans%rowtype;
  v_transaction public.accounting_transactions%rowtype;
  v_owner boolean;
  v_can_edit boolean;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_paid_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_milliseconds bigint;
  v_amount_cents bigint;
  v_category_id uuid;
  v_bank_before jsonb;
begin
  if p_actor_id is null or p_plan_id is null or p_expected_amount_cents is null
    or p_expected_amount_cents <= 0 or p_link_only is null
    or length(coalesce(p_payment_notes, '')) > 2000 then
    raise exception using errcode = '22023', message = 'deferred_pay_invalid';
  end if;

  -- Service-only RPC callers pass the authenticated actor obtained by their
  -- section checks. Repeat those checks inside the same transaction as writes.
  select * into v_actor from public.profiles where id = p_actor_id for share;
  if not found or not coalesce(v_actor.is_admin, false) or not coalesce(v_actor.is_active, false) then
    raise exception using errcode = '42501', message = 'deferred_pay_permission';
  end if;
  v_owner := coalesce(v_actor.is_superadmin, false) or lower(coalesce(v_actor.email, '')) = 'zach@sobrew.com';
  if not v_owner then
    select can_edit into v_can_edit from public.admin_permissions
      where profile_id = p_actor_id and section_key = 'payroll' for share;
    if not coalesce(v_can_edit, false) then
      raise exception using errcode = '42501', message = 'deferred_pay_permission';
    end if;
  end if;
  if p_accounting_transaction_id is not null and not v_owner then
    v_can_edit := false;
    select can_edit into v_can_edit from public.admin_permissions
      where profile_id = p_actor_id and section_key = 'accounting' for share;
    if not coalesce(v_can_edit, false) then
      raise exception using errcode = '42501', message = 'deferred_pay_accounting_permission';
    end if;
  end if;

  select * into v_plan from public.admin_deferred_pay_plans where id = p_plan_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'deferred_pay_not_found';
  end if;
  v_before := v_plan;

  if p_link_only then
    if v_plan.paid_at is null or p_accounting_transaction_id is null then
      raise exception using errcode = '22023', message = 'deferred_pay_not_paid';
    end if;
    if v_plan.paid_amount_cents is distinct from p_expected_amount_cents then
      raise exception using errcode = '22023', message = 'deferred_pay_amount_changed';
    end if;
    v_paid_date := (v_plan.paid_at at time zone 'America/Chicago')::date;
    v_amount_cents := v_plan.paid_amount_cents;
  else
    if v_plan.paid_at is not null then
      raise exception using errcode = '22023', message = 'deferred_pay_already_paid';
    end if;
    if v_today < v_plan.payout_date or v_today <= v_plan.end_date then
      raise exception using errcode = '22023', message = 'deferred_pay_not_due';
    end if;
    if p_paid_date is null or p_paid_date < v_plan.payout_date or p_paid_date > v_today then
      raise exception using errcode = '22023', message = 'deferred_pay_invalid_date';
    end if;
    v_paid_date := p_paid_date;
    v_start := v_plan.start_date::timestamp at time zone 'America/Chicago';
    v_end := (v_plan.end_date + 1)::timestamp at time zone 'America/Chicago';

    -- A rare final settlement briefly freezes time mutations while verifying
    -- the reviewed total. SHARE also prevents inserted/deleted breaks or shifts
    -- from racing this check; row locks alone would miss those new rows.
    lock table public.admin_time_entries, public.admin_time_breaks in share mode;
    if exists (
      select 1 from public.admin_time_entries e
      where e.profile_id = v_plan.profile_id and e.status <> 'void'
        and e.clock_in_at < v_end and (e.clock_out_at is null or e.clock_out_at > v_start)
        and (e.clock_out_at is null or e.status = 'open' or e.clock_out_at > now())
    ) then
      raise exception using errcode = '22023', message = 'deferred_pay_open_shifts';
    end if;
    if exists (
      select 1 from public.admin_time_breaks b join public.admin_time_entries e on e.id = b.time_entry_id
      where e.profile_id = v_plan.profile_id and e.status <> 'void'
        and e.clock_in_at < v_end and e.clock_out_at > v_start
        and b.status <> 'void' and b.break_start_at < least(e.clock_out_at, v_end)
        and (b.break_end_at is null or b.status = 'open')
    ) then
      raise exception using errcode = '22023', message = 'deferred_pay_open_shifts';
    end if;

    -- Same interval calculation as calculateDeferredPay(): clip each completed
    -- shift to the Central-date plan, subtract the union of completed breaks,
    -- and round the total once. Truncate timestamps to JS Date milliseconds.
    with shifts as (
      select e.id,
        greatest(date_trunc('milliseconds', e.clock_in_at), v_start) as starts,
        least(date_trunc('milliseconds', e.clock_out_at), v_end) as ends
      from public.admin_time_entries e
      where e.profile_id = v_plan.profile_id and e.status not in ('void', 'open')
        and e.clock_out_at <= now() and e.clock_out_at > e.clock_in_at
        and e.clock_in_at < v_end and e.clock_out_at > v_start
    ), eligible as (
      select s.id,
        tstzmultirange(tstzrange(s.starts, s.ends, '[)'))
          - coalesce((
            select range_agg(tstzrange(
              greatest(date_trunc('milliseconds', b.break_start_at), s.starts),
              least(date_trunc('milliseconds', b.break_end_at), s.ends), '[)'))
            from public.admin_time_breaks b
            where b.time_entry_id = s.id and b.status not in ('void', 'open')
              and b.break_end_at is not null
              and least(date_trunc('milliseconds', b.break_end_at), s.ends)
                > greatest(date_trunc('milliseconds', b.break_start_at), s.starts)
          ), '{}'::tstzmultirange) as worked
      from shifts s where s.ends > s.starts
    )
    select coalesce(sum(extract(epoch from (upper(piece) - lower(piece))) * 1000), 0)::bigint
      into v_milliseconds
    from eligible cross join lateral unnest(worked) as piece;
    v_amount_cents := round(v_milliseconds::numeric * v_plan.accrual_rate_cents / 3600000);
    if v_amount_cents <= 0 then
      raise exception using errcode = '22023', message = 'deferred_pay_no_balance';
    end if;
    if v_amount_cents <> p_expected_amount_cents then
      raise exception using errcode = '22023', message = 'deferred_pay_amount_changed';
    end if;
  end if;

  if p_accounting_transaction_id is not null then
    if v_plan.accounting_transaction_id is not null
      and v_plan.accounting_transaction_id <> p_accounting_transaction_id then
      raise exception using errcode = '22023', message = 'deferred_pay_already_linked';
    end if;
    select * into v_transaction from public.accounting_transactions
      where id = p_accounting_transaction_id for update;
    if not found or v_transaction.amount_cents <> v_amount_cents
      or v_transaction.amount_cents <= 0 or v_transaction.transaction_date <> v_paid_date
      or v_transaction.account_type not in ('bank', 'debit_card')
      or v_transaction.status not in ('needs_review', 'categorized') then
      raise exception using errcode = '22023', message = 'deferred_pay_bank_mismatch';
    end if;
    if exists (select 1 from public.admin_deferred_pay_plans
      where accounting_transaction_id = p_accounting_transaction_id and id <> p_plan_id)
      or exists (select 1 from public.accounting_transaction_matches
        where transaction_id = p_accounting_transaction_id and match_status <> 'rejected')
      or exists (select 1 from public.accounting_transaction_splits where transaction_id = p_accounting_transaction_id) then
      raise exception using errcode = '22023', message = 'deferred_pay_bank_in_use';
    end if;
    select id into v_category_id from public.accounting_categories
      where name = 'Deferred Payroll / Compensation Payable'
        and category_type = 'liability' and pnl_section = 'none' and active = true for share;
    if not found then
      raise exception using errcode = '22023', message = 'deferred_pay_category_missing';
    end if;
    if p_link_only and v_plan.accounting_transaction_id = p_accounting_transaction_id then
      return jsonb_build_object('plan_id', v_plan.id, 'paid_amount_cents', v_plan.paid_amount_cents,
        'paid_at', v_plan.paid_at, 'accounting_transaction_id', v_plan.accounting_transaction_id);
    end if;
    v_bank_before := to_jsonb(v_transaction);
    update public.accounting_transactions set category_id = v_category_id, status = 'categorized',
      reviewed_by = p_actor_id, reviewed_at = now(), updated_at = now()
      where id = p_accounting_transaction_id;
  end if;

  if p_link_only then
    update public.admin_deferred_pay_plans set accounting_transaction_id = p_accounting_transaction_id, updated_at = now()
      where id = p_plan_id returning * into v_plan;
  else
    update public.admin_deferred_pay_plans set
      paid_at = v_paid_date::timestamp at time zone 'America/Chicago',
      paid_amount_cents = v_amount_cents, paid_eligible_milliseconds = v_milliseconds,
      paid_by = p_actor_id, payment_notes = nullif(btrim(p_payment_notes), ''),
      accounting_transaction_id = p_accounting_transaction_id, updated_at = now()
      where id = p_plan_id returning * into v_plan;
  end if;

  insert into public.admin_audit_log(action, actor_profile_id, target_profile_id, section_key, before_value, after_value)
  values (case when p_link_only then 'deferred_pay_bank_linked' else 'deferred_pay_marked_paid' end,
    p_actor_id, v_plan.profile_id, 'payroll', to_jsonb(v_before),
    to_jsonb(v_plan) || jsonb_build_object('bank_transaction_before', v_bank_before));

  return jsonb_build_object('plan_id', v_plan.id, 'paid_amount_cents', v_plan.paid_amount_cents,
    'paid_at', v_plan.paid_at, 'accounting_transaction_id', v_plan.accounting_transaction_id);
end;
$$;

-- No browser/API role may call this privileged RPC. The server must obtain the
-- actor from its authenticated session; the function repeats live permissions.
revoke all on function public.settle_deferred_hourly_pay(uuid,uuid,integer,date,text,uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.settle_deferred_hourly_pay(uuid,uuid,integer,date,text,uuid,boolean)
  to service_role;

notify pgrst, 'reload schema';

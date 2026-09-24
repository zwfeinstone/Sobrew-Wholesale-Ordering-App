-- One first-order SPIFF per customer account (shared by all of its logins).
-- Keep the receipt separately from orders and payroll: deleting/restoring either
-- must never make an account eligible a second time.
create table private.customer_first_order_spiffs (
  center_id uuid primary key references public.centers(id) on delete cascade,
  first_order_id uuid not null,
  first_order_at timestamptz not null,
  eligible boolean not null,
  spiff_id uuid,
  sales_profile_id uuid,
  awarded_at timestamptz
);
alter table private.customer_first_order_spiffs enable row level security;
revoke all on private.customer_first_order_spiffs from public, anon, authenticated, service_role;

comment on table private.customer_first_order_spiffs is
  'Internal first-order receipts. Order and SPIFF IDs intentionally survive deletion; only trusted triggers can write these receipts.';

create index admin_audit_log_center_creation_idx
  on public.admin_audit_log ((after_value->>'center_id'), created_at, id)
  where action = 'center_created';

-- Freeze existing order history without creating retroactive payroll charges.
-- Block writes until the history snapshot and insert trigger are both installed.
lock table public.orders, public.order_trash in share row exclusive mode;
insert into private.customer_first_order_spiffs (
  center_id, first_order_id, first_order_at, eligible
)
select distinct on (history.center_id)
  history.center_id, history.order_id, history.ordered_at, false
from (
  select o.center_id, o.id as order_id, coalesce(o.created_at, now()) as ordered_at
  from public.orders o
  where o.order_kind = 'standard'
  union all
  select t.center_id, t.order_id,
    coalesce((t.order_snapshot->>'created_at')::timestamptz, t.deleted_at)
  from public.order_trash t
  where coalesce(t.order_snapshot->>'order_kind', 'standard') = 'standard'
) history
join public.centers c on c.id = history.center_id
order by history.center_id, history.ordered_at, history.order_id;

-- Internal only: called by triggers after the initiating write passed its RLS
-- checks. This also supports service-role account creation and recurring orders,
-- where auth.uid() is null. No API role may invoke this function directly.
create function private.award_first_order_sales_spiff(
  p_center_id uuid,
  p_order_id uuid default null,
  p_order_at timestamptz default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_receipt private.customer_first_order_spiffs%rowtype;
  v_creator uuid;
  v_creator_was_sales_rep boolean;
  v_center_name text;
  v_week_start date;
  v_spiff_id uuid;
begin
  -- A consistent lock order serializes simultaneous orders and account-creation
  -- audits. NO KEY UPDATE remains compatible with orders' foreign-key checks.
  select c.name into v_center_name from public.centers c
    where c.id = p_center_id for no key update;
  if not found then return; end if;

  if p_order_id is not null then
    insert into private.customer_first_order_spiffs (
      center_id, first_order_id, first_order_at, eligible
    ) values (p_center_id, p_order_id, coalesce(p_order_at, now()), true)
    on conflict (center_id) do nothing;
  end if;

  select * into v_receipt from private.customer_first_order_spiffs
    where center_id = p_center_id for update;
  if not found or not v_receipt.eligible or v_receipt.spiff_id is not null then return; end if;

  -- The creation event records the original actor and their sales-rep status at
  -- creation. Current sales assignments may have changed and are not attribution.
  select a.actor_profile_id, a.after_value->>'sales_assigned_to_creator' = 'true'
    into v_creator, v_creator_was_sales_rep
  from public.admin_audit_log a
  where a.action = 'center_created' and a.after_value->>'center_id' = p_center_id::text
  order by a.created_at, a.id
  limit 1;
  if v_creator is null or v_creator_was_sales_rep is distinct from true
    or not exists (select 1 from public.profiles where id = v_creator) then return; end if;

  v_week_start := date_trunc('week', v_receipt.first_order_at at time zone 'America/Chicago')::date;
  insert into public.admin_weekly_sales_spiffs (
    profile_id, week_start_date, week_end_date, amount_cents,
    paid_at, paid_by, notes, created_by, updated_by
  ) values (
    v_creator, v_week_start, v_week_start + 6, 10000,
    null, null,
    format('Automatic first-order SPIFF: %s. Order %s.', v_center_name, v_receipt.first_order_id),
    null, null
  ) returning id into v_spiff_id;

  update private.customer_first_order_spiffs
    set spiff_id = v_spiff_id, sales_profile_id = v_creator, awarded_at = now()
    where center_id = p_center_id;

  insert into public.admin_audit_log (action, section_key, target_profile_id, after_value)
  values ('first_order_sales_spiff_awarded', 'payroll', v_creator, jsonb_build_object(
    'center_id', p_center_id, 'order_id', v_receipt.first_order_id,
    'payment_id', v_spiff_id, 'amount_cents', 10000,
    'profile_id', v_creator, 'week_start_date', v_week_start, 'week_end_date', v_week_start + 6
  ));
end;
$$;
revoke all on function private.award_first_order_sales_spiff(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;

create function private.record_first_order_sales_spiff()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- A restored order is historical even if its original receipt is unavailable.
  if current_setting('app.restoring_order', true) = new.id::text then return new; end if;
  perform private.award_first_order_sales_spiff(new.center_id, new.id, new.created_at);
  return new;
end;
$$;
revoke all on function private.record_first_order_sales_spiff()
  from public, anon, authenticated, service_role;
create trigger record_first_order_sales_spiff after insert on public.orders
  for each row when (new.center_id is not null and new.order_kind = 'standard')
  execute function private.record_first_order_sales_spiff();

-- Account creation writes its audit after creating the login. If that customer
-- orders immediately, finish the award when creator attribution becomes available.
create function private.finish_first_order_sales_spiff_attribution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_center_id uuid;
begin
  select c.id into v_center_id from public.centers c
    where c.id::text = new.after_value->>'center_id';
  if v_center_id is not null then
    perform private.award_first_order_sales_spiff(v_center_id);
  end if;
  return new;
end;
$$;
revoke all on function private.finish_first_order_sales_spiff_attribution()
  from public, anon, authenticated, service_role;
create trigger finish_first_order_sales_spiff_attribution after insert on public.admin_audit_log
  for each row when (new.action = 'center_created')
  execute function private.finish_first_order_sales_spiff_attribution();

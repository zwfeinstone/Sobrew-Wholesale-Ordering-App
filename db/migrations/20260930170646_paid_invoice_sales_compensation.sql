-- Apply the invoice-payment rule prospectively from September 30, 2026 in
-- America/Chicago. Existing SPIFF records are untouched and remain grandfathered.
-- New qualifying awards retain the order link even after order deletion.
alter table public.admin_weekly_sales_spiffs
  add column first_order_id uuid;
comment on column public.admin_weekly_sales_spiffs.first_order_id is
  'New automatic first-order SPIFFs from September 30, 2026 America/Chicago. Existing records and older first orders remain null; no backfill. No order foreign key so deletion cannot erase the payment requirement.';

-- New payout writes track orders already settled, allowing later-paid invoices
-- from the same shipment month to be paid once. Preserve legacy payout totals:
-- null on an existing paid payout means its entire historical month is settled.
alter table public.monthly_commission_payouts
  add column paid_order_ids uuid[];
comment on column public.monthly_commission_payouts.paid_order_ids is
  'Cumulative order IDs included in commission payouts. Null on a legacy paid row means its month was settled before per-invoice payment tracking.';

create or replace function private.award_first_order_sales_spiff(
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
    paid_at, paid_by, notes, created_by, updated_by, first_order_id
  ) values (
    v_creator, v_week_start, v_week_start + 6, 10000,
    null, null,
    format('Automatic first-order SPIFF: %s. Order %s.', v_center_name, v_receipt.first_order_id),
    -- Attribute by the original order time, even when its creator audit arrives
    -- later. Older first orders retain their original payment eligibility.
    null, null, case
      when v_receipt.first_order_at >= timestamptz '2026-09-30 05:00:00+00'
      then v_receipt.first_order_id
      else null
    end
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

notify pgrst, 'reload schema';

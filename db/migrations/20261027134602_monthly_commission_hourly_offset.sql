-- A monthly hourly offset applies only to explicitly configured sales profiles.
-- Do not change staff settings or rewrite previously recorded commissions here.
alter table public.admin_commission_settings
  add column if not exists hourly_offset_enabled boolean not null default false,
  add column if not exists hourly_offset_start_month date;

alter table public.monthly_commission_payouts
  add column if not exists gross_commission_cents numeric(14, 4),
  add column if not exists hourly_base_offset_cents numeric(14, 4) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.admin_commission_settings'::regclass
      and conname = 'admin_commission_settings_hourly_offset_month_check'
  ) then
    alter table public.admin_commission_settings
      add constraint admin_commission_settings_hourly_offset_month_check check (
        (not hourly_offset_enabled or hourly_offset_start_month is not null)
        and (hourly_offset_start_month is null or (
          isfinite(hourly_offset_start_month)
          and extract(day from hourly_offset_start_month) = 1
        ))
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.monthly_commission_payouts'::regclass
      and conname = 'monthly_commission_payouts_hourly_offset_amounts_check'
  ) then
    alter table public.monthly_commission_payouts
      add constraint monthly_commission_payouts_hourly_offset_amounts_check check (
        (gross_commission_cents is null or (
          gross_commission_cents >= 0 and gross_commission_cents < 'Infinity'::numeric
        ))
        and hourly_base_offset_cents >= 0
        and hourly_base_offset_cents < 'Infinity'::numeric
      );
  end if;
end $$;

comment on column public.admin_commission_settings.hourly_offset_enabled is
  'Pay only cumulative monthly gross-profit commission above that month''s base hourly wages. First-order SPIFFs remain separate.';
comment on column public.admin_commission_settings.hourly_offset_start_month is
  'First commission month subject to the hourly offset, inclusive. Earlier months retain their existing commission policy.';
comment on column public.monthly_commission_payouts.gross_commission_cents is
  'Cumulative GP commission before the monthly hourly offset. NULL preserves legacy rows, whose gross commission is commission_cents.';
comment on column public.monthly_commission_payouts.hourly_base_offset_cents is
  'Full monthly base hourly wages used when recording the cumulative net commission. Not a deduction from first-order SPIFFs.';

create schema if not exists private;

create or replace function private.enforce_monthly_commission_hourly_offset()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_offset_applies boolean;
begin
  select s.hourly_offset_enabled
      and s.hourly_offset_start_month is not null
      and new.commission_month >= s.hourly_offset_start_month
    into v_offset_applies
    from public.admin_commission_settings s
    where s.profile_id = new.sales_profile_id;

  if not coalesce(v_offset_applies, false) then
    return new;
  end if;

  -- Older clients cannot pay the gross GP amount without applying the offset.
  -- The server verifies actual wages; this trigger protects the stored arithmetic.
  if new.gross_commission_cents is null then
    raise exception using errcode = '23514',
      message = 'monthly_commission_hourly_offset_metadata_required';
  end if;

  if new.commission_cents is distinct from greatest(
    0::numeric,
    round(new.gross_commission_cents) - round(new.hourly_base_offset_cents)
  ) then
    raise exception using errcode = '23514',
      message = 'monthly_commission_hourly_offset_amount_mismatch';
  end if;

  -- The wage total is final only after the Chicago calendar month has ended.
  if (new.status = 'paid' or new.paid_at is not null)
    and new.commission_month >= date_trunc('month', now() at time zone 'America/Chicago')::date then
    raise exception using errcode = '23514',
      message = 'monthly_commission_hourly_offset_month_open';
  end if;

  return new;
end $$;

revoke all on function private.enforce_monthly_commission_hourly_offset() from public, anon, authenticated;
grant execute on function private.enforce_monthly_commission_hourly_offset() to service_role;

drop trigger if exists enforce_monthly_commission_hourly_offset on public.monthly_commission_payouts;
create trigger enforce_monthly_commission_hourly_offset
  before insert or update on public.monthly_commission_payouts
  for each row execute function private.enforce_monthly_commission_hourly_offset();

notify pgrst, 'reload schema';

-- Tracks separately payable hourly compensation. It does not change the rate
-- used by weekly payroll, time-entry snapshots, or any payment records.
create table if not exists public.admin_deferred_pay_plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  label text not null,
  start_date date not null,
  end_date date not null,
  payout_date date not null,
  accrual_rate_cents integer not null,
  weekly_rate_cents integer not null,
  paid_at timestamptz,
  paid_amount_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_deferred_pay_plans_date_order_check
    check (start_date <= end_date and payout_date > end_date),
  constraint admin_deferred_pay_plans_rates_check
    check (accrual_rate_cents > 0 and weekly_rate_cents > 0),
  constraint admin_deferred_pay_plans_payment_check
    check (
      (paid_at is null and paid_amount_cents is null)
      or (paid_at is not null and paid_amount_cents is not null and paid_amount_cents >= 0)
    ),
  constraint admin_deferred_pay_plans_profile_period_key
    unique (profile_id, start_date, end_date)
);

comment on table public.admin_deferred_pay_plans is
  'Separate deferred hourly compensation plans; eligible hours come from time entries and unpaid breaks. Does not change weekly payroll.';
comment on column public.admin_deferred_pay_plans.end_date is
  'Inclusive last eligible work date in the application payroll timezone (America/Chicago).';
comment on column public.admin_deferred_pay_plans.paid_at is
  'Set only after the separate lump sum is paid; the payout date alone never marks a plan paid.';

alter table public.admin_deferred_pay_plans enable row level security;

-- Default grants vary between Supabase projects; explicitly keep all API
-- clients read-only and allow only the trusted service role to manage plans.
revoke all on public.admin_deferred_pay_plans from public, anon, authenticated;
grant select on public.admin_deferred_pay_plans to authenticated;
grant all on public.admin_deferred_pay_plans to service_role;

drop policy if exists "read own or managed deferred pay" on public.admin_deferred_pay_plans;
create policy "read own or managed deferred pay"
  on public.admin_deferred_pay_plans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles viewer
      where viewer.id = (select auth.uid())
        and viewer.is_active = true
        and (
          admin_deferred_pay_plans.profile_id = viewer.id
          or (
            viewer.is_admin = true
            and (
              viewer.is_superadmin = true
              or lower(coalesce(viewer.email, '')) = 'zach@sobrew.com'
              or exists (
                select 1
                from public.admin_permissions permission
                where permission.profile_id = viewer.id
                  and permission.section_key = 'payroll'
                  and permission.can_view = true
              )
            )
          )
        )
    )
  );

-- Match the verified staff identity by email instead of carrying an environment-
-- specific generated profile ID into the migration. A missing profile creates
-- no plan; ambiguous matching staff accounts require an explicit resolution.
do $$
begin
  if (
    select count(*)
    from public.profiles
    where lower(btrim(email)) = 'haskins@sobrew.com'
      and is_active = true
  ) > 1 then
    raise exception 'Multiple active Haskins profiles; deferred hourly pay plan was not seeded';
  end if;

  insert into public.admin_deferred_pay_plans (
    profile_id, label, start_date, end_date, payout_date,
    accrual_rate_cents, weekly_rate_cents
  )
  select id, 'January 4 deferred pay', date '2026-10-07', date '2027-01-03', date '2027-01-04', 500, 1500
  from public.profiles
  where lower(btrim(email)) = 'haskins@sobrew.com'
    and is_active = true
  on conflict (profile_id, start_date, end_date) do nothing;
end $$;

notify pgrst, 'reload schema';

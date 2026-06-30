create table if not exists admin_salary_payroll_payments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  payroll_month date not null,
  period_start_date date not null,
  period_end_date date not null,
  salary_amount_cents numeric(14, 4) not null default 0 check (salary_amount_cents >= 0),
  salary_frequency text not null default 'monthly',
  salary_labor_work_type text not null default 'admin',
  salary_pay_cents numeric(14, 4) not null default 0 check (salary_pay_cents >= 0),
  approved_at timestamptz not null default now(),
  approved_by uuid references profiles(id) on delete set null,
  paid_at timestamptz not null default now(),
  paid_by uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  unique (profile_id, payroll_month),
  check (period_end_date >= period_start_date),
  check (salary_frequency in ('annual', 'monthly', 'semimonthly', 'biweekly', 'weekly')),
  check (salary_labor_work_type in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other'))
);

create index if not exists admin_salary_payroll_payments_month_idx
  on admin_salary_payroll_payments(payroll_month desc);

create index if not exists admin_salary_payroll_payments_profile_idx
  on admin_salary_payroll_payments(profile_id);

create index if not exists admin_salary_payroll_payments_paid_at_idx
  on admin_salary_payroll_payments(paid_at desc);

alter table admin_salary_payroll_payments enable row level security;

drop policy if exists "owner all admin_salary_payroll_payments" on admin_salary_payroll_payments;
create policy "owner all admin_salary_payroll_payments"
  on admin_salary_payroll_payments
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

notify pgrst, 'reload schema';

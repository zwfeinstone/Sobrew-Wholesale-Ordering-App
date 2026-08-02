create table if not exists admin_weekly_sales_spiffs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  week_start_date date not null,
  week_end_date date not null,
  amount_cents numeric(14, 4) not null default 0 check (amount_cents >= 0),
  paid_at timestamptz not null default now(),
  paid_by uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  check (week_end_date >= week_start_date),
  unique (profile_id, week_start_date, week_end_date)
);

create index if not exists admin_weekly_sales_spiffs_week_idx
  on admin_weekly_sales_spiffs(week_start_date desc, week_end_date desc);

create index if not exists admin_weekly_sales_spiffs_profile_week_idx
  on admin_weekly_sales_spiffs(profile_id, week_start_date desc);

create index if not exists admin_weekly_sales_spiffs_paid_at_idx
  on admin_weekly_sales_spiffs(paid_at desc);

alter table admin_weekly_sales_spiffs enable row level security;

drop policy if exists "owner all admin_weekly_sales_spiffs" on admin_weekly_sales_spiffs;
create policy "owner all admin_weekly_sales_spiffs"
  on admin_weekly_sales_spiffs
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "sales self read admin_weekly_sales_spiffs" on admin_weekly_sales_spiffs;
create policy "sales self read admin_weekly_sales_spiffs"
  on admin_weekly_sales_spiffs
  for select
  using (profile_id = auth.uid());

notify pgrst, 'reload schema';

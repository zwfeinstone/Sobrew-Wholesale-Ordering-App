do $$
declare
  v_constraint_name text;
begin
  select conname
    into v_constraint_name
  from pg_constraint
  where conrelid = 'admin_permissions'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%section_key%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table admin_permissions drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table admin_permissions
  add constraint admin_permissions_section_key_check
  check (section_key in (
    'dashboard',
    'sales',
    'sales_admin',
    'commission',
    'payroll',
    'reports',
    'reports_sales',
    'reports_profitability',
    'prospecting',
    'orders',
    'archived_orders',
    'recurring_orders',
    'canceled_recurring_orders',
    'order_form',
    'centers',
    'products',
    'inventory',
    'receiving',
    'planning',
    'production',
    'time_clock',
    'settings',
    'manage_admins'
  ));

create table if not exists admin_commission_settings (
  profile_id uuid primary key references profiles(id) on delete cascade,
  commission_percent numeric(8, 4) not null default 0 check (commission_percent >= 0 and commission_percent <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

create table if not exists center_sales_assignments (
  center_id uuid primary key references centers(id) on delete cascade,
  sales_profile_id uuid not null references profiles(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

create table if not exists order_commission_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(id) on delete cascade,
  center_id uuid references centers(id) on delete set null,
  sales_profile_id uuid references profiles(id) on delete set null,
  shipped_at timestamptz not null,
  commission_month date not null,
  revenue_cents numeric(14, 4) not null default 0,
  product_cogs_cents numeric(14, 4) not null default 0,
  shipping_cogs_cents numeric(14, 4) not null default 0,
  total_cogs_cents numeric(14, 4) not null default 0,
  gross_profit_cents numeric(14, 4) not null default 0,
  commission_percent numeric(8, 4) not null default 0,
  commission_cents numeric(14, 4) not null default 0,
  cogs_estimated boolean not null default false,
  snapshot_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists monthly_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  sales_profile_id uuid not null references profiles(id) on delete cascade,
  commission_month date not null,
  status text not null default 'locked' check (status in ('locked', 'paid')),
  order_count integer not null default 0 check (order_count >= 0),
  revenue_cents numeric(14, 4) not null default 0,
  product_cogs_cents numeric(14, 4) not null default 0,
  shipping_cogs_cents numeric(14, 4) not null default 0,
  gross_profit_cents numeric(14, 4) not null default 0,
  commission_cents numeric(14, 4) not null default 0,
  locked_at timestamptz,
  locked_by uuid references profiles(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sales_profile_id, commission_month)
);

create index if not exists center_sales_assignments_sales_profile_idx on center_sales_assignments(sales_profile_id);
create index if not exists order_commission_snapshots_sales_profile_idx on order_commission_snapshots(sales_profile_id);
create index if not exists order_commission_snapshots_month_idx on order_commission_snapshots(commission_month);
create index if not exists order_commission_snapshots_center_idx on order_commission_snapshots(center_id);
create index if not exists monthly_commission_payouts_sales_month_idx on monthly_commission_payouts(sales_profile_id, commission_month desc);

alter table admin_commission_settings enable row level security;
alter table center_sales_assignments enable row level security;
alter table order_commission_snapshots enable row level security;
alter table monthly_commission_payouts enable row level security;

drop policy if exists "owner all admin_commission_settings" on admin_commission_settings;
create policy "owner all admin_commission_settings"
  on admin_commission_settings
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "self read admin_commission_settings" on admin_commission_settings;
create policy "self read admin_commission_settings"
  on admin_commission_settings
  for select
  using (profile_id = auth.uid());

drop policy if exists "owner all center_sales_assignments" on center_sales_assignments;
create policy "owner all center_sales_assignments"
  on center_sales_assignments
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "sales self read center_sales_assignments" on center_sales_assignments;
create policy "sales self read center_sales_assignments"
  on center_sales_assignments
  for select
  using (sales_profile_id = auth.uid());

drop policy if exists "owner all order_commission_snapshots" on order_commission_snapshots;
create policy "owner all order_commission_snapshots"
  on order_commission_snapshots
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "sales self read order_commission_snapshots" on order_commission_snapshots;
create policy "sales self read order_commission_snapshots"
  on order_commission_snapshots
  for select
  using (sales_profile_id = auth.uid());

drop policy if exists "owner all monthly_commission_payouts" on monthly_commission_payouts;
create policy "owner all monthly_commission_payouts"
  on monthly_commission_payouts
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "sales self read monthly_commission_payouts" on monthly_commission_payouts;
create policy "sales self read monthly_commission_payouts"
  on monthly_commission_payouts
  for select
  using (sales_profile_id = auth.uid());

insert into admin_commission_settings (profile_id, commission_percent, active)
select id, 0, true
from profiles
where is_admin = true
on conflict (profile_id) do nothing;

with owner_sections(section_key) as (
  values ('sales_admin'), ('commission'), ('payroll')
)
insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select p.id, owner_sections.section_key, true, true
from profiles p
cross join owner_sections
where p.is_admin = true
  and lower(coalesce(p.email, '')) = 'zach@sobrew.com'
on conflict (profile_id, section_key) do update
set can_view = true,
    can_edit = true,
    updated_at = now();

insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select distinct p.id, 'commission', true, false
from profiles p
join admin_permissions ap
  on ap.profile_id = p.id
 and ap.section_key in ('sales', 'prospecting')
 and ap.can_view = true
where p.is_admin = true
  and lower(coalesce(p.email, '')) <> 'zach@sobrew.com'
on conflict (profile_id, section_key) do nothing;

with restricted_sections(section_key) as (
  values ('sales_admin'), ('payroll')
)
insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select p.id, restricted_sections.section_key, false, false
from profiles p
cross join restricted_sections
where p.is_admin = true
  and lower(coalesce(p.email, '')) <> 'zach@sobrew.com'
on conflict (profile_id, section_key) do nothing;

notify pgrst, 'reload schema';

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
    'marketing',
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
    'week_hours',
    'settings',
    'manage_admins'
  ));

create table if not exists marketing_weekly_recaps (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  week_start_date date not null,
  week_end_date date not null,
  work_notes text not null default '',
  results_notes text,
  next_week_notes text,
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, week_start_date),
  check (week_end_date >= week_start_date)
);

create index if not exists marketing_weekly_recaps_week_idx
  on marketing_weekly_recaps(week_start_date desc, updated_at desc);

create index if not exists marketing_weekly_recaps_profile_idx
  on marketing_weekly_recaps(profile_id);

alter table marketing_weekly_recaps enable row level security;

drop policy if exists "admin all marketing_weekly_recaps" on marketing_weekly_recaps;
create policy "admin all marketing_weekly_recaps"
  on marketing_weekly_recaps
  for all
  using (is_admin())
  with check (is_admin());

insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select p.id, 'marketing', true, true
from profiles p
where p.is_admin = true
  and (
    coalesce(p.is_superadmin, false) = true
    or lower(coalesce(p.email, '')) = 'zach@sobrew.com'
  )
on conflict (profile_id, section_key) do update
set can_view = true,
    can_edit = true,
    updated_at = now();

notify pgrst, 'reload schema';

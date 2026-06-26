create table if not exists admin_permissions (
  profile_id uuid not null references profiles(id) on delete cascade,
  section_key text not null,
  can_view boolean not null default false,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, section_key),
  check (section_key in (
    'dashboard',
    'sales',
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
    'settings',
    'manage_admins'
  )),
  check (can_view or not can_edit)
);

create index if not exists admin_permissions_profile_idx on admin_permissions(profile_id);
create index if not exists admin_permissions_section_idx on admin_permissions(section_key);

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references profiles(id) on delete set null,
  target_profile_id uuid references profiles(id) on delete set null,
  action text not null,
  section_key text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_idx on admin_audit_log(actor_profile_id);
create index if not exists admin_audit_log_target_idx on admin_audit_log(target_profile_id);
create index if not exists admin_audit_log_created_at_idx on admin_audit_log(created_at desc);

create or replace function public.is_owner_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.is_admin = true
      and lower(coalesce(p.email, '')) = 'zach@sobrew.com'
  );
$$;

alter table admin_permissions enable row level security;
alter table admin_audit_log enable row level security;

drop policy if exists "owner all admin_permissions" on admin_permissions;
create policy "owner all admin_permissions"
  on admin_permissions
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "self read admin_permissions" on admin_permissions;
create policy "self read admin_permissions"
  on admin_permissions
  for select
  using (profile_id = auth.uid());

drop policy if exists "owner all admin_audit_log" on admin_audit_log;
create policy "owner all admin_audit_log"
  on admin_audit_log
  for all
  using (is_owner_admin())
  with check (is_owner_admin());

drop policy if exists "self read admin_audit_log" on admin_audit_log;
create policy "self read admin_audit_log"
  on admin_audit_log
  for select
  using (actor_profile_id = auth.uid() or target_profile_id = auth.uid());

with owner_sections(section_key) as (
  values
    ('dashboard'),
    ('sales'),
    ('reports'),
    ('reports_sales'),
    ('reports_profitability'),
    ('prospecting'),
    ('orders'),
    ('archived_orders'),
    ('recurring_orders'),
    ('canceled_recurring_orders'),
    ('order_form'),
    ('centers'),
    ('products'),
    ('inventory'),
    ('receiving'),
    ('planning'),
    ('production'),
    ('settings'),
    ('manage_admins')
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

with existing_admin_view_sections(section_key) as (
  values
    ('dashboard'),
    ('sales'),
    ('reports'),
    ('reports_sales'),
    ('prospecting'),
    ('orders'),
    ('archived_orders'),
    ('recurring_orders'),
    ('canceled_recurring_orders'),
    ('order_form'),
    ('centers'),
    ('products'),
    ('inventory'),
    ('receiving'),
    ('planning'),
    ('production'),
    ('settings')
)
insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select p.id, existing_admin_view_sections.section_key, true, false
from profiles p
cross join existing_admin_view_sections
where p.is_admin = true
  and lower(coalesce(p.email, '')) <> 'zach@sobrew.com'
on conflict (profile_id, section_key) do nothing;

with restricted_sections(section_key) as (
  values ('reports_profitability'), ('manage_admins')
)
insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select p.id, restricted_sections.section_key, false, false
from profiles p
cross join restricted_sections
where p.is_admin = true
  and lower(coalesce(p.email, '')) <> 'zach@sobrew.com'
on conflict (profile_id, section_key) do nothing;

notify pgrst, 'reload schema';

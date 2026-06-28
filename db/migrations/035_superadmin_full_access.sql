alter table profiles
  add column if not exists is_superadmin boolean not null default false;

update profiles
set is_admin = true,
    is_active = true,
    is_superadmin = true
where lower(coalesce(email, '')) = 'zach@sobrew.com';

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
      and coalesce(p.is_admin, false) = true
      and (
        lower(coalesce(p.email, '')) = 'zach@sobrew.com'
        or (
          coalesce(p.is_superadmin, false) = true
          and coalesce(p.is_active, true) = true
        )
      )
  );
$$;

with superadmin_sections(section_key) as (
  values
    ('dashboard'),
    ('sales'),
    ('sales_admin'),
    ('commission'),
    ('payroll'),
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
    ('time_clock'),
    ('settings'),
    ('manage_admins')
)
insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select p.id, superadmin_sections.section_key, true, true
from profiles p
cross join superadmin_sections
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

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
    'week_hours',
    'settings',
    'manage_admins'
  ));

insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select p.id, 'week_hours', true, false
from profiles p
where p.is_admin = true
  and (
    coalesce(p.is_superadmin, false) = true
    or lower(coalesce(p.email, '')) = 'zach@sobrew.com'
    or exists (
      select 1
      from admin_permissions ap
      where ap.profile_id = p.id
        and ap.section_key = 'time_clock'
        and ap.can_view = true
    )
  )
on conflict (profile_id, section_key) do update
set can_view = excluded.can_view,
    can_edit = false,
    updated_at = now();

notify pgrst, 'reload schema';

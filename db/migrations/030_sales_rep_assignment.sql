alter table admin_commission_settings
  add column if not exists is_sales_rep boolean not null default false;

create index if not exists admin_commission_settings_sales_rep_idx
  on admin_commission_settings(is_sales_rep)
  where is_sales_rep = true;

insert into admin_commission_settings (profile_id, commission_percent, active, is_sales_rep)
select p.id, 0, true, true
from profiles p
where p.is_admin = true
  and (
    exists (
      select 1
      from center_sales_assignments csa
      where csa.sales_profile_id = p.id
    )
    or exists (
      select 1
      from admin_permissions ap
      where ap.profile_id = p.id
        and ap.section_key in ('sales', 'prospecting')
        and ap.can_view = true
    )
  )
on conflict (profile_id) do update
set is_sales_rep = admin_commission_settings.is_sales_rep or excluded.is_sales_rep,
    active = true,
    updated_at = now();

notify pgrst, 'reload schema';

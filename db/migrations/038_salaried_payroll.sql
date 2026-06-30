alter table admin_time_settings
  add column if not exists compensation_type text not null default 'hourly',
  add column if not exists salary_amount_cents numeric(14, 4) not null default 0 check (salary_amount_cents >= 0),
  add column if not exists salary_frequency text not null default 'annual',
  add column if not exists salary_labor_work_type text not null default 'admin';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_time_settings_compensation_type_check'
      and conrelid = 'admin_time_settings'::regclass
  ) then
    alter table admin_time_settings
      add constraint admin_time_settings_compensation_type_check
      check (compensation_type in ('hourly', 'salary'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_time_settings_salary_frequency_check'
      and conrelid = 'admin_time_settings'::regclass
  ) then
    alter table admin_time_settings
      add constraint admin_time_settings_salary_frequency_check
      check (salary_frequency in ('annual', 'monthly', 'semimonthly', 'biweekly', 'weekly'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_time_settings_salary_labor_work_type_check'
      and conrelid = 'admin_time_settings'::regclass
  ) then
    alter table admin_time_settings
      add constraint admin_time_settings_salary_labor_work_type_check
      check (salary_labor_work_type in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other'));
  end if;
end $$;

update admin_time_settings
set compensation_type = coalesce(nullif(compensation_type, ''), 'hourly'),
    salary_frequency = coalesce(nullif(salary_frequency, ''), 'annual'),
    salary_labor_work_type = coalesce(nullif(salary_labor_work_type, ''), 'admin')
where compensation_type is null
   or salary_frequency is null
   or salary_labor_work_type is null;

notify pgrst, 'reload schema';

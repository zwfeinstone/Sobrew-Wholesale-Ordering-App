alter table admin_time_settings
  drop constraint if exists admin_time_settings_salary_labor_work_type_check;

update admin_time_settings
set salary_labor_work_type = 'admin'
where salary_labor_work_type is null
   or salary_labor_work_type not in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other', 'owner');

alter table admin_time_settings
  add constraint admin_time_settings_salary_labor_work_type_check
  check (salary_labor_work_type in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other', 'owner'));

alter table admin_salary_payroll_payments
  drop constraint if exists admin_salary_payroll_payments_salary_labor_work_type_check;

update admin_salary_payroll_payments
set salary_labor_work_type = 'admin'
where salary_labor_work_type is null
   or salary_labor_work_type not in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other', 'owner');

alter table admin_salary_payroll_payments
  add constraint admin_salary_payroll_payments_salary_labor_work_type_check
  check (salary_labor_work_type in ('production', 'packing', 'receiving', 'shipping', 'sales', 'admin', 'cleaning', 'other', 'owner'));

notify pgrst, 'reload schema';

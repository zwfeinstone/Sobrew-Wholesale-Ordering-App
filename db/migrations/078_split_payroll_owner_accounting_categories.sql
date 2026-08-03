update accounting_transactions
set
  category_id = (select id from accounting_categories where name = 'Payroll Wages & Taxes' limit 1),
  updated_at = now()
where category_id in (select id from accounting_categories where name = 'Payroll & Owner Pay')
  and exists (select 1 from accounting_categories where name = 'Payroll Wages & Taxes');

update accounting_categories
set
  active = false,
  updated_at = now()
where name = 'Payroll & Owner Pay'
  and exists (select 1 from accounting_categories where name = 'Payroll Wages & Taxes');

update accounting_categories
set
  name = 'Payroll Wages & Taxes',
  category_type = 'operating_expense',
  pnl_section = 'operating_expenses',
  display_order = 400,
  is_system = true,
  active = true,
  updated_at = now()
where name = 'Payroll & Owner Pay'
  and not exists (select 1 from accounting_categories where name = 'Payroll Wages & Taxes');

insert into accounting_categories (name, category_type, pnl_section, display_order, is_system)
values
  ('Payroll Wages & Taxes', 'operating_expense', 'operating_expenses', 400, true),
  ('Owner W-2 Payroll', 'operating_expense', 'operating_expenses', 402, true),
  ('Owner Draw / Equity', 'equity', 'none', 2020, true),
  ('Owner Loan Payable', 'liability', 'none', 2040, true)
on conflict (name) do update
set category_type = excluded.category_type,
    pnl_section = excluded.pnl_section,
    display_order = excluded.display_order,
    is_system = true,
    active = true,
    updated_at = now();

insert into accounting_categories (name, category_type, pnl_section, display_order, is_system)
values
  ('Advertising & Marketing', 'operating_expense', 'operating_expenses', 315, true),
  ('Business Meals & Entertainment', 'operating_expense', 'operating_expenses', 332, true),
  ('Travel & Lodging', 'operating_expense', 'operating_expenses', 336, true),
  ('Insurance', 'operating_expense', 'operating_expenses', 345, true),
  ('Office & Retail Supplies', 'operating_expense', 'operating_expenses', 355, true),
  ('Contract Labor / Reimbursements', 'operating_expense', 'operating_expenses', 405, true),
  ('Owner / Personal Review', 'excluded', 'none', 2030, true)
on conflict (name) do update
set category_type = excluded.category_type,
    pnl_section = excluded.pnl_section,
    display_order = excluded.display_order,
    is_system = true,
    active = true,
    updated_at = now();

insert into accounting_categories (name, category_type, pnl_section, display_order, is_system)
values
  ('Deferred Payroll / Compensation Payable', 'liability', 'none', 2050, true)
on conflict (name) do update
set category_type = excluded.category_type,
    pnl_section = excluded.pnl_section,
    display_order = excluded.display_order,
    is_system = true,
    active = true,
    updated_at = now();

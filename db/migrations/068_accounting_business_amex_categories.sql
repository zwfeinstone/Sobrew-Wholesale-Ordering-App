insert into accounting_categories (name, category_type, pnl_section, display_order, is_system)
values
  ('Shipping Labels & Postage COGS', 'cogs', 'cogs', 112, true),
  ('Food & Beverage Ingredients COGS', 'cogs', 'cogs', 125, true),
  ('Equipment & Smallwares', 'operating_expense', 'operating_expenses', 352, true),
  ('Storage & Warehousing', 'operating_expense', 'operating_expenses', 372, true),
  ('Telecom & Internet', 'operating_expense', 'operating_expenses', 374, true),
  ('AI & Automation Tools', 'operating_expense', 'operating_expenses', 376, true),
  ('Ecommerce Platform Fees', 'operating_expense', 'operating_expenses', 382, true),
  ('Printing & Branded Materials', 'operating_expense', 'operating_expenses', 385, true)
on conflict (name) do update
set category_type = excluded.category_type,
    pnl_section = excluded.pnl_section,
    display_order = excluded.display_order,
    is_system = true,
    active = true,
    updated_at = now();

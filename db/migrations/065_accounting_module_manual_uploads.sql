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
    'accounting',
    'reports',
    'reports_sales',
    'reports_profitability',
    'marketing',
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

create table if not exists accounting_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category_type text not null check (category_type in ('revenue', 'cogs', 'operating_expense', 'other_income', 'other_expense', 'asset', 'liability', 'equity', 'excluded')),
  pnl_section text not null default 'none' check (pnl_section in ('revenue', 'cogs', 'operating_expenses', 'other_income', 'other_expenses', 'none')),
  display_order int not null default 1000,
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table if not exists accounting_upload_batches (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'csv' check (source_type in ('csv', 'manual', 'plaid')),
  account_name text,
  account_type text not null default 'other' check (account_type in ('debit_card', 'credit_card', 'bank', 'manual', 'other')),
  file_name text,
  uploaded_by uuid references profiles(id) on delete set null,
  transaction_count int not null default 0 check (transaction_count >= 0),
  total_outflow_cents numeric(14, 4) not null default 0,
  total_inflow_cents numeric(14, 4) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists accounting_transactions (
  id uuid primary key default gen_random_uuid(),
  upload_batch_id uuid references accounting_upload_batches(id) on delete set null,
  external_id text,
  transaction_fingerprint text not null unique,
  source_type text not null default 'csv' check (source_type in ('csv', 'manual', 'plaid')),
  account_name text,
  account_type text not null default 'other' check (account_type in ('debit_card', 'credit_card', 'bank', 'manual', 'other')),
  transaction_date date not null,
  posted_at timestamptz,
  merchant_name text,
  original_description text not null,
  amount_cents numeric(14, 4) not null check (amount_cents <> 0),
  category_id uuid references accounting_categories(id) on delete set null,
  status text not null default 'needs_review' check (status in ('needs_review', 'categorized', 'matched_inventory', 'matched_non_inventory_expense', 'excluded')),
  ai_review_status text not null default 'not_reviewed' check (ai_review_status in ('not_reviewed', 'clean', 'flagged', 'error')),
  ai_review_summary text,
  ai_review_flags jsonb not null default '[]'::jsonb,
  ai_review_model text,
  ai_review_prompt_version text,
  ai_reviewed_at timestamptz,
  review_notes text,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounting_transactions_date_idx
  on accounting_transactions(transaction_date desc);

create index if not exists accounting_transactions_status_idx
  on accounting_transactions(status);

create index if not exists accounting_transactions_ai_review_status_idx
  on accounting_transactions(ai_review_status);

create index if not exists accounting_transactions_category_idx
  on accounting_transactions(category_id);

create index if not exists accounting_transactions_account_idx
  on accounting_transactions(account_name, transaction_date desc);

create table if not exists accounting_transaction_matches (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references accounting_transactions(id) on delete cascade,
  target_type text not null check (target_type in ('inventory_receipt', 'non_inventory_expense', 'production_run', 'order', 'payroll', 'manual', 'other')),
  target_id uuid,
  confidence numeric(5, 2) not null default 0 check (confidence >= 0 and confidence <= 100),
  match_status text not null default 'suggested' check (match_status in ('suggested', 'approved', 'rejected')),
  reason text,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists accounting_transaction_matches_transaction_idx
  on accounting_transaction_matches(transaction_id);

create index if not exists accounting_transaction_matches_target_idx
  on accounting_transaction_matches(target_type, target_id);

create unique index if not exists accounting_transaction_matches_one_approved_idx
  on accounting_transaction_matches(transaction_id)
  where match_status = 'approved';

create table if not exists accounting_transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references accounting_transactions(id) on delete cascade,
  category_id uuid references accounting_categories(id) on delete set null,
  amount_cents numeric(14, 4) not null check (amount_cents <> 0),
  memo text,
  target_type text check (target_type in ('inventory_receipt', 'non_inventory_expense', 'production_run', 'order', 'payroll', 'manual', 'other')),
  target_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists accounting_transaction_splits_transaction_idx
  on accounting_transaction_splits(transaction_id);

alter table accounting_categories enable row level security;
alter table accounting_upload_batches enable row level security;
alter table accounting_transactions enable row level security;
alter table accounting_transaction_matches enable row level security;
alter table accounting_transaction_splits enable row level security;

drop policy if exists "admin all accounting_categories" on accounting_categories;
create policy "admin all accounting_categories"
  on accounting_categories
  for all
  using (is_admin())
  with check (is_admin());

drop policy if exists "admin all accounting_upload_batches" on accounting_upload_batches;
create policy "admin all accounting_upload_batches"
  on accounting_upload_batches
  for all
  using (is_admin())
  with check (is_admin());

drop policy if exists "admin all accounting_transactions" on accounting_transactions;
create policy "admin all accounting_transactions"
  on accounting_transactions
  for all
  using (is_admin())
  with check (is_admin());

drop policy if exists "admin all accounting_transaction_matches" on accounting_transaction_matches;
create policy "admin all accounting_transaction_matches"
  on accounting_transaction_matches
  for all
  using (is_admin())
  with check (is_admin());

drop policy if exists "admin all accounting_transaction_splits" on accounting_transaction_splits;
create policy "admin all accounting_transaction_splits"
  on accounting_transaction_splits
  for all
  using (is_admin())
  with check (is_admin());

grant select, insert, update, delete on accounting_categories to authenticated, service_role;
grant select, insert, update, delete on accounting_upload_batches to authenticated, service_role;
grant select, insert, update, delete on accounting_transactions to authenticated, service_role;
grant select, insert, update, delete on accounting_transaction_matches to authenticated, service_role;
grant select, insert, update, delete on accounting_transaction_splits to authenticated, service_role;

insert into accounting_categories (name, category_type, pnl_section, display_order, is_system)
values
  ('Sales Revenue', 'revenue', 'revenue', 10, true),
  ('Coffee & Ingredients COGS', 'cogs', 'cogs', 100, true),
  ('Packaging & Shipping Supplies COGS', 'cogs', 'cogs', 110, true),
  ('Freight In / Landed Cost', 'cogs', 'cogs', 120, true),
  ('Inventory Purchase / Asset', 'asset', 'none', 200, true),
  ('Shipping & Postage', 'operating_expense', 'operating_expenses', 300, true),
  ('Software & Subscriptions', 'operating_expense', 'operating_expenses', 310, true),
  ('Marketing & Samples', 'operating_expense', 'operating_expenses', 320, true),
  ('Meals & Travel', 'operating_expense', 'operating_expenses', 330, true),
  ('Fuel & Auto', 'operating_expense', 'operating_expenses', 340, true),
  ('Repairs & Maintenance', 'operating_expense', 'operating_expenses', 350, true),
  ('Professional Fees', 'operating_expense', 'operating_expenses', 360, true),
  ('Rent & Utilities', 'operating_expense', 'operating_expenses', 370, true),
  ('Bank & Processing Fees', 'operating_expense', 'operating_expenses', 380, true),
  ('Taxes, Licenses & Permits', 'operating_expense', 'operating_expenses', 390, true),
  ('Payroll & Owner Pay', 'operating_expense', 'operating_expenses', 400, true),
  ('Other Operating Expense', 'operating_expense', 'operating_expenses', 900, true),
  ('Other Income', 'other_income', 'other_income', 1000, true),
  ('Other Expense', 'other_expense', 'other_expenses', 1010, true),
  ('Transfer / Credit Card Payment', 'excluded', 'none', 2000, true),
  ('Refund / Credit', 'excluded', 'none', 2010, true),
  ('Owner Draw / Equity', 'equity', 'none', 2020, true),
  ('Uncategorized', 'excluded', 'none', 9999, true)
on conflict (name) do update
set category_type = excluded.category_type,
    pnl_section = excluded.pnl_section,
    display_order = excluded.display_order,
    is_system = true,
    active = true,
    updated_at = now();

insert into admin_permissions (profile_id, section_key, can_view, can_edit)
select p.id, 'accounting', true, true
from profiles p
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

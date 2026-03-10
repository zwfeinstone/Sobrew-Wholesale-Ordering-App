alter table recurring_orders
add column if not exists last_generated_at timestamptz;

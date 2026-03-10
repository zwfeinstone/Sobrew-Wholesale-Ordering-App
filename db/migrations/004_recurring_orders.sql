create table if not exists recurring_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  source_order_id uuid references orders(id) on delete cascade,
  frequency text not null check (frequency in ('2_weeks','monthly')),
  amount_cents int not null check (amount_cents >= 0),
  active boolean not null default true,
  created_at timestamptz default now()
);

alter table recurring_orders enable row level security;

create policy "admin all recurring_orders" on recurring_orders for all using (is_admin()) with check (is_admin());
create policy "self create recurring_orders" on recurring_orders for insert with check (user_id = auth.uid());
create policy "self read recurring_orders" on recurring_orders for select using (user_id = auth.uid());

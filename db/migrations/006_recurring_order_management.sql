alter table recurring_orders
add column if not exists status text not null default 'active' check (status in ('active','paused','canceled'));

update recurring_orders
set status = case when active then 'active' else 'paused' end
where status is null or status = '';

drop policy if exists "self update recurring_orders" on recurring_orders;
create policy "self update recurring_orders" on recurring_orders for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists recurring_order_items (
  id uuid primary key default gen_random_uuid(),
  recurring_order_id uuid not null references recurring_orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name_snapshot text,
  qty int not null check (qty > 0),
  unit_price_cents int not null check (unit_price_cents >= 0),
  line_total_cents int not null check (line_total_cents >= 0)
);

alter table recurring_order_items enable row level security;

drop policy if exists "admin all recurring_order_items" on recurring_order_items;
create policy "admin all recurring_order_items" on recurring_order_items for all using (is_admin()) with check (is_admin());

drop policy if exists "self read recurring_order_items" on recurring_order_items;
create policy "self read recurring_order_items" on recurring_order_items for select using (
  exists(select 1 from recurring_orders ro where ro.id = recurring_order_items.recurring_order_id and ro.user_id = auth.uid())
);

drop policy if exists "self create recurring_order_items" on recurring_order_items;
create policy "self create recurring_order_items" on recurring_order_items for insert with check (
  exists(select 1 from recurring_orders ro where ro.id = recurring_order_items.recurring_order_id and ro.user_id = auth.uid())
);

drop policy if exists "self update recurring_order_items" on recurring_order_items;
create policy "self update recurring_order_items" on recurring_order_items for update using (
  exists(select 1 from recurring_orders ro where ro.id = recurring_order_items.recurring_order_id and ro.user_id = auth.uid())
) with check (
  exists(select 1 from recurring_orders ro where ro.id = recurring_order_items.recurring_order_id and ro.user_id = auth.uid())
);

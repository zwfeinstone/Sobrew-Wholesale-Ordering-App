create table if not exists order_item_shipping_boxes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  order_item_id uuid not null references order_items(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id) on delete restrict,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit_cost_cents numeric(14, 4) not null default 0 check (unit_cost_cents >= 0),
  total_cost_cents numeric(14, 4) not null default 0 check (total_cost_cents >= 0),
  cogs_estimated boolean not null default false,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_item_shipping_boxes_order_idx on order_item_shipping_boxes(order_id);
create index if not exists order_item_shipping_boxes_order_item_idx on order_item_shipping_boxes(order_item_id);
create index if not exists order_item_shipping_boxes_inventory_item_idx on order_item_shipping_boxes(inventory_item_id);

alter table order_item_shipping_boxes enable row level security;

drop policy if exists "admin all order_item_shipping_boxes" on order_item_shipping_boxes;
create policy "admin all order_item_shipping_boxes"
  on order_item_shipping_boxes
  for all
  using (is_admin())
  with check (is_admin());

notify pgrst, 'reload schema';

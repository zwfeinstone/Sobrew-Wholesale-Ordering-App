alter table orders
  add column if not exists order_kind text not null default 'standard',
  add column if not exists prospecting_lead_id uuid references prospecting_leads(id) on delete set null,
  add column if not exists shipping_company text;

alter table orders
  drop constraint if exists orders_order_kind_check;

alter table orders
  add constraint orders_order_kind_check
  check (order_kind in ('standard', 'prospecting_sample'));

create index if not exists orders_order_kind_idx on orders(order_kind);
create index if not exists orders_prospecting_lead_id_idx on orders(prospecting_lead_id);

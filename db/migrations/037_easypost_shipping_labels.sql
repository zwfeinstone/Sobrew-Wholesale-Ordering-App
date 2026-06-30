alter table app_settings
  add column if not exists shipping_origin_name text,
  add column if not exists shipping_origin_company text,
  add column if not exists shipping_origin_address1 text,
  add column if not exists shipping_origin_address2 text,
  add column if not exists shipping_origin_city text,
  add column if not exists shipping_origin_state text,
  add column if not exists shipping_origin_zip text,
  add column if not exists shipping_origin_country text not null default 'US',
  add column if not exists shipping_origin_phone text,
  add column if not exists shipping_origin_email text;

create table if not exists order_shipping_labels (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  provider text not null default 'easypost',
  package_index int not null default 1 check (package_index > 0),
  status text not null default 'quoted' check (status in ('quoted', 'purchased', 'voided', 'error')),
  easypost_shipment_id text,
  easypost_rate_id text,
  easypost_postage_label_id text,
  easypost_refund_id text,
  carrier text,
  service text,
  tracking_code text,
  label_url text,
  label_pdf_url text,
  label_file_type text,
  label_cost_cents numeric(14, 4) check (label_cost_cents is null or label_cost_cents >= 0),
  currency text,
  package_length_in numeric(14, 4) not null check (package_length_in > 0),
  package_width_in numeric(14, 4) not null check (package_width_in > 0),
  package_height_in numeric(14, 4) not null check (package_height_in > 0),
  package_weight_oz numeric(14, 4) not null check (package_weight_oz > 0),
  rates_json jsonb not null default '[]'::jsonb,
  raw_response jsonb,
  error_message text,
  purchased_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_shipping_labels_order_idx on order_shipping_labels(order_id);
create index if not exists order_shipping_labels_status_idx on order_shipping_labels(status);
create index if not exists order_shipping_labels_easypost_shipment_idx on order_shipping_labels(easypost_shipment_id);

alter table order_shipping_labels enable row level security;

drop policy if exists "admin all order_shipping_labels" on order_shipping_labels;
create policy "admin all order_shipping_labels"
  on order_shipping_labels
  for all
  using (is_admin())
  with check (is_admin());

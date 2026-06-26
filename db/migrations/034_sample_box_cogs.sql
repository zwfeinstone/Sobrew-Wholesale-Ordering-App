create table if not exists sample_box_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  fixed_shipping_cents numeric(14, 4) not null default 0 check (fixed_shipping_cents >= 0),
  fixed_misc_cents numeric(14, 4) not null default 0 check (fixed_misc_cents >= 0),
  active boolean not null default true,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sample_box_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references sample_box_templates(id) on delete cascade,
  item_kind text not null check (item_kind in ('inventory_item', 'product')),
  inventory_item_id uuid references inventory_items(id) on delete restrict,
  product_id uuid references products(id) on delete restrict,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null check (unit in ('lb', 'oz', 'each', 'case')),
  label text,
  sort_order integer not null default 0,
  system_key text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sample_box_template_items_one_source_check check (
    (item_kind = 'inventory_item' and inventory_item_id is not null and product_id is null)
    or
    (item_kind = 'product' and product_id is not null and inventory_item_id is null)
  )
);

create unique index if not exists sample_box_template_items_template_system_key_idx
  on sample_box_template_items(template_id, system_key)
  where system_key is not null;

create index if not exists sample_box_template_items_template_idx on sample_box_template_items(template_id);
create index if not exists sample_box_template_items_inventory_item_idx on sample_box_template_items(inventory_item_id);
create index if not exists sample_box_template_items_product_idx on sample_box_template_items(product_id);

create table if not exists sample_box_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references sample_box_templates(id) on delete set null,
  center_id uuid references centers(id) on delete set null,
  prospect_name text,
  sales_profile_id uuid references profiles(id) on delete set null,
  quantity_boxes numeric(14, 4) not null default 1 check (quantity_boxes > 0),
  fixed_shipping_cents numeric(14, 4) not null default 0 check (fixed_shipping_cents >= 0),
  fixed_misc_cents numeric(14, 4) not null default 0 check (fixed_misc_cents >= 0),
  inventory_cogs_cents numeric(14, 4) not null default 0 check (inventory_cogs_cents >= 0),
  product_cogs_cents numeric(14, 4) not null default 0 check (product_cogs_cents >= 0),
  total_cogs_cents numeric(14, 4) not null default 0 check (total_cogs_cents >= 0),
  cogs_estimated boolean not null default false,
  sent_at timestamptz not null default now(),
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists sample_box_runs_sent_idx on sample_box_runs(sent_at desc);
create index if not exists sample_box_runs_center_idx on sample_box_runs(center_id);
create index if not exists sample_box_runs_sales_profile_idx on sample_box_runs(sales_profile_id);
create index if not exists sample_box_runs_template_idx on sample_box_runs(template_id);

create table if not exists sample_box_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references sample_box_runs(id) on delete cascade,
  item_kind text not null check (item_kind in ('inventory_item', 'product')),
  inventory_item_id uuid references inventory_items(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  label text,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null check (unit in ('lb', 'oz', 'each', 'case')),
  unit_cost_cents numeric(14, 4) not null default 0 check (unit_cost_cents >= 0),
  total_cost_cents numeric(14, 4) not null default 0 check (total_cost_cents >= 0),
  cogs_estimated boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists sample_box_run_items_run_idx on sample_box_run_items(run_id);
create index if not exists sample_box_run_items_inventory_item_idx on sample_box_run_items(inventory_item_id);
create index if not exists sample_box_run_items_product_idx on sample_box_run_items(product_id);

alter table inventory_movements
  add column if not exists sample_box_run_id uuid references sample_box_runs(id) on delete set null,
  add column if not exists sample_box_run_item_id uuid references sample_box_run_items(id) on delete set null;

alter table inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in ('receipt', 'production_consume', 'production_output', 'shipment_consume', 'sample_box_consume', 'adjustment'));

create index if not exists inventory_movements_sample_box_run_idx on inventory_movements(sample_box_run_id);
create index if not exists inventory_movements_sample_box_run_item_idx on inventory_movements(sample_box_run_item_id);

alter table sample_box_templates enable row level security;
alter table sample_box_template_items enable row level security;
alter table sample_box_runs enable row level security;
alter table sample_box_run_items enable row level security;

drop policy if exists "admin all sample_box_templates" on sample_box_templates;
create policy "admin all sample_box_templates"
  on sample_box_templates
  for all
  using (is_admin())
  with check (is_admin());

drop policy if exists "admin all sample_box_template_items" on sample_box_template_items;
create policy "admin all sample_box_template_items"
  on sample_box_template_items
  for all
  using (is_admin())
  with check (is_admin());

drop policy if exists "admin all sample_box_runs" on sample_box_runs;
create policy "admin all sample_box_runs"
  on sample_box_runs
  for all
  using (is_admin())
  with check (is_admin());

drop policy if exists "admin all sample_box_run_items" on sample_box_run_items;
create policy "admin all sample_box_run_items"
  on sample_box_run_items
  for all
  using (is_admin())
  with check (is_admin());

insert into sample_box_templates (key, name, fixed_shipping_cents, fixed_misc_cents, active, notes)
values (
  'default_sample_box',
  'Sample Box',
  800,
  300,
  true,
  'Default sample box template for prospecting samples.'
)
on conflict (key) do nothing;

do $$
declare
  v_template_id uuid;
  v_item_id uuid;
  v_product_id uuid;
begin
  select id into v_template_id
  from sample_box_templates
  where key = 'default_sample_box'
  limit 1;

  if v_template_id is null then
    return;
  end if;

  select id into v_item_id
  from inventory_items
  where item_type = 'raw_coffee'
    and name ilike '%meeting%'
    and name ilike '%dark%'
  order by name
  limit 1;

  if v_item_id is not null then
    insert into sample_box_template_items (
      template_id,
      item_kind,
      inventory_item_id,
      quantity,
      unit,
      label,
      sort_order,
      system_key
    )
    values (
      v_template_id,
      'inventory_item',
      v_item_id,
      8,
      'oz',
      '8 oz Meeting Dark Roast Coffee',
      10,
      'meeting_dark_roast_8oz'
    )
    on conflict (template_id, system_key) where system_key is not null do nothing;
  end if;

  select id into v_item_id
  from inventory_items
  where item_type = 'raw_coffee'
    and name ilike '%meeting%'
    and name ilike '%medium%'
  order by name
  limit 1;

  if v_item_id is not null then
    insert into sample_box_template_items (
      template_id,
      item_kind,
      inventory_item_id,
      quantity,
      unit,
      label,
      sort_order,
      system_key
    )
    values (
      v_template_id,
      'inventory_item',
      v_item_id,
      8,
      'oz',
      '8 oz Meeting Medium Roast Coffee',
      20,
      'meeting_medium_roast_8oz'
    )
    on conflict (template_id, system_key) where system_key is not null do nothing;
  end if;

  select id into v_product_id
  from products
  where active is not false
    and name ilike '%12%'
    and name ilike '%whole%'
    and name ilike '%medium%'
    and name ilike '%meeting%'
  order by name
  limit 1;

  if v_product_id is null then
    select id into v_product_id
    from products
    where active is not false
      and name ilike '%medium%'
      and name ilike '%meeting%'
    order by name
    limit 1;
  end if;

  if v_product_id is not null then
    insert into sample_box_template_items (
      template_id,
      item_kind,
      product_id,
      quantity,
      unit,
      label,
      sort_order,
      system_key
    )
    values (
      v_template_id,
      'product',
      v_product_id,
      1,
      'each',
      '12 oz Whole Bean Medium Roast Meeting',
      30,
      'meeting_medium_whole_bean_12oz'
    )
    on conflict (template_id, system_key) where system_key is not null do nothing;
  end if;

  select id into v_item_id
  from inventory_items
  where sku = 'BOX-12X7X4'
  limit 1;

  if v_item_id is not null then
    insert into sample_box_template_items (
      template_id,
      item_kind,
      inventory_item_id,
      quantity,
      unit,
      label,
      sort_order,
      system_key
    )
    values (
      v_template_id,
      'inventory_item',
      v_item_id,
      1,
      'each',
      '12x7x4 box',
      40,
      'box_12x7x4'
    )
    on conflict (template_id, system_key) where system_key is not null do nothing;
  end if;
end $$;

notify pgrst, 'reload schema';

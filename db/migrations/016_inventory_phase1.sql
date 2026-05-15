create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sku text unique,
  description text,
  item_type text not null check (item_type in ('raw_coffee', 'supply', 'finished_good')),
  base_unit text not null check (base_unit in ('lb', 'oz', 'each', 'case')),
  product_id uuid references products(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_items_product_id_idx
  on inventory_items(product_id)
  where product_id is not null;

create index if not exists inventory_items_type_idx on inventory_items(item_type);

create table if not exists inventory_lots (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  lot_code text not null,
  source_type text not null default 'purchase' check (source_type in ('purchase', 'production', 'adjustment')),
  quantity_received numeric(14, 4) not null check (quantity_received >= 0),
  quantity_remaining numeric(14, 4) not null check (quantity_remaining >= 0),
  unit_cost_cents numeric(14, 4) not null default 0 check (unit_cost_cents >= 0),
  received_at timestamptz not null default now(),
  production_run_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_lots_item_idx on inventory_lots(inventory_item_id);
create index if not exists inventory_lots_remaining_idx on inventory_lots(inventory_item_id, quantity_remaining);

create table if not exists inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  lot_id uuid references inventory_lots(id) on delete set null,
  supplier text,
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null check (unit in ('lb', 'oz', 'each', 'case')),
  item_unit_cost_cents numeric(14, 4) not null default 0 check (item_unit_cost_cents >= 0),
  freight_cents numeric(14, 4) not null default 0 check (freight_cents >= 0),
  other_cost_cents numeric(14, 4) not null default 0 check (other_cost_cents >= 0),
  landed_unit_cost_cents numeric(14, 4) not null default 0 check (landed_unit_cost_cents >= 0),
  received_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_receipts_item_idx on inventory_receipts(inventory_item_id);

create table if not exists product_recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade unique,
  output_qty numeric(14, 4) not null default 1 check (output_qty > 0),
  waste_percent numeric(8, 4) not null default 0 check (waste_percent >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_recipe_components (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references product_recipes(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id),
  quantity numeric(14, 4) not null check (quantity > 0),
  unit text not null check (unit in ('lb', 'oz', 'each', 'case')),
  sort_order int not null default 0,
  notes text
);

create index if not exists product_recipe_components_recipe_idx on product_recipe_components(recipe_id);

create table if not exists production_runs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  finished_lot_id uuid references inventory_lots(id) on delete set null,
  quantity_produced numeric(14, 4) not null check (quantity_produced > 0),
  waste_quantity numeric(14, 4) not null default 0 check (waste_quantity >= 0),
  estimated_unit_cost_cents numeric(14, 4),
  actual_unit_cost_cents numeric(14, 4),
  notes text,
  produced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists production_runs_product_idx on production_runs(product_id);

alter table inventory_lots
  drop constraint if exists inventory_lots_production_run_id_fkey;

alter table inventory_lots
  add constraint inventory_lots_production_run_id_fkey
  foreign key (production_run_id) references production_runs(id) on delete set null;

create table if not exists production_run_inputs (
  id uuid primary key default gen_random_uuid(),
  production_run_id uuid not null references production_runs(id) on delete cascade,
  inventory_item_id uuid not null references inventory_items(id),
  quantity_expected numeric(14, 4) not null default 0 check (quantity_expected >= 0),
  quantity_used numeric(14, 4) not null check (quantity_used >= 0),
  unit text not null check (unit in ('lb', 'oz', 'each', 'case')),
  cost_cents numeric(14, 4) not null default 0 check (cost_cents >= 0)
);

create index if not exists production_run_inputs_run_idx on production_run_inputs(production_run_id);

create table if not exists inventory_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  lot_id uuid references inventory_lots(id) on delete set null,
  movement_type text not null check (movement_type in ('receipt', 'production_consume', 'production_output', 'adjustment')),
  quantity_change numeric(14, 4) not null,
  unit text not null check (unit in ('lb', 'oz', 'each', 'case')),
  unit_cost_cents numeric(14, 4) not null default 0,
  production_run_id uuid references production_runs(id) on delete set null,
  receipt_id uuid references inventory_receipts(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_item_idx on inventory_movements(inventory_item_id);
create index if not exists inventory_movements_lot_idx on inventory_movements(lot_id);

alter table inventory_items enable row level security;
alter table inventory_lots enable row level security;
alter table inventory_receipts enable row level security;
alter table product_recipes enable row level security;
alter table product_recipe_components enable row level security;
alter table production_runs enable row level security;
alter table production_run_inputs enable row level security;
alter table inventory_movements enable row level security;

drop policy if exists "admin all inventory_items" on inventory_items;
create policy "admin all inventory_items" on inventory_items for all using (is_admin()) with check (is_admin());

drop policy if exists "admin all inventory_lots" on inventory_lots;
create policy "admin all inventory_lots" on inventory_lots for all using (is_admin()) with check (is_admin());

drop policy if exists "admin all inventory_receipts" on inventory_receipts;
create policy "admin all inventory_receipts" on inventory_receipts for all using (is_admin()) with check (is_admin());

drop policy if exists "admin all product_recipes" on product_recipes;
create policy "admin all product_recipes" on product_recipes for all using (is_admin()) with check (is_admin());

drop policy if exists "admin all product_recipe_components" on product_recipe_components;
create policy "admin all product_recipe_components" on product_recipe_components for all using (is_admin()) with check (is_admin());

drop policy if exists "admin all production_runs" on production_runs;
create policy "admin all production_runs" on production_runs for all using (is_admin()) with check (is_admin());

drop policy if exists "admin all production_run_inputs" on production_run_inputs;
create policy "admin all production_run_inputs" on production_run_inputs for all using (is_admin()) with check (is_admin());

drop policy if exists "admin all inventory_movements" on inventory_movements;
create policy "admin all inventory_movements" on inventory_movements for all using (is_admin()) with check (is_admin());

insert into inventory_items (name, sku, item_type, base_unit, active)
values
  ('5lb Bags', 'SUP-5LB-BAG', 'supply', 'each', true),
  ('2lb Bags', 'SUP-2LB-BAG', 'supply', 'each', true),
  ('Fraction Pack Bags', 'SUP-FRACTION-BAG', 'supply', 'each', true),
  ('K-Cups', 'SUP-KCUP', 'supply', 'each', true),
  ('Filter Pack Bags', 'SUP-FILTER-BAG', 'supply', 'each', true),
  ('Tape', 'SUP-TAPE', 'supply', 'each', true),
  ('Box 12x7x4', 'BOX-12X7X4', 'supply', 'each', true),
  ('Box 12x12x10', 'BOX-12X12X10', 'supply', 'each', true),
  ('Box 14x14x14', 'BOX-14X14X14', 'supply', 'each', true),
  ('Box 16x16x16', 'BOX-16X16X16', 'supply', 'each', true)
on conflict (sku) do nothing;

create or replace function public.record_inventory_production_run(
  p_product_id uuid,
  p_quantity_produced numeric,
  p_waste_quantity numeric,
  p_notes text,
  p_estimated_unit_cost_cents numeric,
  p_components jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product record;
  v_finished_item_id uuid;
  v_run_id uuid;
  v_finished_lot_id uuid;
  v_component jsonb;
  v_item_id uuid;
  v_unit text;
  v_expected numeric;
  v_used numeric;
  v_available numeric;
  v_remaining_to_consume numeric;
  v_take numeric;
  v_lot record;
  v_component_cost numeric;
  v_total_cost numeric := 0;
  v_actual_unit_cost numeric := 0;
begin
  if not is_admin() then
    raise exception 'Only admins can record production runs.';
  end if;

  if p_quantity_produced is null or p_quantity_produced <= 0 then
    raise exception 'Quantity produced must be greater than zero.';
  end if;

  select id, name, sku
    into v_product
    from products
    where id = p_product_id;

  if not found then
    raise exception 'Product not found.';
  end if;

  select id
    into v_finished_item_id
    from inventory_items
    where product_id = p_product_id
    limit 1;

  if v_finished_item_id is null then
    insert into inventory_items (name, sku, item_type, base_unit, product_id, active)
    values (
      v_product.name,
      'FIN-' || coalesce(nullif(v_product.sku, ''), left(p_product_id::text, 8)),
      'finished_good',
      'each',
      p_product_id,
      true
    )
    returning id into v_finished_item_id;
  end if;

  for v_component in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb))
  loop
    v_item_id := (v_component ->> 'inventory_item_id')::uuid;
    v_used := coalesce((v_component ->> 'quantity_used')::numeric, 0);

    if v_used < 0 then
      raise exception 'Component quantity cannot be negative.';
    end if;

    select coalesce(sum(quantity_remaining), 0)
      into v_available
      from inventory_lots
      where inventory_item_id = v_item_id
        and quantity_remaining > 0;

    if v_available < v_used then
      raise exception 'Insufficient inventory for component %. Available %, needed %.', v_item_id, v_available, v_used;
    end if;
  end loop;

  insert into production_runs (
    product_id,
    quantity_produced,
    waste_quantity,
    estimated_unit_cost_cents,
    notes
  )
  values (
    p_product_id,
    p_quantity_produced,
    coalesce(p_waste_quantity, 0),
    p_estimated_unit_cost_cents,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_run_id;

  for v_component in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb))
  loop
    v_item_id := (v_component ->> 'inventory_item_id')::uuid;
    v_expected := coalesce((v_component ->> 'quantity_expected')::numeric, 0);
    v_used := coalesce((v_component ->> 'quantity_used')::numeric, 0);
    v_unit := coalesce(nullif(v_component ->> 'unit', ''), 'each');
    v_remaining_to_consume := v_used;
    v_component_cost := 0;

    for v_lot in
      select id, quantity_remaining, unit_cost_cents
      from inventory_lots
      where inventory_item_id = v_item_id
        and quantity_remaining > 0
      order by received_at asc, created_at asc
    loop
      exit when v_remaining_to_consume <= 0;
      v_take := least(v_lot.quantity_remaining, v_remaining_to_consume);

      update inventory_lots
      set quantity_remaining = quantity_remaining - v_take
      where id = v_lot.id;

      insert into inventory_movements (
        inventory_item_id,
        lot_id,
        movement_type,
        quantity_change,
        unit,
        unit_cost_cents,
        production_run_id,
        notes
      )
      values (
        v_item_id,
        v_lot.id,
        'production_consume',
        -v_take,
        v_unit,
        v_lot.unit_cost_cents,
        v_run_id,
        'Production consumption'
      );

      v_component_cost := v_component_cost + (v_take * v_lot.unit_cost_cents);
      v_remaining_to_consume := v_remaining_to_consume - v_take;
    end loop;

    insert into production_run_inputs (
      production_run_id,
      inventory_item_id,
      quantity_expected,
      quantity_used,
      unit,
      cost_cents
    )
    values (
      v_run_id,
      v_item_id,
      v_expected,
      v_used,
      v_unit,
      v_component_cost
    );

    v_total_cost := v_total_cost + v_component_cost;
  end loop;

  v_actual_unit_cost := case when p_quantity_produced > 0 then v_total_cost / p_quantity_produced else 0 end;

  update production_runs
  set actual_unit_cost_cents = v_actual_unit_cost
  where id = v_run_id;

  insert into inventory_lots (
    inventory_item_id,
    lot_code,
    source_type,
    quantity_received,
    quantity_remaining,
    unit_cost_cents,
    production_run_id,
    received_at,
    notes
  )
  values (
    v_finished_item_id,
    'RUN-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
    'production',
    p_quantity_produced,
    p_quantity_produced,
    v_actual_unit_cost,
    v_run_id,
    now(),
    'Finished goods produced from production run'
  )
  returning id into v_finished_lot_id;

  update production_runs
  set finished_lot_id = v_finished_lot_id
  where id = v_run_id;

  insert into inventory_movements (
    inventory_item_id,
    lot_id,
    movement_type,
    quantity_change,
    unit,
    unit_cost_cents,
    production_run_id,
    notes
  )
  values (
    v_finished_item_id,
    v_finished_lot_id,
    'production_output',
    p_quantity_produced,
    'each',
    v_actual_unit_cost,
    v_run_id,
    'Finished goods output'
  );

  return v_run_id;
end;
$$;

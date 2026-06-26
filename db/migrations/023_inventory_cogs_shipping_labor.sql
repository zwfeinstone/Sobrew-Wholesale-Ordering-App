alter table inventory_items
  drop constraint if exists inventory_items_item_type_check;

update inventory_items
set item_type = 'material_supply'
where item_type = 'supply';

update inventory_items
set active = false
where sku = 'SUP-TAPE';

alter table inventory_items
  add constraint inventory_items_item_type_check
  check (item_type in ('raw_coffee', 'material_supply', 'finished_good'));

alter table products
  add column if not exists shipping_box_count_required boolean not null default false;

alter table orders
  add column if not exists shipping_cost_cents numeric(14, 4) check (shipping_cost_cents is null or shipping_cost_cents >= 0),
  add column if not exists shipped_at timestamptz;

alter table order_items
  add column if not exists shipping_boxes_used numeric(14, 4) check (shipping_boxes_used is null or shipping_boxes_used >= 0);

alter table product_recipes
  add column if not exists labor_minutes numeric(14, 4) not null default 0 check (labor_minutes >= 0),
  add column if not exists labor_rate_cents numeric(14, 4) not null default 0 check (labor_rate_cents >= 0),
  add column if not exists shipping_label_qty numeric(14, 4) not null default 0 check (shipping_label_qty >= 0),
  add column if not exists branding_label_qty numeric(14, 4) not null default 0 check (branding_label_qty >= 0);

alter table product_recipe_components
  add column if not exists component_role text;

alter table production_runs
  add column if not exists fixed_cost_cents numeric(14, 4) not null default 0 check (fixed_cost_cents >= 0),
  add column if not exists expected_labor_cost_cents numeric(14, 4) not null default 0 check (expected_labor_cost_cents >= 0),
  add column if not exists actual_labor_cost_cents numeric(14, 4) not null default 0 check (actual_labor_cost_cents >= 0),
  add column if not exists labor_minutes numeric(14, 4) not null default 0 check (labor_minutes >= 0),
  add column if not exists labor_rate_cents numeric(14, 4) not null default 0 check (labor_rate_cents >= 0);

create table if not exists non_inventory_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_type text not null check (expense_type in ('tape', 'shipping_label', 'branding_label', 'other')),
  vendor text,
  amount_cents numeric(14, 4) not null check (amount_cents >= 0),
  spent_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

alter table non_inventory_expenses enable row level security;

drop policy if exists "admin all non_inventory_expenses" on non_inventory_expenses;
create policy "admin all non_inventory_expenses"
  on non_inventory_expenses
  for all
  using (is_admin())
  with check (is_admin());

create table if not exists inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references inventory_items(id) on delete cascade,
  lot_id uuid references inventory_lots(id) on delete set null,
  adjustment_type text not null check (adjustment_type in ('starting_count', 'count_correction', 'damaged', 'sample', 'lost', 'expired', 'other')),
  quantity_change numeric(14, 4) not null,
  unit text not null check (unit in ('lb', 'oz', 'each', 'case')),
  unit_cost_cents numeric(14, 4) not null default 0 check (unit_cost_cents >= 0),
  notes text,
  adjusted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table inventory_adjustments enable row level security;

drop policy if exists "admin all inventory_adjustments" on inventory_adjustments;
create policy "admin all inventory_adjustments"
  on inventory_adjustments
  for all
  using (is_admin())
  with check (is_admin());

drop function if exists public.record_inventory_production_run(uuid, numeric, numeric, text, numeric, jsonb);

create or replace function public.record_inventory_production_run(
  p_product_id uuid,
  p_quantity_produced numeric,
  p_waste_quantity numeric,
  p_notes text,
  p_estimated_unit_cost_cents numeric,
  p_components jsonb,
  p_fixed_cost_cents numeric default 0,
  p_expected_labor_cost_cents numeric default 0,
  p_actual_labor_cost_cents numeric default 0,
  p_labor_minutes numeric default 0,
  p_labor_rate_cents numeric default 0
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
  v_fixed_cost numeric := greatest(coalesce(p_fixed_cost_cents, 0), 0);
  v_expected_labor_cost numeric := greatest(coalesce(p_expected_labor_cost_cents, 0), 0);
  v_actual_labor_cost numeric := greatest(coalesce(p_actual_labor_cost_cents, 0), 0);
  v_labor_minutes numeric := greatest(coalesce(p_labor_minutes, 0), 0);
  v_labor_rate numeric := greatest(coalesce(p_labor_rate_cents, 0), 0);
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
    fixed_cost_cents,
    expected_labor_cost_cents,
    actual_labor_cost_cents,
    labor_minutes,
    labor_rate_cents,
    notes
  )
  values (
    p_product_id,
    p_quantity_produced,
    coalesce(p_waste_quantity, 0),
    p_estimated_unit_cost_cents,
    v_fixed_cost,
    v_expected_labor_cost,
    v_actual_labor_cost,
    v_labor_minutes,
    v_labor_rate,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_run_id;

  v_total_cost := v_fixed_cost + v_actual_labor_cost;

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

notify pgrst, 'reload schema';

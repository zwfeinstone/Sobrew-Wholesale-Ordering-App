alter table order_items
  add column if not exists cogs_material_cents numeric(14, 4) check (cogs_material_cents is null or cogs_material_cents >= 0),
  add column if not exists cogs_labor_cents numeric(14, 4) check (cogs_labor_cents is null or cogs_labor_cents >= 0),
  add column if not exists cogs_fixed_cents numeric(14, 4) check (cogs_fixed_cents is null or cogs_fixed_cents >= 0),
  add column if not exists cogs_tape_cents numeric(14, 4) check (cogs_tape_cents is null or cogs_tape_cents >= 0),
  add column if not exists cogs_shipping_label_cents numeric(14, 4) check (cogs_shipping_label_cents is null or cogs_shipping_label_cents >= 0),
  add column if not exists cogs_branding_label_cents numeric(14, 4) check (cogs_branding_label_cents is null or cogs_branding_label_cents >= 0),
  add column if not exists cogs_fixed_other_cents numeric(14, 4) check (cogs_fixed_other_cents is null or cogs_fixed_other_cents >= 0),
  add column if not exists cogs_product_cents numeric(14, 4) check (cogs_product_cents is null or cogs_product_cents >= 0),
  add column if not exists cogs_shipping_cents numeric(14, 4) check (cogs_shipping_cents is null or cogs_shipping_cents >= 0),
  add column if not exists cogs_total_cents numeric(14, 4) check (cogs_total_cents is null or cogs_total_cents >= 0),
  add column if not exists cogs_unit_cents numeric(14, 4) check (cogs_unit_cents is null or cogs_unit_cents >= 0),
  add column if not exists cogs_source text,
  add column if not exists cogs_estimated boolean not null default false,
  add column if not exists cogs_snapshot_at timestamptz;

create index if not exists order_items_cogs_snapshot_idx on order_items(cogs_snapshot_at);
create index if not exists order_items_cogs_source_idx on order_items(cogs_source);

alter table production_runs
  add column if not exists fixed_tape_cost_cents numeric(14, 4) not null default 0 check (fixed_tape_cost_cents >= 0),
  add column if not exists fixed_shipping_label_cost_cents numeric(14, 4) not null default 0 check (fixed_shipping_label_cost_cents >= 0),
  add column if not exists fixed_branding_label_cost_cents numeric(14, 4) not null default 0 check (fixed_branding_label_cost_cents >= 0),
  add column if not exists fixed_other_cost_cents numeric(14, 4) not null default 0 check (fixed_other_cost_cents >= 0);

update production_runs
set fixed_other_cost_cents = fixed_cost_cents
where coalesce(fixed_other_cost_cents, 0) = 0
  and coalesce(fixed_tape_cost_cents, 0) = 0
  and coalesce(fixed_shipping_label_cost_cents, 0) = 0
  and coalesce(fixed_branding_label_cost_cents, 0) = 0
  and coalesce(fixed_cost_cents, 0) > 0;

alter table inventory_movements
  add column if not exists order_id uuid references orders(id) on delete set null,
  add column if not exists order_item_id uuid references order_items(id) on delete set null;

alter table inventory_movements
  drop constraint if exists inventory_movements_movement_type_check;

alter table inventory_movements
  add constraint inventory_movements_movement_type_check
  check (movement_type in ('receipt', 'production_consume', 'production_output', 'shipment_consume', 'adjustment'));

create index if not exists inventory_movements_order_idx on inventory_movements(order_id);
create index if not exists inventory_movements_order_item_idx on inventory_movements(order_item_id);

drop function if exists public.record_inventory_production_run(
  uuid,
  numeric,
  numeric,
  text,
  numeric,
  jsonb,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric
);

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
  p_labor_rate_cents numeric default 0,
  p_fixed_tape_cost_cents numeric default 0,
  p_fixed_shipping_label_cost_cents numeric default 0,
  p_fixed_branding_label_cost_cents numeric default 0,
  p_fixed_other_cost_cents numeric default 0
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
  v_fixed_tape_cost numeric := greatest(coalesce(p_fixed_tape_cost_cents, 0), 0);
  v_fixed_shipping_label_cost numeric := greatest(coalesce(p_fixed_shipping_label_cost_cents, 0), 0);
  v_fixed_branding_label_cost numeric := greatest(coalesce(p_fixed_branding_label_cost_cents, 0), 0);
  v_fixed_other_cost numeric := greatest(coalesce(p_fixed_other_cost_cents, 0), 0);
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

  if v_fixed_cost = 0 then
    v_fixed_cost := v_fixed_tape_cost + v_fixed_shipping_label_cost + v_fixed_branding_label_cost + v_fixed_other_cost;
  end if;

  if v_fixed_other_cost = 0 and v_fixed_cost > (v_fixed_tape_cost + v_fixed_shipping_label_cost + v_fixed_branding_label_cost) then
    v_fixed_other_cost := v_fixed_cost - v_fixed_tape_cost - v_fixed_shipping_label_cost - v_fixed_branding_label_cost;
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
    fixed_tape_cost_cents,
    fixed_shipping_label_cost_cents,
    fixed_branding_label_cost_cents,
    fixed_other_cost_cents,
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
    v_fixed_tape_cost,
    v_fixed_shipping_label_cost,
    v_fixed_branding_label_cost,
    v_fixed_other_cost,
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

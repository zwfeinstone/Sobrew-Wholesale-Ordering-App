-- Recipe-specific packaging substitutions. No inventory, recipes, or historical runs are changed here.
create table public.product_material_fallbacks (
  product_id uuid not null references public.products(id) on delete cascade,
  primary_inventory_item_id uuid not null references public.inventory_items(id),
  fallback_inventory_item_id uuid not null references public.inventory_items(id),
  primary key (product_id, primary_inventory_item_id),
  constraint product_material_fallbacks_distinct_items
    check (primary_inventory_item_id <> fallback_inventory_item_id)
);

create index product_material_fallbacks_primary_item_idx
  on public.product_material_fallbacks(primary_inventory_item_id);
create index product_material_fallbacks_fallback_item_idx
  on public.product_material_fallbacks(fallback_inventory_item_id);

alter table public.product_material_fallbacks enable row level security;
revoke all on public.product_material_fallbacks from public, anon, authenticated;
grant select, insert, update, delete on public.product_material_fallbacks to authenticated, service_role;
create policy "admin all product_material_fallbacks"
  on public.product_material_fallbacks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

comment on table public.product_material_fallbacks is
  'Recipe materials consumed primary-first, then fallback. Both must be active materials with the same base unit.';

-- Based on the live October 12, 2026 function. The existing FIFO accounting and
-- movement provenance remain intact; resolve substitutions under locks first.
CREATE OR REPLACE FUNCTION public.record_inventory_production_run(p_product_id uuid, p_quantity_produced numeric, p_waste_quantity numeric, p_notes text, p_estimated_unit_cost_cents numeric, p_components jsonb, p_fixed_cost_cents numeric DEFAULT 0, p_expected_labor_cost_cents numeric DEFAULT 0, p_actual_labor_cost_cents numeric DEFAULT 0, p_labor_minutes numeric DEFAULT 0, p_labor_rate_cents numeric DEFAULT 0, p_fixed_tape_cost_cents numeric DEFAULT 0, p_fixed_shipping_label_cost_cents numeric DEFAULT 0, p_fixed_branding_label_cost_cents numeric DEFAULT 0, p_fixed_other_cost_cents numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_product record;
  v_finished_item_id uuid;
  v_run_id uuid;
  v_finished_lot_id uuid;
  v_component jsonb;
  v_components jsonb := '[]'::jsonb;
  v_pending_components jsonb := '[]'::jsonb;
  v_fallbacks jsonb := '[]'::jsonb;
  v_fallback record;
  v_primary_item record;
  v_fallback_item record;
  v_primary_available numeric;
  v_fallback_available numeric;
  v_primary_used numeric;
  v_fallback_used numeric;
  v_primary_expected numeric;
  v_fallback_expected numeric;
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
    where id = p_product_id
    for update;

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

  if jsonb_typeof(coalesce(p_components, '[]'::jsonb)) <> 'array' then
    raise exception 'Production components must be an array.';
  end if;

  -- Validate before aggregation so negative duplicate rows cannot cancel out.
  for v_component in select * from jsonb_array_elements(coalesce(p_components, '[]'::jsonb))
  loop
    v_item_id := (v_component ->> 'inventory_item_id')::uuid;
    v_expected := coalesce((v_component ->> 'quantity_expected')::numeric, 0);
    v_used := coalesce((v_component ->> 'quantity_used')::numeric, 0);
    if v_item_id is null then
      raise exception 'Component inventory item is required.';
    end if;
    if v_used < 0 or v_expected < 0
      or v_used in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      or v_expected in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) then
      raise exception 'Component quantities must be finite and nonnegative.';
    end if;
  end loop;

  -- Only a configured primary present in this product's recipe authorizes a
  -- substitution. A stale mapping never substitutes an unrelated ingredient.
  select coalesce(jsonb_agg(to_jsonb(config)), '[]'::jsonb)
    into v_fallbacks
    from (
      select f.*, exists (
        select 1
        from public.product_recipes r
        join public.product_recipe_components c on c.recipe_id = r.id
        where r.product_id = p_product_id
          and c.inventory_item_id = f.primary_inventory_item_id
          and c.component_role in ('bag', 'box', 'filter_pack', 'fraction_bag')
      ) whole_count_packaging
      from public.product_material_fallbacks f
      where f.product_id = p_product_id
        and exists (
          select 1
          from public.product_recipes r
          join public.product_recipe_components c on c.recipe_id = r.id
          where r.product_id = p_product_id
            and c.inventory_item_id = f.primary_inventory_item_id
        )
      order by f.primary_inventory_item_id
      for share of f
    ) config;

  -- Overlapping pairs have ambiguous client-split totals. Reject them rather
  -- than double count a shared fallback or silently follow a fallback chain.
  if exists (
    select 1
    from jsonb_to_recordset(v_fallbacks) a(primary_inventory_item_id uuid, fallback_inventory_item_id uuid)
    join jsonb_to_recordset(v_fallbacks) b(primary_inventory_item_id uuid, fallback_inventory_item_id uuid)
      on a.primary_inventory_item_id < b.primary_inventory_item_id
    where a.fallback_inventory_item_id = b.fallback_inventory_item_id
      or a.fallback_inventory_item_id = b.primary_inventory_item_id
      or a.primary_inventory_item_id = b.fallback_inventory_item_id
  ) then
    raise exception 'Product material fallback pairs must not overlap.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'inventory_item_id', inventory_item_id,
    'quantity_expected', quantity_expected,
    'quantity_used', quantity_used,
    'unit', unit
  ) order by inventory_item_id, unit), '[]'::jsonb)
    into v_pending_components
    from (
      select (c ->> 'inventory_item_id')::uuid inventory_item_id,
        coalesce(nullif(c ->> 'unit', ''), 'each') unit,
        sum(coalesce((c ->> 'quantity_expected')::numeric, 0)) quantity_expected,
        sum(coalesce((c ->> 'quantity_used')::numeric, 0)) quantity_used
      from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) c
      group by 1, 2
    ) requested;

  -- Lock every involved item and lot in the same deterministic order before
  -- availability checks. Item locks also block new lot FK inserts while this
  -- transaction resolves inventory. Lot locks protect against other adjustment
  -- and void paths, which may not lock the inventory-item row.
  perform i.id
    from public.inventory_items i
    where i.id in (
      select (c ->> 'inventory_item_id')::uuid from jsonb_array_elements(v_pending_components) c
      union
      select (f ->> 'primary_inventory_item_id')::uuid from jsonb_array_elements(v_fallbacks) f
      union
      select (f ->> 'fallback_inventory_item_id')::uuid from jsonb_array_elements(v_fallbacks) f
    )
    order by i.id
    for update;
  perform l.id
    from public.inventory_lots l
    where l.inventory_item_id in (
      select (c ->> 'inventory_item_id')::uuid from jsonb_array_elements(v_pending_components) c
      union
      select (f ->> 'primary_inventory_item_id')::uuid from jsonb_array_elements(v_fallbacks) f
      union
      select (f ->> 'fallback_inventory_item_id')::uuid from jsonb_array_elements(v_fallbacks) f
    )
    order by l.inventory_item_id, l.received_at, l.created_at, l.id
    for update;

  for v_fallback in
    select * from jsonb_to_recordset(v_fallbacks)
      as f(primary_inventory_item_id uuid, fallback_inventory_item_id uuid, whole_count_packaging boolean)
    order by primary_inventory_item_id
  loop
    if not exists (
      select 1 from jsonb_array_elements(v_pending_components) c
      where (c ->> 'inventory_item_id')::uuid in
        (v_fallback.primary_inventory_item_id, v_fallback.fallback_inventory_item_id)
    ) then
      continue;
    end if;

    select * into strict v_primary_item from public.inventory_items
      where id = v_fallback.primary_inventory_item_id;
    select * into strict v_fallback_item from public.inventory_items
      where id = v_fallback.fallback_inventory_item_id;
    if not v_primary_item.active or not v_fallback_item.active
      or v_primary_item.item_type <> 'material_supply'
      or v_fallback_item.item_type <> 'material_supply'
      or v_primary_item.base_unit <> v_fallback_item.base_unit then
      raise exception 'Material fallback requires active materials with the same base unit.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_pending_components) c
      where (c ->> 'inventory_item_id')::uuid in
        (v_fallback.primary_inventory_item_id, v_fallback.fallback_inventory_item_id)
        and c ->> 'unit' <> v_primary_item.base_unit
    ) then
      raise exception 'Material fallback component unit must match its base unit.';
    end if;

    -- New clients may already split the two materials; old clients submit only
    -- the primary. Recombine both and allocate again against locked balances.
    select coalesce(sum((c ->> 'quantity_expected')::numeric), 0),
           coalesce(sum((c ->> 'quantity_used')::numeric), 0)
      into v_expected, v_used
      from jsonb_array_elements(v_pending_components) c
      where (c ->> 'inventory_item_id')::uuid in
        (v_fallback.primary_inventory_item_id, v_fallback.fallback_inventory_item_id);
    select coalesce(sum(quantity_remaining), 0) into v_primary_available
      from public.inventory_lots
      where inventory_item_id = v_fallback.primary_inventory_item_id and quantity_remaining > 0;
    select coalesce(sum(quantity_remaining), 0) into v_fallback_available
      from public.inventory_lots
      where inventory_item_id = v_fallback.fallback_inventory_item_id and quantity_remaining > 0;
    if v_fallback.whole_count_packaging then
      if v_primary_item.base_unit <> 'each' or v_used <> trunc(v_used) then
        raise exception 'Packaging usage must be a whole number in each units.';
      end if;
      -- A partial package cannot cover a whole package from either material.
      v_primary_available := floor(v_primary_available);
      v_fallback_available := floor(v_fallback_available);
    end if;
    if v_primary_available + v_fallback_available < v_used then
      raise exception 'Insufficient inventory for material % and fallback %. Available %, needed %.',
        v_fallback.primary_inventory_item_id, v_fallback.fallback_inventory_item_id,
        v_primary_available + v_fallback_available, v_used;
    end if;

    v_primary_used := least(v_used, v_primary_available);
    v_fallback_used := v_used - v_primary_used;
    -- Proportional expected quantities retain the caller's total and each
    -- actual material's variance, including operator-entered over/under usage.
    v_primary_expected := case when v_used > 0
      then round(v_expected * v_primary_used / v_used, 4) else v_expected end;
    v_fallback_expected := v_expected - v_primary_expected;
    if v_primary_used > 0 or v_primary_expected > 0 then
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'inventory_item_id', v_fallback.primary_inventory_item_id,
        'quantity_expected', v_primary_expected, 'quantity_used', v_primary_used,
        'unit', v_primary_item.base_unit));
    end if;
    if v_fallback_used > 0 or v_fallback_expected > 0 then
      v_components := v_components || jsonb_build_array(jsonb_build_object(
        'inventory_item_id', v_fallback.fallback_inventory_item_id,
        'quantity_expected', v_fallback_expected, 'quantity_used', v_fallback_used,
        'unit', v_fallback_item.base_unit));
    end if;
    select coalesce(jsonb_agg(c), '[]'::jsonb) into v_pending_components
      from jsonb_array_elements(v_pending_components) c
      where (c ->> 'inventory_item_id')::uuid not in
        (v_fallback.primary_inventory_item_id, v_fallback.fallback_inventory_item_id);
  end loop;

  v_components := v_components || v_pending_components;

  -- Check combined requests, including duplicate non-fallback component rows,
  -- before any consumption or production-run insert.
  for v_component in
    select jsonb_build_object('inventory_item_id', (c ->> 'inventory_item_id')::uuid,
      'quantity_used', sum((c ->> 'quantity_used')::numeric))
    from jsonb_array_elements(v_components) c
    group by (c ->> 'inventory_item_id')::uuid
  loop
    v_item_id := (v_component ->> 'inventory_item_id')::uuid;
    v_used := (v_component ->> 'quantity_used')::numeric;
    select coalesce(sum(quantity_remaining), 0) into v_available
      from public.inventory_lots
      where inventory_item_id = v_item_id and quantity_remaining > 0;
    if v_available < v_used then
      raise exception 'Insufficient inventory for component %. Available %, needed %.',
        v_item_id, v_available, v_used;
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

  for v_component in select * from jsonb_array_elements(v_components)
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
      order by received_at asc, created_at asc, id asc
      for update
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

    if v_remaining_to_consume > 0 then
      raise exception 'Insufficient inventory for component % after locking. Remaining %.',
        v_item_id, v_remaining_to_consume;
    end if;

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
$function$;

revoke all on function public.record_inventory_production_run(
  uuid, numeric, numeric, text, numeric, jsonb, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric
) from public, anon;
grant execute on function public.record_inventory_production_run(
  uuid, numeric, numeric, text, numeric, jsonb, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric
) to authenticated, service_role;

-- Authorized starting inventory and recipe preference, October 12, 2026.
-- Recognizes the starting count previously entered in production, so replay
-- never duplicates that count or resets inventory already consumed.
-- Fresh databases receive the material and starting count even if no filter-pack
-- products have been created yet. Only existing filter-pack recipes are updated.
-- Existing recipes must match the reviewed 40-bag case format; incompatible
-- recipes abort the entire migration for review.
begin;
do $$
declare
  v_primary uuid;
  v_secondary uuid;
  v_lot uuid;
  v_expected integer;
  v_changed integer;
  v_notes constant text := 'Starting inventory: 5,882 filter-pack roll-stock bag equivalents at 3.49 cents ($0.0349) each, requested 2026-10-12.';
begin
  perform pg_advisory_xact_lock(hashtextextended('filter-pack-roll-stock-20261012', 0));

  select count(*) into v_expected from public.products where category = 'filter_packs';

  if v_expected > 0 then
    select id into strict v_secondary from public.inventory_items
    where sku = 'MAT-BAG-FILTER-PACK' and item_type = 'material_supply'
      and base_unit = 'each' and active;
  end if;

  insert into public.inventory_items (name, sku, description, item_type, base_unit, active)
  values ('Filter Pack Bag - Roll Stock', 'MAT-BAG-FILTER-PACK-ROLL-STOCK',
    'Filter-pack roll stock tracked in individual bag equivalents.',
    'material_supply', 'each', true)
  on conflict (sku) do nothing;

  select id into strict v_primary from public.inventory_items
  where sku = 'MAT-BAG-FILTER-PACK-ROLL-STOCK'
    and name = 'Filter Pack Bag - Roll Stock' and item_type = 'material_supply'
    and base_unit = 'each' and active
  for update;

  if not exists (
    select 1 from public.inventory_adjustments
    where inventory_item_id = v_primary and adjustment_type = 'starting_count'
      and notes = v_notes and quantity_change = 5882 and unit_cost_cents = 3.49
  ) then
    if exists (select 1 from public.inventory_lots where inventory_item_id = v_primary)
      or exists (select 1 from public.inventory_movements where inventory_item_id = v_primary)
      or exists (select 1 from public.inventory_adjustments where inventory_item_id = v_primary) then
      raise exception 'Roll stock already has inventory history; refusing to duplicate the starting count.';
    end if;

    insert into public.inventory_lots (
      inventory_item_id, lot_code, source_type, quantity_received,
      quantity_remaining, unit_cost_cents, received_at, notes
    ) values (
      v_primary, 'ADJ-20261012-BAG-FILTER-PAC-' || upper(left(gen_random_uuid()::text, 6)),
      'adjustment', 5882, 5882, 3.49, now(), v_notes
    ) returning id into v_lot;

    insert into public.inventory_adjustments (
      inventory_item_id, lot_id, adjustment_type, quantity_change, unit,
      unit_cost_cents, notes, adjusted_at
    ) values (v_primary, v_lot, 'starting_count', 5882, 'each', 3.49, v_notes, now());

    insert into public.inventory_movements (
      inventory_item_id, lot_id, movement_type, quantity_change, unit,
      unit_cost_cents, notes
    ) values (v_primary, v_lot, 'adjustment', 5882, 'each', 3.49, v_notes);
  end if;

  -- Fail closed if any product no longer matches the reviewed recipe shape.
  if exists (
    select 1 from public.products p
    left join public.product_recipes r on r.product_id = p.id
    where p.category = 'filter_packs'
      and (r.id is null or (
        select count(*) from public.product_recipe_components c
        where c.recipe_id = r.id and c.component_role = 'filter_pack'
          and c.inventory_item_id in (v_primary, v_secondary)
          and c.unit = 'each' and c.quantity = 40
      ) <> 1)
  ) then
    raise exception 'A filter-pack recipe changed; review before updating materials.';
  end if;

  update public.product_recipe_components c
  set inventory_item_id = v_primary
  from public.product_recipes r, public.products p
  where c.recipe_id = r.id and r.product_id = p.id
    and p.category = 'filter_packs' and c.component_role = 'filter_pack'
    and c.inventory_item_id in (v_primary, v_secondary);
  get diagnostics v_changed = row_count;
  if v_changed <> v_expected then
    raise exception 'Updated % recipes, expected %.', v_changed, v_expected;
  end if;

  insert into public.product_material_fallbacks (
    product_id, primary_inventory_item_id, fallback_inventory_item_id
  )
  select id, v_primary, v_secondary from public.products where category = 'filter_packs'
  on conflict (product_id, primary_inventory_item_id) do update
    set fallback_inventory_item_id = excluded.fallback_inventory_item_id;
end;
$$;
commit;

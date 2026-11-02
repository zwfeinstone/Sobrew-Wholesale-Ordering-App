-- Add the two black bags requested on October 27, 2026.
-- Catalog setup only: receive actual quantities/costs through Receiving.
-- Existing primary bags and individual filter-pack/roll-stock choices stay intact.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $black_bag_fallbacks$
declare
  v_primary uuid;
  v_matte uuid;
  v_americana uuid;
  v_expected integer;
  v_actual integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('black-bag-fallbacks-20261027', 0));

  select id into strict v_primary
  from public.inventory_items
  where sku = 'MAT-BAG-5LB' and item_type = 'material_supply'
    and base_unit = 'each' and active
  for update;

  select count(distinct r.product_id) into v_expected
  from public.product_recipes r
  join public.product_recipe_components c on c.recipe_id = r.id
  where c.inventory_item_id = v_primary;
  if v_expected = 0 then
    raise exception 'No recipes use the existing 5 lb bag; review before applying.';
  end if;

  insert into public.inventory_items (name, sku, description, item_type, base_unit, active)
  values
    ('Bag - 5 lb - Black Matte', 'MAT-BAG-5LB-BLACK-MATTE',
     '5 lb black matte square-bottom bag with zip and valve. Supplier item 430-SQZIPBLACK-V. 250 bags per case; tracked by individual bag.',
     'material_supply', 'each', true),
    ('Bag - Americana Black - 13 x 16.5', 'MAT-BAG-AMERICANA-BLACK-13X16.5',
     '13 x 16.5 Americana black stand-up pouch with valve. Supplier item 562-AMERBLACK-WV. 250 pouches per case; tracked by individual pouch.',
     'material_supply', 'each', true)
  on conflict (sku) do nothing;

  -- Existing matching catalog rows may be reused, but conflicting identities
  -- or units must be reviewed instead of silently changing inventory history.
  select id into strict v_matte from public.inventory_items
  where sku = 'MAT-BAG-5LB-BLACK-MATTE' and name = 'Bag - 5 lb - Black Matte'
    and item_type = 'material_supply' and base_unit = 'each' and active
    and product_id is null;
  select id into strict v_americana from public.inventory_items
  where sku = 'MAT-BAG-AMERICANA-BLACK-13X16.5'
    and name = 'Bag - Americana Black - 13 x 16.5'
    and item_type = 'material_supply' and base_unit = 'each' and active
    and product_id is null;

  if exists (
    select 1 from public.product_material_fallbacks f
    where exists (
      select 1 from public.product_recipes r
      join public.product_recipe_components c on c.recipe_id = r.id
      where r.product_id = f.product_id and c.inventory_item_id = v_primary
    )
      and f.primary_inventory_item_id <> v_primary
      and (f.primary_inventory_item_id in (v_matte, v_americana)
        or f.fallback_inventory_item_id in (v_primary, v_matte, v_americana))
  ) then
    raise exception 'An overlapping material fallback needs review before applying.';
  end if;

  insert into public.product_material_fallbacks (
    product_id, primary_inventory_item_id, fallback_inventory_item_id
  )
  select p.id, v_primary,
    case when p.category = 'filter_packs' then v_americana else v_matte end
  from public.products p
  where exists (
    select 1 from public.product_recipes r
    join public.product_recipe_components c on c.recipe_id = r.id
    where r.product_id = p.id and c.inventory_item_id = v_primary
  )
  on conflict (product_id, primary_inventory_item_id) do update
    set fallback_inventory_item_id = excluded.fallback_inventory_item_id
    where product_material_fallbacks.fallback_inventory_item_id
      is distinct from excluded.fallback_inventory_item_id;

  select count(*) into v_actual
  from public.product_material_fallbacks f
  join public.products p on p.id = f.product_id
  where f.primary_inventory_item_id = v_primary
    and f.fallback_inventory_item_id =
      case when p.category = 'filter_packs' then v_americana else v_matte end
    and exists (
      select 1 from public.product_recipes r
      join public.product_recipe_components c on c.recipe_id = r.id
      where r.product_id = p.id and c.inventory_item_id = v_primary
    );
  if v_actual <> v_expected then
    raise exception 'Configured % bag fallbacks, expected %.', v_actual, v_expected;
  end if;
end;
$black_bag_fallbacks$;

commit;

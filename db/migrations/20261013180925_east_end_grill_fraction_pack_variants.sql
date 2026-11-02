-- October 13, 2026: two 100 x 1.5 oz with-filters variants and East End Grill prices.
-- Clone the corresponding 100 x 2 oz recipe, including material alternatives.
-- Coffee is 150 oz before the source recipe's retained waste allowance.
-- External catalog identities and existing stock/history are never copied.
begin;
do $$
declare
  v_center uuid;
  v_spec record;
  v_source public.products%rowtype;
  v_source_recipe public.product_recipes%rowtype;
  v_product uuid;
  v_recipe uuid;
  v_created boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('east-end-grill-fraction-pack-variants-20261013', 0));

  -- This dated customer setup has no work on a fresh database without the customer.
  if not exists (select 1 from public.centers where name = 'East End Grill') then
    return;
  end if;
  select id into strict v_center from public.centers
  where name = 'East End Grill' and is_active for update;

  for v_spec in select * from (values
    ('423423423', 'MTC-FP-MED-100X1.5OZ-FILTERS', 'Meeting Coffee Medium Roast Fraction Pack 100x1.5oz with Filters'),
    ('2542523423', 'MTC-FP-DRK-100X1.5OZ-FILTERS', 'Meeting Coffee Dark Roast Fraction Pack 100x1.5oz with Filters')
  ) as specifications(source_sku, new_sku, new_name)
  loop
    select * into strict v_source from public.products
    where sku = v_spec.source_sku and category = 'fraction_packs' and active for share;
    select * into strict v_source_recipe from public.product_recipes
    where product_id = v_source.id for share;

    if v_source_recipe.output_qty <> 1
      or (select count(*) from public.product_recipe_components
          where recipe_id = v_source_recipe.id and component_role = 'raw_coffee') <> 1
      or not exists (select 1 from public.product_recipe_components
          where recipe_id = v_source_recipe.id and component_role = 'raw_coffee' and quantity = 200 and unit = 'oz')
      or (select count(*) from public.product_recipe_components
          where recipe_id = v_source_recipe.id and component_role = 'fraction_bag') <> 1
      or not exists (select 1 from public.product_recipe_components
          where recipe_id = v_source_recipe.id and component_role = 'fraction_bag' and quantity = 100 and unit = 'each') then
      raise exception 'Source recipe for % no longer matches the reviewed 100 x 2 oz case.', v_source.name;
    end if;

    v_product := null;
    insert into public.products(name, sku, description, image_url, category, active,
      shipping_box_count_required, receivable_finished_good)
    values (v_spec.new_name, v_spec.new_sku, v_spec.new_name, v_source.image_url,
      v_source.category, true, v_source.shipping_box_count_required, v_source.receivable_finished_good)
    on conflict (sku) do nothing
    returning id into v_product;
    v_created := v_product is not null;

    if v_created then
      insert into public.product_recipes(product_id, output_qty, waste_percent, labor_minutes,
        labor_rate_cents, shipping_label_qty, branding_label_qty, notes)
      values (v_product, v_source_recipe.output_qty, v_source_recipe.waste_percent,
        v_source_recipe.labor_minutes, v_source_recipe.labor_rate_cents,
        v_source_recipe.shipping_label_qty, v_source_recipe.branding_label_qty, v_source_recipe.notes)
      returning id into v_recipe;

      insert into public.product_recipe_components(recipe_id, inventory_item_id, quantity,
        unit, component_role, sort_order, notes)
      select v_recipe, inventory_item_id,
        case when component_role = 'raw_coffee' then 150 else quantity end,
        unit, component_role, sort_order, notes
      from public.product_recipe_components where recipe_id = v_source_recipe.id;

      insert into public.product_material_fallbacks(product_id, primary_inventory_item_id, fallback_inventory_item_id)
      select v_product, primary_inventory_item_id, fallback_inventory_item_id
      from public.product_material_fallbacks where product_id = v_source.id;
    else
      -- Preserve saved recipes on replay; refuse a conflicting/incomplete product.
      select id into strict v_product from public.products
      where sku = v_spec.new_sku and name = v_spec.new_name and category = 'fraction_packs' and active;
      select id into strict v_recipe from public.product_recipes where product_id = v_product;
      if (select count(*) from public.product_recipe_components
          where recipe_id = v_recipe and component_role = 'raw_coffee') <> 1
        or not exists (select 1 from public.product_recipe_components
          where recipe_id = v_recipe and component_role = 'raw_coffee' and quantity = 150 and unit = 'oz') then
        raise exception 'Existing product % does not have the expected 150 oz coffee recipe.', v_spec.new_name;
      end if;
    end if;

    insert into public.user_products(center_id, product_id)
    values (v_center, v_product) on conflict (center_id, product_id) do nothing;
    insert into public.user_product_prices(center_id, product_id, price_cents, allow_zero_price)
    values (v_center, v_product, 10500, false)
    on conflict (center_id, product_id) do update
      set price_cents = excluded.price_cents, allow_zero_price = excluded.allow_zero_price;
  end loop;

  for v_spec in select * from (values ('MTC-KCUP-MED-50CT'), ('MTC-KCUP-DRK-50CT')) as cups(sku)
  loop
    select id into strict v_product from public.products
    where sku = v_spec.sku and category = 'k_cups' and active for share;
    insert into public.user_products(center_id, product_id)
    values (v_center, v_product) on conflict (center_id, product_id) do nothing;
    insert into public.user_product_prices(center_id, product_id, price_cents, allow_zero_price)
    values (v_center, v_product, 4200, false)
    on conflict (center_id, product_id) do update
      set price_cents = excluded.price_cents, allow_zero_price = excluded.allow_zero_price;
  end loop;
end;
$$;
commit;

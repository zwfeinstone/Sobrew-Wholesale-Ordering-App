-- Requested October 12, 2026: $22/hour for every existing product recipe;
-- fraction and filter packs take 20 seconds per individual pack.
-- Quantities and labor_minutes describe the full recipe output. Production
-- already scales both by output_qty, so do not scale the pack count again here.
-- Round to hundredths of a minute to match the recipe/production editor inputs.
-- The reviewed pack recipes each output one case; stop if that shape changes.
-- This updates recipe estimates only, not payroll or historical production costs.
begin;

-- Keep catalog/category/component validation consistent with the update.
lock table public.products, public.product_recipe_components in share mode;
lock table public.product_recipes in share row exclusive mode;

do $$
declare
  v_invalid_products text;
begin
  select string_agg(invalid.name, ', ' order by invalid.name)
    into v_invalid_products
  from (
    select p.name
    from public.products p
    left join public.product_recipes r on r.product_id = p.id
    left join public.product_recipe_components c
      on c.recipe_id = r.id
      and c.component_role = case p.category
        when 'fraction_packs' then 'fraction_bag'
        when 'filter_packs' then 'filter_pack'
      end
    left join public.inventory_items i on i.id = c.inventory_item_id
    where p.category in ('fraction_packs', 'filter_packs')
    group by p.id, p.name, r.id
    having r.id is null
      or count(c.id) <> 1
      or bool_or(r.output_qty <> 1 or c.unit <> 'each' or i.base_unit <> 'each'
        or c.quantity = 'NaN'::numeric or r.output_qty = 'NaN'::numeric
        or c.quantity <= 0 or c.quantity <> trunc(c.quantity)
        or c.quantity / r.output_qty <> trunc(c.quantity / r.output_qty))
  ) invalid;

  if v_invalid_products is not null then
    raise exception 'Cannot calculate pack labor: missing or ambiguous whole-pack recipe for %.', v_invalid_products;
  end if;

  with requested_labor as (
    select r.id,
      case when p.category in ('fraction_packs', 'filter_packs') then (
        select round(c.quantity * 20 / 60, 2)
        from public.product_recipe_components c
        where c.recipe_id = r.id
          and c.component_role = case p.category
            when 'fraction_packs' then 'fraction_bag'
            when 'filter_packs' then 'filter_pack'
          end
      ) else r.labor_minutes end as labor_minutes
    from public.product_recipes r
    join public.products p on p.id = r.product_id
  )
  update public.product_recipes r
  set labor_rate_cents = 2200,
      labor_minutes = requested.labor_minutes,
      updated_at = now()
  from requested_labor requested
  where requested.id = r.id
    and (r.labor_rate_cents is distinct from 2200
      or r.labor_minutes is distinct from requested.labor_minutes);
end;
$$;

commit;

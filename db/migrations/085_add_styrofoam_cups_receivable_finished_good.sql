with styrofoam_product as (
  insert into products (name, description, sku, category, active, receivable_finished_good)
  values (
    'Styrofoam Cups - 12 oz - 1000 ct',
    'Purchased finished good received and sold as-is.',
    'RET-CUP-STYRO-12OZ-1000CT',
    'retail',
    true,
    true
  )
  on conflict (sku) do update
  set
    name = excluded.name,
    description = coalesce(products.description, excluded.description),
    category = excluded.category,
    active = excluded.active,
    receivable_finished_good = excluded.receivable_finished_good
  returning id
),
updated_inventory_item as (
  update inventory_items as item
  set
    name = 'Styrofoam Cups - 12 oz - 1000 ct',
    sku = 'FIN-RET-CUP-STYRO-12OZ-1000CT',
    description = coalesce(item.description, 'Purchased finished good received and sold as-is.'),
    item_type = 'finished_good',
    base_unit = 'each',
    product_id = product.id,
    active = true
  from styrofoam_product as product
  where item.product_id = product.id
    or item.sku = 'FIN-RET-CUP-STYRO-12OZ-1000CT'
  returning item.id
)
insert into inventory_items (name, sku, description, item_type, base_unit, product_id, active)
select
  'Styrofoam Cups - 12 oz - 1000 ct',
  'FIN-RET-CUP-STYRO-12OZ-1000CT',
  'Purchased finished good received and sold as-is.',
  'finished_good',
  'each',
  id,
  true
from styrofoam_product
where not exists (select 1 from updated_inventory_item);

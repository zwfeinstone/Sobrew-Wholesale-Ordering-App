with sweet_tea_product as (
  insert into products (name, description, sku, category, active)
  values (
    '3.3lb x 8 Sweet Tea Bag',
    'Purchased finished good received and sold as-is.',
    'TEA-SWEET-3.3LBX8',
    'tea',
    true
  )
  on conflict (sku) do update
  set
    name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    active = excluded.active
  returning id
)
insert into inventory_items (name, sku, description, item_type, base_unit, product_id, active)
select
  '3.3lb x 8 Sweet Tea Bag',
  'FIN-TEA-SWEET-3.3LBX8',
  'Purchased finished good received and sold as-is.',
  'finished_good',
  'each',
  id,
  true
from sweet_tea_product
on conflict (sku) do update
set
  name = excluded.name,
  description = excluded.description,
  item_type = excluded.item_type,
  base_unit = excluded.base_unit,
  product_id = excluded.product_id,
  active = excluded.active;

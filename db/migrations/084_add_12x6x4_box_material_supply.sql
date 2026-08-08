insert into inventory_items (name, sku, item_type, base_unit, active)
values ('Box - 12 x 6 x 4', 'MAT-BOX-12X6X4', 'material_supply', 'each', true)
on conflict (sku) do update
set
  name = excluded.name,
  item_type = excluded.item_type,
  base_unit = excluded.base_unit,
  active = excluded.active;

with new_box as (
  insert into inventory_items (name, sku, item_type, base_unit, active)
  values ('Box - 12 x 12 x 12', 'MAT-BOX-12X12X12', 'material_supply', 'each', true)
  on conflict (sku) do update
  set
    name = excluded.name,
    item_type = excluded.item_type,
    base_unit = excluded.base_unit,
    active = excluded.active
  returning id
),
old_boxes as (
  select id
  from inventory_items
  where sku in ('MAT-BOX-12X12X10', 'BOX-12X12X10')
    or name ilike 'Box%12%x%12%x%10%'
)
update product_recipe_components as component
set
  inventory_item_id = new_box.id,
  component_role = coalesce(component.component_role, 'box')
from new_box, old_boxes
where component.inventory_item_id = old_boxes.id;

notify pgrst, 'reload schema';

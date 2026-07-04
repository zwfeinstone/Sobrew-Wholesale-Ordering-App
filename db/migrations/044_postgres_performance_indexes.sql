create index if not exists orders_created_at_idx on orders(created_at desc);
create index if not exists orders_active_status_created_at_idx on orders(status, created_at desc) where archived_at is null;
create index if not exists orders_user_id_created_at_idx on orders(user_id, created_at desc);

create index if not exists order_items_order_id_idx on order_items(order_id);
create index if not exists order_items_product_id_idx on order_items(product_id);

create index if not exists recurring_orders_source_order_id_idx on recurring_orders(source_order_id);
create index if not exists recurring_orders_user_id_idx on recurring_orders(user_id);
create index if not exists recurring_order_items_recurring_order_id_idx on recurring_order_items(recurring_order_id);
create index if not exists recurring_order_items_product_id_idx on recurring_order_items(product_id);

create index if not exists inventory_lots_production_run_id_idx on inventory_lots(production_run_id);
create index if not exists inventory_lots_item_received_created_idx on inventory_lots(inventory_item_id, received_at, created_at);

create index if not exists inventory_movements_production_run_id_idx on inventory_movements(production_run_id);
create index if not exists inventory_movements_receipt_id_idx on inventory_movements(receipt_id);
create index if not exists inventory_movements_unlotted_consumption_item_idx
  on inventory_movements(inventory_item_id)
  where lot_id is null and movement_type in ('shipment_consume', 'sample_box_consume');

create index if not exists product_recipe_components_inventory_item_id_idx on product_recipe_components(inventory_item_id);
create index if not exists production_run_inputs_inventory_item_id_idx on production_run_inputs(inventory_item_id);

create index if not exists production_runs_produced_at_idx on production_runs(produced_at desc);
create index if not exists production_runs_product_produced_at_idx on production_runs(product_id, produced_at desc);

create index if not exists order_commission_snapshots_sales_profile_month_idx
  on order_commission_snapshots(sales_profile_id, commission_month desc);

create index if not exists user_products_product_id_idx on user_products(product_id);
create index if not exists user_product_prices_product_id_idx on user_product_prices(product_id);

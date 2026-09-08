-- All fixtures and their history are rolled back. No existing order is changed.
begin;
do $$
declare
  v_owner uuid; v_order uuid := gen_random_uuid(); v_item uuid := gen_random_uuid();
  v_center uuid := gen_random_uuid(); v_product uuid := gen_random_uuid();
  v_inventory uuid := gen_random_uuid(); v_lot uuid := gen_random_uuid();
  v_schedule uuid := gen_random_uuid(); v_trash uuid; v_quantity numeric;
  v_price_order uuid := gen_random_uuid();
begin
  select id into v_owner from public.profiles where is_superadmin and is_admin and is_active limit 1;
  if v_owner is null then raise exception 'An active superadmin fixture is required'; end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  insert into public.centers(id,name) values(v_center,'Recovery transaction test');
  insert into public.products(id,name,sku,active) values(v_product,'Recovery test product','RECOVERY-TEST-' || v_product,true);
  insert into public.inventory_items(id,name,item_type,base_unit) values(v_inventory,'Recovery test material','material_supply','each');
  insert into public.inventory_lots(id,inventory_item_id,lot_code,quantity_received,quantity_remaining) values(v_lot,v_inventory,'recovery-test',10,7);
  insert into public.orders(id,center_id,user_id,status,notes,subtotal_cents) values(v_order,v_center,v_owner,'Shipped',E'Deliver to receiving\nCall first',1000);
  insert into public.order_items(id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents) values(v_item,v_order,v_product,'Snapshot name',1,1000,1000);
  insert into public.inventory_movements(inventory_item_id,lot_id,movement_type,quantity_change,unit,order_id,order_item_id) values(v_inventory,v_lot,'shipment_consume',-3,'each',v_order,v_item);
  insert into public.recurring_orders(id,center_id,user_id,source_order_id,frequency,amount_cents) values(v_schedule,v_center,v_owner,v_order,'1_week',1000);
  insert into public.recurring_order_items(recurring_order_id,product_id,qty,unit_price_cents,line_total_cents) values(v_schedule,v_product,1,1000,1000);
  insert into public.orders(center_id,recurring_order_id,notes) values(v_center,v_schedule,'Auto-generated recurring order (1_week)');
  if not exists(select 1 from public.orders where recurring_order_id=v_schedule and notes like E'Deliver to receiving\nCall first%') then raise exception 'Recurring delivery notes lost'; end if;
  perform public.move_order_to_trash(v_order,'Test duplicate');
  select id into v_trash from public.order_trash where order_id=v_order and restored_at is null;
  if v_trash is null or exists(select 1 from public.orders where id=v_order) then raise exception 'Deletion failed'; end if;
  if (select quantity_remaining from public.inventory_lots where id=v_lot) <> 10 then raise exception 'Inventory not restored exactly once'; end if;
  if not exists(select 1 from public.recurring_orders where id=v_schedule and status='paused' and not active and source_order_id is null) then raise exception 'Schedule was lost or not paused'; end if;
  if not exists(select 1 from public.recurring_order_items where recurring_order_id=v_schedule) then raise exception 'Schedule items were lost'; end if;
  update public.inventory_lots set quantity_remaining=2 where id=v_lot;
  begin
    perform public.restore_order_from_trash(v_trash);
    raise exception 'Insufficient inventory was accepted';
  exception when sqlstate '22023' then null; end;
  if exists(select 1 from public.orders where id=v_order) then raise exception 'Failed restore partially inserted order'; end if;
  update public.inventory_lots set quantity_remaining=10 where id=v_lot;
  perform public.restore_order_from_trash(v_trash);
  perform public.restore_order_from_trash(v_trash);
  if (select quantity_remaining from public.inventory_lots where id=v_lot) <> 7 then raise exception 'Restore was not idempotent'; end if;
  if not exists(select 1 from public.orders where id=v_order and notes=E'Deliver to receiving\nCall first') then raise exception 'Notes lost'; end if;
  if not exists(select 1 from public.order_items where id=v_item and product_name_snapshot='Snapshot name') then raise exception 'Items lost'; end if;
  if not exists(select 1 from public.recurring_orders where id=v_schedule and source_order_id=v_order and status='paused' and not active) then raise exception 'Schedule was resumed or not linked'; end if;
  perform public.delete_order_and_restore_inventory(v_order);
  if (select quantity_remaining from public.inventory_lots where id=v_lot) <> 10 then raise exception 'Legacy delete double-restored inventory'; end if;
  select id into v_trash from public.order_trash where order_id=v_order and restored_at is null;
  perform public.restore_order_from_trash(v_trash);
  delete from public.orders where id=v_order;
  if not exists(select 1 from public.order_trash where order_id=v_order and restored_at is null) then raise exception 'Direct delete bypassed recovery'; end if;
  perform public.save_center_catalog(v_center,jsonb_build_array(jsonb_build_object('product_id',v_product,'price_cents',1000)));
  insert into public.orders(id,center_id) values(v_price_order,v_center);
  begin
    insert into public.order_items(order_id,product_id,qty,unit_price_cents,line_total_cents) values(v_price_order,v_product,1,0,0);
    raise exception 'Unapproved complimentary order accepted';
  exception when sqlstate '22023' then null; end;
  begin
    perform public.save_center_catalog(v_center,jsonb_build_array(jsonb_build_object('product_id',v_product,'price_cents',0)));
    raise exception 'Unapproved zero price saved';
  exception when sqlstate '22023' then null; end;
  if not exists(select 1 from public.user_product_prices where center_id=v_center and price_cents=1000) then raise exception 'Invalid save erased catalog'; end if;
  perform public.save_center_catalog(v_center,jsonb_build_array(jsonb_build_object('product_id',v_product,'price_cents',0,'allow_zero_price',true)));
  if not exists(select 1 from public.user_product_prices where center_id=v_center and price_cents=0 and allow_zero_price) then raise exception 'Approved complimentary price failed'; end if;
  insert into public.order_items(order_id,product_id,qty,unit_price_cents,line_total_cents) values(v_price_order,v_product,1,0,0);
  begin
    insert into public.order_items(order_id,product_id,qty,unit_price_cents,line_total_cents) values(v_price_order,v_product,1,-100,-100);
    raise exception 'Negative complimentary order accepted';
  exception when sqlstate '22023' then null; end;
  update public.orders set order_kind='prospecting_sample' where id=v_price_order;
  perform public.save_center_catalog(v_center,'[]');
  insert into public.order_items(order_id,product_id,qty,unit_price_cents,line_total_cents) values(v_price_order,v_product,1,0,0);
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.restore_order_from_trash(v_trash);
    raise exception 'Unauthorized restore accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_center_catalog(v_center,'[]');
    raise exception 'Unauthorized catalog edit accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
select 'PASS: notes, items, inventory, schedules, legacy/direct deletion, idempotence, insufficient stock, atomic pricing and authorization' as result;
rollback;

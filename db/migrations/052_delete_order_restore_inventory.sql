create or replace function public.delete_order_and_restore_inventory(
  p_order_id uuid
)
returns table (
  order_id uuid,
  recurring_source_count integer,
  restored_movement_count integer,
  restored_lot_count integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted_order_id uuid;
  v_movement record;
  v_recurring_source_count integer := 0;
  v_restore_quantity numeric := 0;
  v_restored_lot_count integer := 0;
  v_restored_movement_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_order_id is null then
    raise exception 'Order is required' using errcode = '22023';
  end if;

  perform 1
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  select count(*)::integer
  into v_recurring_source_count
  from public.recurring_orders ro
  where ro.source_order_id = p_order_id;

  for v_movement in
    select
      movement.id,
      movement.lot_id,
      movement.quantity_change
    from public.inventory_movements movement
    where movement.order_id = p_order_id
      and movement.movement_type = 'shipment_consume'
    for update
  loop
    v_restored_movement_count := v_restored_movement_count + 1;
    v_restore_quantity := greatest(0, -coalesce(v_movement.quantity_change, 0));

    if v_movement.lot_id is not null and v_restore_quantity > 0 then
      update public.inventory_lots lot
      set quantity_remaining = lot.quantity_remaining + v_restore_quantity
      where lot.id = v_movement.lot_id;

      if found then
        v_restored_lot_count := v_restored_lot_count + 1;
      end if;
    end if;
  end loop;

  delete from public.inventory_movements movement
  where movement.order_id = p_order_id
    and movement.movement_type = 'shipment_consume';

  delete from public.orders o
  where o.id = p_order_id
  returning o.id into v_deleted_order_id;

  if v_deleted_order_id is null then
    raise exception 'Order could not be deleted' using errcode = 'P0002';
  end if;

  return query
  select
    v_deleted_order_id,
    v_recurring_source_count,
    v_restored_movement_count,
    v_restored_lot_count;
end;
$function$;

revoke all on function public.delete_order_and_restore_inventory(uuid)
  from public, anon, authenticated;

grant execute on function public.delete_order_and_restore_inventory(uuid)
  to authenticated;

notify pgrst, 'reload schema';

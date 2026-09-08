create schema if not exists private;

create or replace function private.can_access_order_history(p_edit boolean default false)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.is_admin() and (
    public.is_owner_admin() or exists (
      select 1 from public.admin_permissions p
      where p.profile_id = auth.uid() and p.section_key = 'orders'
        and case when p_edit then p.can_edit else p.can_view or p.can_edit end
    )
  );
$$;
revoke all on function private.can_access_order_history(boolean) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_access_order_history(boolean) to authenticated;

create table public.order_trash (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  center_id uuid,
  customer_name text not null,
  deleted_at timestamptz not null default now(),
  deleted_by uuid,
  deleted_by_name text,
  reason text not null default 'Removed by administrator',
  order_snapshot jsonb not null,
  items_snapshot jsonb not null default '[]',
  movements_snapshot jsonb not null default '[]',
  boxes_snapshot jsonb not null default '[]',
  commissions_snapshot jsonb not null default '[]',
  schedules_snapshot jsonb not null default '[]',
  restored_at timestamptz,
  restored_by uuid
);
create unique index order_trash_pending_order_idx on public.order_trash(order_id) where restored_at is null;
create index order_trash_deleted_at_idx on public.order_trash(deleted_at desc) where restored_at is null;
create index order_trash_center_idx on public.order_trash(center_id);
alter table public.order_trash enable row level security;
revoke all on public.order_trash from anon, authenticated;
grant select on public.order_trash to authenticated;
create policy "order editors read trash" on public.order_trash for select to authenticated
  using ((select private.can_access_order_history(true)));

create table public.order_activity (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  center_id uuid,
  actor_id uuid,
  actor_name text,
  action text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
create index order_activity_order_created_idx on public.order_activity(order_id, created_at desc);
create index order_activity_center_created_idx on public.order_activity(center_id, created_at desc);
alter table public.order_activity enable row level security;
revoke all on public.order_activity from anon, authenticated;
grant select on public.order_activity to authenticated;
create policy "order viewers read activity" on public.order_activity for select to authenticated
  using ((select private.can_access_order_history(false)));

-- The trigger also protects deletion from older clients and direct admin deletes.
create or replace function private.recycle_order_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_actor text;
  v_reason text;
  v_lot record;
begin
  if auth.uid() is not null and not private.can_access_order_history(true) then
    raise exception 'Order edit access required' using errcode = '42501';
  end if;
  select coalesce(p.full_name, p.email) into v_actor from public.profiles p where p.id = auth.uid();
  select c.name into v_name from public.centers c where c.id = old.center_id;
  v_reason := coalesce(nullif(current_setting('app.order_trash_reason', true), ''), 'Removed by administrator');
  insert into public.order_trash (
    order_id, center_id, customer_name, deleted_by, deleted_by_name, reason,
    order_snapshot, items_snapshot, movements_snapshot, boxes_snapshot, commissions_snapshot, schedules_snapshot
  ) values (
    old.id, old.center_id, coalesce(v_name, old.shipping_company, old.shipping_name, 'Unknown customer'),
    auth.uid(), v_actor, left(v_reason, 1000), to_jsonb(old),
    coalesce((select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id = old.id), '[]'),
    coalesce((select jsonb_agg(to_jsonb(m)) from public.inventory_movements m where m.order_id = old.id), '[]'),
    coalesce((select jsonb_agg(to_jsonb(b)) from public.order_item_shipping_boxes b where b.order_id = old.id), '[]'),
    coalesce((select jsonb_agg(to_jsonb(c)) from public.order_commission_snapshots c where c.order_id = old.id), '[]'),
    coalesce((select jsonb_agg(to_jsonb(r)) from public.recurring_orders r where r.source_order_id = old.id), '[]')
  );

  -- Keep schedules and their items intact, but stop generation until explicitly resumed.
  update public.recurring_orders set source_order_id = null, active = false,
    status = case when status = 'canceled' then status else 'paused' end
  where source_order_id = old.id;

  for v_lot in
    select l.id from public.inventory_lots l where l.id in (
      select m.lot_id from public.inventory_movements m
      where m.order_id = old.id and m.movement_type = 'shipment_consume'
    ) order by l.id for update
  loop
    update public.inventory_lots set quantity_remaining = quantity_remaining + coalesce((
      select sum(greatest(0, -m.quantity_change)) from public.inventory_movements m
      where m.order_id = old.id and m.lot_id = v_lot.id and m.movement_type = 'shipment_consume'
    ), 0) where id = v_lot.id;
  end loop;
  delete from public.inventory_movements where order_id = old.id and movement_type = 'shipment_consume';
  insert into public.order_activity(order_id, center_id, actor_id, actor_name, action, before_value, after_value)
  values(old.id, old.center_id, auth.uid(), v_actor, 'moved_to_trash', to_jsonb(old), jsonb_build_object('reason', v_reason));
  return old;
end;
$$;
revoke all on function private.recycle_order_before_delete() from public, anon, authenticated;
create trigger recycle_order_before_delete before delete on public.orders
  for each row execute function private.recycle_order_before_delete();

create or replace function public.move_order_to_trash(p_order_id uuid, p_reason text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_deleted uuid;
begin
  if not private.can_access_order_history(true) then
    raise exception 'Order edit access required' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 1000 then
    raise exception 'A reason of 1 to 1000 characters is required' using errcode = '22023';
  end if;
  perform set_config('app.order_trash_reason', btrim(p_reason), true);
  delete from public.orders where id = p_order_id returning id into v_deleted;
  perform set_config('app.order_trash_reason', '', true);
  if v_deleted is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  return v_deleted;
end;
$$;
revoke all on function public.move_order_to_trash(uuid, text) from public, anon;
grant execute on function public.move_order_to_trash(uuid, text) to authenticated;

-- Preserve the old RPC contract without restoring inventory twice.
create or replace function public.delete_order_and_restore_inventory(p_order_id uuid)
returns table(order_id uuid, recurring_source_count integer, restored_movement_count integer, restored_lot_count integer)
language plpgsql security invoker set search_path = '' as $$
declare v_recurring integer; v_movements integer; v_lots integer;
begin
  if not private.can_access_order_history(true) then
    raise exception 'Order edit access required' using errcode = '42501';
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  select count(*)::integer into v_recurring from public.recurring_orders where source_order_id = p_order_id;
  select count(*)::integer, count(distinct lot_id)::integer into v_movements, v_lots
    from public.inventory_movements where inventory_movements.order_id = p_order_id and movement_type = 'shipment_consume';
  perform public.move_order_to_trash(p_order_id, 'Removed by administrator');
  return query select p_order_id, v_recurring, v_movements, v_lots;
end;
$$;

create or replace function private.restore_order_from_trash(p_trash_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_trash public.order_trash%rowtype;
  v_order public.orders%rowtype;
  v_lot record;
  v_needed numeric;
  v_actor text;
begin
  if not private.can_access_order_history(true) then
    raise exception 'Order edit access required' using errcode = '42501';
  end if;
  select * into v_trash from public.order_trash where id = p_trash_id for update;
  if not found then raise exception 'Order recovery record not found' using errcode = 'P0002'; end if;
  if v_trash.restored_at is not null then return v_trash.order_id; end if;
  if exists(select 1 from public.orders where id = v_trash.order_id) then
    raise exception 'This order already exists' using errcode = '23505';
  end if;
  v_order := jsonb_populate_record(null::public.orders, v_trash.order_snapshot);
  if v_order.center_id is not null and not exists(select 1 from public.centers where id = v_order.center_id) then
    raise exception 'Restore the customer before restoring this order' using errcode = '22023';
  end if;
  if not exists(select 1 from public.profiles where id = v_order.user_id) then v_order.user_id := null; end if;
  if not exists(select 1 from public.center_locations where id = v_order.center_location_id) then v_order.center_location_id := null; end if;
  if not exists(select 1 from public.recurring_orders where id = v_order.recurring_order_id) then v_order.recurring_order_id := null; end if;

  if exists (
    select 1 from jsonb_populate_recordset(null::public.inventory_movements, v_trash.movements_snapshot) m
    where m.movement_type = 'shipment_consume' and m.lot_id is not null
      and not exists(select 1 from public.inventory_lots l where l.id = m.lot_id)
  ) then raise exception 'An inventory lot is missing; restore the lot before restoring this shipment' using errcode = '22023'; end if;
  for v_lot in
    select l.id, l.quantity_remaining from public.inventory_lots l where l.id in (
      select m.lot_id from jsonb_populate_recordset(null::public.inventory_movements, v_trash.movements_snapshot) m
      where m.movement_type = 'shipment_consume'
    ) order by l.id for update
  loop
    select coalesce(sum(greatest(0, -m.quantity_change)), 0) into v_needed
    from jsonb_populate_recordset(null::public.inventory_movements, v_trash.movements_snapshot) m
    where m.lot_id = v_lot.id and m.movement_type = 'shipment_consume';
    if v_lot.quantity_remaining < v_needed then
      raise exception 'Not enough inventory remains to restore this shipment' using errcode = '22023';
    end if;
    update public.inventory_lots set quantity_remaining = quantity_remaining - v_needed where id = v_lot.id;
  end loop;

  perform set_config('app.restoring_order', v_order.id::text, true);
  insert into public.orders select v_order.*;
  insert into public.order_items select * from jsonb_populate_recordset(null::public.order_items, v_trash.items_snapshot);
  insert into public.order_item_shipping_boxes select * from jsonb_populate_recordset(null::public.order_item_shipping_boxes, v_trash.boxes_snapshot);
  insert into public.order_commission_snapshots select * from jsonb_populate_recordset(null::public.order_commission_snapshots, v_trash.commissions_snapshot);
  insert into public.inventory_movements select * from jsonb_populate_recordset(null::public.inventory_movements, v_trash.movements_snapshot)
    on conflict (id) do update set order_id = excluded.order_id, order_item_id = excluded.order_item_id;
  update public.recurring_orders r set source_order_id = v_order.id
    where r.id in (select (s->>'id')::uuid from jsonb_array_elements(v_trash.schedules_snapshot) s)
      and r.source_order_id is null;
  perform set_config('app.restoring_order', '', true);
  select coalesce(p.full_name, p.email) into v_actor from public.profiles p where p.id = auth.uid();
  update public.order_trash set restored_at = now(), restored_by = auth.uid() where id = p_trash_id;
  insert into public.order_activity(order_id, center_id, actor_id, actor_name, action, after_value)
  values(v_order.id, v_order.center_id, auth.uid(), v_actor, 'restored', jsonb_build_object('trash_id', p_trash_id));
  return v_order.id;
end;
$$;
revoke all on function private.restore_order_from_trash(uuid) from public, anon;
grant execute on function private.restore_order_from_trash(uuid) to authenticated;
create or replace function public.restore_order_from_trash(p_trash_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select private.restore_order_from_trash(p_trash_id);
$$;
revoke all on function public.restore_order_from_trash(uuid) from public, anon;
grant execute on function public.restore_order_from_trash(uuid) to authenticated;

create or replace function private.record_order_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_action text; v_before jsonb; v_actor text;
begin
  if current_setting('app.restoring_order', true) = new.id::text then return new; end if;
  if tg_op = 'INSERT' then v_action := 'received';
  else
    v_before := jsonb_build_object('status', old.status, 'notes', old.notes, 'archived_at', old.archived_at,
      'shipping_address1', old.shipping_address1, 'shipping_address2', old.shipping_address2,
      'shipping_city', old.shipping_city, 'shipping_state', old.shipping_state, 'shipping_zip', old.shipping_zip);
    if old.notes is distinct from new.notes then v_action := 'notes_updated';
    elsif old.status is distinct from new.status then v_action := 'status_updated';
    elsif old.archived_at is distinct from new.archived_at then v_action := case when new.archived_at is null then 'unarchived' else 'archived' end;
    elsif row(old.shipping_name,old.shipping_address1,old.shipping_address2,old.shipping_city,old.shipping_state,old.shipping_zip)
      is distinct from row(new.shipping_name,new.shipping_address1,new.shipping_address2,new.shipping_city,new.shipping_state,new.shipping_zip) then v_action := 'delivery_updated';
    else return new;
    end if;
  end if;
  select coalesce(p.full_name,p.email) into v_actor from public.profiles p where p.id = auth.uid();
  insert into public.order_activity(order_id,center_id,actor_id,actor_name,action,before_value,after_value)
    values(new.id,new.center_id,auth.uid(),v_actor,v_action,v_before,jsonb_build_object(
      'status',new.status,'notes',new.notes,'archived_at',new.archived_at,
      'shipping_address1',new.shipping_address1,'shipping_address2',new.shipping_address2,
      'shipping_city',new.shipping_city,'shipping_state',new.shipping_state,'shipping_zip',new.shipping_zip));
  return new;
end;
$$;
revoke all on function private.record_order_activity() from public, anon, authenticated;
create trigger record_order_activity after insert or update on public.orders
  for each row execute function private.record_order_activity();

alter table public.user_product_prices add column allow_zero_price boolean not null default false;
create or replace view public.portal_catalog with (security_invoker = true) as
  select p.id as product_id,p.name,p.description,p.image_url,p.category,price.price_cents as current_price_cents
  from public.products p
  join public.user_products assignment on assignment.product_id = p.id and assignment.center_id = public.current_center_id()
  join public.user_product_prices price on price.product_id = p.id and price.center_id = assignment.center_id
  where coalesce(p.active,false) and (price.price_cents > 0 or (price.price_cents = 0 and price.allow_zero_price));

create or replace function private.validate_order_item_price()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if current_setting('app.restoring_order', true) = new.order_id::text then return new; end if;
  select * into v_order from public.orders where id = new.order_id;
  if v_order.order_kind <> 'prospecting_sample' and new.unit_price_cents <= 0 and not exists(
    select 1 from public.user_product_prices p where p.center_id = v_order.center_id
      and p.product_id = new.product_id and p.price_cents = 0 and p.allow_zero_price
  ) then raise exception 'Product price requires review; complimentary pricing must be explicitly approved' using errcode = '22023'; end if;
  return new;
end;
$$;
revoke all on function private.validate_order_item_price() from public, anon, authenticated;
create trigger validate_order_item_price before insert or update of unit_price_cents,product_id,order_id on public.order_items
  for each row execute function private.validate_order_item_price();

-- Replace assignments and prices together so a failed save cannot empty a catalog.
create or replace function private.save_center_catalog(p_center_id uuid, p_entries jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_admin() or not (
    public.is_owner_admin() or (
      exists(select 1 from public.admin_permissions p where p.profile_id = auth.uid() and p.section_key='centers' and p.can_edit)
      and exists(select 1 from public.admin_center_assignments a where a.profile_id = auth.uid() and a.center_id = p_center_id)
    )
  ) then raise exception 'Customer edit access required' using errcode = '42501'; end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) > 1000 then
    raise exception 'Invalid catalog' using errcode='22023';
  end if;
  perform 1 from public.centers where id = p_center_id for update;
  if not found then raise exception 'Customer not found' using errcode='P0002'; end if;
  if exists(select 1 from jsonb_to_recordset(p_entries) e(product_id uuid,price_cents integer,allow_zero_price boolean)
    where e.product_id is null or e.price_cents is null or e.price_cents < 0 or (e.price_cents=0 and not coalesce(e.allow_zero_price,false)) or not exists(select 1 from public.products p where p.id=e.product_id and p.active)) then
    raise exception 'Invalid product or price' using errcode='22023'; end if;
  if (select count(*) from jsonb_to_recordset(p_entries) e(product_id uuid)) <>
    (select count(distinct product_id) from jsonb_to_recordset(p_entries) e(product_id uuid)) then
    raise exception 'Duplicate product' using errcode='22023'; end if;
  delete from public.user_products where center_id=p_center_id;
  delete from public.user_product_prices where center_id=p_center_id;
  insert into public.user_products(center_id,product_id)
    select p_center_id,e.product_id from jsonb_to_recordset(p_entries) e(product_id uuid);
  insert into public.user_product_prices(center_id,product_id,price_cents,allow_zero_price)
    select p_center_id,e.product_id,e.price_cents,coalesce(e.allow_zero_price,false) and e.price_cents=0
    from jsonb_to_recordset(p_entries) e(product_id uuid,price_cents integer,allow_zero_price boolean);
end;
$$;
revoke all on function private.save_center_catalog(uuid,jsonb) from public, anon;
grant execute on function private.save_center_catalog(uuid,jsonb) to authenticated;
create or replace function public.save_center_catalog(p_center_id uuid,p_entries jsonb)
returns void language sql security invoker set search_path = '' as $$
  select private.save_center_catalog(p_center_id,p_entries);
$$;
revoke all on function public.save_center_catalog(uuid,jsonb) from public, anon;
grant execute on function public.save_center_catalog(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';

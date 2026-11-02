-- A prepaid batch remains physically at Sobrew. Customer releases reserve that
-- finite batch; the original billed order never consumes its finished goods.
create table public.held_stock_sales (
  order_id uuid primary key references public.orders(id) on delete restrict,
  processing_fee_cents integer not null check (processing_fee_cents >= 0),
  donation_cogs_cents integer not null default 0 check (donation_cogs_cents >= 0),
  invoice_only boolean not null default true,
  tax_exempt boolean not null default true
);
create table public.customer_stock_allocations (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.centers(id) on delete restrict,
  product_id uuid not null unique references public.products(id) on delete restrict,
  initial_order_id uuid not null references public.held_stock_sales(order_id) on delete restrict,
  initial_quantity integer not null check (initial_quantity > 0),
  created_at timestamptz not null default now()
);
create index customer_stock_allocations_center_idx on public.customer_stock_allocations(center_id);
create index customer_stock_allocations_initial_order_idx on public.customer_stock_allocations(initial_order_id);
create table public.customer_stock_reservations (
  order_item_id uuid primary key references public.order_items(id) on delete cascade,
  allocation_id uuid not null references public.customer_stock_allocations(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null check (status in ('reserved', 'shipped')),
  consumed_at timestamptz,
  constraint customer_stock_reservations_consumed_state_check
    check ((status = 'shipped') = (consumed_at is not null))
);
create index customer_stock_reservations_allocation_idx on public.customer_stock_reservations(allocation_id);

alter table public.held_stock_sales enable row level security;
alter table public.customer_stock_allocations enable row level security;
alter table public.customer_stock_reservations enable row level security;
revoke all on public.held_stock_sales, public.customer_stock_allocations, public.customer_stock_reservations
  from public, anon, authenticated;
grant select, insert, update, delete on public.held_stock_sales, public.customer_stock_allocations to authenticated;
grant select on public.customer_stock_reservations to authenticated;
grant all on public.held_stock_sales, public.customer_stock_allocations, public.customer_stock_reservations to service_role;
create policy "admins manage held stock sales" on public.held_stock_sales for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins manage customer stock allocations" on public.customer_stock_allocations for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "customers read their stock allocation" on public.customer_stock_allocations for select to authenticated
  using (center_id = (select public.current_center_id()));
create policy "read authorized customer stock reservations" on public.customer_stock_reservations for select to authenticated
  using (exists (select 1 from public.customer_stock_allocations a where a.id = allocation_id));

-- Only quantities are customer-readable. No production or packaging costs are
-- included in either the public ledger or this SECURITY INVOKER read endpoint.
create function public.get_customer_stock_balances(p_center_id uuid)
returns table (
  allocation_id uuid, product_id uuid, initial_quantity integer,
  available_quantity integer, reserved_quantity integer, on_hand_quantity integer
)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not public.is_admin() and current_setting('role', true) <> 'service_role'
    and (auth.uid() is null or public.current_center_id() is distinct from p_center_id) then
    raise exception 'Customer stock access denied' using errcode = '42501';
  end if;
  return query
    select a.id, a.product_id, a.initial_quantity,
      (a.initial_quantity - coalesce(sum(r.quantity), 0))::integer,
      coalesce(sum(r.quantity) filter (where r.consumed_at is null), 0)::integer,
      (a.initial_quantity - coalesce(sum(r.quantity) filter (where r.consumed_at is not null), 0))::integer
    from public.customer_stock_allocations a
    left join public.customer_stock_reservations r on r.allocation_id = a.id
    where a.center_id = p_center_id
    group by a.id, a.product_id, a.initial_quantity;
end;
$$;
revoke all on function public.get_customer_stock_balances(uuid) from public, anon;
grant execute on function public.get_customer_stock_balances(uuid) to authenticated, service_role;

-- A restrictive policy prevents accidental catalog assignments from exposing a
-- different customer's private product. The lookup cannot rely on allocations'
-- RLS, which deliberately hides the other customer's allocation.
create function private.can_read_customer_stock_product(p_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    public.is_admin() or not exists (
      select 1 from public.customer_stock_allocations a
      where a.product_id = p_product_id and a.center_id is distinct from public.current_center_id()
    )
  );
$$;
revoke all on function private.can_read_customer_stock_product(uuid) from public, anon;
grant execute on function private.can_read_customer_stock_product(uuid) to authenticated, service_role;
create policy "customer stock product ownership" on public.products as restrictive for select to authenticated
  using (private.can_read_customer_stock_product(id));

create function private.guard_customer_stock_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_quantity bigint;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Customer stock allocation is permanent; reconcile the batch before changing it' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = new.initial_order_id for update;
  if not found or v_order.center_id is distinct from new.center_id or v_order.status <> 'Shipped'
    or v_order.archived_at is not null then
    raise exception 'The billed held-stock order must be Shipped for the same customer' using errcode = '22023';
  end if;
  select sum(i.qty) into v_quantity from public.order_items i
    where i.order_id = new.initial_order_id and i.product_id = new.product_id;
  if v_quantity is distinct from new.initial_quantity::bigint then
    raise exception 'The allocation quantity must match the original billed quantity' using errcode = '22023';
  end if;
  if exists (select 1 from public.order_items i where i.product_id = new.product_id and i.order_id <> new.initial_order_id)
    or exists (select 1 from public.recurring_order_items i where i.product_id = new.product_id) then
    raise exception 'Create the held-stock allocation before accepting release orders' using errcode = '22023';
  end if;
  if not exists (select 1 from public.inventory_items i where i.product_id = new.product_id
    and i.item_type = 'finished_good' and i.base_unit = 'each') then
    raise exception 'Customer stock requires a finished good tracked by individual bag' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_customer_stock_allocation() from public, anon, authenticated, service_role;
create trigger guard_customer_stock_allocation before insert or update or delete on public.customer_stock_allocations
  for each row execute function private.guard_customer_stock_allocation();

-- All item writes take the parent order lock first, then allocation locks in a
-- stable order. The allocation row serializes reservations across every login,
-- direct admin writes, checkout RPCs, and recurring generation.
create function private.guard_customer_stock_order_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old_product uuid; v_old_order uuid; v_new_product uuid; v_new_order uuid;
  v_allocation public.customer_stock_allocations%rowtype;
  v_order public.orders%rowtype; v_consumed timestamptz; v_restoring boolean;
begin
  if tg_op <> 'INSERT' then v_old_product := old.product_id; v_old_order := old.order_id; end if;
  if tg_op <> 'DELETE' then v_new_product := new.product_id; v_new_order := new.order_id; end if;
  if not exists (select 1 from public.customer_stock_allocations a where a.product_id in (v_old_product, v_new_product)
    or a.initial_order_id in (v_old_order, v_new_order)
    or a.product_id in (select i.product_id from public.order_items i where i.order_id in (v_old_order,v_new_order))) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform 1 from public.orders o where o.id in (v_old_order, v_new_order) order by o.id for update;
  perform 1 from public.customer_stock_allocations a where a.product_id in (v_old_product, v_new_product)
    or a.initial_order_id in (v_old_order, v_new_order)
    or a.product_id in (select i.product_id from public.order_items i where i.order_id in (v_old_order,v_new_order))
    order by a.id for update;
  if tg_op = 'UPDATE' and old.shipping_boxes_used is distinct from new.shipping_boxes_used
    and exists (select 1 from public.customer_stock_reservations r join public.order_items i on i.id = r.order_item_id
      where i.order_id in (v_old_order,v_new_order) and r.consumed_at is not null) then
    raise exception 'Customer stock shipping box counts cannot change after consumption' using errcode = '22023';
  end if;
  if exists (select 1 from public.customer_stock_allocations a where a.initial_order_id in (v_old_order, v_new_order))
    and (tg_op in ('INSERT', 'DELETE') or row(old.order_id, old.product_id, old.qty, old.unit_price_cents, old.line_total_cents)
      is distinct from row(new.order_id, new.product_id, new.qty, new.unit_price_cents, new.line_total_cents)) then
    raise exception 'The original held-stock sale cannot add, remove or reprice lines after allocation' using errcode = '22023';
  end if;
  if tg_op <> 'INSERT' then
    if exists (select 1 from public.customer_stock_allocations a where a.product_id = old.product_id and a.initial_order_id = old.order_id)
      and (tg_op = 'DELETE' or row(old.order_id, old.product_id, old.qty, old.unit_price_cents, old.line_total_cents)
        is distinct from row(new.order_id, new.product_id, new.qty, new.unit_price_cents, new.line_total_cents)) then
      raise exception 'The original held-stock sale cannot be removed or repriced' using errcode = '22023';
    end if;
    select r.consumed_at into v_consumed from public.customer_stock_reservations r where r.order_item_id = old.id;
    if v_consumed is not null and (tg_op = 'DELETE' or row(old.order_id, old.product_id, old.qty, old.unit_price_cents, old.line_total_cents, old.shipping_boxes_used)
      is distinct from row(new.order_id, new.product_id, new.qty, new.unit_price_cents, new.line_total_cents, new.shipping_boxes_used)) then
      -- The existing order-trash trigger restores lots and removes movements
      -- before its item cascade reaches here. Direct item deletion cannot do so.
      if tg_op <> 'DELETE' or exists (select 1 from public.inventory_movements m
        where m.order_item_id = old.id and m.movement_type = 'shipment_consume') then
        raise exception 'Consumed customer stock cannot be edited; use order recovery to restore its inventory' using errcode = '22023';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select * into v_allocation from public.customer_stock_allocations where product_id = new.product_id;
  if not found then return new; end if;
  select * into v_order from public.orders where id = new.order_id;
  if v_order.center_id is distinct from v_allocation.center_id then
    raise exception 'Customer stock belongs to a different customer' using errcode = '42501';
  end if;
  if v_order.id = v_allocation.initial_order_id then
    if tg_op = 'INSERT' then
      raise exception 'The original held-stock sale quantity is already allocated' using errcode = '22023';
    end if;
    return new;
  end if;
  if new.qty <= 0 or new.unit_price_cents <> 0 or new.line_total_cents <> 0 then
    raise exception 'Customer stock releases require a positive bag count and a zero price' using errcode = '22023';
  end if;
  if v_order.recurring_order_id is not null then
    raise exception 'Customer-held stock cannot be scheduled as a recurring order' using errcode = '22023';
  end if;
  v_restoring := coalesce(current_setting('app.restoring_order', true) = v_order.id::text, false)
    and private.can_access_order_history(true)
    and exists (select 1 from public.order_trash t where t.order_id = v_order.id and t.restored_at is null
      and exists (select 1 from jsonb_array_elements(t.items_snapshot) i where i->>'id' = new.id::text)
      and (select sum(greatest(0, -(m->>'quantity_change')::numeric))
        from jsonb_array_elements(t.movements_snapshot) m
        where m->>'order_item_id' = new.id::text and m->>'movement_type' = 'shipment_consume'
          and m->>'inventory_item_id' = (select ii.id::text from public.inventory_items ii where ii.product_id = new.product_id)) = new.qty);
  if v_order.status = 'Shipped' and v_consumed is null and not v_restoring then
    raise exception 'Consume the customer stock before marking its release Shipped' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_customer_stock_order_item() from public, anon, authenticated, service_role;
create trigger aa_guard_customer_stock_order_item before insert or update or delete on public.order_items
  for each row execute function private.guard_customer_stock_order_item();

create function private.sync_customer_stock_order_item(p_order_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.order_items%rowtype; v_order public.orders%rowtype;
  v_allocation public.customer_stock_allocations%rowtype;
  v_consumed timestamptz; v_used bigint; v_restoring boolean;
begin
  select * into v_item from public.order_items where id = p_order_item_id;
  if not found then return; end if;
  select * into v_order from public.orders where id = v_item.order_id;
  select * into v_allocation from public.customer_stock_allocations where product_id = v_item.product_id for update;
  if not found or v_order.id = v_allocation.initial_order_id then
    delete from public.customer_stock_reservations where order_item_id = p_order_item_id;
    return;
  end if;
  select consumed_at into v_consumed from public.customer_stock_reservations where order_item_id = p_order_item_id;
  v_restoring := coalesce(current_setting('app.restoring_order', true) = v_order.id::text, false)
    and private.can_access_order_history(true)
    and exists (select 1 from public.order_trash t where t.order_id = v_order.id and t.restored_at is null
      and (select sum(greatest(0, -(m->>'quantity_change')::numeric))
        from jsonb_array_elements(t.movements_snapshot) m
        where m->>'order_item_id' = p_order_item_id::text and m->>'movement_type' = 'shipment_consume'
          and m->>'inventory_item_id' = (select ii.id::text from public.inventory_items ii where ii.product_id = v_item.product_id)) = v_item.qty);
  if v_restoring then v_consumed := coalesce(v_consumed, now()); end if;
  if v_order.archived_at is not null and v_consumed is null then
    delete from public.customer_stock_reservations where order_item_id = p_order_item_id;
    return;
  end if;
  select coalesce(sum(r.quantity), 0) into v_used from public.customer_stock_reservations r
    where r.allocation_id = v_allocation.id and r.order_item_id <> p_order_item_id;
  if v_used + v_item.qty > v_allocation.initial_quantity then
    raise exception 'Customer stock unavailable: only % bags remain available', v_allocation.initial_quantity - v_used
      using errcode = '23514';
  end if;
  insert into public.customer_stock_reservations(order_item_id, allocation_id, quantity, status, consumed_at)
    values (p_order_item_id, v_allocation.id, v_item.qty, case when v_consumed is null then 'reserved' else 'shipped' end, v_consumed)
    on conflict (order_item_id) do update set allocation_id = excluded.allocation_id,
      quantity = excluded.quantity, status = excluded.status, consumed_at = excluded.consumed_at;
end;
$$;
revoke all on function private.sync_customer_stock_order_item(uuid) from public, anon, authenticated, service_role;
create function private.sync_customer_stock_item_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.sync_customer_stock_order_item(new.id); return new; end;
$$;
revoke all on function private.sync_customer_stock_item_trigger() from public, anon, authenticated, service_role;
create trigger sync_customer_stock_item after insert or update of order_id,product_id,qty on public.order_items
  for each row execute function private.sync_customer_stock_item_trigger();

create function private.guard_customer_stock_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_has_stock boolean;
begin
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  perform 1 from public.customer_stock_allocations a where a.initial_order_id = v_id
    or a.product_id in (select i.product_id from public.order_items i where i.order_id = v_id)
    order by a.id for update;
  if exists (select 1 from public.customer_stock_allocations a where a.initial_order_id = v_id) then
    if tg_op = 'DELETE' or row(old.center_id, old.status, old.archived_at, old.subtotal_cents)
      is distinct from row(new.center_id, new.status, new.archived_at, new.subtotal_cents) then
      raise exception 'The billed held-stock order must remain Shipped and linked to its customer allocation' using errcode = '22023';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select exists (select 1 from public.order_items i join public.customer_stock_allocations a on a.product_id = i.product_id
    where i.order_id = new.id) into v_has_stock;
  if v_has_stock then
    if exists (select 1 from public.order_items i join public.customer_stock_allocations a on a.product_id = i.product_id
      where i.order_id = new.id and a.center_id is distinct from new.center_id) then
      raise exception 'Customer stock belongs to a different customer' using errcode = '42501';
    end if;
    if new.recurring_order_id is not null then
      raise exception 'Customer-held stock cannot be scheduled as a recurring order' using errcode = '22023';
    end if;
    if new.status = 'Shipped' and exists (
      select 1 from public.order_items i join public.customer_stock_allocations a on a.product_id = i.product_id
      left join public.customer_stock_reservations r on r.order_item_id = i.id
      where i.order_id = new.id and r.consumed_at is null
    ) then
      raise exception 'Customer stock shipping requires consumed inventory' using errcode = '22023';
    end if;
    if new.status = 'Shipped' and (
      (select coalesce(sum(i.shipping_boxes_used),0) from public.order_items i where i.order_id = new.id) <= 0
      or exists (select 1 from public.order_items i where i.order_id = new.id
        and (i.shipping_boxes_used < 0 or i.shipping_boxes_used <> trunc(i.shipping_boxes_used)))
    ) then
      raise exception 'Customer stock shipping requires a whole positive box count for the order' using errcode = '22023';
    end if;
    if new.status = 'Shipped' and new.shipping_cost_cents is null then
      raise exception 'Enter the shipping cost before shipping customer stock' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and old.status = 'Shipped' and new.status <> 'Shipped'
      and exists (select 1 from public.customer_stock_reservations r join public.order_items i on i.id = r.order_item_id
        where i.order_id = new.id and r.consumed_at is not null) then
      raise exception 'Use order recovery to reverse a shipped customer-stock release' using errcode = '22023';
    end if;
  end if;
  if new.invoice_status = 'not_required' and new.order_source <> 'shopify' then
    if new.subtotal_cents <> 0 or not v_has_stock or exists (
      select 1 from public.order_items i left join public.customer_stock_allocations a on a.product_id = i.product_id
      where i.order_id = new.id and (a.id is null or i.unit_price_cents <> 0 or i.line_total_cents <> 0)
    ) then
      raise exception 'Only zero-dollar customer stock releases may skip invoicing' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_customer_stock_order() from public, anon, authenticated, service_role;
create trigger aa_guard_customer_stock_order before update or delete on public.orders
  for each row execute function private.guard_customer_stock_order();
create function private.sync_customer_stock_order_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_item uuid;
begin
  for v_item in select i.id from public.order_items i join public.customer_stock_allocations a on a.product_id = i.product_id
    where i.order_id = new.id order by a.id, i.id
  loop perform private.sync_customer_stock_order_item(v_item); end loop;
  return new;
end;
$$;
revoke all on function private.sync_customer_stock_order_trigger() from public, anon, authenticated, service_role;
create trigger sync_customer_stock_order after update of status,archived_at,center_id on public.orders
  for each row execute function private.sync_customer_stock_order_trigger();

create function private.reject_recurring_customer_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.customer_stock_allocations a where a.product_id = new.product_id) then
    raise exception 'Customer-held stock cannot be scheduled as a recurring order' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_recurring_customer_stock() from public, anon, authenticated, service_role;
create trigger reject_recurring_customer_stock before insert or update of product_id on public.recurring_order_items
  for each row execute function private.reject_recurring_customer_stock();

-- The finite prepaid batch cannot be silently replenished or voided after its
-- ownership is established. The existing production-void RPC is transactional,
-- so this rejection also rolls back its earlier material/lot reversals.
create function private.guard_customer_stock_production()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old_product uuid; v_new_product uuid;
begin
  if tg_op <> 'INSERT' then v_old_product := old.product_id; end if;
  if tg_op <> 'DELETE' then v_new_product := new.product_id; end if;
  if exists (select 1 from public.customer_stock_allocations a where a.product_id in (v_old_product,v_new_product))
    and (tg_op in ('INSERT','DELETE') or row(old.product_id,old.finished_lot_id,old.quantity_produced,old.quantity_voided,old.status)
      is distinct from row(new.product_id,new.finished_lot_id,new.quantity_produced,new.quantity_voided,new.status)) then
    raise exception 'Customer-owned batch production cannot be replenished or voided after allocation' using errcode = '22023';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_customer_stock_production() from public, anon, authenticated, service_role;
create trigger guard_customer_stock_production before insert or update or delete on public.production_runs
  for each row execute function private.guard_customer_stock_production();

-- Shopify already uses not_required. Extend the constraint to zero-dollar
-- releases, with the order trigger above checking the actual allocation lines.
alter table public.orders drop constraint if exists orders_invoice_not_required_source_check;
alter table public.orders add constraint orders_invoice_not_required_source_check
  check (invoice_status <> 'not_required' or order_source = 'shopify' or subtotal_cents = 0);

-- Validate the completed transaction as well as status updates. This catches
-- direct header INSERTs and later non-stock line changes without blocking the
-- existing recovery RPC, which restores the header before its line snapshots.
create function private.assert_customer_stock_invoice_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.invoice_status <> 'not_required' or v_order.order_source = 'shopify' then return; end if;
  if v_order.subtotal_cents <> 0
    or not exists (select 1 from public.order_items i where i.order_id = p_order_id)
    or exists (select 1 from public.order_items i
      left join public.customer_stock_allocations a on a.product_id = i.product_id
      where i.order_id = p_order_id and (a.id is null or a.center_id is distinct from v_order.center_id
        or a.initial_order_id = p_order_id or i.unit_price_cents <> 0 or i.line_total_cents <> 0)) then
    raise exception 'Only zero-dollar customer stock releases may skip invoicing' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.assert_customer_stock_invoice_order(uuid) from public, anon, authenticated, service_role;
create function private.validate_customer_stock_invoice_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'orders' then
    perform private.assert_customer_stock_invoice_order(new.id);
  else
    if tg_op <> 'INSERT' then perform private.assert_customer_stock_invoice_order(old.order_id); end if;
    if tg_op <> 'DELETE' then perform private.assert_customer_stock_invoice_order(new.order_id); end if;
  end if;
  return null;
end;
$$;
revoke all on function private.validate_customer_stock_invoice_trigger() from public, anon, authenticated, service_role;
create constraint trigger validate_customer_stock_invoice_order after insert or update on public.orders
  deferrable initially deferred for each row execute function private.validate_customer_stock_invoice_trigger();
create constraint trigger validate_customer_stock_invoice_items after insert or update or delete on public.order_items
  deferrable initially deferred for each row execute function private.validate_customer_stock_invoice_trigger();

-- The UI saves a box plan before requesting shipment. Serialize those edits
-- with consumption and prevent a stale duplicate request from inserting a new
-- box plan after another request has already consumed the original one.
create function private.guard_customer_stock_box_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old_order uuid; v_new_order uuid; v_frozen boolean;
begin
  if tg_op <> 'INSERT' then v_old_order := old.order_id; end if;
  if tg_op <> 'DELETE' then v_new_order := new.order_id; end if;
  if not exists (select 1 from public.order_items i join public.customer_stock_allocations a on a.product_id = i.product_id
    where i.order_id in (v_old_order,v_new_order) and i.order_id <> a.initial_order_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  perform 1 from public.orders o where o.id in (v_old_order,v_new_order) order by o.id for update;
  -- During the order-trash cascade the parent has already been removed and its
  -- inventory restored. The saved box snapshot is recovered with that order.
  if tg_op = 'DELETE' and not exists (select 1 from public.orders where id = old.order_id) then return old; end if;
  select exists (select 1 from public.customer_stock_reservations r join public.order_items i on i.id = r.order_item_id
    where i.order_id in (v_old_order,v_new_order) and r.consumed_at is not null)
    or exists (select 1 from public.order_item_shipping_boxes b
      where b.order_id in (v_old_order,v_new_order) and b.consumed_at is not null) into v_frozen;
  if v_frozen and (
    tg_op in ('INSERT','DELETE')
    or row(old.order_id,old.order_item_id,old.inventory_item_id,old.quantity)
      is distinct from row(new.order_id,new.order_item_id,new.inventory_item_id,new.quantity)
    or (old.consumed_at is not null and new.consumed_at is distinct from old.consumed_at)
  ) then
    -- Recovery re-inserts saved, already-consumed usage rows in one transaction.
    if tg_op <> 'INSERT' or not coalesce(current_setting('app.restoring_order',true) = new.order_id::text,false)
      or not private.can_access_order_history(true) then
      raise exception 'Customer stock shipping boxes were already consumed; recover the order before changing its box plan' using errcode = '22023';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function private.guard_customer_stock_box_plan() from public, anon, authenticated, service_role;
create trigger guard_customer_stock_box_plan before insert or update or delete on public.order_item_shipping_boxes
  for each row execute function private.guard_customer_stock_box_plan();

-- Called only by the guarded held-stock consumption function. The parent order
-- lock and each usage lock make retry/concurrent calls consume boxes once.
create function private.consume_held_stock_shipping_boxes(p_order_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_usage public.order_item_shipping_boxes%rowtype;
  v_lot record;
  v_remaining numeric;
  v_take numeric;
  v_total_cost numeric;
  v_fallback_cost numeric;
  v_estimated boolean;
  v_consumed_at timestamptz := now();
begin
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found' using errcode = 'P0002'; end if;

  -- Serialize different held-stock shipments using the same box inventory and
  -- acquire multiple material locks in a deterministic order.
  perform 1 from public.inventory_items i
    where i.id in (select b.inventory_item_id from public.order_item_shipping_boxes b
      where b.order_id = p_order_id and b.consumed_at is null)
    order by i.id for update;

  for v_usage in select b.* from public.order_item_shipping_boxes b
    where b.order_id = p_order_id order by b.inventory_item_id, b.id for update
  loop
    if v_usage.consumed_at is not null then continue; end if;
    if v_usage.quantity <= 0 or v_usage.quantity <> trunc(v_usage.quantity) then
      raise exception 'Shipping boxes require a positive whole quantity' using errcode = '22023';
    end if;
    if not exists (select 1 from public.order_items i where i.id = v_usage.order_item_id and i.order_id = p_order_id) then
      raise exception 'Shipping box usage belongs to a different order item' using errcode = '22023';
    end if;
    if not exists (select 1 from public.inventory_items i where i.id = v_usage.inventory_item_id and i.base_unit = 'each'
      and not exists (select 1 from public.customer_stock_allocations a where a.product_id = i.product_id)) then
      raise exception 'Shipping box inventory must be counted individually' using errcode = '22023';
    end if;

    v_remaining := v_usage.quantity;
    v_total_cost := 0;
    v_estimated := false;
    for v_lot in select l.id, l.quantity_remaining, l.unit_cost_cents from public.inventory_lots l
      where l.inventory_item_id = v_usage.inventory_item_id and l.quantity_remaining > 0
      order by l.received_at, l.created_at, l.id for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, v_lot.quantity_remaining);
      update public.inventory_lots set quantity_remaining = quantity_remaining - v_take where id = v_lot.id;
      insert into public.inventory_movements(inventory_item_id, lot_id, movement_type,
        quantity_change, unit, unit_cost_cents, order_id, order_item_id, notes)
        values (v_usage.inventory_item_id, v_lot.id, 'shipment_consume', -v_take, 'each',
          v_lot.unit_cost_cents, p_order_id, v_usage.order_item_id, 'Shipping product box used');
      v_total_cost := v_total_cost + v_take * v_lot.unit_cost_cents;
      v_remaining := v_remaining - v_take;
    end loop;

    if v_remaining > 0 then
      select l.unit_cost_cents into v_fallback_cost from public.inventory_lots l
        where l.inventory_item_id = v_usage.inventory_item_id and l.unit_cost_cents > 0
        order by l.received_at desc, l.created_at desc, l.id desc limit 1;
      v_fallback_cost := coalesce(v_fallback_cost, 0);
      v_total_cost := v_total_cost + v_remaining * v_fallback_cost;
      v_estimated := true;
      insert into public.inventory_movements(inventory_item_id, lot_id, movement_type,
        quantity_change, unit, unit_cost_cents, order_id, order_item_id, notes)
        values (v_usage.inventory_item_id, null, 'shipment_consume', -v_remaining, 'each',
          v_fallback_cost, p_order_id, v_usage.order_item_id, 'Shipping product box used below available stock');
    end if;

    update public.order_item_shipping_boxes set
      unit_cost_cents = v_total_cost / v_usage.quantity,
      total_cost_cents = v_total_cost,
      cogs_estimated = v_estimated,
      consumed_at = v_consumed_at,
      updated_at = v_consumed_at
      where id = v_usage.id;
  end loop;
end;
$$;
revoke all on function private.consume_held_stock_shipping_boxes(uuid) from public, anon, authenticated, service_role;

create function private.consume_customer_stock_for_order_item(p_order_item_id uuid, p_shipping_cost_cents integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype; v_item public.order_items%rowtype;
  v_allocation public.customer_stock_allocations%rowtype;
  v_reservation public.customer_stock_reservations%rowtype;
  v_inventory public.inventory_items%rowtype; v_lot record;
  v_remaining numeric; v_take numeric;
begin
  if not public.is_admin() and current_setting('role', true) <> 'service_role' then
    raise exception 'Only administrators can ship customer stock' using errcode = '42501';
  end if;
  if p_shipping_cost_cents is null or p_shipping_cost_cents < 0 then
    raise exception 'A nonnegative shipping cost is required' using errcode = '22023';
  end if;
  select o.* into v_order from public.orders o join public.order_items i on i.order_id = o.id
    where i.id = p_order_item_id for update of o;
  if not found then raise exception 'Order item not found' using errcode = 'P0002'; end if;
  select * into v_item from public.order_items where id = p_order_item_id for update;
  select * into v_allocation from public.customer_stock_allocations where product_id = v_item.product_id for update;
  if not found or v_order.id = v_allocation.initial_order_id or v_order.center_id <> v_allocation.center_id then
    raise exception 'This is not an authorized customer stock release' using errcode = '22023';
  end if;
  select * into v_reservation from public.customer_stock_reservations where order_item_id = p_order_item_id for update;
  if not found or v_reservation.quantity <> v_item.qty or v_reservation.allocation_id <> v_allocation.id then
    raise exception 'Customer stock reservation is missing or changed' using errcode = '22023';
  end if;
  if v_reservation.consumed_at is not null then
    if v_order.shipping_cost_cents is distinct from p_shipping_cost_cents::numeric then
      raise exception 'This stock was already consumed with a different shipping cost; reconcile the shipment before changing it' using errcode = '22023';
    end if;
    perform private.consume_held_stock_shipping_boxes(v_order.id);
    return v_reservation.quantity;
  end if;
  if v_order.archived_at is not null then raise exception 'Restore the order before shipping' using errcode = '22023'; end if;
  if (select coalesce(sum(i.shipping_boxes_used),0) from public.order_items i where i.order_id = v_order.id) <= 0
    or exists (select 1 from public.order_items i where i.order_id = v_order.id
      and (i.shipping_boxes_used < 0 or i.shipping_boxes_used <> trunc(i.shipping_boxes_used))) then
    raise exception 'Customer stock shipping requires shipping cost and a whole positive box count' using errcode = '22023';
  end if;
  select * into v_inventory from public.inventory_items where product_id = v_item.product_id for update;
  if not found or v_inventory.item_type <> 'finished_good' or v_inventory.base_unit <> 'each' then
    raise exception 'Customer stock finished-good inventory is missing' using errcode = '22023';
  end if;
  if exists (select 1 from public.inventory_movements m where m.order_item_id = p_order_item_id
    and m.inventory_item_id = v_inventory.id and m.movement_type = 'shipment_consume') then
    raise exception 'Existing customer stock movements require reconciliation before retrying' using errcode = '22023';
  end if;
  perform private.consume_held_stock_shipping_boxes(v_order.id);
  v_remaining := v_item.qty;
  for v_lot in select l.id, l.quantity_remaining from public.inventory_lots l
    where l.inventory_item_id = v_inventory.id and l.quantity_remaining > 0
    order by l.received_at, l.created_at, l.id for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_lot.quantity_remaining);
    update public.inventory_lots set quantity_remaining = quantity_remaining - v_take where id = v_lot.id;
    insert into public.inventory_movements(inventory_item_id, lot_id, movement_type, quantity_change, unit,
      unit_cost_cents, order_id, order_item_id, notes)
      values (v_inventory.id, v_lot.id, 'shipment_consume', -v_take, 'each', 0, v_order.id, v_item.id,
        'Prepaid customer stock release; production costs recorded on initial order ' || v_allocation.initial_order_id);
    v_remaining := v_remaining - v_take;
  end loop;
  if v_remaining > 0 then
    raise exception 'Insufficient finished customer stock: % more bags required', v_remaining using errcode = '23514';
  end if;
  update public.orders set shipping_cost_cents = p_shipping_cost_cents where id = v_order.id;
  update public.customer_stock_reservations set consumed_at = now(), status = 'shipped' where order_item_id = p_order_item_id;
  return v_item.qty;
end;
$$;
revoke all on function private.consume_customer_stock_for_order_item(uuid, integer) from public, anon;
grant execute on function private.consume_customer_stock_for_order_item(uuid, integer) to authenticated, service_role;
create function public.consume_customer_stock_for_order_item(p_order_item_id uuid, p_shipping_cost_cents integer)
returns integer language sql security invoker set search_path = '' as $$
  select private.consume_customer_stock_for_order_item(p_order_item_id, p_shipping_cost_cents);
$$;
revoke all on function public.consume_customer_stock_for_order_item(uuid, integer) from public, anon;
grant execute on function public.consume_customer_stock_for_order_item(uuid, integer) to authenticated, service_role;

comment on table public.held_stock_sales is 'Admin-only billing and expense overrides for a prepaid custom batch held at Sobrew.';
comment on table public.customer_stock_allocations is 'Permanent finite customer ownership; the initial billed Shipped order does not reduce the stored stock.';
comment on table public.customer_stock_reservations is 'Trigger-maintained releases. consumed_at is the atomic physical stock event, including shipments awaiting a final status update.';
notify pgrst, 'reload schema';

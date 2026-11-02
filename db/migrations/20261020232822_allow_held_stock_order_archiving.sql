-- Archiving is a visibility change. The original prepaid sale must remain
-- Shipped, linked to its customer, and retain its billed amount, but may move
-- between active and archived orders without changing the stock ledger.
create or replace function private.guard_customer_stock_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_has_stock boolean;
begin
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  perform 1 from public.customer_stock_allocations a where a.initial_order_id = v_id
    or a.product_id in (select i.product_id from public.order_items i where i.order_id = v_id)
    order by a.id for update;
  if exists (select 1 from public.customer_stock_allocations a where a.initial_order_id = v_id) then
    if tg_op = 'DELETE' or row(old.center_id, old.status, old.subtotal_cents)
      is distinct from row(new.center_id, new.status, new.subtotal_cents) then
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

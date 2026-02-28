drop policy if exists "self create order_items" on order_items;
create policy "self create order_items" on order_items for insert with check (
  exists(select 1 from orders o where o.id = order_items.order_id and o.user_id = auth.uid())
);

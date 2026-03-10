drop policy if exists "self delete recurring_orders" on recurring_orders;
create policy "self delete recurring_orders" on recurring_orders for delete using (user_id = auth.uid());

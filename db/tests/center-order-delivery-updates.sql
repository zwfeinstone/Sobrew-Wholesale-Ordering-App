-- Run after the center_order_delivery_updates migration as a database owner.
-- Every fixture, generated order, activity entry and receipt is rolled back.
begin;
do $test$
declare
  v_owner uuid;
  v_center uuid := gen_random_uuid();
  v_other_center uuid := gen_random_uuid();
  v_batch_center uuid := gen_random_uuid();
  v_location uuid := gen_random_uuid();
  v_alternate_location uuid := gen_random_uuid();
  v_batch_location uuid := gen_random_uuid();
  v_source uuid := gen_random_uuid();
  v_historical_order uuid := gen_random_uuid();
  v_sample uuid := gen_random_uuid();
  v_restored uuid := gen_random_uuid();
  v_alternate_order uuid := gen_random_uuid();
  v_failed_order uuid := gen_random_uuid();
  v_itemless_order uuid := gen_random_uuid();
  v_other_order uuid := gen_random_uuid();
  v_after_deletion uuid := gen_random_uuid();
  v_batch_first uuid := gen_random_uuid();
  v_batch_second uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_schedule uuid := gen_random_uuid();
  v_first_order uuid;
  v_due timestamptz;
  v_generation record;
  v_note text := 'New address: 470 Lake Concord Rd NE, Concord, NC 28025, United States.';
begin
  select id into v_owner from public.profiles
    where is_superadmin and is_admin and is_active limit 1;
  if v_owner is null then raise exception 'An active superadmin fixture is required'; end if;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into public.centers(id, name) values
    (v_center, 'Delivery update regression: moved customer'),
    (v_other_center, 'Delivery update regression: unrelated customer'),
    (v_batch_center, 'Delivery update regression: batch customer');
  insert into public.center_locations(id, center_id, name, address1, city, state, zip) values
    (v_location, v_center, 'Main delivery', '470 Lake Concord Rd NE', 'Concord', 'NC', '28025'),
    (v_alternate_location, v_center, 'Alternate delivery', '1 Alternate Road', 'Charlotte', 'NC', '28202'),
    (v_batch_location, v_batch_center, 'Batch delivery', '470 Lake Concord Rd NE', 'Concord', 'NC', '28025');
  insert into public.products(id, name, sku, active)
    values (v_product, 'Delivery regression product', 'DELIVERY-TEST-' || v_product, true);

  -- Existing shipped source history predates the configured move.
  insert into public.orders(id, center_id, user_id, status, shipping_name,
    shipping_address1, shipping_address2, shipping_city, shipping_state, shipping_zip, notes)
  values (v_source, v_center, v_owner, 'Shipped', 'Historical recipient',
    '10 Old Road', 'Old suite', 'Old City', 'NC', '28001', 'Call before delivery.');
  insert into public.orders(id, center_id, center_location_id, user_id, created_at, shipping_address1, notes)
    values (v_historical_order, v_center, v_location, v_owner, now() - interval '1 day',
      '470 Lake Concord Rd NE', 'Historical matching-location instructions.');
  insert into private.center_order_delivery_updates(center_id, location_id, next_order_note)
    values (v_center, v_location, v_note), (v_batch_center, v_batch_location, v_note);

  -- Editing the items on an older order at the same location must not consume
  -- a newly armed notice intended for the next order placed.
  insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents)
    values (v_historical_order, v_product, 1, 1000, 1000);
  if (select noted_order_id from private.center_order_delivery_updates where center_id = v_center) is not null
    or not exists(select 1 from public.orders where id = v_historical_order
      and notes = 'Historical matching-location instructions.')
  then raise exception 'An item added to a historical order consumed the newly armed notice'; end if;

  -- Sample shipments and restores must neither change their address nor consume
  -- the notice. Restoration uses the same transaction-local flag as the real RPC.
  insert into public.orders(id, center_id, user_id, order_kind, shipping_address1, notes)
    values (v_sample, v_center, v_owner, 'prospecting_sample', 'Sample Road', 'Sample instructions.');
  insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents)
    values (v_sample, v_product, 1, 1000, 1000);
  perform set_config('app.restoring_order', v_restored::text, true);
  insert into public.orders(id, center_id, user_id, shipping_address1, notes)
    values (v_restored, v_center, v_owner, 'Historical Road', 'Historical instructions.');
  insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents)
    values (v_restored, v_product, 1, 1000, 1000);
  perform set_config('app.restoring_order', '', true);
  if not exists(select 1 from public.orders where id = v_sample
    and shipping_address1 = 'Sample Road' and notes = 'Sample instructions.' and center_location_id is null)
    or not exists(select 1 from public.orders where id = v_restored
      and shipping_address1 = 'Historical Road' and notes = 'Historical instructions.' and center_location_id is null)
    or (select noted_order_id from private.center_order_delivery_updates where center_id = v_center) is not null
  then raise exception 'A sample or restored order applied/consumed the move'; end if;

  -- An explicitly different destination remains authoritative and does not
  -- consume the notice intended for the configured delivery location.
  insert into public.orders(id, center_id, center_location_id, user_id, shipping_address1, notes)
    values (v_alternate_order, v_center, v_alternate_location, v_owner, '1 Alternate Road', 'Alternate delivery.');
  insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents)
    values (v_alternate_order, v_product, 1, 1000, 1000);
  if not exists(select 1 from public.orders where id = v_alternate_order
    and center_location_id = v_alternate_location and shipping_address1 = '1 Alternate Road' and notes = 'Alternate delivery.')
    or (select noted_order_id from private.center_order_delivery_updates where center_id = v_center) is not null
  then raise exception 'An explicit alternate location was overridden or consumed the notice'; end if;

  -- PostgreSQL runs BEFORE INSERT even when ON CONFLICT subsequently skips it.
  insert into public.orders(id, center_id, user_id, notes)
    values (v_source, v_center, v_owner, 'Ignored duplicate.') on conflict (id) do nothing;
  if (select noted_order_id from private.center_order_delivery_updates where center_id = v_center) is not null
    or not exists(select 1 from public.orders where id = v_source
      and notes = 'Call before delivery.' and shipping_address1 = '10 Old Road')
  then raise exception 'A conflict-do-nothing retry consumed the notice or changed history'; end if;

  -- Legacy activation creates the order before a separate request inserts its
  -- items. An empty parent must not consume the notice, even if a failed item
  -- request leaves that parent behind for the caller to clean up.
  insert into public.orders(id, center_id, user_id, notes)
    values (v_itemless_order, v_center, v_owner, 'Itemless order instructions.');
  if (select noted_order_id from private.center_order_delivery_updates where center_id = v_center) is not null
    or not exists(select 1 from public.orders where id = v_itemless_order
      and shipping_address1 = '470 Lake Concord Rd NE' and notes = 'Itemless order instructions.')
  then raise exception 'An itemless order consumed or received the pending note'; end if;
  begin
    -- A valid first row can invoke the claim trigger, but the missing product
    -- in the second row makes this whole item statement roll back atomically.
    insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents) values
      (v_itemless_order, v_product, 1, 1000, 1000),
      (v_itemless_order, gen_random_uuid(), 1, 1000, 1000);
    raise exception 'A nonexistent item product was unexpectedly accepted';
  exception when foreign_key_violation then null;
  end;
  if exists(select 1 from public.order_items where order_id = v_itemless_order)
    or (select noted_order_id from private.center_order_delivery_updates where center_id = v_center) is not null
    or not exists(select 1 from public.orders where id = v_itemless_order and notes = 'Itemless order instructions.')
  then raise exception 'A failed split-call item insertion consumed the notice or changed the parent notes'; end if;
  perform public.move_order_to_trash(v_itemless_order, 'Delivery regression: failed item request cleanup');
  if (select noted_order_id from private.center_order_delivery_updates where center_id = v_center) is not null
  then raise exception 'Cleaning up an itemless order consumed the pending note'; end if;

  -- Roll back after both the order and a valid item have been inserted, as a
  -- later failing step in an atomic checkout would.
  begin
    insert into public.orders(id, center_id, user_id, notes)
      values (v_failed_order, v_center, v_owner, 'Rolled-back instructions.');
    insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents)
      values (v_failed_order, v_product, 1, 1000, 1000);
    if (select noted_order_id from private.center_order_delivery_updates where center_id = v_center)
      is distinct from v_failed_order
    then raise exception 'The order with an inserted item did not claim its notice inside the transaction'; end if;
    raise exception 'Simulated checkout item failure' using errcode = '22023';
  exception when sqlstate '22023' then null;
  end;
  if exists(select 1 from public.orders where id = v_failed_order)
    or (select noted_order_id from private.center_order_delivery_updates where center_id = v_center) is not null
  then raise exception 'Failed checkout left an order or consumed the notice'; end if;

  -- Exercise the actual recurring generator with the historical source's stale
  -- address; its later SELECT must return the saved destination applied on insert.
  insert into public.recurring_orders(id, center_id, user_id, source_order_id, frequency, amount_cents)
    values (v_schedule, v_center, v_owner, v_source, '1_week', 1000);
  insert into public.recurring_order_items(recurring_order_id, product_id, product_name_snapshot, qty, unit_price_cents, line_total_cents)
    values (v_schedule, v_product, 'Delivery regression product', 1, 1000, 1000);
  select next_run_at into v_due from public.recurring_orders where id = v_schedule;
  select * into v_generation from public.generate_recurring_order(v_schedule, v_due);
  v_first_order := v_generation.order_id;
  if not v_generation.was_created or v_first_order is null
    or v_generation.center_location_id is distinct from v_location
    or v_generation.shipping_address1 is distinct from '470 Lake Concord Rd NE'
    or nullif(v_generation.shipping_address2, '') is not null
    or v_generation.shipping_city is distinct from 'Concord'
    or v_generation.shipping_state is distinct from 'NC'
    or v_generation.shipping_zip is distinct from '28025'
  then raise exception 'First recurring generation did not return the new saved address'; end if;
  if not exists(select 1 from public.orders where id = v_first_order
    and strpos(notes, 'Call before delivery.') > 0
    and (length(notes) - length(replace(notes, v_note, ''))) = length(v_note))
    or (select noted_order_id from private.center_order_delivery_updates where center_id = v_center)
      is distinct from v_first_order
  then raise exception 'First actual order lost its permanent notes or did not receive exactly one move notice'; end if;
  if not exists(select 1 from public.orders where id = v_source and status = 'Shipped'
    and shipping_name = 'Historical recipient' and shipping_address1 = '10 Old Road'
    and shipping_address2 = 'Old suite' and shipping_city = 'Old City' and shipping_zip = '28001'
    and notes = 'Call before delivery.')
  then raise exception 'The move rewrote shipped source-order history'; end if;

  select * into v_generation from public.generate_recurring_order(v_schedule, v_due);
  if v_generation.was_created or v_generation.order_id is distinct from v_first_order
    or (select noted_order_id from private.center_order_delivery_updates where center_id = v_center)
      is distinct from v_first_order
  then raise exception 'An idempotent recurring retry replaced the notice claim'; end if;

  -- Reusing the first order as a source exercises the existing note-copy trigger.
  -- The new trigger must remove only the reserved notice and keep other notes.
  update public.recurring_orders set source_order_id = v_first_order where id = v_schedule;
  select next_run_at into v_due from public.recurring_orders where id = v_schedule;
  select * into v_generation from public.generate_recurring_order(v_schedule, v_due);
  if not v_generation.was_created or not exists(select 1 from public.orders where id = v_generation.order_id
    and shipping_address1 = '470 Lake Concord Rd NE' and strpos(notes, v_note) = 0
    and strpos(notes, 'Call before delivery.') > 0
    and strpos(notes, 'Auto-generated recurring order (1_week)') > 0)
    or (select noted_order_id from private.center_order_delivery_updates where center_id = v_center)
      is distinct from v_first_order
  then raise exception 'A reused recurring source repeated the one-time notice or lost permanent notes'; end if;

  -- Future edits to the saved location also apply, without changing the old
  -- order snapshot or rearming the original move notice.
  update public.center_locations set address1 = '472 Lake Concord Rd NE', address2 = 'Suite 2'
    where id = v_location;
  select next_run_at into v_due from public.recurring_orders where id = v_schedule;
  select * into v_generation from public.generate_recurring_order(v_schedule, v_due);
  if v_generation.shipping_address1 is distinct from '472 Lake Concord Rd NE'
    or v_generation.shipping_address2 is distinct from 'Suite 2'
    or exists(select 1 from public.orders where id = v_generation.order_id and strpos(notes, v_note) > 0)
    or not exists(select 1 from public.orders where id = v_first_order and shipping_address1 = '470 Lake Concord Rd NE')
  then raise exception 'A later saved-location edit was ignored, repeated the notice, or changed history'; end if;

  insert into public.orders(id, center_id, user_id, shipping_address1, notes)
    values (v_other_order, v_other_center, v_owner, 'Unrelated Road', 'Leave at side door.');
  insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents)
    values (v_other_order, v_product, 1, 1000, 1000);
  if not exists(select 1 from public.orders where id = v_other_order
    and center_location_id is null and shipping_address1 = 'Unrelated Road' and notes = 'Leave at side door.')
  then raise exception 'A customer without a delivery-update configuration was changed'; end if;

  -- Neither empty parent claims the note. When a multi-row item statement
  -- completes both orders, exactly one receives the pending notice.
  insert into public.orders(id, center_id, user_id, notes) values
    (v_batch_first, v_batch_center, v_owner, 'First batch instructions.'),
    (v_batch_second, v_batch_center, v_owner, 'Second batch instructions.');
  if (select noted_order_id from private.center_order_delivery_updates where center_id = v_batch_center) is not null
    or exists(select 1 from public.orders where id in (v_batch_first, v_batch_second) and strpos(notes, v_note) > 0)
  then raise exception 'A batch of itemless orders prematurely claimed the notice'; end if;
  insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents) values
    (v_batch_first, v_product, 1, 1000, 1000),
    (v_batch_second, v_product, 1, 1000, 1000);
  if (select count(*) from public.orders where id in (v_batch_first, v_batch_second) and strpos(notes, v_note) > 0) <> 1
    or not exists(select 1 from private.center_order_delivery_updates c join public.orders o on o.id = c.noted_order_id
      where c.center_id = v_batch_center and o.id in (v_batch_first, v_batch_second) and strpos(o.notes, v_note) > 0)
    or not exists(select 1 from public.orders where id = v_batch_first and strpos(notes, 'First batch instructions.') > 0)
    or not exists(select 1 from public.orders where id = v_batch_second and strpos(notes, 'Second batch instructions.') > 0)
  then raise exception 'A multi-row insert duplicated/lost the one-time claim or permanent notes'; end if;

  -- Claim provenance survives removal of the order; subsequent orders must not
  -- treat deletion as a fresh opportunity to attach the same one-time notice.
  perform public.move_order_to_trash(v_first_order, 'Delivery regression only');
  insert into public.orders(id, center_id, user_id, notes)
    values (v_after_deletion, v_center, v_owner, 'Instructions after deletion.');
  insert into public.order_items(order_id, product_id, qty, unit_price_cents, line_total_cents)
    values (v_after_deletion, v_product, 1, 1000, 1000);
  if (select noted_order_id from private.center_order_delivery_updates where center_id = v_center)
      is distinct from v_first_order
    or not exists(select 1 from public.orders where id = v_after_deletion
      and shipping_address1 = '472 Lake Concord Rd NE' and notes = 'Instructions after deletion.')
  then raise exception 'Deleting the first noted order rearmed the notice'; end if;

  if has_table_privilege('authenticated', 'private.center_order_delivery_updates', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'private.center_order_delivery_updates', 'INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated', 'private.apply_center_order_delivery_update()', 'EXECUTE')
    or has_function_privilege('anon', 'private.apply_center_order_delivery_update()', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.mark_center_order_delivery_update()', 'EXECUTE')
    or has_function_privilege('anon', 'private.mark_center_order_delivery_update()', 'EXECUTE')
  then raise exception 'Delivery-update internals are exposed to untrusted API callers'; end if;
end;
$test$;
select 'PASS: one-time note after first item, itemless and failed split-call safety, current recurring address, source preservation, sample/restore/alternate exclusions, rollback, conflict retries, multi-row items, source-note stripping, future address edits, durable claims and access controls' as result;
rollback;

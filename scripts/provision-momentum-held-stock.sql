-- Approved one-off Momentum Recovery batch. Execute only after the customer-held
-- stock migration and application billing safeguards have been deployed.
-- This transaction records the order and inventory; it sends no email, creates
-- no QuickBooks invoice, and never charges a card. Invoice delivery is separate.
-- Re-running an intact batch is a verified no-op, even after release shipments.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

do $provision_momentum$
declare
  v_sku constant text := 'MOMENTUM-CUSTOM-8OZ-20261020';
  v_center_id constant uuid := 'f5f284c6-cd7c-4a1b-9e4b-497fe7299837';
  v_user_id constant uuid := 'f2780be5-b012-4900-b3fd-69d39e56bc81';
  v_raw_item_id constant uuid := 'bcdfd4f2-db80-4260-aa7c-13715f6544e1';
  v_center public.centers%rowtype;
  v_user public.profiles%rowtype;
  v_product public.products%rowtype;
  v_raw public.inventory_items%rowtype;
  v_allocation public.customer_stock_allocations%rowtype;
  v_run public.production_runs%rowtype;
  v_lot record;
  v_product_id uuid;
  v_finished_item_id uuid;
  v_finished_lot_id uuid;
  v_run_id uuid;
  v_order_id uuid;
  v_order_item_id uuid;
  v_raw_before numeric;
  v_remaining numeric := 510;
  v_take numeric;
  v_material_cost numeric := 0;
  v_shipped_quantity bigint;
  v_now timestamptz := now();
  v_order_note constant text := 'Billed - held at Sobrew for future deliveries. Momentum Recovery purchased 1,000 Custom 8-ounce bags of Meeting Coffee Medium Roast, ground, for $6,900 total, with no tax. This order is marked Shipped for the billed-and-held purchase; no physical dispatch has occurred. The 1,000 bags remain at Sobrew for delivery on request through your order guide. Boxes, shipping, and freight are included, with no additional charge for these deliveries. An invoice will be emailed; your saved payment method will not be charged for this purchase.';
  v_note constant text := 'Billed - held at Sobrew for future deliveries. Momentum Recovery purchased 1,000 custom 8-ounce bags of Meeting Coffee Medium Roast, ground, for $6,900 total. Marked Shipped for the approved billed-and-held sale; no physical dispatch has occurred. Coffee: 500 lb packed plus additive 2% waste (10 lb), 510 lb consumed. One-time custom packaging $1,500, labor $800, tape $20. Processing allowance 2.99% ($206.31), no fixed processing fee, no donation, no tax. Invoice only for this order; do not charge the saved payment method. Empty custom bags are a one-time expense and are not maintained as packaging inventory. Finished bags remain customer-owned at Sobrew. Boxes and shipping/freight remain pending and will be recorded on linked release shipments; Sobrew absorbs those costs and no additional customer charge is due.';
begin
  perform pg_advisory_xact_lock(hashtextextended(v_sku, 0));

  select * into v_center from public.centers where id = v_center_id for update;
  if not found or v_center.name is distinct from 'Momentum Recovery'
    or v_center.is_active is distinct from true
    or lower(btrim(v_center.billing_email)) is distinct from 'momentumrecovery1@bill.com' then
    raise exception 'Momentum identity, active status, or approved invoice recipient changed; review before provisioning';
  end if;
  select * into v_user from public.profiles where id = v_user_id for share;
  if not found or v_user.center_id is distinct from v_center_id or v_user.is_active is distinct from true
    or v_user.is_admin is distinct from false or v_user.full_name is distinct from 'Melissa Cantrell' then
    raise exception 'The verified Momentum customer login changed; review before provisioning';
  end if;
  select * into v_raw from public.inventory_items where id = v_raw_item_id for update;
  if not found or v_raw.name is distinct from 'Raw Coffee - Meeting Coffee Medium Roast'
    or v_raw.sku is distinct from 'RAW-COF-MTC-MED' or v_raw.item_type is distinct from 'raw_coffee'
    or v_raw.base_unit is distinct from 'lb' or v_raw.active is distinct from true then
    raise exception 'The approved medium-roast raw coffee identity changed; review before provisioning';
  end if;

  select * into v_product from public.products where sku = v_sku for update;
  if found then
    select * into v_allocation from public.customer_stock_allocations where product_id = v_product.id for update;
    if not found then raise exception 'Task SKU exists without an allocation; no data was changed'; end if;
    if v_product.name is distinct from 'Custom 8-ounce bags' or v_product.active is distinct from true
      or v_product.category is distinct from 'retail' or v_product.shipping_box_count_required is distinct from true
      or v_product.receivable_finished_good is distinct from false or v_allocation.center_id is distinct from v_center_id
      or v_allocation.initial_quantity is distinct from 1000 then
      raise exception 'Existing Momentum batch identity or allocation does not match the approved plan';
    end if;
    v_order_id := v_allocation.initial_order_id;
    if not exists (
      select 1 from public.orders o join public.held_stock_sales h on h.order_id = o.id
      where o.id = v_order_id and o.center_id = v_center_id and o.user_id = v_user_id
        and o.status = 'Shipped' and o.archived_at is null and o.subtotal_cents = 690000
        and o.processing_fee_cents = 20631 and o.donation_cogs_cents = 0
        and o.shipping_cost_cents is null and o.quickbooks_payment_charge_id is null
        and h.processing_fee_cents = 20631 and h.donation_cogs_cents = 0 and h.invoice_only and h.tax_exempt
    ) then raise exception 'Existing billed-and-held order does not match the approved amount and billing overrides'; end if;
    if (select count(*) from public.order_items where order_id = v_order_id) <> 1 or not exists (
      select 1 from public.order_items i where i.order_id = v_order_id and i.product_id = v_product.id
        and i.qty = 1000 and i.unit_price_cents = 690 and i.line_total_cents = 690000
        and i.cogs_material_cents = 102000 and i.cogs_labor_cents = 80000
        and i.cogs_fixed_cents = 152000 and i.cogs_fixed_other_cents = 150000 and i.cogs_tape_cents = 2000
        and i.cogs_product_cents = 334000 and i.cogs_processing_fee_cents = 20631 and i.cogs_donation_cents = 0
        and i.cogs_shipping_cents is null and i.shipping_boxes_used is null
        and i.cogs_total_cents = 354631 and i.cogs_unit_cents = 334 and i.cogs_snapshot_at is not null
    ) then raise exception 'Existing billed line or batch cost snapshot does not match the approved plan'; end if;
    if (select count(*) from public.production_runs where product_id = v_product.id) <> 1 then
      raise exception 'Existing batch must have exactly one production run';
    end if;
    select * into v_run from public.production_runs where product_id = v_product.id for update;
    if v_run.quantity_produced <> 1000 or v_run.status <> 'active' or v_run.quantity_voided <> 0
      or v_run.actual_unit_cost_cents is distinct from 334 or v_run.actual_labor_cost_cents <> 80000
      or v_run.fixed_cost_cents <> 152000 or v_run.fixed_other_cost_cents <> 150000 or v_run.fixed_tape_cost_cents <> 2000
      or (select count(*) from public.production_run_inputs where production_run_id = v_run.id) <> 1
      or not exists (select 1 from public.production_run_inputs where production_run_id = v_run.id
        and inventory_item_id = v_raw_item_id and quantity_expected = 510 and quantity_used = 510 and cost_cents = 102000 and unit = 'lb') then
      raise exception 'Existing batch production provenance does not match the approved plan';
    end if;
    select coalesce(sum(quantity), 0) into v_shipped_quantity from public.customer_stock_reservations
      where allocation_id = v_allocation.id and consumed_at is not null;
    if (select count(*) from public.inventory_lots l join public.inventory_items i on i.id = l.inventory_item_id where i.product_id = v_product.id) <> 1
      or not exists (select 1 from public.inventory_lots l join public.inventory_items i on i.id = l.inventory_item_id
      where l.id = v_run.finished_lot_id and l.production_run_id = v_run.id and l.quantity_received = 1000
        and l.quantity_remaining = 1000 - v_shipped_quantity and l.unit_cost_cents = 0
        and i.product_id = v_product.id and i.item_type = 'finished_good' and i.base_unit = 'each') then
      raise exception 'Existing customer-owned finished stock does not reconcile to shipped releases';
    end if;
    if (select coalesce(sum(-quantity_change), 0) from public.inventory_movements
      where production_run_id = v_run.id and inventory_item_id = v_raw_item_id and movement_type = 'production_consume') <> 510
      or (select coalesce(sum(-quantity_change * unit_cost_cents), 0) from public.inventory_movements
      where production_run_id = v_run.id and inventory_item_id = v_raw_item_id and movement_type = 'production_consume') <> 102000
      or (select coalesce(sum(quantity_change), 0) from public.inventory_movements
      where production_run_id = v_run.id and lot_id = v_run.finished_lot_id and movement_type = 'production_output' and unit_cost_cents = 0) <> 1000
      or exists (select 1 from public.inventory_movements where order_id = v_order_id) then
      raise exception 'Existing batch raw usage or initial-order physical dispatch history does not reconcile';
    end if;
    if not exists (select 1 from public.user_products where center_id = v_center_id and product_id = v_product.id)
      or not exists (select 1 from public.user_product_prices where center_id = v_center_id and product_id = v_product.id and price_cents = 0 and allow_zero_price)
      or exists (select 1 from public.user_products where product_id = v_product.id and center_id <> v_center_id)
      or exists (select 1 from public.user_product_prices where product_id = v_product.id and center_id <> v_center_id) then
      raise exception 'Existing private $0 order-guide assignment does not match the approved plan';
    end if;
    raise notice 'Verified existing Momentum held-stock batch. Order %, product %, allocation %. No changes made.', v_order_id, v_product.id, v_allocation.id;
    return;
  end if;

  if exists (select 1 from public.inventory_items where sku = 'FG-' || v_sku)
    or exists (select 1 from public.inventory_lots where lot_code = v_sku) then
    raise exception 'Task inventory identifiers already exist without the expected product; review before provisioning';
  end if;
  -- Do not consume an unrelated next-delivery notice on this billed-only order.
  if exists (select 1 from private.center_order_delivery_updates where center_id = v_center_id) then
    raise exception 'Momentum has a saved next-delivery update; preserve it and review provisioning before proceeding';
  end if;

  -- Lock every currently available source lot in the same FIFO order as normal
  -- production, then verify sufficient stock before creating anything.
  perform id from public.inventory_lots where inventory_item_id = v_raw_item_id and quantity_remaining > 0
    order by received_at, created_at, id for update;
  select coalesce(sum(quantity_remaining), 0) into v_raw_before from public.inventory_lots where inventory_item_id = v_raw_item_id;
  if v_raw_before < 510 then raise exception 'Insufficient approved medium roast: % lb available; 510 lb required', v_raw_before; end if;

  insert into public.products (name, sku, description, category, active, shipping_box_count_required, receivable_finished_good)
    values ('Custom 8-ounce bags', v_sku, 'Meeting Coffee Medium Roast, ground. Your purchased custom 8-ounce bags held at Sobrew for delivery on request.', 'retail', true, true, false)
    returning id into v_product_id;
  insert into public.inventory_items (name, sku, description, item_type, base_unit, product_id, active)
    values ('Custom 8-ounce bags - Momentum Recovery', 'FG-' || v_sku,
      'Customer-owned finished bags. Costs recognized once on the original billed order; release stock has zero carrying cost.',
      'finished_good', 'each', v_product_id, true)
    returning id into v_finished_item_id;
  insert into public.production_runs (
    product_id, quantity_produced, waste_quantity, estimated_unit_cost_cents, actual_unit_cost_cents,
    expected_labor_cost_cents, actual_labor_cost_cents, labor_minutes, labor_rate_cents,
    fixed_cost_cents, fixed_tape_cost_cents, fixed_shipping_label_cost_cents, fixed_branding_label_cost_cents, fixed_other_cost_cents,
    status, produced_at, notes
  ) values (
    v_product_id, 1000, 0, 334, 334, 80000, 80000, 0, 0, 152000, 2000, 0, 0, 150000,
    'active', v_now, v_note || ' Production waste_quantity is finished-bag scrap (0); the 10 lb coffee waste is included in the 510 lb input. Labor is a fixed batch cost; no hours or pay rate were supplied.'
  ) returning id into v_run_id;

  for v_lot in select id, quantity_remaining, unit_cost_cents from public.inventory_lots
    where inventory_item_id = v_raw_item_id and quantity_remaining > 0 order by received_at, created_at, id for update
  loop
    exit when v_remaining = 0;
    if v_lot.unit_cost_cents <> 200 then
      raise exception 'FIFO raw-coffee cost changed from the approved $2/lb; no batch will be created';
    end if;
    v_take := least(v_remaining, v_lot.quantity_remaining);
    update public.inventory_lots set quantity_remaining = quantity_remaining - v_take where id = v_lot.id;
    insert into public.inventory_movements (inventory_item_id, lot_id, movement_type, quantity_change, unit, unit_cost_cents, production_run_id, notes)
      values (v_raw_item_id, v_lot.id, 'production_consume', -v_take, 'lb', v_lot.unit_cost_cents, v_run_id,
        'Momentum custom batch: 500 lb packed plus 10 lb additive 2% waste.');
    v_material_cost := v_material_cost + v_take * v_lot.unit_cost_cents;
    v_remaining := v_remaining - v_take;
  end loop;
  if v_remaining <> 0 or v_material_cost <> 102000 then
    raise exception 'Raw material consumption or approved $1,020 cost did not reconcile';
  end if;
  insert into public.production_run_inputs (production_run_id, inventory_item_id, quantity_expected, quantity_used, unit, cost_cents)
    values (v_run_id, v_raw_item_id, 510, 510, 'lb', 102000);
  insert into public.inventory_lots (inventory_item_id, lot_code, source_type, quantity_received, quantity_remaining, unit_cost_cents, production_run_id, received_at, notes)
    values (v_finished_item_id, v_sku, 'production', 1000, 1000, 0, v_run_id, v_now,
      '1,000 customer-owned Momentum bags held at Sobrew. Batch product cost $3,340 recognized on original sale; this zero-value lot prevents repeat COGS on releases.')
    returning id into v_finished_lot_id;
  update public.production_runs set finished_lot_id = v_finished_lot_id where id = v_run_id;
  insert into public.inventory_movements (inventory_item_id, lot_id, movement_type, quantity_change, unit, unit_cost_cents, production_run_id, notes)
    values (v_finished_item_id, v_finished_lot_id, 'production_output', 1000, 'each', 0, v_run_id,
      'Customer-owned finished bags stored at Sobrew; production cost remains documented on the run and original sale.');

  insert into public.orders (
    user_id, center_id, status, order_kind, order_source, fulfillment_method, notes, subtotal_cents,
    shipping_name, shipping_company, shipping_address1, shipping_address2, shipping_city, shipping_state, shipping_zip,
    shipped_at, shipping_cost_cents, processing_fee_cents, donation_cogs_cents, invoice_status
  ) values (
    v_user_id, v_center_id, 'Shipped', 'standard', 'portal', 'carrier', v_order_note, 690000,
    v_user.full_name, v_center.name, v_center.billing_address1, v_center.billing_address2, v_center.billing_city, v_center.billing_state, v_center.billing_zip,
    v_now, null, 20631, 0, 'not_invoiced'
  ) returning id into v_order_id;
  insert into public.order_items (
    order_id, product_id, product_name_snapshot, qty, unit_price_cents, line_total_cents, shipping_boxes_used,
    cogs_material_cents, cogs_labor_cents, cogs_fixed_cents, cogs_tape_cents, cogs_shipping_label_cents, cogs_branding_label_cents,
    cogs_fixed_other_cents, cogs_product_cents, cogs_processing_fee_cents, cogs_donation_cents, cogs_shipping_cents,
    cogs_total_cents, cogs_unit_cents, cogs_source, cogs_estimated, cogs_snapshot_at
  ) values (
    v_order_id, v_product_id, 'Custom 8-ounce bags', 1000, 690, 690000, null,
    102000, 80000, 152000, 2000, 0, 0, 150000, 334000, 20631, 0, null,
    354631, 334, 'held_stock_batch', false, v_now
  ) returning id into v_order_item_id;
  insert into public.held_stock_sales (order_id, processing_fee_cents, donation_cogs_cents, invoice_only, tax_exempt)
    values (v_order_id, 20631, 0, true, true);
  -- This is last among stock/production writes: the allocation freezes the
  -- original sale and the batch production history against later mutation.
  insert into public.customer_stock_allocations (center_id, product_id, initial_order_id, initial_quantity)
    values (v_center_id, v_product_id, v_order_id, 1000) returning * into v_allocation;

  -- Catalogs are center-scoped, so these rows apply to every Momentum login.
  -- No existing assignment, customer setting, tax setting, or payment method is changed.
  insert into public.user_products (center_id, user_id, product_id) values (v_center_id, v_user_id, v_product_id);
  insert into public.user_product_prices (center_id, user_id, product_id, price_cents, allow_zero_price)
    values (v_center_id, v_user_id, v_product_id, 0, true);

  if (select coalesce(sum(quantity_remaining), 0) from public.inventory_lots where inventory_item_id = v_raw_item_id) <> v_raw_before - 510
    or (select quantity_remaining from public.inventory_lots where id = v_finished_lot_id) is distinct from 1000
    or exists (select 1 from public.customer_stock_reservations where allocation_id = v_allocation.id)
    or exists (select 1 from public.inventory_movements where order_id = v_order_id) then
    raise exception 'Post-provision stock check failed; entire transaction rolled back';
  end if;
  raise notice 'Created Momentum billed-and-held order %, product %, allocation %, production run %. No invoice was sent and no card was charged.',
    v_order_id, v_product_id, v_allocation.id, v_run_id;
end;
$provision_momentum$;

commit;

select p.id as product_id, a.id as allocation_id, a.initial_order_id as order_id, a.initial_quantity,
  o.status, o.subtotal_cents, o.invoice_status, o.shipping_cost_cents,
  o.quickbooks_invoice_id, o.quickbooks_invoice_email_sent_at, o.quickbooks_payment_charge_id,
  i.cogs_total_cents, r.id as production_run_id, l.quantity_remaining as physically_held_bags
from public.products p
join public.customer_stock_allocations a on a.product_id = p.id
join public.orders o on o.id = a.initial_order_id
join public.order_items i on i.order_id = o.id and i.product_id = p.id
join public.production_runs r on r.product_id = p.id
join public.inventory_lots l on l.id = r.finished_lot_id
where p.sku = 'MOMENTUM-CUSTOM-8OZ-20261020';

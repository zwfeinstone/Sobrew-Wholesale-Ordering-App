import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const PROCESSING_FEE_RATE = 0.0299;
const PROCESSING_FEE_FIXED_CENTS = 30;
const DONATION_COGS_RATE = 0.01;
const PLACEHOLDER_SHIPPING_CENTS_PER_LB = 100;
const PAGE_SIZE = 1000;
const CHUNK_SIZE = 400;
const CENTRAL_TIME_ZONE = 'America/Chicago';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function chunks(values, size = CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function fetchAll(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function numericValue(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineRevenueCents(item) {
  const explicit = numericValue(item.line_total_cents);
  if (explicit > 0) return explicit;
  return numericValue(item.qty) * numericValue(item.unit_price_cents);
}

function processingFeeCentsForRevenue(revenueCents) {
  const parsed = numericValue(revenueCents);
  if (parsed < 0) return 0;
  return Math.round(parsed * PROCESSING_FEE_RATE + PROCESSING_FEE_FIXED_CENTS);
}

function donationCogsCentsForRevenue(revenueCents) {
  const parsed = numericValue(revenueCents);
  if (parsed <= 0) return 0;
  return Math.round(parsed * DONATION_COGS_RATE);
}

function allocateShipping(items, shippingCostCents) {
  const allocations = new Map();
  const safeAmount = Math.max(0, shippingCostCents);
  const totalBoxes = items.reduce((sum, item) => sum + Math.max(0, numericValue(item.shipping_boxes_used)), 0);
  const totalRevenue = items.reduce((sum, item) => sum + Math.max(0, lineRevenueCents(item)), 0);
  const useBoxes = totalBoxes > 0 && items.every((item) => numericValue(item.shipping_boxes_used) > 0);
  const totalWeight = useBoxes ? totalBoxes : totalRevenue || items.length || 1;
  let allocated = 0;

  items.forEach((item, index) => {
    const weight = useBoxes
      ? Math.max(0, numericValue(item.shipping_boxes_used))
      : totalRevenue > 0
        ? Math.max(0, lineRevenueCents(item))
        : 1;
    const amount = index === items.length - 1 ? Math.max(0, safeAmount - allocated) : (safeAmount * weight) / totalWeight;
    allocated += amount;
    allocations.set(item.id, amount);
  });

  return allocations;
}

function allocateByRevenue(items, amountCents) {
  const allocations = new Map();
  const safeAmount = Math.max(0, amountCents);
  const totalRevenue = items.reduce((sum, item) => sum + Math.max(0, lineRevenueCents(item)), 0);
  const totalWeight = totalRevenue || items.length || 1;
  let allocated = 0;

  items.forEach((item, index) => {
    const weight = totalRevenue > 0 ? Math.max(0, lineRevenueCents(item)) : 1;
    const amount = index === items.length - 1 ? Math.max(0, safeAmount - allocated) : (safeAmount * weight) / totalWeight;
    allocated += amount;
    allocations.set(item.id, amount);
  });

  return allocations;
}

function commissionMonthForDate(value = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    timeZone: CENTRAL_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(safeDate);
  const year = parts.find((part) => part.type === 'year')?.value ?? String(safeDate.getUTCFullYear());
  const month = parts.find((part) => part.type === 'month')?.value ?? String(safeDate.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

function componentPounds(component) {
  const quantity = numericValue(component.quantity);
  if (quantity <= 0) return { pounds: 0, valid: false };
  if (component.unit === 'lb') return { pounds: quantity, valid: true };
  if (component.unit === 'oz') return { pounds: quantity / 16, valid: true };
  return { pounds: 0, valid: false };
}

function recipePoundsPerUnit(recipe) {
  const outputQty = numericValue(recipe.output_qty);
  if (outputQty <= 0) return { poundsPerUnit: 0, valid: false };
  const components = recipe.product_recipe_components ?? [];
  const rawCoffeeComponents = components.filter((component) => {
    const item = Array.isArray(component.inventory_items) ? component.inventory_items[0] : component.inventory_items;
    return component.component_role === 'raw_coffee' || item?.item_type === 'raw_coffee';
  });
  if (!rawCoffeeComponents.length) return { poundsPerUnit: 0, valid: false };

  let totalPounds = 0;
  let valid = true;
  for (const component of rawCoffeeComponents) {
    const converted = componentPounds(component);
    totalPounds += converted.pounds;
    valid = valid && converted.valid;
  }
  return { poundsPerUnit: totalPounds / outputQty, valid: valid && totalPounds > 0 };
}

function deriveProductCogsCents(item) {
  const explicitProductCogs = numericValue(item.cogs_product_cents);
  if (explicitProductCogs > 0) return explicitProductCogs;
  const totalCogs = numericValue(item.cogs_total_cents);
  if (totalCogs <= 0) return 0;
  return Math.max(
    0,
    totalCogs
      - numericValue(item.cogs_shipping_cents)
      - numericValue(item.cogs_processing_fee_cents)
      - numericValue(item.cogs_donation_cents)
  );
}

function productLabel(item) {
  return item.product_name_snapshot || item.product_id || 'Unknown product';
}

async function main() {
  loadEnvFile(path.resolve('.env.local'));

  const apply = process.argv.includes('--apply');
  const help = process.argv.includes('--help') || process.argv.includes('-h');
  if (help) {
    console.log('Usage: npm run backfill:cogs           # dry run');
    console.log('Usage: npm run backfill:cogs -- --apply # write changes');
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false },
  });
  const snapshotAt = new Date().toISOString();

  const orders = await fetchAll(() =>
    supabase
      .from('orders')
      .select('id,center_id,status,subtotal_cents,shipping_cost_cents,created_at,shipped_at')
      .eq('status', 'Shipped')
      .order('created_at', { ascending: true })
  );
  const orderIds = orders.map((order) => order.id);
  if (!orderIds.length) {
    console.log('No shipped orders found.');
    return;
  }

  const orderItems = [];
  for (const orderIdChunk of chunks(orderIds)) {
    orderItems.push(
      ...(await fetchAll(() =>
        supabase
          .from('order_items')
          .select('id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents,shipping_boxes_used,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_unit_cents,cogs_source,cogs_estimated,cogs_snapshot_at')
          .in('order_id', orderIdChunk)
      ))
    );
  }

  const productIds = [...new Set(orderItems.map((item) => item.product_id).filter(Boolean))];
  const recipes = [];
  for (const productIdChunk of chunks(productIds)) {
    recipes.push(
      ...(await fetchAll(() =>
        supabase
          .from('product_recipes')
          .select('product_id,output_qty,product_recipe_components(quantity,unit,component_role,inventory_items(item_type))')
          .in('product_id', productIdChunk)
      ))
    );
  }

  const centerIds = [...new Set(orders.map((order) => order.center_id).filter(Boolean))];
  const assignments = centerIds.length
    ? await fetchAll(() =>
        supabase
          .from('center_sales_assignments')
          .select('center_id,sales_profile_id')
          .in('center_id', centerIds)
      )
    : [];
  const salesProfileIds = [...new Set(assignments.map((assignment) => assignment.sales_profile_id).filter(Boolean))];
  const commissionSettings = salesProfileIds.length
    ? await fetchAll(() =>
        supabase
          .from('admin_commission_settings')
          .select('profile_id,commission_percent')
          .in('profile_id', salesProfileIds)
      )
    : [];
  const existingSnapshots = [];
  for (const orderIdChunk of chunks(orderIds)) {
    existingSnapshots.push(
      ...(await fetchAll(() =>
        supabase
          .from('order_commission_snapshots')
          .select('id,order_id,sales_profile_id')
          .in('order_id', orderIdChunk)
      ))
    );
  }

  const itemsByOrderId = new Map();
  for (const item of orderItems) {
    const rows = itemsByOrderId.get(item.order_id) ?? [];
    rows.push(item);
    itemsByOrderId.set(item.order_id, rows);
  }

  const poundsPerUnitByProductId = new Map();
  for (const recipe of recipes) {
    poundsPerUnitByProductId.set(recipe.product_id, recipePoundsPerUnit(recipe));
  }
  const assignmentByCenterId = new Map(assignments.map((assignment) => [assignment.center_id, assignment.sales_profile_id]));
  const commissionPercentByProfileId = new Map(commissionSettings.map((setting) => [setting.profile_id, numericValue(setting.commission_percent)]));
  const snapshotByOrderId = new Map(existingSnapshots.map((snapshot) => [snapshot.order_id, snapshot]));

  const missingRecipeProducts = new Map();
  const computedOrders = [];
  const computedItemsByOrderId = new Map();
  let placeholderShippingOrderCount = 0;
  let preservedShippingOrderCount = 0;
  let totalPlaceholderShippingCents = 0;
  let totalProcessingFeeCents = 0;
  let totalDonationCents = 0;
  let productCogsMissingOrderCount = 0;

  for (const order of orders) {
    const items = itemsByOrderId.get(order.id) ?? [];
    const revenueCents = numericValue(order.subtotal_cents) || items.reduce((sum, item) => sum + lineRevenueCents(item), 0);
    const processingFeeCents = processingFeeCentsForRevenue(revenueCents);
    const donationCogsCents = donationCogsCentsForRevenue(revenueCents);
    const hasActualShipping = numericValue(order.shipping_cost_cents) > 0;
    let poundsSold = 0;
    const missingPoundsByItemId = new Set();

    if (!hasActualShipping) {
      for (const item of items) {
        const qty = Math.max(0, numericValue(item.qty));
        const poundsInfo = item.product_id ? poundsPerUnitByProductId.get(item.product_id) : null;
        if (!poundsInfo?.valid) {
          missingPoundsByItemId.add(item.id);
          const key = item.product_id ?? productLabel(item);
          const row = missingRecipeProducts.get(key) ?? {
            product: productLabel(item),
            quantity: 0,
            orders: new Set(),
          };
          row.quantity += qty;
          row.orders.add(order.id);
          missingRecipeProducts.set(key, row);
          continue;
        }
        poundsSold += qty * poundsInfo.poundsPerUnit;
      }
    }

    const shippingCostCents = hasActualShipping
      ? numericValue(order.shipping_cost_cents)
      : Math.round(poundsSold * PLACEHOLDER_SHIPPING_CENTS_PER_LB);
    const usedPlaceholderShipping = !hasActualShipping;
    if (usedPlaceholderShipping) {
      placeholderShippingOrderCount += 1;
      totalPlaceholderShippingCents += shippingCostCents;
    } else {
      preservedShippingOrderCount += 1;
    }
    totalProcessingFeeCents += processingFeeCents;
    totalDonationCents += donationCogsCents;

    const shippingAllocations = allocateShipping(items, shippingCostCents);
    const processingAllocations = allocateByRevenue(items, processingFeeCents);
    const donationAllocations = allocateByRevenue(items, donationCogsCents);
    const computedItems = [];
    let orderProductCogsMissing = false;

    for (const item of items) {
      const qty = Math.max(0, numericValue(item.qty));
      const productCogsCents = deriveProductCogsCents(item);
      const lineHasRevenue = lineRevenueCents(item) > 0 || qty > 0;
      const productCogsMissing = lineHasRevenue && productCogsCents <= 0;
      orderProductCogsMissing = orderProductCogsMissing || productCogsMissing;
      const shippingCogsCents = shippingAllocations.get(item.id) ?? 0;
      const processingFeeCogsCents = processingAllocations.get(item.id) ?? 0;
      const donationLineCogsCents = donationAllocations.get(item.id) ?? 0;
      const totalCogsCents = productCogsCents + shippingCogsCents + processingFeeCogsCents + donationLineCogsCents;
      const estimated = Boolean(item.cogs_estimated)
        || usedPlaceholderShipping
        || missingPoundsByItemId.has(item.id)
        || productCogsMissing;

      computedItems.push({
        cogs_donation_cents: donationLineCogsCents,
        cogs_estimated: estimated,
        cogs_processing_fee_cents: processingFeeCogsCents,
        cogs_product_cents: productCogsCents,
        cogs_shipping_cents: shippingCogsCents,
        cogs_snapshot_at: item.cogs_snapshot_at ?? snapshotAt,
        cogs_source: item.cogs_source || (productCogsMissing ? 'missing_cost' : 'estimated_recipe'),
        cogs_total_cents: totalCogsCents,
        cogs_unit_cents: qty > 0 ? productCogsCents / qty : 0,
        id: item.id,
        productCogsMissing,
      });
    }

    if (orderProductCogsMissing) productCogsMissingOrderCount += 1;
    computedOrders.push({
      donationCogsCents,
      id: order.id,
      order,
      processingFeeCents,
      revenueCents,
      shippedAt: order.shipped_at ?? order.created_at,
      shippingCostCents,
      usedPlaceholderShipping,
    });
    computedItemsByOrderId.set(order.id, computedItems);
  }

  let commissionUpserts = 0;
  let commissionSkippedNoAssignment = 0;
  let commissionSkippedRepMismatch = 0;

  for (const computedOrder of computedOrders) {
    const salesProfileId = computedOrder.order.center_id ? assignmentByCenterId.get(computedOrder.order.center_id) : null;
    if (!salesProfileId || !computedOrder.shippedAt) {
      commissionSkippedNoAssignment += 1;
      continue;
    }
    const existingSnapshot = snapshotByOrderId.get(computedOrder.id);
    if (existingSnapshot?.sales_profile_id && existingSnapshot.sales_profile_id !== salesProfileId) {
      commissionSkippedRepMismatch += 1;
      continue;
    }
    commissionUpserts += 1;
  }

  console.log(apply ? 'Historical COGS backfill APPLY mode' : 'Historical COGS backfill DRY RUN');
  console.log(`Shipped orders scanned: ${orders.length}`);
  console.log(`Order items scanned: ${orderItems.length}`);
  console.log(`Orders preserving actual shipping: ${preservedShippingOrderCount}`);
  console.log(`Orders receiving placeholder shipping: ${placeholderShippingOrderCount}`);
  console.log(`Placeholder shipping total: $${(totalPlaceholderShippingCents / 100).toFixed(2)}`);
  console.log(`Processing fee total at 2.99% + $0.30: $${(totalProcessingFeeCents / 100).toFixed(2)}`);
  console.log(`Donation COGS total at 1%: $${(totalDonationCents / 100).toFixed(2)}`);
  console.log(`Orders with missing product COGS: ${productCogsMissingOrderCount}`);
  console.log(`Commission snapshots to refresh/create: ${commissionUpserts}`);
  console.log(`Commission skipped with no center assignment: ${commissionSkippedNoAssignment}`);
  console.log(`Commission skipped due to existing rep mismatch: ${commissionSkippedRepMismatch}`);
  console.log('Monthly commission payout records will not be changed.');

  if (missingRecipeProducts.size) {
    console.log('\nProducts without usable raw-coffee recipe pounds for placeholder shipping:');
    for (const row of [...missingRecipeProducts.values()].slice(0, 25)) {
      console.log(`- ${row.product}: ${row.quantity} unit(s), ${row.orders.size} order(s)`);
    }
    if (missingRecipeProducts.size > 25) {
      console.log(`...and ${missingRecipeProducts.size - 25} more product(s).`);
    }
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to write these changes.');
    return;
  }

  for (const computedOrder of computedOrders) {
    const orderUpdate = {
      donation_cogs_cents: computedOrder.donationCogsCents,
      processing_fee_cents: computedOrder.processingFeeCents,
    };
    if (computedOrder.usedPlaceholderShipping) {
      orderUpdate.shipping_cost_cents = computedOrder.shippingCostCents;
    }
    const { error } = await supabase.from('orders').update(orderUpdate).eq('id', computedOrder.id);
    if (error) throw error;

    for (const computedItem of computedItemsByOrderId.get(computedOrder.id) ?? []) {
      const { id, productCogsMissing, ...itemUpdate } = computedItem;
      const { error: itemError } = await supabase.from('order_items').update(itemUpdate).eq('id', id);
      if (itemError) throw itemError;
    }
  }

  for (const computedOrder of computedOrders) {
    const salesProfileId = computedOrder.order.center_id ? assignmentByCenterId.get(computedOrder.order.center_id) : null;
    if (!salesProfileId || !computedOrder.shippedAt) continue;
    const existingSnapshot = snapshotByOrderId.get(computedOrder.id);
    if (existingSnapshot?.sales_profile_id && existingSnapshot.sales_profile_id !== salesProfileId) continue;

    const computedItems = computedItemsByOrderId.get(computedOrder.id) ?? [];
    const productCogsCents = computedItems.reduce((sum, item) => sum + numericValue(item.cogs_product_cents), 0);
    const shippingCogsCents = computedItems.reduce((sum, item) => sum + numericValue(item.cogs_shipping_cents), 0);
    const processingFeeCogsCents = computedItems.reduce((sum, item) => sum + numericValue(item.cogs_processing_fee_cents), 0);
    const donationCogsCents = computedItems.reduce((sum, item) => sum + numericValue(item.cogs_donation_cents), 0);
    const totalCogsCents = productCogsCents + shippingCogsCents + processingFeeCogsCents + donationCogsCents;
    const productCogsMissing = computedItems.some((item) => item.productCogsMissing);
    const grossProfitCents = productCogsMissing ? 0 : computedOrder.revenueCents - totalCogsCents;
    const commissionPercent = Math.max(0, commissionPercentByProfileId.get(salesProfileId) ?? 0);
    const commissionCents = productCogsMissing ? 0 : Math.max(0, grossProfitCents) * (commissionPercent / 100);
    const payload = {
      center_id: computedOrder.order.center_id,
      cogs_estimated: productCogsMissing || computedItems.some((item) => Boolean(item.cogs_estimated)),
      commission_cents: commissionCents,
      commission_month: commissionMonthForDate(computedOrder.shippedAt),
      commission_percent: commissionPercent,
      donation_cogs_cents: donationCogsCents,
      gross_profit_cents: grossProfitCents,
      order_id: computedOrder.id,
      processing_fee_cogs_cents: processingFeeCogsCents,
      product_cogs_cents: productCogsCents,
      revenue_cents: computedOrder.revenueCents,
      sales_profile_id: salesProfileId,
      shipped_at: computedOrder.shippedAt,
      shipping_cogs_cents: shippingCogsCents,
      snapshot_at: snapshotAt,
      total_cogs_cents: totalCogsCents,
      updated_at: snapshotAt,
    };

    const writeResult = existingSnapshot?.id
      ? await supabase.from('order_commission_snapshots').update(payload).eq('id', existingSnapshot.id)
      : await supabase.from('order_commission_snapshots').insert(payload);
    if (writeResult.error) throw writeResult.error;
  }

  console.log('\nBackfill complete.');
}

main().catch((error) => {
  console.error('Historical COGS backfill failed.');
  console.error(error);
  process.exit(1);
});

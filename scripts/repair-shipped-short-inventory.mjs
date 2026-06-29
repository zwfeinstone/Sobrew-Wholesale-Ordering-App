import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 400;
const DEFAULT_FROM_ISO = '2026-06-28T08:00:00-05:00';
const DEFAULT_FROM_LABEL = 'June 28, 2026 at 8:00 AM Central';
const VALID_DATE_FIELDS = new Set(['created_at', 'shipped_at']);

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

function argValue(name) {
  const exactPrefix = `${name}=`;
  const exact = process.argv.find((arg) => arg.startsWith(exactPrefix));
  if (exact) return exact.slice(exactPrefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

function skuSegment(value) {
  return (value ?? '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

function finishedGoodSkuCandidates(product) {
  const sku = skuSegment(product.sku);
  const shortId = String(product.id).replace(/-/g, '').slice(0, 12);
  return [...new Set([
    `FIN-${sku || shortId}`,
    `FIN-${shortId}`,
    `FIN-${product.id}`,
  ])];
}

async function refetchFinishedItem(supabase, productId) {
  return supabase
    .from('inventory_items')
    .select('id,product_id,base_unit')
    .eq('item_type', 'finished_good')
    .eq('product_id', productId)
    .maybeSingle();
}

async function createFinishedItem(supabase, product) {
  const name = product.name?.trim() || product.sku?.trim() || 'Finished good';
  for (const sku of finishedGoodSkuCandidates(product)) {
    const { data, error } = await supabase
      .from('inventory_items')
      .insert({
        active: true,
        base_unit: 'each',
        item_type: 'finished_good',
        name,
        product_id: product.id,
        sku,
      })
      .select('id,product_id,base_unit')
      .single();

    if (!error && data) return data;

    const { data: existing } = await refetchFinishedItem(supabase, product.id);
    if (existing) return existing;
  }
  throw new Error(`Unable to create finished-good item for product ${product.id}`);
}

function movementUnitCostCents(item) {
  const qty = numericValue(item.qty);
  const unitCogs = numericValue(item.cogs_unit_cents);
  if (unitCogs > 0) return unitCogs;
  const productCogs = numericValue(item.cogs_product_cents);
  return qty > 0 ? productCogs / qty : 0;
}

loadEnvFile(path.join(process.cwd(), '.env.local'));
loadEnvFile(path.join(process.cwd(), '.env'));

const apply = process.argv.includes('--apply');
const fromInput = argValue('--from') ?? DEFAULT_FROM_ISO;
const dateField = argValue('--date-field') ?? 'created_at';
if (!VALID_DATE_FIELDS.has(dateField)) {
  throw new Error(`Invalid --date-field. Use one of: ${[...VALID_DATE_FIELDS].join(', ')}`);
}

const fromDate = new Date(fromInput);
if (Number.isNaN(fromDate.getTime())) {
  throw new Error(`Invalid --from date: ${fromInput}`);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRole) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false },
});

console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
console.log(`Repair scope: shipped orders with ${dateField} >= ${fromDate.toISOString()}`);
if (!argValue('--from')) console.log(`Default cutoff: ${DEFAULT_FROM_LABEL}`);

const orders = await fetchAll(() =>
  supabase
    .from('orders')
    .select('id,created_at,shipped_at,status')
    .eq('status', 'Shipped')
    .gte(dateField, fromDate.toISOString())
    .order(dateField, { ascending: true })
);

const orderIds = orders.map((order) => order.id);
const orderIdSet = new Set(orderIds);
const orderItems = [];
for (const orderIdChunk of chunks(orderIds)) {
  const rows = await fetchAll(() =>
    supabase
      .from('order_items')
      .select('id,order_id,product_id,product_name_snapshot,qty,cogs_unit_cents,cogs_product_cents')
      .in('order_id', orderIdChunk)
  );
  orderItems.push(...rows.filter((item) => orderIdSet.has(item.order_id)));
}

const orderItemIds = orderItems.map((item) => item.id);
const movedOrderItemIds = new Set();
for (const itemIdChunk of chunks(orderItemIds)) {
  const rows = await fetchAll(() =>
    supabase
      .from('inventory_movements')
      .select('order_item_id')
      .eq('movement_type', 'shipment_consume')
      .in('order_item_id', itemIdChunk)
  );
  rows.forEach((row) => {
    if (row.order_item_id) movedOrderItemIds.add(row.order_item_id);
  });
}

const candidateItems = orderItems.filter((item) =>
  item.product_id &&
  numericValue(item.qty) > 0 &&
  !movedOrderItemIds.has(item.id)
);
const productIds = [...new Set(candidateItems.map((item) => item.product_id))];

const products = [];
for (const productIdChunk of chunks(productIds)) {
  const { data, error } = await supabase
    .from('products')
    .select('id,name,sku')
    .in('id', productIdChunk);
  if (error) throw error;
  products.push(...(data ?? []));
}
const productById = new Map(products.map((product) => [product.id, product]));

const finishedItems = [];
for (const productIdChunk of chunks(productIds)) {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('id,product_id,base_unit')
    .eq('item_type', 'finished_good')
    .in('product_id', productIdChunk);
  if (error) throw error;
  finishedItems.push(...(data ?? []));
}
const finishedItemByProductId = new Map(
  finishedItems
    .filter((item) => item.product_id)
    .map((item) => [item.product_id, item])
);

const missingFinishedProductIds = productIds.filter((productId) => !finishedItemByProductId.has(productId));
const missingProductIds = missingFinishedProductIds.filter((productId) => !productById.has(productId));
const creatableProductIds = missingFinishedProductIds.filter((productId) => productById.has(productId));

if (apply) {
  for (const productId of creatableProductIds) {
    const item = await createFinishedItem(supabase, productById.get(productId));
    finishedItemByProductId.set(productId, item);
  }
} else {
  for (const productId of creatableProductIds) {
    finishedItemByProductId.set(productId, { id: `dry-run-${productId}`, product_id: productId, base_unit: 'each' });
  }
}

const movementRows = candidateItems
  .filter((item) => finishedItemByProductId.has(item.product_id))
  .map((item) => ({
    inventory_item_id: finishedItemByProductId.get(item.product_id).id,
    lot_id: null,
    movement_type: 'shipment_consume',
    order_id: item.order_id,
    order_item_id: item.id,
    quantity_change: -Math.max(0, numericValue(item.qty)),
    unit: 'each',
    unit_cost_cents: Math.max(0, movementUnitCostCents(item)),
    notes: 'Repair shipped-short finished good movement for order shipped without finished inventory item',
  }));

if (apply && movementRows.length) {
  for (const movementChunk of chunks(movementRows)) {
    const { error } = await supabase.from('inventory_movements').insert(movementChunk);
    if (error) throw error;
  }
}

console.log(`Shipped orders scanned: ${orders.length}`);
console.log(`Order items scanned: ${orderItems.length}`);
console.log(`Order items already having shipment movement: ${movedOrderItemIds.size}`);
console.log(`Candidate shipped-short items needing movement: ${candidateItems.length}`);
console.log(`Finished-good items to create: ${creatableProductIds.length}`);
console.log(`Missing product rows skipped: ${missingProductIds.length}`);
console.log(`Shipment movements to insert: ${movementRows.length}`);

if (movementRows.length) {
  console.log('\nSample movements:');
  console.table(
    movementRows.slice(0, 10).map((row) => ({
      order_id: row.order_id,
      order_item_id: row.order_item_id,
      inventory_item_id: row.inventory_item_id,
      quantity_change: row.quantity_change,
      unit_cost_cents: row.unit_cost_cents,
    }))
  );
}

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to write finished-good items and shipment movements.');
}

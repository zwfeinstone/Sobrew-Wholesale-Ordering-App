import 'server-only';

import { getShopifyConfig } from '@/lib/shopify';
import { ensureShopifyOrderProducts } from '@/lib/shopify-catalog';
import { getSupabaseAdmin, type SupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';

type RecordValue = Record<string, unknown>;
export type ShopifyImportProduct = { id: string; name: string; sku: string; active: boolean | null; shopify_shop_domain: string | null; shopify_variant_id: string | null };
export type ShopifyImportResult = { status: 'imported' | 'ignored' | 'error'; orderId?: string; error?: string; retryable?: boolean };

function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Node 24's reviver source retains large numeric Shopify IDs without precision loss. */
export function parseShopifyWebhookPayload(rawBody: string): unknown {
  return JSON.parse(rawBody, (key: string, value: unknown, context?: { source: string }) => {
    if ((key === 'id' || key.endsWith('_id')) && typeof value === 'number') {
      if (context?.source && /^[1-9][0-9]*$/.test(context.source)) return context.source;
      if (!Number.isSafeInteger(value)) throw new Error('Shopify ID cannot be represented exactly.');
      return String(value);
    }
    return value;
  });
}

function variantGid(line: RecordValue): string {
  const value = line.variant_id;
  if (typeof value === 'string' && /^gid:\/\/shopify\/ProductVariant\/[1-9][0-9]*$/.test(value)) return value;
  const id = typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : '';
  if (/^[1-9][0-9]*$/.test(id)) return `gid://shopify/ProductVariant/${id}`;
  throw new Error('This Shopify line has no exact variant ID. Custom line items require manual review.');
}

function optionalProductGid(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string' && /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(value)) return value;
  const id = typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : '';
  if (/^[1-9][0-9]*$/.test(id)) return `gid://shopify/Product/${id}`;
  throw new Error('This Shopify line has no exact product ID. Review this order in Shopify.');
}

export function shopifyOrderIdentity(payload: unknown) {
  const order = record(payload);
  return { orderId: shopifyGid(order, 'Order'), orderName: text(order.name) };
}

// REST webhook numeric IDs may exceed Number.MAX_SAFE_INTEGER. Prefer the exact GID.
function shopifyGid(value: RecordValue, kind: 'Order' | 'LineItem'): string {
  const gid = text(value.admin_graphql_api_id);
  if (gid && new RegExp(`^gid://shopify/${kind}/[1-9][0-9]*$`).test(gid)) return gid;
  const id = typeof value.id === 'string' ? value.id : Number.isSafeInteger(value.id) ? String(value.id) : '';
  if (/^[1-9][0-9]*$/.test(id)) return `gid://shopify/${kind}/${id}`;
  throw new Error(`Shopify ${kind} is missing a valid, exact ID.`);
}

function cents(value: unknown, label: string): number {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error(`${label} is not a valid USD amount.`);
  const [whole, fraction = ''] = raw.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 2_147_483_647) throw new Error(`${label} exceeds the supported amount.`);
  return result;
}

class IgnoredShopifyOrder extends Error {}

function eligibleLines(payload: unknown) {
  const source = record(payload);
  if (source.test === true) throw new IgnoredShopifyOrder('Test orders are not imported.');
  if (source.cancelled_at) throw new IgnoredShopifyOrder('Cancelled orders are not imported.');
  if (source.financial_status !== 'paid') throw new IgnoredShopifyOrder('Only fully paid orders are imported.');
  if (source.currency !== 'USD') throw new Error('Only USD orders are supported. Review this order in Shopify.');
  if (source.fulfillment_status) throw new Error('This order is already partially or fully fulfilled. Review it in Shopify.');
  if (!Array.isArray(source.line_items) || !source.line_items.length) throw new Error('Shopify order has no line items.');
  const lines = source.line_items.map(record);
  if (lines.every(line => line.requires_shipping === false)) throw new IgnoredShopifyOrder('This order contains no shippable items.');
  if (lines.some(line => line.requires_shipping !== true)) throw new Error('Mixed physical and non-shipping items need manual review in Shopify.');
  return { source, lines };
}

export function prepareShopifyOrder(payload: unknown, shopDomain: string, products: ShopifyImportProduct[]) {
  const { source, lines } = eligibleLines(payload);
  const identity = shopifyOrderIdentity(source);
  const address = record(source.shipping_address);
  const shippingName = text(address.name) ?? [text(address.first_name), text(address.last_name)].filter(Boolean).join(' ');
  if (!shippingName || !text(address.address1) || !text(address.city) || !text(address.country_code)) {
    throw new Error('Shopify order is missing a complete shipping address.');
  }
  const seen = new Set<string>();
  const items = lines.map(line => {
    const lineId = shopifyGid(line, 'LineItem');
    if (seen.has(lineId)) throw new Error('Shopify order contains duplicate line IDs.');
    seen.add(lineId);
    const quantity = line.current_quantity ?? line.quantity;
    if (!Number.isInteger(quantity) || Number(quantity) <= 0 || Number(quantity) > 9999
      || quantity !== line.quantity || (line.fulfillable_quantity !== undefined && line.fulfillable_quantity !== quantity)
      || line.fulfillment_status) {
      throw new Error('Edited, refunded, or partially fulfilled Shopify items need manual review.');
    }
    const variantId = variantGid(line);
    const matching = products.filter(product => product.shopify_variant_id === variantId && product.shopify_shop_domain === shopDomain && product.active === true);
    if (matching.length !== 1) throw new Error(`Shopify variant ${variantId} has not synced to an active portal product. Sync Shopify products, then retry.`);
    const price = cents(line.price, 'Item price');
    const allocations = Array.isArray(line.discount_allocations) ? line.discount_allocations : [];
    const discount = allocations.length
      ? allocations.reduce((sum, allocation) => sum + cents(record(allocation).amount, 'Item discount'), 0)
      : cents(line.total_discount ?? '0', 'Item discount');
    const lineTotal = price * Number(quantity) - discount;
    if (!Number.isSafeInteger(lineTotal) || lineTotal < 0 || lineTotal > 2_147_483_647) throw new Error('Shopify item has an invalid discounted total.');
    return {
      product_id: matching[0].id, product_name_snapshot: text(line.name) ?? text(line.title) ?? matching[0].name,
      shopify_variant_id: variantId, qty: Number(quantity), unit_price_cents: Math.round(lineTotal / Number(quantity)),
      line_total_cents: lineTotal, shopify_line_item_id: lineId,
    };
  });
  const subtotal = items.reduce((sum, item) => sum + item.line_total_cents, 0);
  if (subtotal !== cents(source.current_subtotal_price ?? source.subtotal_price, 'Order subtotal')) {
    throw new Error('Shopify discounted item totals do not match the order subtotal. Review this order in Shopify.');
  }
  const createdAt = text(source.created_at);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) throw new Error('Shopify order has an invalid creation date.');
  return {
    order: {
      order_source: 'shopify', shopify_shop_domain: shopDomain, shopify_order_id: identity.orderId,
      shopify_order_name: identity.orderName, shopify_email: text(source.email) ?? text(source.contact_email),
      shopify_line_items: items.map(item => ({ line_item_id: item.shopify_line_item_id, quantity: item.qty, product_id: item.product_id })),
      shipping_name: shippingName, shipping_company: text(address.company), shipping_address1: text(address.address1),
      shipping_address2: text(address.address2), shipping_city: text(address.city),
      shipping_state: text(address.province_code) ?? text(address.province), shipping_zip: text(address.zip),
      shipping_country: text(address.country_code), notes: text(source.note), subtotal_cents: subtotal, created_at: createdAt,
    },
    items,
  };
}

async function processShopifyImport(receiptId: string, admin: SupabaseAdminClient): Promise<ShopifyImportResult> {
  const { data: receipt, error: readError } = await admin.from('shopify_order_imports').select('*').eq('id', receiptId).single();
  if (readError || !receipt) throw new Error('Could not read the Shopify import receipt.');
  if (receipt.status === 'imported' && receipt.order_id) return { status: 'imported', orderId: receipt.order_id };
  if (receipt.shop_domain !== getShopifyConfig().shopDomain) throw new Error('The Shopify store for this receipt does not match the configured store.');

  let retryable = false;
  try {
    const { lines } = eligibleLines(receipt.payload);
    shopifyOrderIdentity(receipt.payload);
    const parents = new Map<string, string | null>();
    for (const line of lines) {
      shopifyGid(line, 'LineItem');
      const variantId = variantGid(line);
      const parentId = optionalProductGid(line.product_id);
      if (parents.has(variantId) && parents.get(variantId) !== parentId) {
        throw new Error('Shopify order contains inconsistent product and variant IDs. Review it in Shopify.');
      }
      parents.set(variantId, parentId);
    }
    // API/catalog and database failures should get Shopify's automatic delivery
    // retries; deterministic content problems remain visible for operator review.
    retryable = true;
    const products = await ensureShopifyOrderProducts(receipt.payload);
    retryable = false;
    const prepared = prepareShopifyOrder(receipt.payload, receipt.shop_domain, products);
    retryable = true;
    const { data: orderId, error: importError } = await admin.rpc('import_shopify_order', {
      p_order: { ...prepared.order, import_id: receipt.id } as Json, p_items: prepared.items as Json,
    });
    if (importError || !orderId) throw new Error(importError?.message ?? 'Shopify order could not be saved.');
    return { status: 'imported', orderId };
  } catch (error) {
    const ignored = error instanceof IgnoredShopifyOrder;
    const message = error instanceof Error ? error.message : 'Shopify import failed. Retry this import.';
    // Never overwrite a successful receipt if another delivery imported concurrently.
    const { error: saveError } = await admin.from('shopify_order_imports')
      .update({ status: ignored ? 'ignored' : 'error', error: message.slice(0, 2000), updated_at: new Date().toISOString() })
      .eq('id', receiptId).neq('status', 'imported');
    if (saveError) throw new Error('Shopify import failure could not be saved; Shopify should retry delivery.');
    return { status: ignored ? 'ignored' : 'error', error: message, retryable: !ignored && retryable };
  }
}

export async function receiveShopifyOrder(payload: unknown, shopDomain: string, topic: string): Promise<ShopifyImportResult> {
  const admin = getSupabaseAdmin();
  const { orderId, orderName } = shopifyOrderIdentity(payload);
  const { data: receiptId, error } = await admin.rpc('save_shopify_order_import', {
    p_shop_domain: shopDomain, p_shopify_order_id: orderId, p_shopify_order_name: orderName,
    p_topic: topic, p_payload: payload as Json,
  });
  if (error || !receiptId) throw new Error('Could not durably save the Shopify order.');
  return processShopifyImport(receiptId, admin);
}

// Callers must require Orders edit access before exposing this server-only helper.
export async function retryShopifyImport(receiptId: string): Promise<ShopifyImportResult> {
  return processShopifyImport(receiptId, getSupabaseAdmin());
}

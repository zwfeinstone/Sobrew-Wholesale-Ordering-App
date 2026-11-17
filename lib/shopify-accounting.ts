import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import { fetchAllByIds, fetchAllPages } from '@/lib/supabase/pagination';
import { getAccountingPeriodPresets } from '@/lib/accounting-periods';
import { processingFeeCentsForOrder } from '@/lib/order-fees';
import { parseCentralDateInput } from '@/lib/time-clock';

type Amount = number | string | null | undefined;
export type ShopifyAccountingOrder = {
  id: string;
  shopify_order_name: string | null;
  created_at: string | null;
  status: string | null;
  subtotal_cents: Amount;
  shopify_shipping_collected_cents: Amount;
  shopify_tax_collected_cents: Amount;
  shopify_total_paid_cents: Amount;
  shipping_cost_cents: Amount;
  processing_fee_cents: Amount;
  donation_cogs_cents: Amount;
};
type ShopifyAccountingItem = {
  order_id: string | null;
  cogs_product_cents: Amount;
  cogs_snapshot_at: string | null;
  cogs_source?: string | null;
  cogs_estimated?: boolean | null;
};

function cents(value: Amount): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

// Cost snapshots use numeric(14,4) cents; keep their precision until display/export.
function costCents(value: Amount): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function buildShopifyAccountingRows(orders: ShopifyAccountingOrder[], items: ShopifyAccountingItem[]) {
  const itemsByOrder = new Map<string, ShopifyAccountingItem[]>();
  for (const item of items) {
    if (item.order_id == null) continue;
    const lines = itemsByOrder.get(item.order_id) ?? [];
    lines.push(item);
    itemsByOrder.set(item.order_id, lines);
  }
  return orders.map((order) => {
    const merchandiseCents = cents(order.subtotal_cents);
    const shippingRevenueCents = cents(order.shopify_shipping_collected_cents);
    const salesTaxCents = cents(order.shopify_tax_collected_cents);
    const totalPaidCents = cents(order.shopify_total_paid_cents);
    const revenueCents = merchandiseCents == null || shippingRevenueCents == null ? null : merchandiseCents + shippingRevenueCents;
    const checkoutReconciles = revenueCents != null && salesTaxCents != null && totalPaidCents != null && revenueCents + salesTaxCents === totalPaidCents;
    const lines = itemsByOrder.get(order.id) ?? [];
    const productCogsCents = order.status === 'Shipped' && lines.length > 0 && lines.every((line) => line.cogs_snapshot_at && line.cogs_source !== 'missing_cost' && costCents(line.cogs_product_cents) != null)
      ? lines.reduce((sum, line) => sum + costCents(line.cogs_product_cents)!, 0) : null;
    const productCogsBasis = productCogsCents == null ? 'Missing / pending'
      : lines.some((line) => line.cogs_estimated || (line.cogs_source != null && line.cogs_source !== 'actual_fifo')) ? 'Estimated'
      : lines.every((line) => line.cogs_source === 'actual_fifo') ? 'Actual FIFO' : 'Unknown source';
    const shippingCostCents = order.status === 'Shipped' ? costCents(order.shipping_cost_cents) : null;
    const processingCogsCents = order.status === 'Shipped' ? costCents(order.processing_fee_cents) : null;
    const donationCogsCents = order.status === 'Shipped' ? costCents(order.donation_cogs_cents) : null;
    const costs = [productCogsCents, shippingCostCents, processingCogsCents, donationCogsCents];
    const totalCogsCents = costs.every((value) => value != null) ? costs.reduce<number>((sum, value) => sum + value!, 0) : null;
    return {
      id: order.id,
      name: order.shopify_order_name || order.id,
      createdAt: order.created_at,
      status: order.status || 'Unknown',
      merchandiseCents,
      shippingRevenueCents,
      revenueCents,
      salesTaxCents,
      totalPaidCents,
      checkoutReconciles,
      productCogsCents,
      productCogsBasis,
      shippingCostCents,
      processingCogsCents,
      processingEstimateCents: processingFeeCentsForOrder({ orderSource: 'shopify', subtotalCents: merchandiseCents, totalPaidCents }),
      donationCogsCents,
      totalCogsCents,
      grossProfitCents: checkoutReconciles && totalCogsCents != null ? revenueCents! - totalCogsCents : null,
    };
  });
}

export type ShopifyAccountingRow = ReturnType<typeof buildShopifyAccountingRows>[number];

export function shopifyAccountingPeriod(startValue?: string | null, endValue?: string | null, now = new Date()) {
  const defaultPeriod = getAccountingPeriodPresets(now).find((period) => period.id === 'year_to_date')!;
  const validDate = (value: string | null | undefined, fallback: string) => {
    if (!value) return fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Enter valid dates in YYYY-MM-DD format.');
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Enter valid calendar dates.');
    return value;
  };
  const start = validDate(startValue, defaultPeriod.start);
  const end = validDate(endValue, defaultPeriod.end);
  if (end < start) throw new Error('End date must be on or after start date.');
  const nextDay = new Date(`${end}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return { start, end, startAt: parseCentralDateInput(start)!.toISOString(), endExclusive: parseCentralDateInput(nextDay.toISOString().slice(0, 10))!.toISOString() };
}

export async function loadShopifyAccountingRows(supabase: SupabaseClient<Database>, period: ReturnType<typeof shopifyAccountingPeriod>, centerScope: string[] | null) {
  if (centerScope?.length === 0) return { data: [], error: null };
  const orders = await fetchAllPages((from, to) => {
    let query = supabase.from('orders').select('id,shopify_order_name,created_at,status,subtotal_cents,shopify_shipping_collected_cents,shopify_tax_collected_cents,shopify_total_paid_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents')
      .eq('order_source', 'shopify').gte('created_at', period.startAt).lt('created_at', period.endExclusive);
    if (centerScope != null) query = query.in('center_id', centerScope);
    return query.order('created_at', { ascending: false }).order('id').range(from, to);
  });
  if (orders.error) return { data: [], error: orders.error };
  const items = await fetchAllByIds(orders.data.map((order) => order.id), (ids, from, to) =>
    supabase.from('order_items').select('order_id,cogs_product_cents,cogs_snapshot_at,cogs_source,cogs_estimated').in('order_id', ids).order('id').range(from, to));
  if (items.error) return { data: [], error: items.error };
  return { data: buildShopifyAccountingRows(orders.data, items.data), error: null };
}

export function shopifyAccountingCsv(rows: ShopifyAccountingRow[]) {
  const amount = (value: number | null) => value == null ? '' : (value / 100).toFixed(2);
  const cell = (value: string | null) => {
    const safe = /^[\s]*[=+\-@\t\r]/.test(value ?? '') ? `'${value}` : value ?? '';
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const header = ['Order', 'App order ID', 'Order date UTC', 'Status', 'Currency', 'Original merchandise revenue - before refunds', 'Original shipping revenue collected - before refunds', 'Original total revenue excluding tax - before refunds', 'Sales tax collected - liability - original checkout', 'Original gross customer payment - before refunds', 'Original checkout reconciliation', 'Product COGS snapshot', 'Actual carrier expense', 'Processing COGS snapshot - estimated fee', 'Current processing fee estimate', 'Donation COGS snapshot', 'Total COGS snapshot', 'Gross profit including shipping revenue - before refunds', 'Product COGS basis', 'Report exclusions'];
  return '\uFEFF' + [header.map(cell).join(','), ...rows.map((row) => [
    cell(row.name), cell(row.id), cell(row.createdAt), cell(row.status), cell('USD'),
    ...[row.merchandiseCents, row.shippingRevenueCents, row.revenueCents, row.salesTaxCents, row.totalPaidCents].map(amount),
    cell(row.checkoutReconciles ? 'Reconciled' : 'Missing or inconsistent checkout totals'),
    ...[row.productCogsCents, row.shippingCostCents, row.processingCogsCents, row.processingEstimateCents, row.donationCogsCents, row.totalCogsCents, row.grossProfitCents].map(amount),
    cell(row.productCogsBasis), cell('Refunds, returns, chargebacks and tax remittances excluded; reconcile separately'),
  ].join(','))].join('\r\n') + '\r\n';
}

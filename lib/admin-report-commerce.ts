import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import { compareRecentReportOrders, recentOrderMergeOffset } from '@/lib/recent-order-gpm-page';
import { fetchAllByIds, fetchAllPages } from '@/lib/supabase/pagination';

export const REPORT_ORDER_SELECT = 'id,center_id,status,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,shipped_at';
export const REPORT_ORDER_ITEM_SELECT = 'id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents,shipping_boxes_used,cogs_material_cents,cogs_labor_cents,cogs_fixed_cents,cogs_tape_cents,cogs_shipping_label_cents,cogs_branding_label_cents,cogs_fixed_other_cents,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_unit_cents,cogs_source,cogs_estimated,cogs_snapshot_at';

type RecentOrders = { limit: number; page?: number; centerId?: string; productId?: string; start?: string; endExclusive?: string; error?: string };

async function loadRecentReportOrders(
  supabase: SupabaseClient<Database>,
  centerScope: string[] | null,
  { limit, page, centerId, productId, start, endExclusive, error: rangeError }: RecentOrders,
) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
    throw new RangeError('Recent order limit must be an integer between 0 and 1000.');
  }
  const empty = { data: [], error: null, total: 0, page: 1 };
  if (!limit || centerScope?.length === 0 || rangeError) return empty;

  // Retain historical orders whose effective shipment timestamp is created_at.
  // PostgREST cannot order by coalesce, so page an exact merge of two streams.
  const streamQuery = (legacy: boolean, count = false) => {
    let query = supabase.from('orders')
      .select(`${REPORT_ORDER_SELECT},order_items!inner(id)`, count ? { count: 'exact', head: true } : undefined)
      .neq('order_kind', 'prospecting_sample')
      .eq('status', 'Shipped')
      .gt('order_items.qty', 0)
      .limit(1, { referencedTable: 'order_items' });
    if (centerScope !== null) query = query.in('center_id', centerScope);
    if (centerId) query = query.eq('center_id', centerId);
    if (productId) query = query.eq('order_items.product_id', productId);
    const timestamp = legacy ? 'created_at' : 'shipped_at';
    query = legacy ? query.is('shipped_at', null).not('created_at', 'is', null) : query.not('shipped_at', 'is', null);
    if (start) query = query.gte(timestamp, start);
    if (endExclusive) query = query.lt(timestamp, endExclusive);
    return query.order(timestamp, { ascending: false }).order('id', { ascending: false });
  };
  const loadStream = (legacy: boolean, offset: number, length: number) => fetchAllPages((from, to) => {
    if (from >= length) return Promise.resolve({ data: [], error: null });
    return streamQuery(legacy).range(offset + from, offset + Math.min(to, length - 1));
  }, { pageSize: Math.max(1, length) });

  let leftOffset = 0;
  let rightOffset = 0;
  let leftLength = limit;
  let rightLength = limit;
  let total = 0;
  let actualPage = 1;

  if (page !== undefined) {
    const [current, legacy] = await Promise.all([streamQuery(false, true), streamQuery(true, true)]);
    const countError = current.error ?? legacy.error;
    if (countError) return { ...empty, error: countError };
    if (current.count === null || legacy.count === null) {
      return { ...empty, error: { message: 'Shipped order counts are unavailable.' } };
    }
    total = current.count + legacy.count;
    if (!total) return empty;
    actualPage = Math.max(1, Math.min(page, Math.ceil(total / limit)));
    const offset = (actualPage - 1) * limit;
    const rowAt = async (old: boolean, index: number) => {
      const result = await streamQuery(old).range(index, index);
      if (result.error || !result.data[0]) {
        throw result.error ?? new Error('Shipped orders changed while loading this page. Refresh and try again.');
      }
      return result.data[0];
    };
    try {
      leftOffset = await recentOrderMergeOffset(
        offset, current.count, legacy.count, (index) => rowAt(false, index), (index) => rowAt(true, index), compareRecentReportOrders,
      );
    } catch (error) {
      return { ...empty, error: { message: (error as { message?: string })?.message || 'Unable to load shipped orders.' } };
    }
    rightOffset = offset - leftOffset;
    leftLength = Math.min(limit, current.count - leftOffset);
    rightLength = Math.min(limit, legacy.count - rightOffset);
  }

  const streams = await Promise.all([loadStream(false, leftOffset, leftLength), loadStream(true, rightOffset, rightLength)]);
  const error = streams.find((stream) => stream.error)?.error ?? null;
  const data = error ? [] : streams.flatMap((stream) => stream.data).sort(compareRecentReportOrders).slice(0, limit);
  return { data, error, total, page: actualPage };
}

/** Preserve lifetime metrics when unbounded; period reports only load their comparison window. */
export async function loadReportCommerce(supabase: SupabaseClient<Database>, {
  centerScope,
  shippedRange,
  recentOrders,
}: {
  centerScope: string[] | null;
  shippedRange?: { start: Date; endExclusive: Date };
  recentOrders?: RecentOrders;
}) {
  if (shippedRange && recentOrders) throw new Error('Recent orders and a report period cannot be requested together.');
  const loadOrders = (from: number, to: number) => {
    let query = supabase.from('orders').select(REPORT_ORDER_SELECT).neq('order_kind', 'prospecting_sample');
    if (centerScope !== null) query = query.in('center_id', centerScope);
    if (shippedRange) {
      const start = shippedRange.start.toISOString();
      const end = shippedRange.endExclusive.toISOString();
      query = query.eq('status', 'Shipped').or(
        `and(shipped_at.gte.${start},shipped_at.lt.${end}),and(shipped_at.is.null,created_at.gte.${start},created_at.lt.${end})`
      );
    }
    return query.order('created_at', { ascending: false }).order('id').range(from, to);
  };
  const recentResult = recentOrders ? await loadRecentReportOrders(supabase, centerScope, recentOrders) : null;
  const orders = recentResult ? { data: recentResult.data, error: recentResult.error } : await fetchAllPages(loadOrders);
  const orderItems = await fetchAllByIds(orders.data.map((order) => order.id), (ids, from, to) =>
    supabase.from('order_items').select(REPORT_ORDER_ITEM_SELECT).in('order_id', ids).order('id').range(from, to)
  );
  return { orders, orderItems, recentPage: recentResult ? { total: recentResult.total, page: recentResult.page } : undefined };
}

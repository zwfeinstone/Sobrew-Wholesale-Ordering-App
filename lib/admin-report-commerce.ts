import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import { fetchAllByIds, fetchAllPages } from '@/lib/supabase/pagination';

export const REPORT_ORDER_SELECT = 'id,center_id,status,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,shipped_at';
export const REPORT_ORDER_ITEM_SELECT = 'id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents,shipping_boxes_used,cogs_material_cents,cogs_labor_cents,cogs_fixed_cents,cogs_tape_cents,cogs_shipping_label_cents,cogs_branding_label_cents,cogs_fixed_other_cents,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_unit_cents,cogs_source,cogs_estimated,cogs_snapshot_at';

type RecentOrders = { limit: number; centerId?: string; productId?: string };

async function loadRecentReportOrders(
  supabase: SupabaseClient<Database>,
  centerScope: string[] | null,
  { limit, centerId, productId }: RecentOrders,
) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
    throw new RangeError('Recent order limit must be an integer between 0 and 1000.');
  }
  // PostgREST ordering cannot express coalesce(shipped_at, created_at).
  // The top N of each disjoint timestamp stream contains the combined top N.
  // Filter item eligibility before the limit, but fetch all sibling lines below
  // so product-filtered rows retain their complete shipping/fee allocations.
  const loadStream = (legacy: boolean) => fetchAllPages((from, to) => {
    if (from >= limit || centerScope?.length === 0) return Promise.resolve({ data: [], error: null });
    let query = supabase.from('orders')
      .select(`${REPORT_ORDER_SELECT},order_items!inner(id)`)
      .neq('order_kind', 'prospecting_sample')
      .eq('status', 'Shipped')
      .gt('order_items.qty', 0)
      .limit(1, { referencedTable: 'order_items' });
    if (centerScope !== null) query = query.in('center_id', centerScope);
    if (centerId) query = query.eq('center_id', centerId);
    if (productId) query = query.eq('order_items.product_id', productId);
    query = legacy ? query.is('shipped_at', null).not('created_at', 'is', null) : query.not('shipped_at', 'is', null);
    return query.order(legacy ? 'created_at' : 'shipped_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, Math.min(to, limit - 1));
  }, { pageSize: Math.max(1, limit) });
  const streams = await Promise.all([loadStream(false), loadStream(true)]);
  const error = streams.find((stream) => stream.error)?.error ?? null;
  const data = error ? [] : streams.flatMap((stream) => stream.data)
    .sort((left, right) => Date.parse(right.shipped_at ?? right.created_at ?? '') - Date.parse(left.shipped_at ?? left.created_at ?? '')
      || right.id.localeCompare(left.id))
    .slice(0, limit);
  return { data, error };
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
  const orders = recentOrders
    ? await loadRecentReportOrders(supabase, centerScope, recentOrders)
    : await fetchAllPages(loadOrders);
  const orderItems = await fetchAllByIds(orders.data.map((order) => order.id), (ids, from, to) =>
    supabase.from('order_items').select(REPORT_ORDER_ITEM_SELECT).in('order_id', ids).order('id').range(from, to)
  );
  return { orders, orderItems };
}

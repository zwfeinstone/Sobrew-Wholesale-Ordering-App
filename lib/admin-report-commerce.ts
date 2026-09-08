import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import { fetchAllByIds, fetchAllPages } from '@/lib/supabase/pagination';

export const REPORT_ORDER_SELECT = 'id,center_id,status,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,shipped_at';
export const REPORT_ORDER_ITEM_SELECT = 'id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents,shipping_boxes_used,cogs_material_cents,cogs_labor_cents,cogs_fixed_cents,cogs_tape_cents,cogs_shipping_label_cents,cogs_branding_label_cents,cogs_fixed_other_cents,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_unit_cents,cogs_source,cogs_estimated,cogs_snapshot_at';

/** Preserve lifetime metrics when unbounded; period reports only load their comparison window. */
export async function loadReportCommerce(supabase: SupabaseClient<Database>, {
  centerScope,
  shippedRange,
}: {
  centerScope: string[] | null;
  shippedRange?: { start: Date; endExclusive: Date };
}) {
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
  const orders = await fetchAllPages(loadOrders);
  const orderItems = await fetchAllByIds(orders.data.map((order) => order.id), (ids, from, to) =>
    supabase.from('order_items').select(REPORT_ORDER_ITEM_SELECT).in('order_id', ids).order('id').range(from, to)
  );
  return { orders, orderItems };
}

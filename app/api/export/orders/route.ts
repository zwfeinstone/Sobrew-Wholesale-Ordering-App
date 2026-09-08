import { requireAdminSectionView } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/supabase/pagination';
import type { Database } from '@/lib/supabase/schema';

type OrderRow = Database['public']['Tables']['orders']['Row'];
type ExportOrder = Pick<OrderRow, 'id' | 'status' | 'subtotal_cents' | 'shipping_cost_cents' | 'processing_fee_cents' | 'donation_cogs_cents' | 'created_at' | 'center_id' | 'user_id'>
  & Partial<Pick<OrderRow, 'fulfillment_method'>>;

function isMissingFulfillmentMethodColumn(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  return message.includes('fulfillment_method') && (
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('Could not find')
  );
}

export async function GET() {
  await requireAdminSectionView('orders');
  const supabase = await createClient();
  const loadOrders = (includeFulfillmentMethod: boolean) => fetchAllPages<ExportOrder>(async (from, to) => {
    const query = includeFulfillmentMethod
      ? supabase.from('orders').select('id,status,fulfillment_method,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,center_id,user_id')
      : supabase.from('orders').select('id,status,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,center_id,user_id');
    return query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
  });
  let result = await loadOrders(true);
  if (result.error && isMissingFulfillmentMethodColumn(result.error)) {
    result = await loadOrders(false);
  }
  if (result.error) {
    console.error('[export-orders] order records failed', result.error);
    return new Response('Unable to load all orders. Please try again.', { status: 500 });
  }
  const data = result.data ?? [];
  const csv = [
    'id,status,fulfillment_method,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,center_id,user_id',
    ...data.map((o) => `${o.id},${o.status},${o.fulfillment_method ?? 'carrier'},${o.subtotal_cents},${o.shipping_cost_cents ?? ''},${o.processing_fee_cents ?? ''},${o.donation_cogs_cents ?? ''},${o.created_at},${o.center_id},${o.user_id}`),
  ].join('\n');
  return new Response(csv, { headers: { 'cache-control': 'no-store', 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="orders.csv"' } });
}

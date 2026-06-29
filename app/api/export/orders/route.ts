import { requireAdminSectionView } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  await requireAdminSectionView('reports');
  const supabase = await createClient();
  const { data } = await supabase.from('orders').select('id,status,fulfillment_method,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,center_id,user_id').order('created_at', { ascending: false });
  const csv = [
    'id,status,fulfillment_method,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,center_id,user_id',
    ...(data ?? []).map((o) => `${o.id},${o.status},${o.fulfillment_method ?? 'carrier'},${o.subtotal_cents},${o.shipping_cost_cents ?? ''},${o.processing_fee_cents ?? ''},${o.donation_cogs_cents ?? ''},${o.created_at},${o.center_id},${o.user_id}`),
  ].join('\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="orders.csv"' } });
}

import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  await requireAdmin();
  const supabase = await createClient();
  const { data } = await supabase.from('orders').select('id,status,subtotal_cents,created_at,user_id').order('created_at', { ascending: false });
  const csv = ['id,status,subtotal_cents,created_at,user_id', ...(data ?? []).map((o) => `${o.id},${o.status},${o.subtotal_cents},${o.created_at},${o.user_id}`)].join('\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="orders.csv"' } });
}

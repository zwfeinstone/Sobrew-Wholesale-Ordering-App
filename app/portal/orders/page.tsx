import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

export default async function OrdersPage() {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from('orders')
    .select('id,status,subtotal_cents,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const orderIds = (orders ?? []).map((order) => order.id);
  const { data: items } = orderIds.length
    ? await supabase
        .from('order_items')
        .select('order_id,product_name_snapshot,products(name)')
        .in('order_id', orderIds)
    : { data: [] as any[] };

  const firstNameByOrderId = new Map<string, string>();
  for (const item of items ?? []) {
    if (!firstNameByOrderId.has(item.order_id)) {
      firstNameByOrderId.set(item.order_id, item.product_name_snapshot || (item as any).products?.name || 'Product');
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Order history</h1>
      {orders?.map((order) => (
        <Link key={order.id} href={`/portal/orders/${order.id}`} className="card block">
          {firstNameByOrderId.get(order.id) ?? 'Product'} - {order.status} - {usd(order.subtotal_cents)}
        </Link>
      ))}
    </div>
  );
}

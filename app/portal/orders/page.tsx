import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
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
    ? await supabase.from('order_items').select('order_id,product_id,product_name_snapshot,qty').in('order_id', orderIds)
    : { data: [] as any[] };

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const { data: products } = productIds.length
    ? await supabaseAdmin.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const productNameById = new Map((products ?? []).map((p: any) => [p.id, p.name]));

  const lineItemsByOrderId = new Map<string, string[]>();
  for (const item of items ?? []) {
    const mappedName = productNameById.get(item.product_id);
    const itemLabel = `${mappedName || item.product_name_snapshot || 'Unknown product'} x ${item.qty}`;
    const existingItems = lineItemsByOrderId.get(item.order_id) ?? [];
    existingItems.push(itemLabel);
    lineItemsByOrderId.set(item.order_id, existingItems);
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Order history</h1>
      {orders?.map((order) => (
        <Link key={order.id} href={`/portal/orders/${order.id}`} className="card block">
          {(lineItemsByOrderId.get(order.id) ?? ['Unknown product']).join(', ')} - {order.status} - {usd(order.subtotal_cents)}
        </Link>
      ))}
    </div>
  );
}

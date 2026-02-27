import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function AdminDashboard() {
  const supabase = await createClient();
  const [{ count: newOrders }, { data: recent }] = await Promise.all([
    supabase.from('orders').select('*', { head: true, count: 'exact' }).eq('status', 'New'),
    supabase.from('orders').select('id,status,created_at,profiles(email)').order('created_at', { ascending: false }).limit(8)
  ]);

  const orderIds = (recent ?? []).map((order: any) => order.id);
  const { data: items } = orderIds.length
    ? await supabase.from('order_items').select('order_id,product_id,product_name_snapshot').in('order_id', orderIds)
    : { data: [] as any[] };

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const productNameById = new Map((products ?? []).map((p: any) => [p.id, p.name]));

  const firstNameByOrderId = new Map<string, string>();
  for (const item of items ?? []) {
    if (!firstNameByOrderId.has(item.order_id)) {
      const mappedName = productNameById.get(item.product_id);
      firstNameByOrderId.set(item.order_id, mappedName || item.product_name_snapshot || 'Unknown product');
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="card">New orders: {newOrders ?? 0}</div>
      <div className="card space-y-2">
        <h2 className="font-semibold">Recent orders</h2>
        {recent?.map((order: any) => (
          <Link key={order.id} href={`/admin/orders/${order.id}`} className="block rounded border p-2">
            {firstNameByOrderId.get(order.id) ?? 'Unknown product'} - {order.status} - {order.profiles?.email}
          </Link>
        ))}
      </div>
    </div>
  );
}

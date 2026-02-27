import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function AdminOrdersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const status = typeof searchParams.status === 'string' ? searchParams.status : '';
  let query = supabase.from('orders').select('id,status,created_at,profiles(email)').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data: orders } = await query.limit(100);

  const orderIds = (orders ?? []).map((order: any) => order.id);
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
      <h1 className="text-2xl font-semibold">Orders</h1>
      <form className="card flex gap-2">
        <select className="input" name="status" defaultValue={status}>
          <option value="">All statuses</option>
          <option>New</option><option>Processing</option><option>Shipped</option>
        </select>
        <button className="btn-primary">Filter</button>
        <a className="rounded border px-3 py-2" href="/api/export/orders">Export CSV</a>
      </form>
      {orders?.map((order: any) => (
        <Link key={order.id} href={`/admin/orders/${order.id}`} className="card block">
          {firstNameByOrderId.get(order.id) ?? 'Unknown product'} - {order.status} - {order.profiles?.email}
        </Link>
      ))}
    </div>
  );
}

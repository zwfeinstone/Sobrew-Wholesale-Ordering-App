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
    <div className="space-y-6">
      <section className="panel">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="space-y-4">
            <span className="eyebrow">Operations Snapshot</span>
            <div>
              <h1 className="page-title">Keep wholesale fulfillment moving with less friction.</h1>
              <p className="page-subtitle mt-3">Review what needs action, jump into new orders quickly, and stay on top of recurring demand from one streamlined admin workspace.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">New Orders</p>
              <p className="mt-2 text-4xl font-semibold text-slate-950">{newOrders ?? 0}</p>
              <p className="mt-2 text-sm text-slate-500">Orders currently waiting for review.</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent Activity</p>
              <p className="mt-2 text-4xl font-semibold text-slate-950">{recent?.length ?? 0}</p>
              <p className="mt-2 text-sm text-slate-500">Most recent orders shown below.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">Recent orders</h2>
            <p className="mt-1 text-sm text-slate-500">Open any order to update status, check items, or confirm shipment progress.</p>
          </div>
          <Link href="/admin/orders" className="btn-secondary">View all orders</Link>
        </div>
        {recent?.map((order: any) => (
          <Link
            key={order.id}
            href={`/admin/orders/${order.id}`}
            className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200/70 bg-white/70 px-4 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:bg-white"
          >
            <div>
              <p className="font-semibold text-slate-950">{firstNameByOrderId.get(order.id) ?? 'Unknown product'}</p>
              <p className="mt-1 text-sm text-slate-500">{order.profiles?.email}</p>
            </div>
            <div className="text-right">
              <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{order.status}</p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

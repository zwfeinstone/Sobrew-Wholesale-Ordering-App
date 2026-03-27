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
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Past Orders</span>
        <h1 className="page-title mt-4">Order history</h1>
        <p className="page-subtitle mt-3">Track previous purchases, review line items, and quickly reorder when you need to restock.</p>
      </section>
      {orders?.map((order) => (
        <Link
          key={order.id}
          href={`/portal/orders/${order.id}`}
          className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-lg font-semibold text-slate-950">{(lineItemsByOrderId.get(order.id) ?? ['Unknown product']).join(', ')}</p>
              <p className="mt-2 text-sm text-slate-500">{new Date(order.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{order.status}</span>
              <span className="text-lg font-semibold text-slate-950">{usd(order.subtotal_cents)}</span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

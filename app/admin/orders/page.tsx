import Link from 'next/link';
import { redirect } from 'next/navigation';
import StatusToast from '@/components/status-toast';
import { sendShippedEmail } from '@/lib/email';
import { getOrderItemSummaries } from '@/lib/order-items';
import { createClient } from '@/lib/supabase/server';

async function updateStatus(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  const statusFilter = String(formData.get('statusFilter') ?? '');

  const { data: order } = await supabase.from('orders').select('id,status,profiles(email)').eq('id', id).single();
  const orderUpdateResult = await supabase.from('orders').update({ status }).eq('id', id).select('id');

  if (!orderUpdateResult.error && orderUpdateResult.data?.length && order?.status !== 'Shipped' && status === 'Shipped' && (order as any)?.profiles?.email) {
    const items = await getOrderItemSummaries(supabase, id);
    await sendShippedEmail((order as any).profiles.email, items);
  }

  const query = new URLSearchParams();
  if (statusFilter) query.set('status', statusFilter);
  if (orderUpdateResult.error || !orderUpdateResult.data?.length) {
    query.set('toast', 'status_error');
  } else {
    query.set('toast', 'status_updated');
  }
  const nextSearch = query.toString() ? `?${query.toString()}` : '';
  redirect(`/admin/orders${nextSearch}`);
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const status = typeof searchParams.status === 'string' ? searchParams.status : '';
  const toast = typeof searchParams.toast === 'string' ? searchParams.toast : '';
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
    <div className="space-y-6">
      {toast === 'status_updated' ? <StatusToast message="Order status updated." tone="success" /> : null}
      {toast === 'status_error' ? <StatusToast message="Order status update failed." tone="error" /> : null}
      <section className="panel">
        <span className="eyebrow">Order Queue</span>
        <h1 className="page-title mt-4">Manage wholesale orders</h1>
        <p className="page-subtitle mt-3">Filter by status, review the latest requests, and update fulfillment without losing context.</p>
      </section>
      <form className="card flex flex-col gap-3 md:flex-row">
        <select className="input" name="status" defaultValue={status}>
          <option value="">All statuses</option>
          <option>New</option><option>Processing</option><option>Shipped</option>
        </select>
        <button className="btn-primary">Filter</button>
        <a className="btn-secondary" href="/api/export/orders">Export CSV</a>
      </form>
      {orders?.map((order: any) => (
        <div key={order.id} className="card flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Link href={`/admin/orders/${order.id}`} className="block">
            <p className="text-lg font-semibold text-slate-950">{firstNameByOrderId.get(order.id) ?? 'Unknown product'}</p>
            <p className="mt-2 text-sm text-slate-500">{order.profiles?.email}</p>
          </Link>
          <form action={updateStatus} className="flex items-center gap-2">
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="statusFilter" value={status} />
            <select className="input" name="status" defaultValue={order.status}>
              <option>New</option>
              <option>Processing</option>
              <option>Shipped</option>
            </select>
            <button className="btn-primary" type="submit">Save</button>
          </form>
        </div>
      ))}
    </div>
  );
}

import { notFound, redirect } from 'next/navigation';
import StatusToast from '@/components/status-toast';
import { createClient } from '@/lib/supabase/server';
import { sendShippedEmail } from '@/lib/email';
import { getOrderItemSummaries } from '@/lib/order-items';

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function updateStatus(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  const { data: order } = await supabase.from('orders').select('id,user_id,status,profiles(email)').eq('id', id).single();
  const orderUpdateResult = await supabase.from('orders').update({ status }).eq('id', id).select('id');
  if (!orderUpdateResult.error && orderUpdateResult.data?.length && order?.status !== 'Shipped' && status === 'Shipped' && (order as any)?.profiles?.email) {
    const items = await getOrderItemSummaries(supabase, id);
    await sendShippedEmail((order as any).profiles.email, items);
  }
  const query = new URLSearchParams({
    toast: orderUpdateResult.error || !orderUpdateResult.data?.length ? 'status_error' : 'status_updated',
  });
  redirect(`/admin/orders/${id}?${query.toString()}`);
}

async function archiveOrder(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/admin/orders?toast=archive_error');

  const { data: order } = await supabase.from('orders').select('id,status,archived_at').eq('id', id).single();
  if (!order || order.archived_at || !['Processing', 'Shipped'].includes(order.status)) {
    redirect(`/admin/orders/${id}?toast=archive_error`);
  }

  const archiveResult = await supabase.from('orders').update({ archived_at: new Date().toISOString() }).eq('id', id).is('archived_at', null).select('id');
  redirect(`/admin/orders/${id}?toast=${archiveResult.error || !archiveResult.data?.length ? 'archive_error' : 'archive_success'}`);
}

export default async function AdminOrderDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const toast = typeof searchParams.toast === 'string' ? searchParams.toast : '';
  const { data: order } = await supabase.from('orders').select('*,profiles(email,full_name)').eq('id', params.id).single();
  if (!order) return notFound();
  const { data: items } = await supabase.from('order_items').select('id,qty,product_id,product_name_snapshot').eq('order_id', order.id);

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const productNameById = new Map((products ?? []).map((p: any) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      {toast === 'status_updated' ? <StatusToast message="Order status updated." tone="success" /> : null}
      {toast === 'status_error' ? <StatusToast message="Order status update failed." tone="error" /> : null}
      {toast === 'archive_success' ? <StatusToast message="Order archived." tone="success" /> : null}
      {toast === 'archive_error' ? <StatusToast message="Unable to archive this order." tone="error" /> : null}
      <section className="panel">
        <span className="eyebrow">Order Detail</span>
        <h1 className="page-title mt-4">Order overview</h1>
        <p className="page-subtitle mt-3">Update fulfillment status, verify shipping details, and review the ordered products below.</p>
        <p className="mt-4 text-sm font-medium text-slate-600">Placed {formatOrderTimestamp(order.created_at)}</p>
        {order.archived_at ? <p className="mt-2 text-sm font-medium text-slate-600">Archived {formatOrderTimestamp(order.archived_at)}</p> : null}
      </section>
      {order.archived_at ? (
        <div className="card text-sm text-slate-600">This order is archived and no longer appears in the active orders list.</div>
      ) : null}
      <form action={updateStatus} className="card flex flex-col gap-3 md:flex-row md:items-center">
        <input type="hidden" name="id" value={order.id} />
        <select className="input" name="status" defaultValue={order.status}>
          <option>New</option><option>Processing</option><option>Shipped</option>
        </select>
        <button className="btn-primary">Update status</button>
        {!order.archived_at && ['Processing', 'Shipped'].includes(order.status) ? (
          <button formAction={archiveOrder} className="btn-secondary" type="submit">Archive order</button>
        ) : null}
      </form>
      <div className="card">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Shipping</p>
        <p className="mt-3 text-lg font-semibold text-slate-950">{order.shipping_name}</p>
        <p className="mt-2 text-sm text-slate-600">{order.shipping_address1}, {order.shipping_city}</p>
      </div>
      <div className="card space-y-3">
        {items?.map((i: any) => (
          <div key={i.id} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
            <span>{productNameById.get(i.product_id) || i.product_name_snapshot || 'Unknown product'} x {i.qty}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

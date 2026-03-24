import { notFound, redirect } from 'next/navigation';
import StatusToast from '@/components/status-toast';
import { createClient } from '@/lib/supabase/server';
import { sendShippedEmail } from '@/lib/email';
import { getOrderItemSummaries } from '@/lib/order-items';

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
    <div className="space-y-4">
      {toast === 'status_updated' ? <StatusToast message="Order status updated." tone="success" /> : null}
      {toast === 'status_error' ? <StatusToast message="Order status update failed." tone="error" /> : null}
      <h1 className="text-2xl font-semibold">Order {order.id}</h1>
      <form action={updateStatus} className="card flex gap-2">
        <input type="hidden" name="id" value={order.id} />
        <select className="input" name="status" defaultValue={order.status}>
          <option>New</option><option>Processing</option><option>Shipped</option>
        </select>
        <button className="btn-primary">Update status</button>
      </form>
      <div className="card">{order.shipping_name} - {order.shipping_address1}, {order.shipping_city}</div>
      <div className="card space-y-1">
        {items?.map((i: any) => (
          <div key={i.id}>{productNameById.get(i.product_id) || i.product_name_snapshot || 'Unknown product'} x {i.qty}</div>
        ))}
      </div>
    </div>
  );
}

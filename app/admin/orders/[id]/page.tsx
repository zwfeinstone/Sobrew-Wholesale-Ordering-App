import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { sendShippedEmail } from '@/lib/email';

async function updateStatus(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  const { data: order } = await supabase.from('orders').select('id,user_id,status,profiles(email)').eq('id', id).single();
  await supabase.from('orders').update({ status }).eq('id', id);
  if (order?.status !== 'Shipped' && status === 'Shipped' && (order as any)?.profiles?.email) {
    await sendShippedEmail((order as any).profiles.email, id);
  }
  redirect(`/admin/orders/${id}`);
}

export default async function AdminOrderDetail({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('*,profiles(email,full_name)').eq('id', params.id).single();
  if (!order) return notFound();
  const { data: items } = await supabase.from('order_items').select('id,qty,product_name_snapshot,products(name)').eq('order_id', order.id);

  return (
    <div className="space-y-4">
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
          <div key={i.id}>{i.product_name_snapshot || i.products?.name || 'Product'} x {i.qty}</div>
        ))}
      </div>
    </div>
  );
}

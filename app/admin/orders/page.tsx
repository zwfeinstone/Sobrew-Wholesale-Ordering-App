import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sendShippedEmail } from '@/lib/email';
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
    await sendShippedEmail((order as any).profiles.email, id);
  }

  const nextSearch = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
  redirect(`/admin/orders${nextSearch}`);
}

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
        <div key={order.id} className="card flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <Link href={`/admin/orders/${order.id}`} className="block font-medium hover:underline">
            {firstNameByOrderId.get(order.id) ?? 'Unknown product'} - {order.profiles?.email}
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

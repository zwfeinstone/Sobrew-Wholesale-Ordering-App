import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function AdminOrdersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const status = typeof searchParams.status === 'string' ? searchParams.status : '';
  let query = supabase.from('orders').select('id,status,created_at,profiles(email)').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data } = await query.limit(100);

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
      {data?.map((order: any) => (
        <Link key={order.id} href={`/admin/orders/${order.id}`} className="card block">
          {order.id} - {order.status} - {order.profiles?.email}
        </Link>
      ))}
    </div>
  );
}

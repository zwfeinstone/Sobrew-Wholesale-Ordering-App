import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function AdminDashboard() {
  const supabase = await createClient();
  const [{ count: newOrders }, { data: recent }] = await Promise.all([
    supabase.from('orders').select('*', { head: true, count: 'exact' }).eq('status', 'New'),
    supabase.from('orders').select('id,status,created_at,profiles(email)').order('created_at', { ascending: false }).limit(8)
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="card">New orders: {newOrders ?? 0}</div>
      <div className="card space-y-2">
        <h2 className="font-semibold">Recent orders</h2>
        {recent?.map((order: any) => (
          <Link key={order.id} href={`/admin/orders/${order.id}`} className="block rounded border p-2">
            {order.id} - {order.status} - {order.profiles?.email}
          </Link>
        ))}
      </div>
    </div>
  );
}

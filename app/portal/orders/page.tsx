import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

export default async function OrdersPage() {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from('orders').select('id,status,subtotal_cents,created_at').eq('user_id', user.id).order('created_at', { ascending: false });

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Order history</h1>
      {data?.map((order) => (
        <Link key={order.id} href={`/portal/orders/${order.id}`} className="card block">
          {order.id} - {order.status} - {usd(order.subtotal_cents)}
        </Link>
      ))}
    </div>
  );
}

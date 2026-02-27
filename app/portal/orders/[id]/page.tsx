import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClearCart } from '@/components/cart-client';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

export default async function OrderDetail({ params }: { params: { id: string } }) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('*').eq('id', params.id).eq('user_id', user.id).single();
  if (!order) return notFound();
  const { data: items } = await supabase
    .from('order_items')
    .select('id,qty,line_total_cents,product_name_snapshot,products(name)')
    .eq('order_id', order.id);

  return (
    <div className="space-y-4">
      <ClearCart />
      <h1 className="text-2xl font-semibold">Order {order.id}</h1>
      <p>Status: {order.status}</p>
      <div className="card">
        {items?.map((i: any) => (
          <div key={i.id} className="flex justify-between">
            <span>{i.product_name_snapshot || i.products?.name || 'Product'} x {i.qty}</span>
            <span>{usd(i.line_total_cents)}</span>
          </div>
        ))}
      </div>
      <div>Subtotal: {usd(order.subtotal_cents)}</div>
      <Link className="btn-primary inline-block" href="/portal">Reorder</Link>
    </div>
  );
}

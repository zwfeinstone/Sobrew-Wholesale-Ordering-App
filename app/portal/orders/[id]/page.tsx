import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ClearCart } from '@/components/cart-client';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd } from '@/lib/utils';

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default async function OrderDetail({ params }: { params: { id: string } }) {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { data: order } = await supabase.from('orders').select('*').eq('id', params.id).eq('user_id', user.id).single();
  if (!order) return notFound();
  const { data: items } = await supabase.from('order_items').select('id,qty,line_total_cents,product_id,product_name_snapshot').eq('order_id', order.id);

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const { data: products } = productIds.length
    ? await supabaseAdmin.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const productNameById = new Map((products ?? []).map((p: any) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <ClearCart />
      <section className="panel">
        <span className="eyebrow">Order Details</span>
        <h1 className="page-title mt-4">Your order is {order.status.toLowerCase()}.</h1>
        <p className="page-subtitle mt-3">Review the items in this order and head back to the catalog whenever you are ready to reorder.</p>
        <p className="mt-4 text-sm font-medium text-slate-600">Placed {formatOrderTimestamp(order.created_at)}</p>
      </section>
      <div className="card space-y-3">
        {items?.map((i: any) => (
          <div key={i.id} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
            <span>{productNameById.get(i.product_id) || i.product_name_snapshot || 'Unknown product'} x {i.qty}</span>
            <span className="font-semibold text-slate-950">{usd(i.line_total_cents)}</span>
          </div>
        ))}
      </div>
      <div className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Subtotal</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{usd(order.subtotal_cents)}</p>
        </div>
        <Link className="btn-primary inline-flex" href="/portal">Reorder</Link>
      </div>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { ClearCart, ReorderButton } from '@/components/cart-client';
import { OrderStatusBadge, OrderStatusTimeline } from '@/components/order-status';
import StatusToast from '@/components/status-toast';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';
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

export default async function OrderDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const centerId = profile?.center_id ?? user.id;
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const shouldClearCart =
    toast === 'order_placed' ||
    toast === 'order_placed_recurring_created' ||
    toast === 'order_placed_recurring_error';
  const { data: order } = await supabase.from('orders').select('*').eq('id', params.id).eq('center_id', centerId).single();
  if (!order) return notFound();
  const { data: items } = await supabase.from('order_items').select('id,qty,line_total_cents,product_id,product_name_snapshot,unit_price_cents').eq('order_id', order.id);

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const [{ data: products }, { data: currentPrices }] = await Promise.all([
    productIds.length
      ? supabaseAdmin.from('products').select('id,name').in('id', productIds)
      : Promise.resolve({ data: [] as any[] }),
    productIds.length
      ? supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', centerId).in('product_id', productIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const productNameById = new Map((products ?? []).map((p: any) => [p.id, p.name]));
  const currentPriceById = new Map((currentPrices ?? []).map((row) => [row.product_id, row.price_cents]));
  const reorderItems = (items ?? []).map((item: any) => ({
    product_id: item.product_id,
    name: productNameById.get(item.product_id) || item.product_name_snapshot || 'Unknown product',
    price_cents: currentPriceById.get(item.product_id) ?? item.unit_price_cents ?? 0,
    qty: item.qty,
  }));

  return (
    <div className="space-y-6">
      {shouldClearCart ? <ClearCart storageKey={cartStorageKey} /> : null}
      {toast === 'order_placed' ? <StatusToast message="Order placed successfully." tone="success" /> : null}
      {toast === 'order_placed_recurring_created' ? <StatusToast message="Order placed and recurring shipment created." tone="success" /> : null}
      {toast === 'order_placed_recurring_error' ? <StatusToast message="Order placed, but we couldn't create the recurring shipment." tone="error" /> : null}
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="eyebrow">Order Details</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <h1 className="page-title mt-4">Your order is {(order.status ?? 'New').toLowerCase()}.</h1>
        <p className="page-subtitle mt-3">Review the items in this order and head back to the catalog whenever you are ready to reorder.</p>
        <p className="mt-4 text-sm font-medium text-slate-600">Placed {formatOrderTimestamp(order.created_at)}</p>
        <div className="mt-6">
          <OrderStatusTimeline status={order.status} />
        </div>
      </section>
      <div className="card space-y-3">
        {!items?.length ? <p className="text-sm text-slate-500">No line items are attached to this order.</p> : null}
        {items?.map((i: any) => (
          <div key={i.id} className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <span>{productNameById.get(i.product_id) || i.product_name_snapshot || 'Unknown product'} x {i.qty}</span>
            <span className="font-semibold text-slate-950">{usd(i.line_total_cents)}</span>
          </div>
        ))}
      </div>
      <div className="sticky-action-bar flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Subtotal</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{usd(order.subtotal_cents)}</p>
        </div>
        <ReorderButton
          items={reorderItems}
          storageKey={cartStorageKey}
          label="Add order to cart"
          toastMessage="Order added to cart."
          className="btn-primary inline-flex w-full sm:w-auto"
        />
      </div>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { ClearCart, ReorderButton } from '@/components/cart-client';
import { OrderStatusBadge, OrderStatusTimeline } from '@/components/order-status';
import StatusToast from '@/components/status-toast';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';
import { createClient } from '@/lib/supabase/server';
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
  const { data: catalogProducts } = productIds.length
    ? await supabase
        .from('portal_catalog')
        .select('product_id,name,current_price_cents')
        .in('product_id', productIds)
    : { data: [] as any[] };
  const catalogProductById = new Map((catalogProducts ?? []).map((product) => [product.product_id, product]));
  const reorderItems = (items ?? [])
    .filter((item: any) => catalogProductById.has(item.product_id))
    .map((item: any) => {
      const product = catalogProductById.get(item.product_id)!;
      return {
        product_id: item.product_id,
        name: product.name,
        price_cents: product.current_price_cents,
        qty: item.qty,
      };
    });

  return (
    <div className="space-y-6">
      {shouldClearCart ? <ClearCart storageKey={cartStorageKey} /> : null}
      {toast === 'order_placed' ? <StatusToast message="Order placed successfully." tone="success" /> : null}
      {toast === 'order_placed_recurring_created' ? <StatusToast message="Order placed and recurring shipment created." tone="success" /> : null}
      {toast === 'order_placed_recurring_error' ? (
        <div className="checkout-critical-alert" role="alert">
          Your order was placed, but the recurring shipment could not be created. This message will remain here while you review the order.
        </div>
      ) : null}
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="eyebrow">Order Details</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <h1 className="page-title mt-4">Order from {formatOrderTimestamp(order.created_at)}</h1>
        <p className="page-subtitle mt-3">Review the items and reorder the products that are still available to your center.</p>
        <div className="mt-6">
          <OrderStatusTimeline status={order.status} />
        </div>
      </section>
      <div className="card space-y-3">
        {!items?.length ? <p className="text-sm text-slate-500">No line items are attached to this order.</p> : null}
        {items?.map((i: any) => (
          <div key={i.id} className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <span>{catalogProductById.get(i.product_id)?.name || i.product_name_snapshot || 'Unknown product'} x {i.qty}</span>
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
          label="Reorder & review"
          toastMessage="Order added to cart."
          className="btn-primary inline-flex w-full sm:w-auto"
        />
      </div>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { ClearCart, ReorderButton } from '@/components/cart-client';
import { OrderStatusBadge, OrderStatusTimeline } from '@/components/order-status';
import OrderConfirmation from '@/components/order-confirmation';
import { OrderNotes } from '@/components/order-notes';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';
import { createClient } from '@/lib/supabase/server';
import { formatAppDateTime, usd } from '@/lib/utils';

function formatOrderTimestamp(value: string | null) {
  return formatAppDateTime(value);
}

export default async function OrderDetail(
  props: {
    params: Promise<{ id: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const centerId = profile?.center_id ?? user.id;
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const isOrderConfirmation =
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
      {isOrderConfirmation ? <ClearCart storageKey={cartStorageKey} submissionId={order.submission_id} orderId={order.id} /> : null}
      {isOrderConfirmation ? (
        <OrderConfirmation
          orderId={order.id}
          createdAt={order.created_at}
          subtotalCents={order.subtotal_cents}
          itemCount={(items ?? []).reduce((count, item) => count + item.qty, 0)}
          shipping={order}
          recurringStatus={toast === 'order_placed_recurring_created' ? 'created' : toast === 'order_placed_recurring_error' ? 'error' : 'none'}
        />
      ) : null}
      <section className={isOrderConfirmation ? 'card' : 'panel'}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {isOrderConfirmation ? <h2 className="text-xl font-semibold text-slate-950">Order summary</h2> : <span className="eyebrow">Order Details</span>}
          <OrderStatusBadge status={order.status} />
        </div>
        {!isOrderConfirmation ? <>
          <h1 className="page-title mt-4">Order from {formatOrderTimestamp(order.created_at)}</h1>
          <p className="page-subtitle mt-3">Review the items and reorder the products that are still available to your center.</p>
        </> : null}
        <div className="mt-6">
          <OrderStatusTimeline status={order.status} />
        </div>
      </section>
      <OrderNotes notes={order.notes} />
      <div className="card space-y-3">
        {!items?.length ? <p className="text-sm text-slate-500">No line items are attached to this order.</p> : null}
        {items?.map((i: any) => (
          <div key={i.id} className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <span>{catalogProductById.get(i.product_id)?.name || i.product_name_snapshot || 'Unknown product'} x {i.qty}</span>
            <span className="font-semibold text-slate-950">{usd(i.line_total_cents)}</span>
          </div>
        ))}
      </div>
      {!isOrderConfirmation ? <div className="sticky-action-bar flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Subtotal</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{usd(order.subtotal_cents)}</p>
        </div>
        <ReorderButton
          items={reorderItems}
          storageKey={cartStorageKey}
          label="Reorder & review"
          className="btn-primary inline-flex w-full sm:w-auto"
        />
      </div> : null}
    </div>
  );
}

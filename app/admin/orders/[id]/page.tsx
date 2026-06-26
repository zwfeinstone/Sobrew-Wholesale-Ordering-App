import { notFound, redirect } from 'next/navigation';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import { OrderStatusBadge, OrderStatusTimeline } from '@/components/order-status';
import StatusToast from '@/components/status-toast';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { getCenterLoginEmails } from '@/lib/center-logins';
import { createClient } from '@/lib/supabase/server';
import { sendShippedEmail } from '@/lib/email';
import { getOrderItemSummaries } from '@/lib/order-items';
import { centsFromDollars, normalizeInventoryNumber } from '@/lib/inventory';
import { snapshotOrderCommissionForShipment } from '@/lib/commissions';
import { snapshotOrderCogsForShipment } from '@/lib/order-cogs';
import { usd } from '@/lib/utils';

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function updateStatus(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  const supabase = await createClient();
  if (status === 'Shipped') {
    redirect(`/admin/orders/${id}?toast=ship_on_detail_required`);
  }
  const orderUpdateResult = await supabase.from('orders').update({ status }).eq('id', id).select('id');
  const query = new URLSearchParams({
    toast: orderUpdateResult.error || !orderUpdateResult.data?.length ? 'status_error' : 'status_updated',
  });
  redirect(`/admin/orders/${id}?${query.toString()}`);
}

async function shipOrder(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  const supabase = await createClient();
  const shippingCostCents = centsFromDollars(String(formData.get('shipping_cost') ?? '0'));
  if (!id || shippingCostCents <= 0) redirect(`/admin/orders/${id}?toast=shipping_required`);

  const { data: order } = await supabase
    .from('orders')
    .select('id,user_id,center_id,status,archived_at,profiles(email)')
    .eq('id', id)
    .single();
  if (!order || order.archived_at) redirect(`/admin/orders/${id}?toast=ship_error`);

  const { data: orderItems } = await supabase
    .from('order_items')
    .select('id,product_id,products(shipping_box_count_required)')
    .eq('order_id', id);

  for (const item of orderItems ?? []) {
    const product = relatedOne((item as any).products);
    const rawBoxes = String(formData.get(`boxes_${(item as any).id}`) ?? '').trim();
    const boxesUsed = rawBoxes ? Math.max(0, Number.parseFloat(rawBoxes) || 0) : null;
    if (product?.shipping_box_count_required && (!boxesUsed || boxesUsed <= 0)) {
      redirect(`/admin/orders/${id}?toast=box_count_required`);
    }
    if (boxesUsed !== null) {
      const { error: itemError } = await supabase
        .from('order_items')
        .update({ shipping_boxes_used: boxesUsed })
        .eq('id', (item as any).id);
      if (itemError) redirect(`/admin/orders/${id}?toast=ship_error`);
    }
  }

  const cogsResult = await snapshotOrderCogsForShipment({
    orderId: id,
    shippingCostCents,
    supabase,
  });

  if (cogsResult.error) {
    redirect(`/admin/orders/${id}?toast=ship_error`);
  }

  const shippedAt = new Date().toISOString();
  const commissionResult = await snapshotOrderCommissionForShipment({
    orderId: id,
    shippedAt,
    shippingCostCents,
  });

  if (commissionResult.error) {
    console.error('[orders] commission snapshot failed', commissionResult.error);
    redirect(`/admin/orders/${id}?toast=ship_error`);
  }

  const orderUpdateResult = await supabase
    .from('orders')
    .update({
      status: 'Shipped',
      shipping_cost_cents: shippingCostCents,
      shipped_at: shippedAt,
    })
    .eq('id', id)
    .select('id');

  if (orderUpdateResult.error || !orderUpdateResult.data?.length) {
    redirect(`/admin/orders/${id}?toast=ship_error`);
  }

  if (order.status !== 'Shipped') {
    const items = await getOrderItemSummaries(supabase, id);
    const centerEmails = await getCenterLoginEmails(supabase, (order as any).center_id);
    await sendShippedEmail(centerEmails.length ? centerEmails : (order as any).profiles.email, items);
  }

  redirect(`/admin/orders/${id}?toast=order_shipped`);
}

async function archiveOrder(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  const supabase = await createClient();
  if (!id) redirect('/admin/orders?toast=archive_error');

  const { data: order } = await supabase.from('orders').select('id,status,archived_at').eq('id', id).single();
  if (!order || order.archived_at || !['Processing', 'Shipped'].includes(order.status)) {
    redirect(`/admin/orders/${id}?toast=archive_error`);
  }

  const archiveResult = await supabase.from('orders').update({ archived_at: new Date().toISOString() }).eq('id', id).is('archived_at', null).select('id');
  redirect(`/admin/orders/${id}?toast=${archiveResult.error || !archiveResult.data?.length ? 'archive_error' : 'archive_success'}`);
}

async function deleteOrder(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  await requireAdminWriteAccess(id ? `/admin/orders/${id}?toast=admin_write_denied` : '/admin/orders?toast=admin_write_denied', 'orders');

  const supabase = await createClient();
  if (!id) redirect('/admin/orders?toast=delete_error');

  const { count: recurringCount } = await supabase
    .from('recurring_orders')
    .select('id', { count: 'exact', head: true })
    .eq('source_order_id', id);

  const deleteResult = await supabase.from('orders').delete().eq('id', id).select('id');
  if (deleteResult.error || !deleteResult.data?.length) {
    redirect(`/admin/orders/${id}?toast=delete_error`);
  }

  redirect(`/admin/orders?toast=${(recurringCount ?? 0) > 0 ? 'delete_success_with_recurring' : 'delete_success'}`);
}

export default async function AdminOrderDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const toast = typeof searchParams.toast === 'string' ? searchParams.toast : '';
  const { data: order } = await supabase.from('orders').select('*,profiles(email,full_name),centers(name)').eq('id', params.id).single();
  if (!order) return notFound();
  const { data: items } = await supabase.from('order_items').select('id,qty,product_id,product_name_snapshot,shipping_boxes_used,cogs_product_cents,cogs_shipping_cents,cogs_total_cents,cogs_source,cogs_estimated,cogs_snapshot_at,products(name,shipping_box_count_required)').eq('order_id', order.id);
  const { count: recurringCount } = await supabase
    .from('recurring_orders')
    .select('id', { count: 'exact', head: true })
    .eq('source_order_id', order.id);
  const orderNotes = typeof order.notes === 'string' ? order.notes.trim() : '';

  return (
    <div className="space-y-6">
      {toast === 'status_updated' ? <StatusToast message="Order status updated." tone="success" /> : null}
      {toast === 'status_error' ? <StatusToast message="Order status update failed." tone="error" /> : null}
      {toast === 'ship_on_detail_required' ? <StatusToast message="Use the shipping form to enter shipping cost before marking this order shipped." tone="error" /> : null}
      {toast === 'shipping_required' ? <StatusToast message="Shipping cost is required before this order can ship." tone="error" /> : null}
      {toast === 'box_count_required' ? <StatusToast message="Boxes used are required for one or more products on this order." tone="error" /> : null}
      {toast === 'order_shipped' ? <StatusToast message="Order shipped, COGS recorded, and customer email sent." tone="success" /> : null}
      {toast === 'ship_error' ? <StatusToast message="Unable to ship this order." tone="error" /> : null}
      {toast === 'archive_success' ? <StatusToast message="Order archived." tone="success" /> : null}
      {toast === 'archive_error' ? <StatusToast message="Unable to archive this order." tone="error" /> : null}
      {toast === 'delete_error' ? <StatusToast message="Unable to delete this order." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only zach@sobrew.com can change admin data." tone="error" /> : null}
      <section className="panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="eyebrow">Order Detail</span>
          <OrderStatusBadge status={order.status} />
        </div>
        <h1 className="page-title mt-4">Order overview</h1>
        <p className="page-subtitle mt-3">Update fulfillment status, verify shipping details, and review the ordered products below.</p>
        <p className="mt-4 break-words text-sm font-medium text-slate-600">Center {order.centers?.name || 'Unknown center'}</p>
        <p className="mt-1 break-all text-sm font-medium text-slate-600">Submitted by {order.profiles?.email || 'Unknown login'}</p>
        <p className="mt-4 text-sm font-medium text-slate-600">Placed {formatOrderTimestamp(order.created_at)}</p>
        {order.archived_at ? <p className="mt-2 text-sm font-medium text-slate-600">Archived {formatOrderTimestamp(order.archived_at)}</p> : null}
        <div className="mt-6">
          <OrderStatusTimeline status={order.status} />
        </div>
      </section>
      {order.archived_at ? (
        <div className="card text-sm text-slate-600">This order is archived and no longer appears in the active orders list.</div>
      ) : null}
      <div className="sticky-action-bar flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {order.status !== 'Shipped' ? (
          <form action={updateStatus} className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
            <input type="hidden" name="id" value={order.id} />
            <select className="input" name="status" defaultValue={order.status}>
              <option>New</option><option>Processing</option>
            </select>
            <button className="btn-primary w-full md:w-auto">Update status</button>
          </form>
        ) : (
          <div className="text-sm font-semibold text-slate-700">This order was shipped {formatOrderTimestamp(order.shipped_at)}.</div>
        )}
        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:flex-wrap md:justify-end">
          {!order.archived_at && ['Processing', 'Shipped'].includes(order.status) ? (
            <form action={archiveOrder} className="w-full md:w-auto">
              <input type="hidden" name="id" value={order.id} />
              <button className="btn-secondary w-full md:w-auto" type="submit">Archive order</button>
            </form>
          ) : null}
          <form action={deleteOrder} className="w-full md:w-auto">
            <input type="hidden" name="id" value={order.id} />
            <ConfirmSubmitButton
              className="w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70 md:w-auto"
              confirmMessage={
                (recurringCount ?? 0) > 0
                  ? 'Delete this order permanently? This will also delete the recurring schedule created from it. This action cannot be undone.'
                  : 'Delete this order permanently? This action cannot be undone.'
              }
              label="Delete order"
              pendingLabel="Deleting..."
            />
          </form>
        </div>
      </div>
      <div className="card">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Shipping</p>
        <p className="mt-3 text-lg font-semibold text-slate-950">{order.shipping_name}</p>
        <p className="mt-2 text-sm text-slate-600">{order.shipping_address1}, {order.shipping_city}</p>
        {order.shipping_cost_cents !== null && order.shipping_cost_cents !== undefined ? (
          <p className="mt-3 text-sm font-semibold text-slate-950">Shipping COGS: {usd(Math.round(normalizeInventoryNumber(order.shipping_cost_cents)))}</p>
        ) : null}
      </div>
      {!order.archived_at && order.status !== 'Shipped' ? (
        <form action={shipOrder} className="card space-y-4">
          <div>
            <span className="eyebrow">Ship Order</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Record shipping COGS</h2>
            <p className="mt-2 text-sm text-slate-500">Shipping cost is required before this order can be marked shipped.</p>
          </div>
          <input type="hidden" name="id" value={order.id} />
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Shipping cost
            <input className="input" name="shipping_cost" min="0.01" step="0.01" type="number" required placeholder="0.00" />
          </label>
          {(items ?? []).some((item: any) => relatedOne(item.products)?.shipping_box_count_required) ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-950">Boxes used</p>
              {(items ?? []).filter((item: any) => relatedOne(item.products)?.shipping_box_count_required).map((item: any) => {
                const product = relatedOne(item.products);
                return (
                  <label key={item.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_9rem] sm:items-center">
                    <span className="font-medium text-slate-800">{product?.name || item.product_name_snapshot || 'Unknown product'} x {item.qty}</span>
                    <input className="input" name={`boxes_${item.id}`} min="0.0001" step="0.0001" type="number" required placeholder="Boxes" />
                  </label>
                );
              })}
            </div>
          ) : null}
          <button className="btn-primary w-full sm:w-auto">Mark shipped</button>
        </form>
      ) : null}
      {orderNotes ? (
        <div className="card">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Special note</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{orderNotes}</p>
        </div>
      ) : null}
      <div className="card space-y-3">
        {items?.map((i: any) => (
          <div key={i.id} className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="break-words">{relatedOne(i.products)?.name || i.product_name_snapshot || 'Unknown product'} x {i.qty}</span>
              {i.cogs_snapshot_at ? (
                <p className="mt-1 text-xs text-slate-500">
                  COGS {usd(Math.round(normalizeInventoryNumber(i.cogs_total_cents)))} ({i.cogs_estimated ? 'estimated' : 'actual'}{i.cogs_source ? `, ${String(i.cogs_source).replaceAll('_', ' ')}` : ''})
                </p>
              ) : null}
            </div>
            <div className="text-sm font-medium text-slate-600 sm:text-right">
              {i.shipping_boxes_used !== null && i.shipping_boxes_used !== undefined ? (
                <p>Boxes used: {normalizeInventoryNumber(i.shipping_boxes_used)}</p>
              ) : null}
              {i.cogs_shipping_cents !== null && i.cogs_shipping_cents !== undefined ? (
                <p>Shipping COGS: {usd(Math.round(normalizeInventoryNumber(i.cogs_shipping_cents)))}</p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminOrderBulkControls } from '@/components/admin-order-bulk-controls';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import StatusToast from '@/components/status-toast';
import { getCenterLoginEmails } from '@/lib/center-logins';
import { sendShippedEmail } from '@/lib/email';
import { getOrderItemSummaries } from '@/lib/order-items';
import { createClient } from '@/lib/supabase/server';

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function updateStatus(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  const statusFilter = String(formData.get('statusFilter') ?? '');

  const { data: order } = await supabase.from('orders').select('id,status,center_id,profiles(email)').eq('id', id).single();
  const orderUpdateResult = await supabase.from('orders').update({ status }).eq('id', id).select('id');

  if (!orderUpdateResult.error && orderUpdateResult.data?.length && order?.status !== 'Shipped' && status === 'Shipped') {
    const items = await getOrderItemSummaries(supabase, id);
    const centerEmails = await getCenterLoginEmails(supabase, (order as any).center_id);
    await sendShippedEmail(centerEmails.length ? centerEmails : (order as any).profiles.email, items);
  }

  const query = new URLSearchParams();
  if (statusFilter) query.set('status', statusFilter);
  if (orderUpdateResult.error || !orderUpdateResult.data?.length) {
    query.set('toast', 'status_error');
  } else {
    query.set('toast', 'status_updated');
  }
  const nextSearch = query.toString() ? `?${query.toString()}` : '';
  redirect(`/admin/orders${nextSearch}`);
}

async function archiveOrder(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  const statusFilter = String(formData.get('statusFilter') ?? '');
  if (!id) redirect('/admin/orders?toast=archive_error');

  const { data: order } = await supabase.from('orders').select('id,status').eq('id', id).single();
  const query = new URLSearchParams();
  if (statusFilter) query.set('status', statusFilter);

  if (!order || !['Processing', 'Shipped'].includes(order.status)) {
    query.set('toast', 'archive_error');
    redirect(`/admin/orders?${query.toString()}`);
  }

  const archiveResult = await supabase.from('orders').update({ archived_at: new Date().toISOString() }).eq('id', id).is('archived_at', null).select('id');
  query.set('toast', archiveResult.error || !archiveResult.data?.length ? 'archive_error' : 'archive_success');
  redirect(`/admin/orders?${query.toString()}`);
}

async function archiveSelectedOrders(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const statusFilter = String(formData.get('statusFilter') ?? '');
  const ids = formData.getAll('order_id').map(String).filter(Boolean);
  const query = new URLSearchParams();
  if (statusFilter) query.set('status', statusFilter);

  if (!ids.length) {
    query.set('toast', 'archive_error');
    redirect(`/admin/orders?${query.toString()}`);
  }

  const archiveResult = await supabase
    .from('orders')
    .update({ archived_at: new Date().toISOString() })
    .in('id', ids)
    .in('status', ['Processing', 'Shipped'])
    .is('archived_at', null)
    .select('id');

  query.set('toast', archiveResult.error || !archiveResult.data?.length ? 'archive_error' : 'archive_success');
  redirect(`/admin/orders?${query.toString()}`);
}

async function deleteOrder(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const id = String(formData.get('id') ?? '');
  const statusFilter = String(formData.get('statusFilter') ?? '');
  const query = new URLSearchParams();
  if (statusFilter) query.set('status', statusFilter);

  if (!id) {
    query.set('toast', 'delete_error');
    redirect(`/admin/orders?${query.toString()}`);
  }

  const { count: recurringCount } = await supabase
    .from('recurring_orders')
    .select('id', { count: 'exact', head: true })
    .eq('source_order_id', id);

  const deleteResult = await supabase.from('orders').delete().eq('id', id).select('id');
  query.set(
    'toast',
    deleteResult.error || !deleteResult.data?.length
      ? 'delete_error'
      : (recurringCount ?? 0) > 0
        ? 'delete_success_with_recurring'
        : 'delete_success'
  );
  redirect(`/admin/orders?${query.toString()}`);
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const status = typeof searchParams.status === 'string' ? searchParams.status : '';
  const toast = typeof searchParams.toast === 'string' ? searchParams.toast : '';
  let query = supabase.from('orders').select('id,status,created_at,profiles(email),centers(name)').is('archived_at', null).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data: orders } = await query.limit(100);

  const orderIds = (orders ?? []).map((order: any) => order.id);
  const { data: items } = orderIds.length
    ? await supabase.from('order_items').select('order_id,product_id,product_name_snapshot,qty').in('order_id', orderIds)
    : { data: [] as any[] };

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const productNameById = new Map((products ?? []).map((p: any) => [p.id, p.name]));
  const { data: recurringOrders } = orderIds.length
    ? await supabase.from('recurring_orders').select('source_order_id').in('source_order_id', orderIds)
    : { data: [] as any[] };
  const recurringSourceOrderIds = new Set((recurringOrders ?? []).map((order: any) => order.source_order_id).filter(Boolean));

  const itemLabelsByOrderId = new Map<string, string[]>();
  for (const item of items ?? []) {
    const mappedName = productNameById.get(item.product_id);
    const label = `${mappedName || item.product_name_snapshot || 'Unknown product'} x ${item.qty}`;
    const existing = itemLabelsByOrderId.get(item.order_id) ?? [];
    existing.push(label);
    itemLabelsByOrderId.set(item.order_id, existing);
  }

  return (
    <div className="space-y-6">
      {toast === 'status_updated' ? <StatusToast message="Order status updated." tone="success" /> : null}
      {toast === 'status_error' ? <StatusToast message="Order status update failed." tone="error" /> : null}
      {toast === 'archive_success' ? <StatusToast message="Order archive updated." tone="success" /> : null}
      {toast === 'archive_error' ? <StatusToast message="Unable to archive the selected order(s)." tone="error" /> : null}
      {toast === 'delete_success' ? <StatusToast message="Order deleted." tone="success" /> : null}
      {toast === 'delete_success_with_recurring' ? <StatusToast message="Order and linked recurring schedule deleted." tone="success" /> : null}
      {toast === 'delete_error' ? <StatusToast message="Unable to delete this order." tone="error" /> : null}
      <section className="panel">
        <span className="eyebrow">Order Queue</span>
        <h1 className="page-title mt-4">Manage wholesale orders</h1>
        <p className="page-subtitle mt-3">Filter by status, review the latest requests, and update fulfillment without losing context.</p>
      </section>
      <form className="card flex flex-col gap-3 md:flex-row">
        <select className="input" name="status" defaultValue={status}>
          <option value="">All statuses</option>
          <option>New</option><option>Processing</option><option>Shipped</option>
        </select>
        <button className="btn-primary w-full md:w-auto">Filter</button>
        <a className="btn-secondary w-full md:w-auto" href="/api/export/orders">Export CSV</a>
      </form>
      <form id="archive-orders-form" action={archiveSelectedOrders} className="card flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <input type="hidden" name="statusFilter" value={status} />
        <div>
          <p className="text-sm font-semibold text-slate-950">Archive completed orders</p>
          <p className="mt-1 text-sm text-slate-500">Select `Processing` or `Shipped` orders, then archive them in one batch.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <AdminOrderBulkControls />
          <button className="btn-primary w-full sm:w-auto" type="submit">Archive selected</button>
        </div>
      </form>
      {orders?.map((order: any) => (
        <div key={order.id} className="card flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 items-start gap-4">
            <input
              form="archive-orders-form"
              data-archivable-order-checkbox
              className="mt-1 h-4 w-4 rounded border-slate-300"
              disabled={!['Processing', 'Shipped'].includes(order.status)}
              name="order_id"
              type="checkbox"
              value={order.id}
            />
            <Link href={`/admin/orders/${order.id}`} className="block flex-1 min-w-0">
              <p className="break-words text-lg font-semibold text-slate-950">{(itemLabelsByOrderId.get(order.id) ?? ['Unknown product']).join(', ')}</p>
              <p className="mt-2 text-sm font-medium text-slate-700">{order.centers?.name || 'Unknown center'}</p>
              <p className="mt-1 break-all text-sm text-slate-500">{order.profiles?.email || 'No login email on file'}</p>
              <p className="mt-1 text-sm text-slate-500">Placed {formatOrderTimestamp(order.created_at)}</p>
            </Link>
          </div>
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:flex-wrap md:items-center md:justify-end">
            <form action={updateStatus} className="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="statusFilter" value={status} />
              <select className="input w-full sm:min-w-[11rem]" name="status" defaultValue={order.status}>
                <option>New</option>
                <option>Processing</option>
                <option>Shipped</option>
              </select>
              <button className="btn-primary w-full sm:w-auto" type="submit">Save</button>
            </form>
            {['Processing', 'Shipped'].includes(order.status) ? (
              <form action={archiveOrder} className="w-full md:w-auto">
                <input type="hidden" name="id" value={order.id} />
                <input type="hidden" name="statusFilter" value={status} />
                <button className="btn-secondary w-full md:w-auto" type="submit">Archive</button>
              </form>
            ) : null}
            <form action={deleteOrder} className="w-full md:w-auto">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="statusFilter" value={status} />
              <ConfirmSubmitButton
                className="w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70 md:w-auto"
                confirmMessage={
                  recurringSourceOrderIds.has(order.id)
                    ? 'Delete this order permanently? This will also delete the recurring schedule created from it. This action cannot be undone.'
                    : 'Delete this order permanently? This action cannot be undone.'
                }
                label="Delete"
                pendingLabel="Deleting..."
              />
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}

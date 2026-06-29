import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AdminOrderBulkControls } from '@/components/admin-order-bulk-controls';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import { OrderStatusBadge } from '@/components/order-status';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const ORDER_STATUSES = ['New', 'Processing', 'Shipped'] as const;

type OrderStatus = (typeof ORDER_STATUSES)[number];

function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.includes(value as OrderStatus);
}

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function buildOrdersHref({ status, q, toast }: { status?: string; q?: string; toast?: string }) {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (q) query.set('q', q);
  if (toast) query.set('toast', toast);
  const nextSearch = query.toString();
  return `/admin/orders${nextSearch ? `?${nextSearch}` : ''}`;
}

function ordersToastHref(statusFilter: string, toast: string, qFilter = '') {
  return buildOrdersHref({ status: statusFilter, q: qFilter, toast });
}

function nextActionForStatus(status: string | null | undefined) {
  if (status === 'New') return { label: 'Start processing', helper: 'Waiting for review' };
  if (status === 'Processing') return { label: 'Ship order', helper: 'Shipping COGS needed' };
  if (status === 'Shipped') return { label: 'View order', helper: 'Completed' };
  return { label: 'Open order', helper: 'Needs review' };
}

async function updateStatus(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const status = String(formData.get('status'));
  const statusFilter = String(formData.get('statusFilter') ?? '');
  const qFilter = String(formData.get('qFilter') ?? '');

  await requireAdminWriteAccess(ordersToastHref(statusFilter, 'admin_write_denied', qFilter), 'orders');

  const supabase = await createClient();
  if (status === 'Shipped') {
    redirect(ordersToastHref(statusFilter, 'ship_on_detail_required', qFilter));
  }
  const orderUpdateResult = await supabase.from('orders').update({ status }).eq('id', id).select('id');
  redirect(ordersToastHref(statusFilter, orderUpdateResult.error || !orderUpdateResult.data?.length ? 'status_error' : 'status_updated', qFilter));
}

async function archiveOrder(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  const statusFilter = String(formData.get('statusFilter') ?? '');
  const qFilter = String(formData.get('qFilter') ?? '');
  await requireAdminWriteAccess(ordersToastHref(statusFilter, 'admin_write_denied', qFilter), 'orders');

  const supabase = await createClient();
  if (!id) redirect(ordersToastHref(statusFilter, 'archive_error', qFilter));

  const { data: order } = await supabase.from('orders').select('id,status').eq('id', id).single();

  if (!order || !['Processing', 'Shipped'].includes(order.status)) {
    redirect(ordersToastHref(statusFilter, 'archive_error', qFilter));
  }

  const archiveResult = await supabase.from('orders').update({ archived_at: new Date().toISOString() }).eq('id', id).is('archived_at', null).select('id');
  redirect(ordersToastHref(statusFilter, archiveResult.error || !archiveResult.data?.length ? 'archive_error' : 'archive_success', qFilter));
}

async function archiveSelectedOrders(formData: FormData) {
  'use server';
  const statusFilter = String(formData.get('statusFilter') ?? '');
  const qFilter = String(formData.get('qFilter') ?? '');
  const ids = formData.getAll('order_id').map(String).filter(Boolean);
  await requireAdminWriteAccess(ordersToastHref(statusFilter, 'admin_write_denied', qFilter), 'orders');

  const supabase = await createClient();

  if (!ids.length) {
    redirect(ordersToastHref(statusFilter, 'archive_error', qFilter));
  }

  const archiveResult = await supabase
    .from('orders')
    .update({ archived_at: new Date().toISOString() })
    .in('id', ids)
    .in('status', ['Processing', 'Shipped'])
    .is('archived_at', null)
    .select('id');

  redirect(ordersToastHref(statusFilter, archiveResult.error || !archiveResult.data?.length ? 'archive_error' : 'archive_success', qFilter));
}

async function deleteOrder(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  const statusFilter = String(formData.get('statusFilter') ?? '');
  const qFilter = String(formData.get('qFilter') ?? '');
  await requireAdminWriteAccess(ordersToastHref(statusFilter, 'admin_write_denied', qFilter), 'orders');

  const supabase = await createClient();

  if (!id) {
    redirect(ordersToastHref(statusFilter, 'delete_error', qFilter));
  }

  const { count: recurringCount } = await supabase
    .from('recurring_orders')
    .select('id', { count: 'exact', head: true })
    .eq('source_order_id', id);

  const deleteResult = await supabase.from('orders').delete().eq('id', id).select('id');
  const toast =
    deleteResult.error || !deleteResult.data?.length
      ? 'delete_error'
      : (recurringCount ?? 0) > 0
        ? 'delete_success_with_recurring'
        : 'delete_success';
  redirect(ordersToastHref(statusFilter, toast, qFilter));
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const statusParam = typeof searchParams.status === 'string' ? searchParams.status : '';
  const status = isOrderStatus(statusParam) ? statusParam : '';
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim() : '';
  const toast = typeof searchParams.toast === 'string' ? searchParams.toast : '';
  let query = supabase.from('orders').select('id,status,created_at,subtotal_cents,profiles(email),centers(name)').is('archived_at', null).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);

  const [ordersResult, ...statusCountResults] = await Promise.all([
    query.limit(200),
    ...ORDER_STATUSES.map((orderStatus) =>
      supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', orderStatus).is('archived_at', null)
    ),
  ]);
  const baseOrders = ordersResult.data ?? [];
  const statusCounts = Object.fromEntries(ORDER_STATUSES.map((orderStatus, index) => [orderStatus, statusCountResults[index].count ?? 0])) as Record<OrderStatus, number>;

  const orderIds = baseOrders.map((order: any) => order.id);
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

  const normalizedSearch = q.toLowerCase();
  const orders = normalizedSearch
    ? baseOrders.filter((order: any) => {
        const orderText = [
          order.id,
          order.status,
          order.centers?.name,
          order.profiles?.email,
          ...(itemLabelsByOrderId.get(order.id) ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return orderText.includes(normalizedSearch);
      })
    : baseOrders;
  const totalActiveOrders = ORDER_STATUSES.reduce((sum, orderStatus) => sum + statusCounts[orderStatus], 0);
  const statusTabs = [
    { value: '', label: 'All', count: totalActiveOrders },
    ...ORDER_STATUSES.map((orderStatus) => ({ value: orderStatus, label: orderStatus, count: statusCounts[orderStatus] })),
  ];
  const activeFilters = [status ? `Status: ${status}` : null, q ? `Search: ${q}` : null].filter(Boolean);

  return (
    <div className="space-y-6">
      {toast === 'status_updated' ? <StatusToast message="Order status updated." tone="success" /> : null}
      {toast === 'status_error' ? <StatusToast message="Order status update failed." tone="error" /> : null}
      {toast === 'ship_on_detail_required' ? <StatusToast message="Open the order detail page to enter shipping cost before marking it shipped." tone="error" /> : null}
      {toast === 'archive_success' ? <StatusToast message="Order archive updated." tone="success" /> : null}
      {toast === 'archive_error' ? <StatusToast message="Unable to archive the selected order(s)." tone="error" /> : null}
      {toast === 'delete_success' ? <StatusToast message="Order deleted." tone="success" /> : null}
      {toast === 'delete_success_with_recurring' ? <StatusToast message="Order and linked recurring schedule deleted." tone="success" /> : null}
      {toast === 'delete_error' ? <StatusToast message="Unable to delete this order." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only superadmins can change admin data." tone="error" /> : null}
      <section className="panel space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="eyebrow">Order Queue</span>
            <h1 className="page-title mt-4">Work the next order.</h1>
            <p className="page-subtitle mt-3">Search, filter, and move each order from one obvious next action.</p>
          </div>
          <a className="btn-secondary w-full sm:w-auto" href="/api/export/orders">Export CSV</a>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-sky-100 bg-sky-50/80 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-sky-700">New</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{statusCounts.New}</p>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-700">Processing</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{statusCounts.Processing}</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Shipped</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{statusCounts.Shipped}</p>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <div className="grid gap-2 sm:grid-cols-4">
          {statusTabs.map((tab) => (
            <Link
              key={tab.label}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                status === tab.value
                  ? 'border-teal-200 bg-teal-50 text-teal-800'
                  : 'border-slate-200 bg-white/70 text-slate-700 hover:border-teal-100 hover:bg-white'
              }`}
              href={buildOrdersHref({ status: tab.value, q })}
            >
              <span className="flex items-center justify-between gap-3">
                {tab.label}
                <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs text-slate-600">{tab.count}</span>
              </span>
            </Link>
          ))}
        </div>
        <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input className="input" name="q" defaultValue={q} placeholder="Search customer, email, product, or order id" />
          <button className="btn-primary w-full lg:w-auto" type="submit">Search orders</button>
          {activeFilters.length ? <Link className="btn-secondary w-full lg:w-auto" href="/admin/orders">Clear filters</Link> : null}
        </form>
        {activeFilters.length ? (
          <div className="flex flex-wrap gap-2 text-sm text-slate-600">
            {activeFilters.map((filter) => (
              <span key={filter} className="rounded-full border border-slate-200 bg-white/75 px-3 py-1">{filter}</span>
            ))}
          </div>
        ) : null}
      </section>

      <form id="archive-orders-form" action={archiveSelectedOrders} className="card grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <input type="hidden" name="statusFilter" value={status} />
        <input type="hidden" name="qFilter" value={q} />
        <div>
          <p className="text-sm font-semibold text-slate-950">Bulk archive</p>
          <p className="mt-1 text-sm text-slate-500">Select completed or in-process rows, then archive them together.</p>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          <AdminOrderBulkControls />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Archive selected" pendingLabel="Archiving..." />
        </div>
      </form>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">{orders.length.toLocaleString()} orders shown</h2>
          <p className="text-sm text-slate-500">Each row shows the next best action first.</p>
        </div>
        {orders.length ? (
          orders.map((order: any) => {
            const action = nextActionForStatus(order.status);
            const labels = itemLabelsByOrderId.get(order.id) ?? ['Unknown product'];
            const primaryAction =
              order.status === 'New' ? (
                <form action={updateStatus} className="w-full md:w-auto">
                  <input type="hidden" name="id" value={order.id} />
                  <input type="hidden" name="status" value="Processing" />
                  <input type="hidden" name="statusFilter" value={status} />
                  <input type="hidden" name="qFilter" value={q} />
                  <PendingSubmitButton className="btn-primary w-full md:w-auto" label={action.label} pendingLabel="Starting..." />
                </form>
              ) : order.status === 'Processing' ? (
                <Link className="btn-primary w-full md:w-auto" href={`/admin/orders/${order.id}`}>{action.label}</Link>
              ) : (
                <Link className="btn-secondary w-full md:w-auto" href={`/admin/orders/${order.id}`}>{action.label}</Link>
              );

            return (
              <div key={order.id} className="card grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
                  <input
                    form="archive-orders-form"
                    data-archivable-order-checkbox
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                    disabled={!['Processing', 'Shipped'].includes(order.status)}
                    name="order_id"
                    type="checkbox"
                    value={order.id}
                  />
                  <Link href={`/admin/orders/${order.id}`} className="block min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <OrderStatusBadge status={order.status} />
                      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{action.helper}</span>
                    </div>
                    <p className="mt-3 break-words text-base font-semibold text-slate-950">{labels.join(', ')}</p>
                    <div className="mt-3 grid gap-1 text-sm text-slate-600 md:grid-cols-3">
                      <p className="font-medium text-slate-700">{order.centers?.name || 'Unknown center'}</p>
                      <p className="break-all">{order.profiles?.email || 'No login email on file'}</p>
                      <p>Placed {formatOrderTimestamp(order.created_at)}</p>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{usd(order.subtotal_cents ?? 0)}</p>
                  </Link>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
                  {primaryAction}
                  <details className="relative w-full md:w-auto">
                    <summary className="btn-secondary w-full cursor-pointer list-none md:w-auto">More</summary>
                    <div className="mt-2 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg md:absolute md:right-0 md:z-10 md:w-72">
                      <Link className="btn-secondary w-full" href={`/admin/orders/${order.id}`}>Open details</Link>
                      {order.status !== 'Shipped' ? (
                        <form action={updateStatus} className="grid gap-2">
                          <input type="hidden" name="id" value={order.id} />
                          <input type="hidden" name="statusFilter" value={status} />
                          <input type="hidden" name="qFilter" value={q} />
                          <select className="input" name="status" defaultValue={order.status}>
                            <option>New</option>
                            <option>Processing</option>
                          </select>
                          <PendingSubmitButton className="btn-secondary w-full" label="Save status" pendingLabel="Saving..." />
                        </form>
                      ) : null}
                      {['Processing', 'Shipped'].includes(order.status) ? (
                        <form action={archiveOrder}>
                          <input type="hidden" name="id" value={order.id} />
                          <input type="hidden" name="statusFilter" value={status} />
                          <input type="hidden" name="qFilter" value={q} />
                          <PendingSubmitButton className="btn-secondary w-full" label="Archive" pendingLabel="Archiving..." />
                        </form>
                      ) : null}
                      <form action={deleteOrder}>
                        <input type="hidden" name="id" value={order.id} />
                        <input type="hidden" name="statusFilter" value={status} />
                        <input type="hidden" name="qFilter" value={q} />
                        <ConfirmSubmitButton
                          className="w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
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
                  </details>
                </div>
              </div>
            );
          })
        ) : (
          <div className="card text-center">
            <p className="text-base font-semibold text-slate-950">No orders match these filters.</p>
            <p className="mt-2 text-sm text-slate-500">Clear filters or try a broader search.</p>
          </div>
        )}
      </section>
    </div>
  );
}

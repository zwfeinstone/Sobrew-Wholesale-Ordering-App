import { Archive, Download, ClipboardList, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { AdminOrderWorkspace, type AdminOrderRow } from '@/components/admin-order-workspace';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import { fetchAllByIds } from '@/lib/supabase/pagination';
import { formatAppDateTime } from '@/lib/utils';

function relatedOne<T>(value: T | T[] | null | undefined): T | null { return Array.isArray(value) ? value[0] ?? null : value ?? null; }
const messages: Record<string, { message: string; tone: 'success' | 'error' }> = {
  status_updated: { message: 'Order status updated.', tone: 'success' },
  status_error: { message: 'Order status could not be updated. Try again.', tone: 'error' },
  archive_success: { message: 'Selected orders archived.', tone: 'success' },
  archive_error: { message: 'Orders could not be archived. Only processing or shipped orders can be archived.', tone: 'error' },
  archive_denied: { message: 'Only superadmins can archive orders.', tone: 'error' },
  trash_error: { message: 'The order could not be moved. It has not been removed; try again.', tone: 'error' },
  trash_reason_required: { message: 'Enter a reason before removing an order.', tone: 'error' },
  admin_write_denied: { message: 'You do not have permission to edit orders.', tone: 'error' },
  ship_on_detail_required: { message: 'Open the order to complete fulfillment details.', tone: 'error' },
};

export default async function AdminOrdersPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  const current = await requireAdminSectionView('orders');
  const supabase = await createClient();
  const statuses = ['New', 'Processing', 'Shipped'];
  const toast = typeof searchParams.toast === 'string' ? searchParams.toast : '';
  const [ordersResult, ...countResults] = await Promise.all([
    supabase.from('orders').select('id,status,order_kind,shipping_company,shipping_name,created_at,subtotal_cents,notes,profiles(email),centers(name)').is('archived_at', null).order('created_at', { ascending: false }).limit(1000),
    ...statuses.map((status) => supabase.from('orders').select('id', { count: 'exact', head: true }).is('archived_at', null).eq('status', status)),
  ]);
  if (ordersResult.error || countResults.some((result) => result.error)) throw new Error('Order queue could not be loaded.');
  const baseOrders = ordersResult.data ?? [];
  const ids = baseOrders.map((order) => order.id);
  const [itemsResult, recurringResult] = ids.length ? await Promise.all([
    fetchAllByIds(ids, (batch, from, to) => supabase.from('order_items').select('order_id,product_name_snapshot,qty,products(name)').in('order_id', batch).order('id').range(from, to)),
    fetchAllByIds(ids, (batch, from, to) => supabase.from('recurring_orders').select('source_order_id').in('source_order_id', batch).order('id').range(from, to)),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (itemsResult.error || recurringResult.error) throw new Error('Order details could not be loaded.');
  const itemLabels = new Map<string, string[]>();
  for (const item of itemsResult.data ?? []) {
    if (!item.order_id) continue;
    const label = `${item.product_name_snapshot || relatedOne(item.products)?.name || 'Unavailable product'} x ${item.qty}`;
    itemLabels.set(item.order_id, [...(itemLabels.get(item.order_id) ?? []), label]);
  }
  const recurring = new Set((recurringResult.data ?? []).map((row) => row.source_order_id));
  const counts = Object.fromEntries(statuses.map((status, index) => [status, countResults[index].count ?? 0]));
  const rows: AdminOrderRow[] = baseOrders.map((order) => ({
    id: order.id, customerName: relatedOne(order.centers)?.name || order.shipping_company || order.shipping_name || 'Unknown customer',
    email: relatedOne(order.profiles)?.email || '', status: order.status || 'New', kind: order.order_kind,
    createdAt: order.created_at || '', placedLabel: formatAppDateTime(order.created_at), subtotal: order.subtotal_cents,
    notes: order.notes?.trim() || '', items: itemLabels.get(order.id) ?? ['No items'], hasRecurring: recurring.has(order.id),
  }));
  const message = messages[toast];
  const removed = ['order_trashed', 'delete_success', 'delete_success_with_recurring'].includes(toast);
  return <div className="order-workspace">
    {message ? <StatusToast {...message} /> : null}
    {removed ? <StatusToast message="Order moved to Recently deleted. Its notes and history are recoverable." tone="success" actionHref="/admin/orders/trash" actionLabel="View & restore" persistent /> : null}
    <header className="workspace-page-heading"><div><h1 className="page-title">Orders</h1><p>{counts.New + counts.Processing} open orders</p></div><div className="workspace-heading-actions">
      <a className="icon-button" href="/api/export/orders" aria-label="Export orders as CSV" title="Export orders as CSV"><Download aria-hidden="true" /></a>
      {current.access.archived_orders.canView ? <Link className="btn-secondary" href="/admin/archived-orders" prefetch={false}><Archive aria-hidden="true" /><span>Archived</span></Link> : null}
      {current.access.orders.canEdit ? <Link className="icon-button" href="/admin/orders/trash" aria-label="Recently deleted orders" title="Recently deleted orders" prefetch={false}><Trash2 aria-hidden="true" /></Link> : null}
      {current.access.order_form.canView ? <Link className="btn-primary" href="/admin/order-form" prefetch={false}><ClipboardList aria-hidden="true" />Order form</Link> : null}
    </div></header>
    {baseOrders.length >= 1000 ? <p className="workspace-notice" role="status">Showing the latest 1,000 active orders. Export orders for the complete list.</p> : null}
    <AdminOrderWorkspace orders={rows} counts={counts} canArchive={current.isOwner} canEdit={current.access.orders.canEdit} initialQuery={typeof searchParams.q === 'string' ? searchParams.q : ''} initialStatus={typeof searchParams.status === 'string' && statuses.includes(searchParams.status) ? searchParams.status : ''} />
  </div>;
}

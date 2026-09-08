import Link from 'next/link';
import { ArrowLeft, RotateCcw, StickyNote } from 'lucide-react';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import { formatAppDateTime, usd } from '@/lib/utils';
import { restoreOrderFromTrash } from '@/app/admin/orders/actions';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';

export default async function OrderTrashPage(
  props: { searchParams: Promise<Record<string, string | string[] | undefined>> }
) {
  const searchParams = await props.searchParams;
  await requireAdminSectionEdit('orders');
  const supabase = await createClient();
  const { data: rows, error } = await supabase.from('order_trash').select('id,order_id,customer_name,deleted_at,deleted_by_name,reason,order_snapshot,items_snapshot,schedules_snapshot').is('restored_at', null).order('deleted_at', { ascending: false }).limit(200);
  if (error) throw new Error('Recently deleted orders could not be loaded.');
  const q = typeof searchParams.q === 'string' ? searchParams.q.trim().toLowerCase() : '';
  const visible = (rows ?? []).filter((row) => [row.customer_name, row.order_id, row.reason, row.order_snapshot?.notes].join(' ').toLowerCase().includes(q));
  return <div>
    <Link className="workspace-back" href="/admin/orders"><ArrowLeft aria-hidden="true" />Orders</Link>
    <header className="workspace-page-heading"><div><h1 className="page-title">Recently deleted</h1><p>Restore orders with their original items, notes, and history.</p></div></header>
    {searchParams.toast === 'restore_error' ? <StatusToast tone="error" message="The order could not be restored. A linked customer, product, or inventory record may no longer exist. The recovery copy is still saved." persistent /> : null}
    {searchParams.toast === 'restore_inventory_required' ? <StatusToast tone="error" message="This shipment needs its original inventory lots and enough stock before it can be restored. The recovery copy is still saved." persistent /> : null}
    <form className="workspace-toolbar"><label className="workspace-search"><input aria-label="Search recently deleted orders" name="q" type="search" placeholder="Search customer, order or notes" defaultValue={q} /></label><button className="btn-secondary" type="submit">Search</button></form>
    <p className="workspace-notice">Restored recurring schedules stay paused until you resume them. Earlier permanent deletions made before recovery was enabled cannot be reconstructed here.</p>
    {visible.map((row) => <article className="trash-order-row" key={row.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><h2>{row.customer_name}</h2><span className="workspace-badge">{row.order_snapshot?.status}</span><strong>{usd(Number(row.order_snapshot?.subtotal_cents) || 0)}</strong></div><p className="mt-2 text-xs text-slate-500">#{row.order_id.slice(0, 8)} / Removed {formatAppDateTime(row.deleted_at)}{row.deleted_by_name ? ` by ${row.deleted_by_name}` : ''}</p><p className="mt-3 text-sm"><strong>Reason:</strong> {row.reason}</p>{row.order_snapshot?.notes ? <p className="order-row-note mt-3"><StickyNote aria-hidden="true" /><span>{String(row.order_snapshot.notes)}</span></p> : null}<details className="mt-3"><summary className="workspace-text-link">Items & delivery details</summary><div className="space-y-2 py-3 text-sm">{(row.items_snapshot as Array<{ id: string; product_name_snapshot: string; qty: number }>).map((item) => <p key={item.id}>{item.product_name_snapshot || 'Product'} x {item.qty}</p>)}<p className="text-slate-500">{[row.order_snapshot?.shipping_address1, row.order_snapshot?.shipping_address2, row.order_snapshot?.shipping_city, row.order_snapshot?.shipping_state, row.order_snapshot?.shipping_zip].filter(Boolean).join(', ') || 'No address saved'}</p>{Array.isArray(row.schedules_snapshot) && row.schedules_snapshot.length > 0 ? <p>{row.schedules_snapshot.length} linked recurring schedule(s) paused.</p> : null}</div></details></div><form action={restoreOrderFromTrash}><input type="hidden" name="trash_id" value={row.id} /><span className="inline-flex items-center gap-2"><RotateCcw size={16} aria-hidden="true" /><PendingSubmitButton className="btn-primary" label="Restore order" pendingLabel="Restoring..." /></span></form></article>)}
    {!visible.length ? <div className="workspace-empty"><h2>{q ? 'No matching orders' : 'No recently deleted orders'}</h2><p>{q ? 'Try a different customer name or note.' : 'Orders removed from now on will be recoverable here.'}</p></div> : null}
    {(rows ?? []).length >= 200 ? <p className="workspace-table-footer">Showing the 200 most recent recovery records.</p> : null}
  </div>;
}

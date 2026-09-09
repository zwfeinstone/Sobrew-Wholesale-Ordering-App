'use client';

import { Archive, ArrowUpRight, ChevronDown, Ellipsis, Search, StickyNote, X } from 'lucide-react';
import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { archiveSelectedOrders } from '@/app/admin/orders/actions';
import { OrderStatusBadge } from '@/components/order-status';
import { OrderTrashDialog } from '@/components/order-trash-dialog';
import PendingSubmitButton from '@/components/pending-submit-button';
import { nextOrderAction } from '@/lib/order-workflow';
import { usd } from '@/lib/utils';

export type AdminOrderRow = {
  id: string; customerName: string; email: string; status: string; kind: string; createdAt: string;
  placedLabel: string; subtotal: number; notes: string; items: string[]; hasRecurring: boolean;
};

export function AdminOrderWorkspace({ orders, counts, canArchive, canEdit, initialQuery = '', initialStatus = '' }: {
  orders: AdminOrderRow[]; counts: Record<string, number>; canArchive: boolean; canEdit: boolean; initialQuery?: string; initialStatus?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('newest');
  const [notesOnly, setNotesOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const deferredQuery = useDeferredValue(query.toLowerCase().trim());
  const rows = useMemo(() => orders.filter((order) => (!status || order.status === status)
    && (kind === 'all' || (kind === 'sample' ? order.kind === 'prospecting_sample' : order.kind !== 'prospecting_sample'))
    && (!notesOnly || order.notes)
    && [order.id, order.customerName, order.email, order.notes, ...order.items].join(' ').toLowerCase().includes(deferredQuery))
    .sort((a, b) => sort === 'value' ? b.subtotal - a.subtotal : (sort === 'oldest' ? 1 : -1) * a.createdAt.localeCompare(b.createdAt)), [orders, status, kind, notesOnly, deferredQuery, sort]);
  const archivable = rows.filter((row) => ['Processing', 'Shipped'].includes(row.status)).map((row) => row.id);
  const notesCount = orders.filter((order) => order.notes).length;
  const setChecked = (id: string, checked: boolean) => setSelected((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  const clearFilters = () => { setQuery(''); setStatus(''); setKind('all'); setNotesOnly(false); };

  return <div>
    <div className="workspace-tabs" role="tablist" aria-label="Order status">{['', 'New', 'Processing', 'Shipped'].map((value) => <button key={value} type="button" role="tab" aria-selected={status === value} className={status === value ? 'is-active' : ''} onClick={() => setStatus(value)}>{value || 'All'}<span>{value ? counts[value] ?? 0 : Object.values(counts).reduce((sum, count) => sum + count, 0)}</span></button>)}</div>
    <div className="workspace-toolbar">
      <label className="workspace-search"><Search aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, product or order" aria-label="Search orders" /></label>
      <select className="input workspace-select" value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Order type"><option value="all">All orders</option><option value="wholesale">Wholesale</option><option value="sample">Samples</option></select>
      <select className="input workspace-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort orders"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="value">Highest value</option></select>
      {query || status || kind !== 'all' || notesOnly ? <button type="button" className="icon-button" title="Clear filters" aria-label="Clear filters" onClick={clearFilters}><X aria-hidden="true" /></button> : null}
      <span className="workspace-result-count" role="status">{rows.length} orders</span>
    </div>
    {notesCount > 0 ? <div className="workspace-notice"><StickyNote aria-hidden="true" /><p><strong>Delivery instructions</strong><span> {notesCount} order{notesCount === 1 ? '' : 's'} with notes</span></p><button type="button" className="workspace-text-link" onClick={() => setNotesOnly(!notesOnly)}>{notesOnly ? 'Show all' : 'Review notes'}</button></div> : null}
    {canArchive ? <form action={archiveSelectedOrders} className="order-bulk-bar" hidden={!selected.length}>{selected.map((id) => <input key={id} type="hidden" name="order_id" value={id} />)}<strong>{selected.length} selected</strong><PendingSubmitButton className="btn-secondary" label="Archive selected" pendingLabel="Archiving..." /><button type="button" className="workspace-text-link" onClick={() => setSelected([])}>Clear</button></form> : null}
    <div className="order-table" role="table" aria-label="Orders">
      <div className={`order-table-heading${canArchive ? ' has-selection' : ''}`} role="row">
        {canArchive ? <div role="columnheader"><input type="checkbox" aria-label="Select all archivable orders in this view" disabled={!archivable.length} checked={archivable.length > 0 && archivable.every((id) => selected.includes(id))} onChange={(event) => setSelected(event.target.checked ? archivable : [])} /></div> : null}
        <div role="columnheader">Customer / Order</div><div role="columnheader" className="order-products-column">Products</div><div role="columnheader">Total</div><div role="columnheader">Status</div><div role="columnheader" className="order-date-column">Placed</div><div role="columnheader" className="text-right">Actions</div>
      </div>
      {rows.map((order) => <div key={order.id} role="row" className={`order-table-row${canArchive ? ' has-selection' : ''}${order.notes ? ' has-note' : ''}`}>
        {canArchive ? <div role="cell" className="order-checkbox"><input type="checkbox" disabled={!['Processing', 'Shipped'].includes(order.status)} checked={selected.includes(order.id)} onChange={(event) => setChecked(order.id, event.target.checked)} aria-label={`Select ${order.customerName} order ${order.id.slice(0, 8)}`} /></div> : null}
        <div role="cell" className="order-customer-column"><Link href={`/admin/orders/${order.id}`} prefetch={false} className="order-customer-name">{order.customerName}</Link><p className="order-row-meta">#{order.id.slice(0, 8)} {order.kind === 'prospecting_sample' ? <span className="workspace-badge">Sample</span> : null}</p>{order.notes ? <p className="order-row-note"><StickyNote aria-hidden="true" /><span>{order.notes}</span></p> : null}</div>
        <div role="cell" className="order-products-column">
          {order.items.slice(0, 2).map((label, index) => <p key={index}>{label}</p>)}
          {order.items.length > 2 ? <details className="order-products-disclosure">
            <summary className="workspace-text-link order-products-toggle">
              <span className="order-products-expand">+{order.items.length - 2} more</span>
              <span className="order-products-collapse">Show less</span>
              <span className="sr-only"> products for {order.customerName} order {order.id.slice(0, 8)}</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <div className="order-products-remaining">{order.items.slice(2).map((label, index) => <p key={index}>{label}</p>)}</div>
          </details> : null}
        </div>
        <div role="cell" className="order-total">{usd(order.subtotal)}</div><div role="cell" className="order-status-cell"><OrderStatusBadge status={order.status} /></div><div role="cell" className="order-date-column">{order.placedLabel}</div>
        <div role="cell" className="order-row-actions"><Link className="btn-secondary" href={`/admin/orders/${order.id}`} prefetch={false}>{nextOrderAction(order.status)}<ArrowUpRight aria-hidden="true" /></Link>{canEdit ? <details className="workspace-menu"><summary className="icon-button" aria-label={`More actions for ${order.customerName}`} title="More actions"><Ellipsis aria-hidden="true" /></summary><div className="workspace-menu-items"><OrderTrashDialog orderId={order.id} customerName={order.customerName} hasRecurring={order.hasRecurring} className="workspace-menu-action" />{canArchive && ['Processing', 'Shipped'].includes(order.status) ? <form action={archiveSelectedOrders}><input type="hidden" name="order_id" value={order.id} /><button type="submit" className="workspace-menu-action"><Archive aria-hidden="true" />Archive</button></form> : null}</div></details> : null}</div>
      </div>)}
    </div>
    {!rows.length ? <div className="workspace-empty"><h2>{query || status || kind !== 'all' || notesOnly ? 'No orders match this view' : 'No active orders'}</h2><p>{query || status || kind !== 'all' || notesOnly ? 'Try another filter or search.' : 'New orders will appear here.'}</p>{query || status || kind !== 'all' || notesOnly ? <button type="button" className="btn-secondary" onClick={clearFilters}>Clear filters</button> : null}</div> : null}
    <p className="workspace-table-footer">Showing {rows.length} of {orders.length} loaded orders</p>
  </div>;
}

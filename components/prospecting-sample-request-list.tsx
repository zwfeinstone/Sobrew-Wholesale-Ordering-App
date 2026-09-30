import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatDateTime, paginationRange, totalPageCount } from '@/lib/prospecting';

type RequestRow = {
  id: string;
  lead_id: string;
  status: 'pending' | 'legacy_review' | 'order_created';
  order_id: string | null;
  created_at: string;
  details: Record<string, unknown> | null;
  prospecting_leads: { company_name: string; stage: string; archived_at: string | null };
  prospecting_contacts: { full_name: string | null; email: string | null } | null;
};

// Rendered only after the manager page has enforced its existing owner access.
export default async function ProspectingSampleRequestList({ page, pageSize, history, canEdit }: { page: number; pageSize: number; history: boolean; canEdit: boolean }) {
  const { from, to } = paginationRange(page, pageSize);
  let query = supabaseAdmin.from('prospecting_sample_requests')
    .select('id,lead_id,status,order_id,created_at,details,prospecting_leads!inner(company_name,stage,archived_at),prospecting_contacts(full_name,email)', { count: 'exact' });
  if (history) query = query.eq('status', 'order_created');
  else query = query.in('status', ['pending', 'legacy_review']).is('closed_at', null).eq('prospecting_leads.stage', 'sample_requested').is('prospecting_leads.archived_at', null);
  const { data, error, count } = await query.order('created_at', { ascending: history ? false : true }).order('id', { ascending: true }).range(from, to);
  const rows = (data ?? []) as unknown as RequestRow[];
  const total = count ?? 0;
  const pages = totalPageCount(total, pageSize);
  const href = (nextPage: number, showHistory = history) => `/admin/sales/prospecting/admin?tab=requests&request_view=${showHistory ? 'orders' : 'pending'}&sample_page=${nextPage}&sample_page_size=${pageSize}`;
  const returnTo = href(page);

  return <section className="space-y-4">
    <div className="card space-y-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Samples</p><h2 className="mt-2 text-xl font-semibold text-slate-950">{history ? 'Created sample orders' : 'Requests to fulfill'}</h2><p className="mt-2 text-sm text-slate-600">{history ? 'Open tracking and pricing to send the customer’s sample email or review a completed quote.' : 'Review the contact and delivery details, then create the sample order. Earlier requests need review before fulfillment.'}</p></div>
      <nav className="flex flex-wrap gap-2" aria-label="Sample request status"><Link className={history ? 'btn-secondary' : 'btn-primary'} href={href(1, false)} aria-current={!history ? 'page' : undefined}>Pending & needs review</Link><Link className={history ? 'btn-primary' : 'btn-secondary'} href={href(1, true)} aria-current={history ? 'page' : undefined}>Created orders</Link></nav>
      {error ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Sample requests are temporarily unavailable. Existing sample outcomes and orders remain available from their views.</p> : <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><p>{total ? Math.min(from + 1, total) : 0}–{Math.min(to + 1, total)} of {total.toLocaleString()} requests</p><div className="flex gap-2">{page > 1 ? <Link className="btn-secondary" href={href(page - 1)}>Previous</Link> : null}{page < pages ? <Link className="btn-secondary" href={href(page + 1)}>Next</Link> : null}</div></div>}
    </div>
    {!error && !rows.length ? <div className="card border-dashed p-8 text-center text-slate-600">{history ? 'No sample orders have been created from requests yet.' : 'No sample requests are waiting for fulfillment.'}</div> : null}
    {rows.map((request) => {
      const leadUrl = `/admin/sales/prospecting/${request.lead_id}?origin=samples&return_to=${encodeURIComponent(returnTo)}`;
      const details = request.details ?? {};
      const note = typeof details.notes === 'string' ? details.notes : typeof details.shipping_notes === 'string' ? details.shipping_notes : '';
      return <article key={request.id} className="card grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${request.status === 'legacy_review' ? 'bg-amber-50 text-amber-900' : request.status === 'order_created' ? 'bg-emerald-50 text-emerald-900' : 'bg-sky-50 text-sky-900'}`}>{request.status === 'legacy_review' ? 'Legacy — review shipment' : request.status === 'order_created' ? 'Order created' : 'Pending'}</span><Link className="mt-3 block text-xl font-semibold text-slate-950 hover:text-teal-800" href={leadUrl}>{request.prospecting_leads.company_name}</Link><p className="mt-2 text-sm text-slate-600">Contact: {request.prospecting_contacts?.full_name || 'Review contact'}{request.prospecting_contacts?.email ? ` · ${request.prospecting_contacts.email}` : ''}</p><p className="mt-1 text-sm text-slate-500">Requested {formatDateTime(request.created_at)}</p>{note ? <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{note}</p> : null}</div>
        <div className="flex flex-wrap gap-2"><Link className="btn-secondary" href={leadUrl}>Open prospect</Link>{request.order_id ? <><Link className="btn-primary" href={`/admin/sales/prospecting/sample-order/${request.order_id}/quote?back=${encodeURIComponent(returnTo)}`}>{canEdit ? 'Continue to tracking & pricing' : 'View tracking & pricing'}</Link><Link className="btn-secondary" href={`/admin/orders/${request.order_id}`}>View sample order</Link></> : canEdit ? <Link className="btn-primary" href={`/admin/sales/prospecting/sample-order?lead=${request.lead_id}&request=${request.id}&origin=samples&return_to=${encodeURIComponent(returnTo)}`}>{request.status === 'legacy_review' ? 'Review & create order' : 'Create sample order'}</Link> : <span className="text-sm text-slate-500">No edit access</span>}</div>
      </article>;
    })}
  </section>;
}

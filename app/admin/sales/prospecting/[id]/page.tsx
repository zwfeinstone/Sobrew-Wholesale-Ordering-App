import Link from 'next/link';
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import LegacyLeadDetailPage from './legacy-page';
import { saveProspectingRecord } from './actions';
import ProspectingRecordEditor from '@/components/prospecting-record-editor';
import ProspectingQueuePanel from '@/components/prospecting-queue-panel';
import { adminCanEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { isProspectingWorkspaceEnabled } from '@/lib/prospecting-rollout';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { loadProspectingSalesReps } from '@/lib/prospecting-sales-reps';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';
import { formatDateTime, prospectingLeadPath, prospectingOriginPath, prospectingQueueContextFromParams, prospectingQueueQueryString, stageLabel } from '@/lib/prospecting';
import { loadProspectingQueueNeighbors } from '@/lib/prospecting-queue-neighbors';
import type { RecordLead } from '@/lib/prospecting-record';

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };
const PAGE_SIZE = 20;

export default async function LeadDetailPage(props: Props) {
  if (!isProspectingWorkspaceEnabled()) return <LegacyLeadDetailPage {...props} />;
  const [{ id }, search, current, supabase] = await Promise.all([props.params, props.searchParams, requireAdminSectionView('prospecting'), createClient()]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const context = prospectingQueueContextFromParams(search);
  const requestedPage = Number(search?.history_page || 1);
  const historyPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const historyType = typeof search?.activity === 'string' && ['call', 'email', 'note'].includes(search.activity) ? search.activity : '';
  let leadQuery = supabase.from('prospecting_leads').select('*').eq('id', id).is('archived_at', null);
  if (!current.isOwner) leadQuery = leadQuery.eq('assigned_profile_id', current.profile.id).neq('stage', 'sample_requested');
  let historyQuery = supabase.from('prospecting_activities').select('*', { count: 'exact' }).eq('lead_id', id);
  if (historyType) historyQuery = historyQuery.eq('activity_type', historyType);
  const [leadResult, contactsResult, historyResult, listsResult, productsResult, salesReps] = await Promise.all([
    leadQuery.maybeSingle(),
    supabase.from('prospecting_contacts').select('id,full_name,email,phone,title,notes,is_primary').eq('lead_id', id).order('is_primary', { ascending: false }).order('created_at'),
    historyQuery.order('created_at', { ascending: false }).order('id', { ascending: false }).range((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE - 1),
    supabase.from('prospecting_list_leads').select('prospecting_lists(name)').eq('lead_id', id),
    supabase.from('products').select('id,name,sku,product_recipes(id)').eq('active', true).eq('category', 'sample_boxes').order('name'),
    current.isOwner ? loadProspectingSalesReps(supabase) : Promise.resolve([]),
  ]);
  if (leadResult.error) throw new Error('Prospect could not be loaded.');
  if (!leadResult.data) return <section className="card space-y-3"><h1 className="text-xl font-semibold">This prospect is unavailable</h1><p className="text-sm text-slate-600">It may have been handed off, reassigned, or archived.</p><Link className="btn-secondary" href={prospectingOriginPath(context)}>Return to workspace</Link></section>;
  const lead = leadResult.data as RecordLead;
  const profileId = current.isOwner ? context.repId || lead.assigned_profile_id : current.profile.id;
  context.repId = profileId || '';
  const today = formatCentralDateInput(new Date());
  // The lead's ownership/view gate above also scopes its shipment history.
  const [neighbors, sampleOrders] = await Promise.all([
    loadProspectingQueueNeighbors(supabase, { context, currentLeadId: id, profileId, today, todayStartIso: (parseCentralDateInput(today) || new Date()).toISOString() }),
    getSupabaseAdmin().from('orders').select('id,created_at,status').eq('prospecting_lead_id', id).eq('order_kind', 'prospecting_sample').order('created_at', { ascending: false }).limit(5),
  ]);
  const queueParams = prospectingQueueQueryString(context, { includePageSize: true });
  const actorIds = [...new Set((historyResult.data || []).map(({ created_by }) => created_by).filter((value): value is string => Boolean(value)))];
  const actorResult = actorIds.length ? await supabase.from('profiles').select('id,full_name,email').in('id', actorIds) : { data: [] };
  const actorNames = new Map((actorResult.data || []).map((actor) => [actor.id, actor.full_name || actor.email || 'Team member']));
  if (current.isOwner && lead.assigned_profile_id && !salesReps.some((rep) => rep.id === lead.assigned_profile_id)) {
    const assignedResult = await supabase.from('profiles').select('id,full_name,email,is_active').eq('id', lead.assigned_profile_id).maybeSingle();
    if (assignedResult.data) salesReps.push(assignedResult.data);
  }
  function historyHref(page: number, type = historyType) { const params = new URLSearchParams(queueParams); params.set('history_page', String(page)); if (type) params.set('activity', type); return `/admin/sales/prospecting/${id}?${params}#activity-history`; }
  const history = <section id="activity-history" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Activity history</h2><span className="text-xs text-slate-500">{historyResult.error ? 'Unavailable' : `${historyResult.count ?? 0} entries`}</span></div><nav aria-label="Activity history filters" className="my-3 flex flex-wrap gap-2">{[['', 'All'], ['call', 'Calls'], ['email', 'Emails'], ['note', 'Notes']].map(([type, label]) => <Link key={type} aria-current={historyType === type ? 'page' : undefined} className={`min-h-9 rounded-lg px-3 py-2 text-xs font-semibold ${historyType === type ? 'bg-teal-50 text-teal-900' : 'bg-slate-100 text-slate-600'}`} href={historyHref(1, type)}>{label}</Link>)}</nav>
    {historyResult.error ? <p role="alert" className="text-sm text-rose-800">History could not be loaded. <Link className="underline" href={historyHref(historyPage)}>Try again</Link></p> : !(historyResult.data || []).length ? <p className="text-sm text-slate-500">{historyPage > 1 ? 'There are no more entries on this page.' : 'No matching activities recorded.'}</p> : <ol className="divide-y divide-slate-100">{historyResult.data!.map((activity) => <li key={activity.id} className="py-3"><div className="flex flex-wrap justify-between gap-2 text-xs"><p className="font-semibold capitalize text-slate-800">{activity.activity_type.replaceAll('_', ' ')}{activity.result ? ` · ${activity.result}` : ''}</p><time dateTime={activity.created_at || undefined} className="text-slate-500">{formatDateTime(activity.created_at)}</time></div><p className="mt-1 text-xs text-slate-500">{activity.created_by ? actorNames.get(activity.created_by) || 'Team member' : 'System'}{activity.previous_stage && activity.next_stage && activity.previous_stage !== activity.next_stage ? ` · ${stageLabel(activity.previous_stage)} → ${stageLabel(activity.next_stage)}` : ''}</p>{activity.body ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{activity.body}</p> : null}</li>)}</ol>}
    {!historyResult.error ? <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3 text-sm">{historyPage > 1 ? <Link className="font-semibold text-teal-800" href={historyHref(historyPage - 1)}>Newer activity</Link> : <span className="text-slate-400">Newest activity</span>}{historyPage * PAGE_SIZE < (historyResult.count || 0) ? <Link className="font-semibold text-teal-800" href={historyHref(historyPage + 1)}>Older activity</Link> : <span className="text-slate-400">End of history</span>}</div> : null}
  </section>;
  const source = <div className="space-y-1 text-xs text-slate-500"><p>Sources: {listsResult.error ? 'Could not be loaded' : (listsResult.data || []).map((row) => { const list = row.prospecting_lists; return Array.isArray(list) ? list[0]?.name : list?.name; }).filter(Boolean).join(' · ') || 'No source list'}</p><p>Created {formatDateTime(lead.created_at)} · Updated {formatDateTime(lead.updated_at)}</p></div>;
  const products = (productsResult.data || []).filter((product) => Array.isArray(product.product_recipes) ? product.product_recipes.length > 0 : Boolean(product.product_recipes));
  return <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]"><aside data-prospecting-rail className="hidden min-w-0 xl:sticky xl:top-4 xl:block xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto"><Suspense fallback={<p className="text-sm text-slate-500">Loading queue…</p>}><ProspectingQueuePanel context={context} currentLeadId={id} profileId={profileId} /></Suspense></aside><ProspectingRecordEditor key={`${id}:${lead.updated_at}`} lead={lead} contacts={contactsResult.data || []} actorId={current.profile.id} canEdit={adminCanEdit(current.access, 'prospecting')} isOwner={current.isOwner} salesReps={salesReps} products={products} productsError={Boolean(productsResult.error)} previousSampleOrders={sampleOrders.data || []} sampleHistoryError={Boolean(sampleOrders.error)} contactsError={Boolean(contactsResult.error)} today={today} queueParams={queueParams} backHref={prospectingOriginPath(context)} previousHref={neighbors.previousLeadId ? prospectingLeadPath(neighbors.previousLeadId, context, { includePageSize: true }) : undefined} nextHref={neighbors.nextLeadId ? prospectingLeadPath(neighbors.nextLeadId, context, { includePageSize: true }) : undefined} action={saveProspectingRecord} history={history} source={source} navigationUnavailable={Boolean(neighbors.unavailable)} initialSampleOpen={search?.sample === '1'} fresh={search?.fresh === '1'} /></div>;
}

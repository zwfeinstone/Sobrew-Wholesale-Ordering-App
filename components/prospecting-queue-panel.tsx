import Link from 'next/link';
import ProspectingQueueScroll from '@/components/prospecting-queue-scroll';
import ProspectingWorkspaceNav from '@/components/prospecting-workspace-nav';
import { createClient } from '@/lib/supabase/server';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';
import {
  MISSING_STATE_FILTER,
  PROSPECTING_PAGE_SIZES,
  PROSPECTING_PRIORITIES,
  PROSPECTING_TODAY_PRESETS,
  REP_PIPELINE_STAGES,
  US_STATE_OPTIONS,
  formatDate,
  missingLeadFields,
  paginationRange,
  priorityLabel,
  prospectingWorkspaceLeadPath,
  prospectingPath,
  stageLabel,
  type ProspectingQueueContext,
} from '@/lib/prospecting';
import { orderedProspectingQueueQuery, prospectingQueueQuery, prospectingTodayGroup } from '@/lib/prospecting-queue';

type QueueLead = {
  id: string;
  company_name: string;
  phone: string | null;
  company_email: string | null;
  address_line_1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  stage: string | null;
  priority: string | null;
  next_follow_up_at: string | null;
  last_result: string | null;
};
type Contact = { lead_id: string; full_name: string | null; email: string | null; phone: string | null; is_primary: boolean | null };
type ListLink = { lead_id: string; prospecting_lists: { name: string | null } | { name: string | null }[] | null };

export type ProspectingQueuePanelProps = {
  context: ProspectingQueueContext;
  currentLeadId?: string;
  profileId: string | null;
  compact?: boolean;
};

function FilterContext({ context }: { context: ProspectingQueueContext }) {
  return <>
    <input type="hidden" name="tab" value={context.tab} />
    {context.preset ? <input type="hidden" name="preset" value={context.preset} /> : null}
    {context.stage ? <input type="hidden" name="stage" value={context.stage} /> : null}
    {context.origin ? <input type="hidden" name="origin" value={context.origin} /> : null}
    {context.returnTo ? <input type="hidden" name="return_to" value={context.returnTo} /> : null}
    {context.repId ? <input type="hidden" name="rep" value={context.repId} /> : null}
    {context.runId ? <input type="hidden" name="run_id" value={context.runId} /> : null}
  </>;
}

export async function ProspectingQueuePanel({ context, currentLeadId, profileId, compact = Boolean(currentLeadId) }: ProspectingQueuePanelProps) {
  const supabase = await createClient();
  const today = formatCentralDateInput(new Date());
  const todayStartIso = (parseCentralDateInput(today) ?? new Date()).toISOString();
  const options = { context, profileId, today, todayStartIso };
  const startContext = { ...context, runId: crypto.randomUUID() };
  const { from, to } = paginationRange(context.page, context.pageSize);
  const choices = context.tab === 'today' || context.tab === 'tasks'
    ? PROSPECTING_TODAY_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, context: { ...context, tab: 'today' as const, preset: preset.id, stage: '' as const } }))
    : context.tab === 'pipeline'
      ? [{ id: '', label: 'All stages', context: { ...context, stage: '' as const } }, ...REP_PIPELINE_STAGES.map((stage) => ({ id: stage, label: stageLabel(stage), context: { ...context, stage } }))]
      : [];
  const [result, listsResult, ...countResults] = await Promise.all([
    orderedProspectingQueueQuery(supabase, options, undefined, { count: 'exact' }).range(from, to),
    supabase.from('prospecting_lists').select('id,name').order('name', { ascending: true }),
    ...choices.map((choice) => prospectingQueueQuery(supabase, { ...options, context: choice.context }, 'id', { count: 'exact', head: true })),
  ]);
  const leads = (result.data ?? []) as unknown as QueueLead[];
  const total = result.count ?? 0;
  const ids = leads.map((lead) => lead.id);
  const [contactsResult, linksResult] = ids.length ? await Promise.all([
    supabase.from('prospecting_contacts').select('lead_id,full_name,email,phone,is_primary').in('lead_id', ids).order('is_primary', { ascending: false }),
    supabase.from('prospecting_list_leads').select('lead_id,prospecting_lists(name)').in('lead_id', ids),
  ]) : [{ data: [] }, { data: [] }];
  const contacts = (contactsResult.data ?? []) as Contact[];
  const links = (linksResult.data ?? []) as unknown as ListLink[];
  const contactsByLead = new Map<string, Contact[]>();
  for (const contact of contacts) contactsByLead.set(contact.lead_id, [...(contactsByLead.get(contact.lead_id) ?? []), contact]);
  const listsByLead = new Map<string, Set<string>>();
  for (const link of links) {
    const name = (Array.isArray(link.prospecting_lists) ? link.prospecting_lists[0] : link.prospecting_lists)?.name;
    if (!name) continue;
    const names = listsByLead.get(link.lead_id) ?? new Set<string>();
    names.add(name);
    listsByLead.set(link.lead_id, names);
  }
  const unknownList = Boolean(context.listId && !listsResult.error && !(listsResult.data ?? []).some((list) => list.id === context.listId));
  const clearContext = { ...context, listId: '', priority: '' as const, q: '', stage: '' as const, state: '' as const, page: 1 };
  const activeFilters = [context.q, context.priority, context.listId, context.state].filter(Boolean).length;
  const allToday = context.tab === 'today' && (!context.preset || context.preset === 'all');
  const heading = context.tab === 'tasks' ? 'Follow-ups due' : context.tab === 'pipeline' ? 'Your pipeline' : context.tab === 'list' ? 'Active leads' : PROSPECTING_TODAY_PRESETS.find((preset) => preset.id === (context.preset ?? 'all'))?.label ?? 'Today';
  let previousGroup = '';

  const queue = <>
    {result.error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Your queue could not be loaded. <Link className="font-semibold underline" href={prospectingPath(context, { includePageSize: true })}>Try again</Link></div> : null}
    {!result.error && !leads.length ? <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center">
      <p className="font-semibold text-slate-950">{total > 0 ? 'There are no leads on this page' : activeFilters ? 'No leads match these filters' : allToday ? 'You’re caught up for today' : 'No leads in this view'}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{total > 0 ? 'Go back to the first page of this queue.' : allToday ? 'Check Upcoming or Needs scheduling to plan your next conversations.' : 'Choose another view or adjust your filters.'}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {total > 0 ? <Link className="btn-secondary" href={prospectingPath(context, { includePageSize: true, page: 1 })}>First page</Link> : null}
        {activeFilters ? <Link className="btn-secondary" href={prospectingPath(clearContext, { includePageSize: true })}>Clear filters</Link> : null}
        {context.state ? <Link className="btn-secondary" href={prospectingPath({ ...context, state: '', page: 1 }, { includePageSize: true })}>Continue across all states</Link> : null}
      </div>
    </div> : null}
    <div className="space-y-2">
      {leads.map((lead) => {
        const leadContacts = contactsByLead.get(lead.id) ?? [];
        const primary = leadContacts[0];
        const missing = missingLeadFields(lead, leadContacts);
        const names = [...(listsByLead.get(lead.id) ?? [])];
        const group = allToday ? prospectingTodayGroup(lead.next_follow_up_at, today) : '';
        const showGroup = group !== previousGroup;
        previousGroup = group;
        const isSelected = lead.id === currentLeadId;
        return <div key={lead.id}>
          {showGroup ? <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</h3> : null}
          <Link
            scroll={false}
            aria-current={isSelected ? 'page' : undefined}
            className={`block min-w-0 rounded-xl border p-3 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${isSelected ? 'border-teal-500 bg-teal-50 shadow-sm' : 'border-slate-200 bg-white hover:border-teal-300 hover:bg-teal-50/40'}`}
            href={prospectingWorkspaceLeadPath(lead.id, context, { includePageSize: true })}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words text-sm font-semibold text-slate-950">{lead.company_name}</p>
              {lead.priority === 'high' ? <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-800">High</span> : null}
            </div>
            <p className="mt-1 break-words text-xs text-slate-500">{[lead.city, lead.state].filter(Boolean).join(', ') || 'Location not added'} · {lead.phone || 'Phone not added'}</p>
            <p className="mt-1 truncate text-xs text-slate-600">{primary?.full_name || primary?.email || primary?.phone || 'Contact not added'}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{stageLabel(lead.stage)}</span>
              {lead.next_follow_up_at ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${lead.next_follow_up_at < today ? 'bg-rose-50 text-rose-800' : lead.next_follow_up_at === today ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800'}`}>{lead.next_follow_up_at < today ? 'Overdue · ' : lead.next_follow_up_at === today ? 'Today · ' : ''}{formatDate(lead.next_follow_up_at)}</span> : <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">No follow-up date</span>}
              {lead.priority !== 'high' ? <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">{priorityLabel(lead.priority)}</span> : null}
            </div>
            {lead.last_result ? <p className="mt-2 truncate text-xs text-slate-600">Last result: {lead.last_result}</p> : null}
            {names.length ? <p className="mt-1 truncate text-xs text-slate-500">{names.join(' · ')}</p> : null}
            {missing.length ? <p className="mt-2 text-[11px] text-amber-800" title={missing.join(', ')}>Needs details ({missing.length})</p> : null}
          </Link>
          <div className="px-2 pt-1 text-right"><Link className="text-xs font-medium text-teal-700 hover:underline" href={`${prospectingWorkspaceLeadPath(lead.id, context, { includePageSize: true })}&sample=1`}>Request sample</Link></div>
        </div>;
      })}
    </div>
  </>;

  const memoryKey = prospectingPath({ ...context, runId: undefined }, { includePageSize: true });
  return <ProspectingQueueScroll memoryKey={memoryKey} compact={compact}><section aria-label="Lead queue" className="min-w-0 space-y-3">
    <ProspectingWorkspaceNav context={context} />
    <form action="/admin/sales/prospecting" className="space-y-2">
      <FilterContext context={context} />
      <div className="flex gap-2">
        <label className="min-w-0 flex-1"><span className="sr-only">Search leads</span><input className="input w-full" name="q" defaultValue={context.q} placeholder="Search company, phone, city…" /></label>
        <button className="btn-secondary shrink-0 px-3" type="submit">Search</button>
      </div>
      <details className="rounded-xl border border-slate-200 bg-white p-3" open={activeFilters > 0}>
        <summary className="cursor-pointer text-xs font-semibold text-slate-600">Filters{activeFilters ? ` (${activeFilters})` : ''}</summary>
        <div className={`mt-3 grid gap-3 ${compact ? '' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
          <label className="text-xs font-semibold text-slate-600">Priority<select className="input mt-1" name="priority" defaultValue={context.priority}><option value="">All priorities</option>{PROSPECTING_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Lead list<select className="input mt-1" name="list" defaultValue={context.listId}><option value="">All lists</option>{unknownList ? <option value={context.listId}>Unavailable list</option> : null}{(listsResult.data ?? []).map((list) => <option key={list.id} value={list.id}>{list.name || 'Untitled list'}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">State<select className="input mt-1" name="state" defaultValue={context.state}><option value="">All states</option><option value={MISSING_STATE_FILTER}>Missing state</option>{US_STATE_OPTIONS.map((state) => <option key={state.id} value={state.id}>{state.id} — {state.label}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Per page<select className="input mt-1" name="page_size" defaultValue={context.pageSize}>{PROSPECTING_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        </div>
        <div className="mt-3 flex gap-2"><button className="btn-primary px-3 py-2 text-xs" type="submit">Apply filters</button>{activeFilters ? <Link className="btn-secondary px-3 py-2 text-xs" href={prospectingPath(clearContext, { includePageSize: true })}>Clear</Link> : null}</div>
      </details>
    </form>
    {choices.length ? <nav aria-label={context.tab === 'pipeline' ? 'Pipeline stages' : 'Today filters'} className="flex flex-wrap gap-1.5">
      {choices.map((choice, index) => {
        const selected = context.tab === 'pipeline' ? context.stage === choice.id : context.tab !== 'tasks' && (context.preset ?? 'all') === choice.id;
        return <Link key={choice.id} aria-current={selected ? 'page' : undefined} className={`rounded-full border px-2.5 py-1.5 text-xs font-medium ${selected ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300'}`} href={prospectingPath(choice.context, { includePageSize: true, page: 1 })}>{choice.label} <span className={selected ? 'text-teal-100' : 'text-slate-400'}>{countResults[index]?.error ? '—' : (countResults[index]?.count ?? 0).toLocaleString()}</span></Link>;
      })}
    </nav> : null}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <p><span className="font-semibold text-slate-700">{heading}</span> · {leads.length ? `${from + 1}–${Math.min(to + 1, total)} of ${total.toLocaleString()}` : total ? `0 on this page · ${total.toLocaleString()} total` : '0 leads'}</p>
      <div className="flex gap-2">
        {context.page > 1 ? <Link className="rounded-md border border-slate-200 bg-white px-2 py-1" href={prospectingPath(context, { includePageSize: true, page: context.page - 1 })}>Previous page</Link> : null}
        {to + 1 < total ? <Link className="rounded-md border border-slate-200 bg-white px-2 py-1" href={prospectingPath(context, { includePageSize: true, page: context.page + 1 })}>Next page</Link> : null}
      </div>
    </div>
    {!compact && leads[0] ? <Link className="btn-primary inline-flex xl:hidden" href={prospectingWorkspaceLeadPath(leads[0].id, startContext, { includePageSize: true })}>Start working</Link> : null}
    {compact ? queue : <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(20rem,1fr)_minmax(0,1.3fr)]"><div className="min-w-0">{queue}</div><div className="hidden self-start rounded-2xl border border-dashed border-slate-200 bg-white/60 px-8 py-16 text-center xl:block"><p className="text-lg font-semibold text-slate-900">Choose a lead to get started</p><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Company details, contacts, and your activity log open here. Work through one conversation at a time.</p>{leads[0] ? <Link className="btn-primary mt-5 inline-flex" href={prospectingWorkspaceLeadPath(leads[0].id, startContext, { includePageSize: true })}>Start working</Link> : null}</div></div>}
  </section></ProspectingQueueScroll>;
}

export default ProspectingQueuePanel;

import Link from 'next/link';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';
import {
  ACTIVE_PROSPECTING_STAGES,
  PROSPECTING_PAGE_SIZES,
  PROSPECTING_PRIORITIES,
  REP_PIPELINE_STAGES,
  REP_PROSPECTING_TABS,
  MISSING_STATE_FILTER,
  US_STATE_OPTIONS,
  formatDate,
  missingLeadFields,
  normalizePriority,
  normalizeStage,
  paginationRange,
  postgrestIlikePattern,
  priorityLabel,
  prospectingLeadPath,
  prospectingPath,
  prospectingQueueContextFromParams,
  prospectingQueueRequiresFollowUp,
  prospectingQueueStageFilter,
  stageLabel,
  totalPageCount,
  type ProspectingPriority,
  type ProspectingQueueContext,
  type ProspectingStateFilter,
  type ProspectingStage,
} from '@/lib/prospecting';

type SearchParams = Record<string, string | string[] | undefined>;

type LeadRow = {
  address_line_1: string | null;
  assigned_profile_id: string | null;
  city: string | null;
  company_email: string | null;
  company_name: string;
  do_not_contact: boolean | null;
  hubspot_status: string | null;
  id: string;
  last_activity_at: string | null;
  last_result: string | null;
  next_follow_up_at: string | null;
  notes: string | null;
  phone: string | null;
  postal_code: string | null;
  priority: string | null;
  stage: string | null;
  state: string | null;
  state_key: string | null;
  updated_at: string | null;
};

type ContactSummary = {
  email: string | null;
  full_name: string | null;
  lead_id: string;
  phone: string | null;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function dateInputFromUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function utcDateFromInput(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addCalendarDays(value: string, days: number) {
  return dateInputFromUtcDate(new Date(utcDateFromInput(value).getTime() + days * DAY_IN_MS));
}

function weekStartInput(value: string) {
  const weekday = utcDateFromInput(value).getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return addCalendarDays(value, -daysSinceMonday);
}

function StageBadge({ stage }: { stage: string | null | undefined }) {
  const normalized = normalizeStage(stage);
  const classes: Record<ProspectingStage, string> = {
    converted: 'bg-emerald-50 text-emerald-800',
    follow_up: 'bg-amber-50 text-amber-800',
    interested: 'bg-teal-50 text-teal-800',
    lost: 'bg-rose-50 text-rose-800',
    new: 'bg-slate-100 text-slate-700',
    not_a_fit: 'bg-zinc-100 text-zinc-700',
    recycle_try_later: 'bg-sky-50 text-sky-800',
    sample_requested: 'bg-indigo-50 text-indigo-800',
    working: 'bg-blue-50 text-blue-800',
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes[normalized]}`}>{stageLabel(normalized)}</span>;
}

function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  const normalized = normalizePriority(priority);
  const classes: Record<ProspectingPriority, string> = {
    high: 'bg-rose-50 text-rose-800',
    low: 'bg-slate-100 text-slate-700',
    normal: 'bg-white text-slate-700',
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classes[normalized]}`}>{priorityLabel(normalized)}</span>;
}

function dueLabel(value: string | null) {
  if (!value) return { className: 'bg-slate-100 text-slate-700', label: 'No date' };
  const due = new Date(`${value}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due.getTime() < today.getTime()) return { className: 'bg-rose-50 text-rose-800', label: 'Overdue' };
  if (due.getTime() === today.getTime()) return { className: 'bg-amber-50 text-amber-800', label: 'Due today' };
  return { className: 'bg-teal-50 text-teal-800', label: 'Upcoming' };
}

function contactLabel(contacts: ContactSummary[]) {
  const primary = contacts[0];
  return primary?.full_name || primary?.email || primary?.phone || 'Missing key contact';
}

function locationLabel(lead: LeadRow) {
  return [lead.city, lead.state].filter(Boolean).join(', ') || 'Missing location';
}

function LeadListTable({
  contactsByLead,
  emptyLabel,
  leads,
  queueContext,
  showDue = false,
}: {
  contactsByLead: Map<string, ContactSummary[]>;
  emptyLabel: string;
  leads: LeadRow[];
  queueContext: ProspectingQueueContext;
  showDue?: boolean;
}) {
  if (!leads.length) {
    return (
      <div className="card border-dashed py-12 text-center">
        <h2 className="text-xl font-semibold text-slate-950">{emptyLabel}</h2>
      </div>
    );
  }

  return (
    <section className="card space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[74rem] border-separate border-spacing-y-2 text-left text-sm">
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">{showDue ? 'Due' : 'Follow-Up'}</th>
              <th className="px-3 py-2">Last Result</th>
              <th className="px-3 py-2">Missing</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const contacts = contactsByLead.get(lead.id) ?? [];
              const missing = missingLeadFields(lead, contacts);
              const timing = dueLabel(lead.next_follow_up_at);
              return (
                <tr key={lead.id} className="bg-white/80 shadow-sm">
                  <td className="rounded-l-lg px-3 py-3">
                    <Link className="font-semibold text-slate-950 hover:text-teal-800" href={prospectingLeadPath(lead.id, queueContext, { includePageSize: true })}>
                      {lead.company_name}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <PriorityBadge priority={lead.priority} />
                      {lead.do_not_contact ? <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800">Do Not Contact</span> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{lead.phone || 'Missing phone'}</td>
                  <td className="px-3 py-3 text-slate-600">{locationLabel(lead)}</td>
                  <td className="px-3 py-3 text-slate-600">{contactLabel(contacts)}</td>
                  <td className="px-3 py-3"><StageBadge stage={lead.stage} /></td>
                  <td className="px-3 py-3">
                    {showDue ? <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${timing.className}`}>{timing.label}</span> : null}
                    <p className={showDue ? 'mt-2 text-slate-600' : 'text-slate-600'}>{formatDate(lead.next_follow_up_at)}</p>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{lead.last_result || 'None'}</td>
                  <td className="px-3 py-3">
                    {missing.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {missing.slice(0, 2).map((item) => (
                          <span key={item} className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800">{item}</span>
                        ))}
                        {missing.length > 2 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800">+{missing.length - 2}</span> : null}
                      </div>
                    ) : <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800">Ready</span>}
                  </td>
                  <td className="rounded-r-lg px-3 py-3 text-right">
                    <Link className="btn-primary inline-flex" href={prospectingLeadPath(lead.id, queueContext, { includePageSize: true })}>Open</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function assignedLeadQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
  q: string,
  priority: string,
  stateKey: '' | ProspectingStateFilter,
  listId: string,
  columns: string,
  options?: { count?: 'exact'; head?: boolean },
) {
  const selectColumns = listId ? `${columns},prospecting_list_leads!inner(list_id)` : columns;
  let query = supabase
    .from('prospecting_leads')
    .select(selectColumns, options)
    .eq('assigned_profile_id', profileId)
    .is('archived_at', null)
    .in('stage', REP_PIPELINE_STAGES);

  if (priority) query = query.eq('priority', priority);
  if (stateKey === MISSING_STATE_FILTER) query = query.is('state_key', null);
  else if (stateKey) query = query.eq('state_key', stateKey);
  if (listId) query = query.eq('prospecting_list_leads.list_id', listId);
  if (q) {
    const search = postgrestIlikePattern(q);
    query = query.or([
      `company_name.ilike.${search}`,
      `phone.ilike.${search}`,
      `company_email.ilike.${search}`,
      `city.ilike.${search}`,
      `state.ilike.${search}`,
      `last_result.ilike.${search}`,
    ].join(','));
  }

  return query;
}

export default async function ProspectingPage({ searchParams }: { searchParams?: SearchParams }) {
  const current = await requireAdminSectionView('prospecting');
  const supabase = await createClient();
  const parsedQueueContext = prospectingQueueContextFromParams(searchParams);
  const queueContext = { ...parsedQueueContext, repId: current.profile.id };
  const q = queueContext.q;
  const tab = queueContext.tab;
  const page = queueContext.page;
  const pageSize = queueContext.pageSize;
  const { from, to } = paginationRange(page, pageSize);
  const selectedPriority = queueContext.priority;
  const selectedStage = queueContext.stage;
  const selectedStateKey = queueContext.state;
  const selectedListId = queueContext.listId;
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const now = new Date();
  const today = formatCentralDateInput(now);
  const tomorrow = addCalendarDays(today, 1);
  const currentWeekStart = weekStartInput(today);
  const todayStart = parseCentralDateInput(today) ?? now;
  const tomorrowStart = parseCentralDateInput(tomorrow) ?? now;
  const weekStart = parseCentralDateInput(currentWeekStart) ?? todayStart;

  let leadsQuery = assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, selectedStateKey, selectedListId, '*', { count: 'exact' });
  leadsQuery = leadsQuery.in('stage', prospectingQueueStageFilter(queueContext));
  if (prospectingQueueRequiresFollowUp(queueContext)) leadsQuery = leadsQuery.not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today);

  if (tab === 'tasks') {
    leadsQuery = leadsQuery.order('next_follow_up_at', { ascending: true }).order('last_activity_at', { ascending: true });
  } else if (tab === 'pipeline') {
    leadsQuery = leadsQuery.order('stage', { ascending: true }).order('updated_at', { ascending: false });
  } else {
    leadsQuery = leadsQuery.order('last_activity_at', { ascending: true }).order('created_at', { ascending: true });
  }

  const { data: leadsData, error: leadsError, count: leadCount } = await leadsQuery.range(from, to);

  const [
    { count: assignedCount },
    { count: activeCount },
    { count: followUpsDue },
    { count: samplesRequested },
    { count: callsToday },
    { count: callsThisWeek },
    ...stageCountResults
  ] = await Promise.all([
    assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, selectedStateKey, selectedListId, 'id', { count: 'exact', head: true }),
    assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, selectedStateKey, selectedListId, 'id', { count: 'exact', head: true }).in('stage', ACTIVE_PROSPECTING_STAGES),
    assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, selectedStateKey, selectedListId, 'id', { count: 'exact', head: true }).not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today),
    assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, selectedStateKey, selectedListId, 'id', { count: 'exact', head: true }).eq('stage', 'sample_requested'),
    supabase
      .from('prospecting_activities')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', current.profile.id)
      .eq('activity_type', 'call')
      .gte('created_at', todayStart.toISOString())
      .lt('created_at', tomorrowStart.toISOString()),
    supabase
      .from('prospecting_activities')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', current.profile.id)
      .eq('activity_type', 'call')
      .gte('created_at', weekStart.toISOString())
      .lt('created_at', tomorrowStart.toISOString()),
    ...REP_PIPELINE_STAGES.map((stage) => (
      assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, selectedStateKey, selectedListId, 'id', { count: 'exact', head: true }).eq('stage', stage)
    )),
  ]);

  const stageCounts = new Map<ProspectingStage, number>();
  REP_PIPELINE_STAGES.forEach((stage, index) => {
    stageCounts.set(stage, stageCountResults[index]?.count ?? 0);
  });

  const leads = (leadsData ?? []) as unknown as LeadRow[];
  const totalLeads = leadCount ?? leads.length;
  const totalPages = totalPageCount(totalLeads, pageSize);
  const displayStart = totalLeads ? from + 1 : 0;
  const displayEnd = Math.min(to + 1, totalLeads);
  const leadIds = leads.map((lead) => lead.id);
  const { data: contactsData } = leadIds.length
    ? await supabase.from('prospecting_contacts').select('lead_id,full_name,email,phone').in('lead_id', leadIds)
    : { data: [] };
  const contactsByLead = new Map<string, ContactSummary[]>();
  for (const contact of (contactsData ?? []) as ContactSummary[]) {
    contactsByLead.set(contact.lead_id, [...(contactsByLead.get(contact.lead_id) ?? []), contact]);
  }

  const firstLead = leads[0];
  const resultLabel = tab === 'tasks' ? 'tasks' : tab === 'pipeline' ? 'pipeline leads' : 'active leads';
  const taskBadgeCount = followUpsDue ?? 0;

  return (
    <div className="space-y-6">
      {toast === 'missing_lead' ? <StatusToast message="That lead could not be found." tone="error" /> : null}
      {toast === 'lead_recycled' ? <StatusToast message="Lead recycled to the unassigned pool." tone="success" /> : null}
      {toast === 'lead_reviewed' ? <StatusToast message="Lead moved to superadmin review." tone="success" /> : null}
      {leadsError ? <StatusToast message="Prospecting leads are not ready yet." tone="error" /> : null}

      <section className="panel">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <span className="eyebrow">Prospecting</span>
            <h1 className="page-title mt-4">Work your assigned leads</h1>
            <p className="page-subtitle mt-3">
              Open a lead, log the call or email, then move straight to the next record in your queue.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            {firstLead ? <Link className="btn-primary inline-flex" href={prospectingLeadPath(firstLead.id, queueContext, { includePageSize: true })}>Start Calling</Link> : null}
            {current.isOwner ? (
              <Link className="btn-secondary inline-flex" href="/admin/sales/prospecting/admin">Prospecting Admin</Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">My Call Scoreboard</p>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Your prospecting calls</h2>
          </div>
          <p className="text-sm font-semibold text-slate-500">Only calls logged by you</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="stat-card border-teal-200 bg-teal-50/70">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Calls Today</p>
            <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">{(callsToday ?? 0).toLocaleString()}</p>
            <p className="mt-2 text-sm font-semibold text-teal-800">{formatDate(today)}</p>
          </div>
          <div className="stat-card border-indigo-200 bg-indigo-50/70">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">Calls This Week</p>
            <p className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">{(callsThisWeek ?? 0).toLocaleString()}</p>
            <p className="mt-2 text-sm font-semibold text-indigo-800">{formatDate(currentWeekStart)} - {formatDate(today)}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">My Leads</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{(assignedCount ?? 0).toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Active Queue</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{(activeCount ?? 0).toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Follow-Up Due</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{(followUpsDue ?? 0).toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Samples Requested</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{(samplesRequested ?? 0).toLocaleString()}</p>
        </div>
      </section>

      <section className="card space-y-4">
        <nav className="grid gap-2 sm:grid-cols-3">
          {REP_PROSPECTING_TABS.map((item) => (
            <Link
              key={item.id}
              className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${tab === item.id ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/70 text-slate-700'}`}
              href={prospectingPath({ ...queueContext, stage: '', tab: item.id }, { includePageSize: true, page: 1 })}
            >
              <span className="inline-flex items-center justify-center gap-2">
                {item.label}
                {item.id === 'tasks' ? (
                  <span className={`min-w-6 rounded-full px-2 py-0.5 text-xs font-semibold ${tab === 'tasks' ? 'bg-teal-900 text-white' : 'bg-amber-50 text-amber-800'}`}>
                    {taskBadgeCount.toLocaleString()}
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </nav>

        <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_14rem_16rem_9rem_auto] lg:items-end">
          <input type="hidden" name="tab" value={tab} />
          {selectedStage ? <input type="hidden" name="stage" value={selectedStage} /> : null}
          {selectedListId ? <input type="hidden" name="list" value={selectedListId} /> : null}
          <label className="text-sm font-semibold text-slate-700">
            Search my leads
            <input className="input mt-2" name="q" defaultValue={q} placeholder="Company, phone, city, result" />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Priority
            <select className="input mt-2" name="priority" defaultValue={selectedPriority}>
              <option value="">All priorities</option>
              {PROSPECTING_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            State
            <select className="input mt-2" name="state" defaultValue={selectedStateKey}>
              <option value="">All states</option>
              <option value={MISSING_STATE_FILTER}>Missing state</option>
              {US_STATE_OPTIONS.map((state) => <option key={state.id} value={state.id}>{state.id} - {state.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Per page
            <select className="input mt-2" name="page_size" defaultValue={pageSize}>
              {PROSPECTING_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button className="btn-primary w-full md:w-auto" type="submit">Filter</button>
            {q || selectedPriority || selectedStage || selectedStateKey || selectedListId ? (
              <Link
                className="btn-secondary inline-flex"
                href={prospectingPath({ ...queueContext, listId: '', priority: '', q: '', stage: '', state: '' }, { includePageSize: true, page: 1 })}
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        <div className="flex flex-col gap-3 rounded-lg bg-white/60 px-3 py-2 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <p>Showing {displayStart.toLocaleString()}-{displayEnd.toLocaleString()} of {totalLeads.toLocaleString()} {resultLabel}</p>
          <div className="flex gap-2">
            <Link
              className={`btn-secondary inline-flex ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
              href={prospectingPath(queueContext, { includePageSize: true, page: Math.max(1, page - 1) })}
            >
              Previous
            </Link>
            <Link
              className={`btn-secondary inline-flex ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
              href={prospectingPath(queueContext, { includePageSize: true, page: Math.min(totalPages, page + 1) })}
            >
              Next
            </Link>
          </div>
        </div>
      </section>

      {tab === 'pipeline' ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {REP_PIPELINE_STAGES.map((stage) => {
              const isSelected = selectedStage === stage;
              const href = prospectingPath({ ...queueContext, stage: isSelected ? '' : stage, tab: 'pipeline' }, { includePageSize: true, page: 1 });
              return (
                <Link
                  key={stage}
                  className={`stat-card block transition hover:border-teal-200 hover:bg-white ${isSelected ? 'border-teal-200 bg-teal-50/70' : ''}`}
                  href={href}
                >
                  <div className="flex items-center justify-between gap-3">
                    <StageBadge stage={stage} />
                    <span className="text-2xl font-semibold tracking-tight text-slate-950">{(stageCounts.get(stage) ?? 0).toLocaleString()}</span>
                  </div>
                </Link>
              );
            })}
          </section>
          <LeadListTable contactsByLead={contactsByLead} emptyLabel="No leads in this pipeline view" leads={leads} queueContext={queueContext} />
        </>
      ) : tab === 'tasks' ? (
        <LeadListTable contactsByLead={contactsByLead} emptyLabel="No follow-ups due" leads={leads} queueContext={queueContext} showDue />
      ) : (
        <LeadListTable contactsByLead={contactsByLead} emptyLabel="No active leads in your queue" leads={leads} queueContext={queueContext} />
      )}

    </div>
  );
}

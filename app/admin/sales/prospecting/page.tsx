import Link from 'next/link';
import StatusToast from '@/components/status-toast';
import { getCurrentAdminAccess } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import {
  ACTIVE_PROSPECTING_STAGES,
  PROSPECTING_PAGE_SIZES,
  PROSPECTING_PRIORITIES,
  REP_PIPELINE_STAGES,
  formatDate,
  missingLeadFields,
  normalizePageNumber,
  normalizePageSize,
  normalizePriority,
  normalizeStage,
  paginationRange,
  postgrestIlikePattern,
  priorityLabel,
  stageLabel,
  totalPageCount,
  type ProspectingPriority,
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
  updated_at: string | null;
};

type ContactSummary = {
  email: string | null;
  full_name: string | null;
  lead_id: string;
  phone: string | null;
};

const REP_TABS = [
  { id: 'list', label: 'List' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'tasks', label: 'Tasks' },
] as const;

type RepTab = (typeof REP_TABS)[number]['id'];

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function normalizeTab(value: string | string[] | undefined): RepTab {
  return REP_TABS.some((tab) => tab.id === value) ? value as RepTab : 'list';
}

function prospectingHref(params: {
  page?: number | string;
  pageSize?: number | string;
  priority?: string;
  q?: string;
  stage?: string;
  tab?: RepTab;
  toast?: string;
}) {
  const query = new URLSearchParams();
  if (params.tab && params.tab !== 'list') query.set('tab', params.tab);
  if (params.q) query.set('q', params.q);
  if (params.priority) query.set('priority', params.priority);
  if (params.stage) query.set('stage', params.stage);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  if (params.toast) query.set('toast', params.toast);
  const qs = query.toString();
  return `/admin/sales/prospecting${qs ? `?${qs}` : ''}`;
}

function leadDetailHref(leadId: string) {
  return `/admin/sales/prospecting/${leadId}`;
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
  showDue = false,
}: {
  contactsByLead: Map<string, ContactSummary[]>;
  emptyLabel: string;
  leads: LeadRow[];
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
                    <Link className="font-semibold text-slate-950 hover:text-teal-800" href={leadDetailHref(lead.id)}>
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
                    <Link className="btn-primary inline-flex" href={leadDetailHref(lead.id)}>Open</Link>
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
  columns: string,
  options?: { count?: 'exact'; head?: boolean },
) {
  let query = supabase
    .from('prospecting_leads')
    .select(columns, options)
    .eq('assigned_profile_id', profileId)
    .is('archived_at', null)
    .in('stage', REP_PIPELINE_STAGES);

  if (priority) query = query.eq('priority', priority);
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
  const current = await getCurrentAdminAccess();
  const supabase = await createClient();
  const q = stringParam(searchParams?.q).trim();
  const tab = normalizeTab(searchParams?.tab);
  const page = normalizePageNumber(searchParams?.page);
  const pageSize = normalizePageSize(searchParams?.page_size);
  const { from, to } = paginationRange(page, pageSize);
  const requestedPriority = stringParam(searchParams?.priority);
  const selectedPriority = PROSPECTING_PRIORITIES.some((priority) => priority.id === requestedPriority) ? requestedPriority as ProspectingPriority : '';
  const requestedStage = stringParam(searchParams?.stage);
  const selectedStage = tab === 'pipeline' && REP_PIPELINE_STAGES.includes(requestedStage as ProspectingStage) ? requestedStage as ProspectingStage : '';
  const toast = stringParam(searchParams?.toast);
  const today = new Date().toISOString().slice(0, 10);

  let leadsQuery = assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, '*', { count: 'exact' });
  if (tab === 'list') leadsQuery = leadsQuery.in('stage', ACTIVE_PROSPECTING_STAGES);
  if (tab === 'tasks') leadsQuery = leadsQuery.not('next_follow_up_at', 'is', null);
  if (selectedStage) leadsQuery = leadsQuery.eq('stage', selectedStage);

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
    ...stageCountResults
  ] = await Promise.all([
    assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, 'id', { count: 'exact', head: true }),
    assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, 'id', { count: 'exact', head: true }).in('stage', ACTIVE_PROSPECTING_STAGES),
    assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, 'id', { count: 'exact', head: true }).not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today),
    assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, 'id', { count: 'exact', head: true }).eq('stage', 'sample_requested'),
    ...REP_PIPELINE_STAGES.map((stage) => (
      assignedLeadQuery(supabase, current.profile.id, q, selectedPriority, 'id', { count: 'exact', head: true }).eq('stage', stage)
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
            {firstLead ? <Link className="btn-primary inline-flex" href={leadDetailHref(firstLead.id)}>Start Calling</Link> : null}
            {current.isOwner ? (
              <Link className="btn-secondary inline-flex" href="/admin/sales/prospecting/admin">Prospecting Admin</Link>
            ) : null}
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
          {REP_TABS.map((item) => (
            <Link
              key={item.id}
              className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${tab === item.id ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/70 text-slate-700'}`}
              href={prospectingHref({ page: 1, pageSize, priority: selectedPriority, q, tab: item.id })}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem_9rem_auto] lg:items-end">
          <input type="hidden" name="tab" value={tab} />
          {selectedStage ? <input type="hidden" name="stage" value={selectedStage} /> : null}
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
            Per page
            <select className="input mt-2" name="page_size" defaultValue={pageSize}>
              {PROSPECTING_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button className="btn-primary w-full md:w-auto" type="submit">Filter</button>
            {q || selectedPriority || selectedStage ? <Link className="btn-secondary inline-flex" href={prospectingHref({ pageSize, tab })}>Clear</Link> : null}
          </div>
        </form>

        <div className="flex flex-col gap-3 rounded-lg bg-white/60 px-3 py-2 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <p>Showing {displayStart.toLocaleString()}-{displayEnd.toLocaleString()} of {totalLeads.toLocaleString()} {resultLabel}</p>
          <div className="flex gap-2">
            <Link
              className={`btn-secondary inline-flex ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
              href={prospectingHref({ page: Math.max(1, page - 1), pageSize, priority: selectedPriority, q, stage: selectedStage, tab })}
            >
              Previous
            </Link>
            <Link
              className={`btn-secondary inline-flex ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
              href={prospectingHref({ page: Math.min(totalPages, page + 1), pageSize, priority: selectedPriority, q, stage: selectedStage, tab })}
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
              const href = prospectingHref({
                page: 1,
                pageSize,
                priority: selectedPriority,
                q,
                stage: isSelected ? '' : stage,
                tab: 'pipeline',
              });
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
          <LeadListTable contactsByLead={contactsByLead} emptyLabel="No leads in this pipeline view" leads={leads} />
        </>
      ) : tab === 'tasks' ? (
        <LeadListTable contactsByLead={contactsByLead} emptyLabel="No follow-ups due" leads={leads} showDue />
      ) : (
        <LeadListTable contactsByLead={contactsByLead} emptyLabel="No active leads in your queue" leads={leads} />
      )}

    </div>
  );
}

import { HUBSPOT_QUEUE_STAGES, PROSPECTING_STAGES, type ProspectingStage } from '@/lib/prospecting';

export const PIPELINE_REVIEW_STAGES: ProspectingStage[] = [
  'new',
  'working',
  'follow_up',
  'recycle_try_later',
  'interested',
  'sample_requested',
];

export type PipelineReviewLeadInput = {
  company_email?: string | null;
  created_at?: string | null;
  hubspot_status?: string | null;
  id: string;
  last_result?: string | null;
  next_follow_up_at?: string | null;
  phone?: string | null;
  priority?: string | null;
  stage?: string | null;
  state_key?: string | null;
};

export type PipelineReviewTouchInput = {
  activity_type?: string | null;
  created_at?: string | null;
  lead_id?: string | null;
};

export type PipelineReviewContactInput = {
  email?: string | null;
  full_name?: string | null;
  lead_id: string;
  phone?: string | null;
};

export type PipelineReviewLeadSummary<TLead extends PipelineReviewLeadInput = PipelineReviewLeadInput> = {
  calls: number;
  daysSinceLastTouch: number | null;
  emails: number;
  hasDataGap: boolean;
  lastTouchAt: string | null;
  lead: TLead;
  recentTouches: number;
  totalTouches: number;
};

export type PipelineReviewSummary<TLead extends PipelineReviewLeadInput = PipelineReviewLeadInput> = {
  leadSummaries: Array<PipelineReviewLeadSummary<TLead>>;
  metrics: {
    dataGaps: number;
    dueToday: number;
    handoffOrActionNeeded: number;
    highPriority: number;
    overdueFollowUps: number;
    stale14Days: number;
    totalOpen: number;
    untouched: number;
  };
  resultMix: Array<{ count: number; result: string }>;
  stageSummaries: Array<{ count: number; stage: ProspectingStage }>;
};

const CENTRAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Chicago',
  year: 'numeric',
});

function centralDateInput(date: Date) {
  const parts = Object.fromEntries(CENTRAL_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function daysBetweenDates(fromDateInput: string, toDateInput: string) {
  const from = Date.parse(`${fromDateInput}T00:00:00.000Z`);
  const to = Date.parse(`${toDateInput}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.floor((to - from) / 86_400_000));
}

function dateInputFromInstant(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return centralDateInput(parsed);
}

function normalizeReviewStage(stage: string | null | undefined): ProspectingStage {
  return PROSPECTING_STAGES.find((candidate) => candidate.id === stage)?.id ?? 'new';
}

function isOutboundTouchType(value: string | null | undefined) {
  return value === 'call' || value === 'email';
}

function hasContactDataGap(lead: PipelineReviewLeadInput, contacts: PipelineReviewContactInput[]) {
  return !lead.phone || !lead.company_email || !lead.state_key || contacts.length === 0;
}

export function summarizePipelineReview<TLead extends PipelineReviewLeadInput>({
  contacts,
  leads,
  now = new Date(),
  touches,
}: {
  contacts: PipelineReviewContactInput[];
  leads: TLead[];
  now?: Date;
  touches: PipelineReviewTouchInput[];
}): PipelineReviewSummary<TLead> {
  const today = centralDateInput(now);
  const recentCutoffMs = now.getTime() - 30 * 86_400_000;
  const contactsByLead = new Map<string, PipelineReviewContactInput[]>();
  for (const contact of contacts) {
    contactsByLead.set(contact.lead_id, [...(contactsByLead.get(contact.lead_id) ?? []), contact]);
  }

  const statsByLead = new Map<string, { calls: number; emails: number; lastTouchAt: string | null; recentTouches: number }>();
  for (const touch of touches) {
    if (!touch.lead_id || !isOutboundTouchType(touch.activity_type)) continue;
    const createdAtMs = touch.created_at ? Date.parse(touch.created_at) : Number.NaN;
    const current = statsByLead.get(touch.lead_id) ?? { calls: 0, emails: 0, lastTouchAt: null, recentTouches: 0 };
    if (touch.activity_type === 'call') current.calls += 1;
    if (touch.activity_type === 'email') current.emails += 1;
    if (!Number.isNaN(createdAtMs)) {
      if (createdAtMs >= recentCutoffMs) current.recentTouches += 1;
      if (!current.lastTouchAt || createdAtMs > Date.parse(current.lastTouchAt)) current.lastTouchAt = touch.created_at ?? null;
    }
    statsByLead.set(touch.lead_id, current);
  }

  const countsByStage = new Map<ProspectingStage, number>(PIPELINE_REVIEW_STAGES.map((stage) => [stage, 0]));
  const countsByResult = new Map<string, number>();
  let dataGaps = 0;
  let dueToday = 0;
  let handoffOrActionNeeded = 0;
  let highPriority = 0;
  let overdueFollowUps = 0;
  let stale14Days = 0;
  let untouched = 0;

  const leadSummaries = leads.map((lead) => {
    const stats = statsByLead.get(lead.id) ?? { calls: 0, emails: 0, lastTouchAt: null, recentTouches: 0 };
    const totalTouches = stats.calls + stats.emails;
    const lastTouchDate = dateInputFromInstant(stats.lastTouchAt);
    const daysSinceLastTouch = lastTouchDate ? daysBetweenDates(lastTouchDate, today) : null;
    const stage = normalizeReviewStage(lead.stage);
    const leadContacts = contactsByLead.get(lead.id) ?? [];
    const hasDataGap = hasContactDataGap(lead, leadContacts);
    const followUp = String(lead.next_follow_up_at ?? '').slice(0, 10);
    const result = String(lead.last_result ?? '').trim();

    countsByStage.set(stage, (countsByStage.get(stage) ?? 0) + 1);
    if (result) countsByResult.set(result, (countsByResult.get(result) ?? 0) + 1);
    if (hasDataGap) dataGaps += 1;
    if (followUp && followUp < today) overdueFollowUps += 1;
    if (followUp && followUp === today) dueToday += 1;
    if (lead.priority === 'high') highPriority += 1;
    if (totalTouches === 0) untouched += 1;
    if (totalTouches === 0 || (daysSinceLastTouch !== null && daysSinceLastTouch >= 14)) stale14Days += 1;
    if ((HUBSPOT_QUEUE_STAGES as ProspectingStage[]).includes(stage) && (!followUp || followUp <= today || lead.hubspot_status !== 'exported')) handoffOrActionNeeded += 1;

    return {
      calls: stats.calls,
      daysSinceLastTouch,
      emails: stats.emails,
      hasDataGap,
      lastTouchAt: stats.lastTouchAt,
      lead,
      recentTouches: stats.recentTouches,
      totalTouches,
    };
  });

  return {
    leadSummaries,
    metrics: {
      dataGaps,
      dueToday,
      handoffOrActionNeeded,
      highPriority,
      overdueFollowUps,
      stale14Days,
      totalOpen: leads.length,
      untouched,
    },
    resultMix: [...countsByResult.entries()]
      .map(([result, count]) => ({ count, result }))
      .sort((a, b) => b.count - a.count || a.result.localeCompare(b.result)),
    stageSummaries: PIPELINE_REVIEW_STAGES.map((stage) => ({
      count: countsByStage.get(stage) ?? 0,
      stage,
    })),
  };
}

import { PROSPECTING_STAGES, type ProspectingStage } from '@/lib/prospecting';

const EM_DASH = '—';
const MAX_SAFE_COUNT = Number.MAX_SAFE_INTEGER;

const PERIOD_COUNT_KEYS = [
  'new_leads',
  'tracked_unique_leads',
  'call_attempts',
  'live_contacts',
  'calls_no_answer',
  'calls_voicemail',
  'calls_invalid',
  'calls_unclassified',
  'emails',
  'texts',
  'notes',
  'followups_email',
  'followups_phone',
  'followups_text',
  'sample_requests',
  'phone_sample_requests',
  'live_contact_sample_requests',
  'email_sample_requests',
  'text_sample_requests',
  'other_sample_requests',
  'deals_won',
  'deals_lost',
  'sample_runs',
  'sample_boxes',
  'sample_cogs_cents',
] as const;

const PIPELINE_COUNT_KEYS = [
  'total_leads',
  'open_pipeline',
  'active_queue',
  'leads_beyond_new',
  'untouched_open',
  'unassigned_open',
  'due_today',
  'overdue_followups',
  'hubspot_ready',
] as const;

const CHANNEL_COUNT_KEYS = [
  'attempts',
  'live_contacts',
  'contact_sample_requests',
  'sample_requests',
  'followups',
  'deals_won',
  'deals_lost',
] as const;

const REP_COUNT_KEYS = [
  'new_leads',
  'calls',
  'live_contacts',
  'sample_requests',
  'phone_sample_requests',
  'deals_won',
  'deals_lost',
  'sample_boxes',
  'sample_cogs_cents',
] as const;

const SOURCE_COUNT_KEYS = [
  'source_rows',
  'calls',
  'emails',
  'texts',
  'notes',
  'followups',
  'sample_requests',
  'deals_won',
  'deals_lost',
  'sample_boxes',
  'sample_cogs_cents',
] as const;

const PROSPECTING_CHANNELS = ['phone', 'email', 'text'] as const;
const PROSPECTING_SOURCES = [
  'lead_activity',
  'prospecting_blocks',
  'followup_blocks',
  'leads_created',
  'sample_box_runs',
] as const;

type CountRecord<Keys extends readonly string[]> = Record<Keys[number], number>;

export type ProspectingPeriodAggregate = CountRecord<typeof PERIOD_COUNT_KEYS>;
export type ProspectingPipelineSnapshot = CountRecord<typeof PIPELINE_COUNT_KEYS>;
export type ProspectingChannel = (typeof PROSPECTING_CHANNELS)[number];
export type ProspectingSource = (typeof PROSPECTING_SOURCES)[number];

export type ProspectingStageAggregate = {
  stage: ProspectingStage;
  count: number;
};

export type ProspectingChannelAggregate = {
  channel: ProspectingChannel;
} & CountRecord<typeof CHANNEL_COUNT_KEYS>;

export type ProspectingRepAggregate = {
  rep_key: string;
} & CountRecord<typeof REP_COUNT_KEYS>;

export type ProspectingSourceAggregate = {
  source: ProspectingSource;
} & CountRecord<typeof SOURCE_COUNT_KEYS>;

export type ProspectingReportAggregate = {
  period: ProspectingPeriodAggregate;
  pipeline_snapshot: ProspectingPipelineSnapshot;
  stages: ProspectingStageAggregate[];
  channels: ProspectingChannelAggregate[];
  reps: ProspectingRepAggregate[];
  sources: ProspectingSourceAggregate[];
};

export type AuthorizedProspectingReportScope = {
  salesProfileId: string | null;
  centerIds: string[] | null;
};

export type ProspectingRate = {
  numerator: number;
  denominator: number;
  percent: number | null;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Normalizes count-like values received across the PostgREST JSON boundary.
 * Invalid and negative values become zero; oversized values are capped so all
 * returned counts remain safe JavaScript integers.
 */
export function safeRawCount(value: unknown): number {
  if (typeof value === 'bigint') {
    if (value <= 0n) return 0;
    return value > BigInt(MAX_SAFE_COUNT) ? MAX_SAFE_COUNT : Number(value);
  }

  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  if (typeof value === 'string' && value.trim() === '') return 0;

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(MAX_SAFE_COUNT, Math.floor(numeric));
}

function normalizeCounts<Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): CountRecord<Keys> {
  const input = record(value);
  const normalized = {} as CountRecord<Keys>;
  for (const key of keys as readonly Keys[number][]) {
    normalized[key] = safeRawCount(input[key]);
  }
  return normalized;
}

function normalizeStages(value: unknown): ProspectingStageAggregate[] {
  const countsByStage = new Map<ProspectingStage, number>();
  for (const valueRow of rows(value)) {
    const input = record(valueRow);
    const stage = PROSPECTING_STAGES.find((candidate) => candidate.id === input.stage)?.id;
    if (stage) countsByStage.set(stage, safeRawCount(input.count));
  }

  return PROSPECTING_STAGES.map(({ id }) => ({
    stage: id,
    count: countsByStage.get(id) ?? 0,
  }));
}

function normalizeChannels(value: unknown): ProspectingChannelAggregate[] {
  const channelsById = new Map<ProspectingChannel, UnknownRecord>();
  for (const valueRow of rows(value)) {
    const input = record(valueRow);
    const channel = PROSPECTING_CHANNELS.find((candidate) => candidate === input.channel);
    if (channel) channelsById.set(channel, input);
  }

  return PROSPECTING_CHANNELS.map((channel) => ({
    channel,
    ...normalizeCounts(channelsById.get(channel), CHANNEL_COUNT_KEYS),
  }));
}

function normalizeReps(value: unknown): ProspectingRepAggregate[] {
  return rows(value)
    .filter((valueRow) => valueRow !== null && typeof valueRow === 'object' && !Array.isArray(valueRow))
    .map((valueRow) => {
      const input = record(valueRow);
      const repKey = typeof input.rep_key === 'string' && input.rep_key.trim()
        ? input.rep_key.trim()
        : '__unknown_rep__';
      return {
        rep_key: repKey,
        ...normalizeCounts(input, REP_COUNT_KEYS),
      };
    });
}

function normalizeSources(value: unknown): ProspectingSourceAggregate[] {
  const sourcesById = new Map<ProspectingSource, UnknownRecord>();
  for (const valueRow of rows(value)) {
    const input = record(valueRow);
    const source = PROSPECTING_SOURCES.find((candidate) => candidate === input.source);
    if (source) sourcesById.set(source, input);
  }

  return PROSPECTING_SOURCES.map((source) => ({
    source,
    ...normalizeCounts(sourcesById.get(source), SOURCE_COUNT_KEYS),
  }));
}

/** Creates a complete, safe report contract from an untrusted RPC payload. */
export function normalizeProspectingReportAggregate(value: unknown): ProspectingReportAggregate {
  const input = record(value);
  return {
    period: normalizeCounts(input.period, PERIOD_COUNT_KEYS),
    pipeline_snapshot: normalizeCounts(input.pipeline_snapshot, PIPELINE_COUNT_KEYS),
    stages: normalizeStages(input.stages),
    channels: normalizeChannels(input.channels),
    reps: normalizeReps(input.reps),
    sources: normalizeSources(input.sources),
  };
}

/** Returns a fresh empty aggregate so callers cannot share mutable row arrays. */
export function emptyProspectingReportAggregate(): ProspectingReportAggregate {
  return normalizeProspectingReportAggregate(null);
}

export function rate(numerator: unknown, denominator: unknown): ProspectingRate {
  const safeNumerator = safeRawCount(numerator);
  const safeDenominator = safeRawCount(denominator);
  return {
    numerator: safeNumerator,
    denominator: safeDenominator,
    percent: safeDenominator === 0 ? null : (safeNumerator / safeDenominator) * 100,
  };
}

export function formatRatePercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}%`
    : EM_DASH;
}

export function formatRawRatio(value: Pick<ProspectingRate, 'numerator' | 'denominator'>): string {
  return `${value.numerator.toLocaleString('en-US')} / ${value.denominator.toLocaleString('en-US')}`;
}

export function formatRateWithRatio(value: ProspectingRate): string {
  return value.percent === null
    ? EM_DASH
    : `${formatRatePercent(value.percent)} · ${formatRawRatio(value)}`;
}

const CENTRAL_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Formats an instant as the reporting date in America/Chicago. */
export function centralDateInput(date = new Date()): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');
  const parts = Object.fromEntries(
    CENTRAL_DATE_FORMATTER.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import { isOwnerEmail } from '@/lib/admin-permission-definitions';
import { getCurrentAdminAccess } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { createClient } from '@/lib/supabase/server';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const PROSPECTING_RANGES = [
  { id: 'daily', label: 'Daily', description: 'Day-by-day activity' },
  { id: 'weekly', label: 'Weekly', description: 'Weekly totals' },
  { id: 'monthly', label: 'Monthly', description: 'Monthly trends' },
  { id: 'yearly', label: 'Yearly', description: 'Annual view' },
] as const;

type ProspectingRange = (typeof PROSPECTING_RANGES)[number]['id'];

type CallBlock = {
  id: string;
  activity_date: string;
  block_label: string | null;
  calls_no_contact: number | null;
  calls_voicemail: number | null;
  calls_email: number | null;
  calls_contact: number | null;
  calls_text: number | null;
  samples_from_contact: number | null;
  samples_from_voicemail_callback: number | null;
  samples_from_email_reply: number | null;
  samples_from_text_reply: number | null;
  samples_other: number | null;
  notes: string | null;
  created_at: string | null;
};

type FollowUpBlock = {
  id: string;
  activity_date: string;
  block_label: string | null;
  followups_email: number | null;
  followups_phone: number | null;
  followups_text: number | null;
  deals_closed_email: number | null;
  deals_closed_phone: number | null;
  deals_closed_text: number | null;
  deals_lost_email: number | null;
  deals_lost_phone: number | null;
  deals_lost_text: number | null;
  notes: string | null;
  created_at: string | null;
};

type CallTotals = {
  callsNoContact: number;
  callsVoicemail: number;
  callsEmail: number;
  callsContact: number;
  callsText: number;
  samplesFromContact: number;
  samplesFromVoicemailCallback: number;
  samplesFromEmailReply: number;
  samplesFromTextReply: number;
  samplesOther: number;
};

type FollowUpTotals = {
  followupsEmail: number;
  followupsPhone: number;
  followupsText: number;
  dealsClosedEmail: number;
  dealsClosedPhone: number;
  dealsClosedText: number;
  dealsLostEmail: number;
  dealsLostPhone: number;
  dealsLostText: number;
};

type ProspectingTotals = CallTotals & FollowUpTotals;

type PeriodReport = ProspectingTotals & {
  key: string;
  label: string;
  sortDate: Date;
  callBlocks: number;
  followUpBlocks: number;
};

function normalizeRange(value: string | string[] | undefined): ProspectingRange {
  return PROSPECTING_RANGES.some((range) => range.id === value) ? (value as ProspectingRange) : 'daily';
}

function toWholeNumber(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseActivityDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatLongDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseDateParam(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return startOfDay(date);
}

function normalizeDateWindow(from: string | string[] | undefined, to: string | string[] | undefined) {
  let start = parseDateParam(from);
  let end = parseDateParam(to);

  if (start && end && start.getTime() > end.getTime()) {
    [start, end] = [end, start];
  }

  return {
    start,
    end,
    fromKey: start ? formatDateKey(start) : '',
    toKey: end ? formatDateKey(end) : '',
    isActive: Boolean(start || end),
  };
}

function formatDateWindowLabel(start: Date | null, end: Date | null) {
  if (start && end) return `${formatLongDate(start)} - ${formatLongDate(end)}`;
  if (start) return `Since ${formatLongDate(start)}`;
  if (end) return `Through ${formatLongDate(end)}`;
  return 'All time';
}

function formDateParam(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function prospectingHref({
  range,
  from,
  to,
  toast,
}: {
  range: ProspectingRange;
  from?: string;
  to?: string;
  toast?: string;
}) {
  const query = new URLSearchParams({ range });
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (toast) query.set('toast', toast);
  return `/admin/sales/prospecting?${query.toString()}`;
}

function rangeHref(range: ProspectingRange, from?: string, to?: string) {
  return prospectingHref({ range, from, to });
}

function DateWindowHiddenInputs({ from, to }: { from: string; to: string }) {
  return (
    <>
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
    </>
  );
}

function emptyCallTotals(): CallTotals {
  return {
    callsNoContact: 0,
    callsVoicemail: 0,
    callsEmail: 0,
    callsContact: 0,
    callsText: 0,
    samplesFromContact: 0,
    samplesFromVoicemailCallback: 0,
    samplesFromEmailReply: 0,
    samplesFromTextReply: 0,
    samplesOther: 0,
  };
}

function emptyFollowUpTotals(): FollowUpTotals {
  return {
    followupsEmail: 0,
    followupsPhone: 0,
    followupsText: 0,
    dealsClosedEmail: 0,
    dealsClosedPhone: 0,
    dealsClosedText: 0,
    dealsLostEmail: 0,
    dealsLostPhone: 0,
    dealsLostText: 0,
  };
}

function emptyTotals(): ProspectingTotals {
  return {
    ...emptyCallTotals(),
    ...emptyFollowUpTotals(),
  };
}

function addCallBlockToTotals(totals: CallTotals, block: CallBlock) {
  totals.callsNoContact += block.calls_no_contact ?? 0;
  totals.callsVoicemail += block.calls_voicemail ?? 0;
  totals.callsEmail += block.calls_email ?? 0;
  totals.callsContact += block.calls_contact ?? 0;
  totals.callsText += block.calls_text ?? 0;
  totals.samplesFromContact += block.samples_from_contact ?? 0;
  totals.samplesFromVoicemailCallback += block.samples_from_voicemail_callback ?? 0;
  totals.samplesFromEmailReply += block.samples_from_email_reply ?? 0;
  totals.samplesFromTextReply += block.samples_from_text_reply ?? 0;
  totals.samplesOther += block.samples_other ?? 0;
}

function addFollowUpBlockToTotals(totals: FollowUpTotals, block: FollowUpBlock) {
  totals.followupsEmail += block.followups_email ?? 0;
  totals.followupsPhone += block.followups_phone ?? 0;
  totals.followupsText += block.followups_text ?? 0;
  totals.dealsClosedEmail += block.deals_closed_email ?? 0;
  totals.dealsClosedPhone += block.deals_closed_phone ?? 0;
  totals.dealsClosedText += block.deals_closed_text ?? 0;
  totals.dealsLostEmail += block.deals_lost_email ?? 0;
  totals.dealsLostPhone += block.deals_lost_phone ?? 0;
  totals.dealsLostText += block.deals_lost_text ?? 0;
}

function totalInitialOutreach(totals: CallTotals) {
  return totals.callsNoContact + totals.callsVoicemail + totals.callsEmail + totals.callsContact + totals.callsText;
}

function totalSamples(totals: CallTotals) {
  return totals.samplesFromContact + totals.samplesFromVoicemailCallback + totals.samplesFromEmailReply + totals.samplesFromTextReply + totals.samplesOther;
}

function totalFollowUps(totals: FollowUpTotals) {
  return totals.followupsEmail + totals.followupsPhone + totals.followupsText;
}

function totalDeals(totals: FollowUpTotals) {
  return totals.dealsClosedEmail + totals.dealsClosedPhone + totals.dealsClosedText;
}

function totalDealsLost(totals: FollowUpTotals) {
  return totals.dealsLostEmail + totals.dealsLostPhone + totals.dealsLostText;
}

function ratio(numerator: number, denominator: number) {
  if (!denominator) return '0.0%';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function periodForDate(date: Date, range: ProspectingRange) {
  if (range === 'daily') {
    return {
      key: formatDateKey(date),
      label: formatLongDate(date),
      sortDate: startOfDay(date),
    };
  }

  if (range === 'weekly') {
    const start = startOfWeek(date);
    return {
      key: formatDateKey(start),
      label: `${formatShortDate(start)} - ${formatShortDate(addDays(start, 6))}`,
      sortDate: start,
    };
  }

  if (range === 'monthly') {
    const start = startOfMonth(date);
    return {
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      sortDate: start,
    };
  }

  const start = startOfYear(date);
  return {
    key: String(start.getFullYear()),
    label: String(start.getFullYear()),
    sortDate: start,
  };
}

function getPeriodReport(reports: Map<string, PeriodReport>, dateValue: string, range: ProspectingRange) {
  const period = periodForDate(parseActivityDate(dateValue), range);
  const report = reports.get(period.key) ?? {
    ...emptyTotals(),
    key: period.key,
    label: period.label,
    sortDate: period.sortDate,
    callBlocks: 0,
    followUpBlocks: 0,
  };
  reports.set(period.key, report);
  return report;
}

function buildPeriodReports(callBlocks: CallBlock[], followUpBlocks: FollowUpBlock[], range: ProspectingRange) {
  const reports = new Map<string, PeriodReport>();

  for (const block of callBlocks) {
    const report = getPeriodReport(reports, block.activity_date, range);
    addCallBlockToTotals(report, block);
    report.callBlocks += 1;
  }

  for (const block of followUpBlocks) {
    const report = getPeriodReport(reports, block.activity_date, range);
    addFollowUpBlockToTotals(report, block);
    report.followUpBlocks += 1;
  }

  return [...reports.values()].sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function BreakdownBar({ label, value, total }: { label: string; value: number; total: number }) {
  const width = total ? Math.max((value / total) * 100, value > 0 ? 6 : 0) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="text-slate-500">{value.toLocaleString()} - {ratio(value, total)}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-teal-700" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{value.toLocaleString()}</p>
    </div>
  );
}

function NumberField({ defaultValue, label, name }: { defaultValue?: number | null; label: string; name: string }) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input className="input mt-2" defaultValue={defaultValue ?? 0} min="0" name={name} type="number" />
    </label>
  );
}

function FormMessages({ toast }: { toast: string }) {
  const messages: Record<string, { tone: string; text: string }> = {
    call_saved: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Call block saved.' },
    call_updated: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Call block updated.' },
    call_deleted: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Call block deleted.' },
    followup_saved: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Follow-up block saved.' },
    followup_updated: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Follow-up block updated.' },
    followup_deleted: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-800', text: 'Follow-up block deleted.' },
    invalid_date: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Choose a valid activity date.' },
    missing_block: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Choose a valid block to update or delete.' },
    save_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Unable to save prospecting data. Make sure migrations 019, 020, and 021 have been run.' },
    update_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Unable to update that prospecting block. Make sure migrations 019, 020, and 021 have been run.' },
    delete_error: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Unable to delete that prospecting block.' },
    admin_write_denied: { tone: 'border-rose-200 bg-rose-50 text-rose-700', text: 'Only zach@sobrew.com can change admin data.' },
  };
  const message = messages[toast];
  return message ? <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold ${message.tone}`}>{message.text}</div> : null;
}

function prospectingToastHref(range: ProspectingRange, toast: string, from?: string, to?: string) {
  return prospectingHref({ range, from, to, toast });
}

function redirectWithToast(range: ProspectingRange, toast: string, from?: string, to?: string) {
  redirect(prospectingToastHref(range, toast, from, to));
}

function callBlockPayload(formData: FormData) {
  return {
    activity_date: String(formData.get('activity_date') ?? '').trim(),
    block_label: String(formData.get('block_label') ?? '').trim() || null,
    calls_no_contact: toWholeNumber(formData.get('calls_no_contact')),
    calls_voicemail: toWholeNumber(formData.get('calls_voicemail')),
    calls_email: toWholeNumber(formData.get('calls_email')),
    calls_contact: toWholeNumber(formData.get('calls_contact')),
    calls_text: toWholeNumber(formData.get('calls_text')),
    samples_from_contact: toWholeNumber(formData.get('samples_from_contact')),
    samples_from_voicemail_callback: toWholeNumber(formData.get('samples_from_voicemail_callback')),
    samples_from_email_reply: toWholeNumber(formData.get('samples_from_email_reply')),
    samples_from_text_reply: toWholeNumber(formData.get('samples_from_text_reply')),
    samples_other: toWholeNumber(formData.get('samples_other')),
    notes: String(formData.get('notes') ?? '').trim() || null,
  };
}

async function saveCallBlock(formData: FormData) {
  'use server';

  const range = normalizeRange(String(formData.get('range') ?? 'daily'));
  const from = formDateParam(formData, 'from');
  const to = formDateParam(formData, 'to');
  const current = await requireAdminWriteAccess(prospectingToastHref(range, 'admin_write_denied', from, to), 'prospecting');

  const supabase = await createClient();
  const payload = callBlockPayload(formData);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.activity_date)) {
    redirectWithToast(range, 'invalid_date', from, to);
  }

  const { error } = await supabase.from('sales_prospecting_blocks').insert({
    ...payload,
    created_by: current.profile.id,
  });

  redirectWithToast(range, error ? 'save_error' : 'call_saved', from, to);
}

async function updateCallBlock(formData: FormData) {
  'use server';

  const range = normalizeRange(String(formData.get('range') ?? 'daily'));
  const from = formDateParam(formData, 'from');
  const to = formDateParam(formData, 'to');
  const current = await requireAdminWriteAccess(prospectingToastHref(range, 'admin_write_denied', from, to), 'prospecting');

  const supabase = await createClient();
  const blockId = String(formData.get('block_id') ?? '').trim();
  const payload = callBlockPayload(formData);

  if (!blockId) {
    redirectWithToast(range, 'missing_block', from, to);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.activity_date)) {
    redirectWithToast(range, 'invalid_date', from, to);
  }

  let updateQuery = supabase
    .from('sales_prospecting_blocks')
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', blockId);
  if (!isOwnerEmail(current.user.email || current.profile.email)) {
    updateQuery = updateQuery.eq('created_by', current.profile.id);
  }
  const { error } = await updateQuery;

  redirectWithToast(range, error ? 'update_error' : 'call_updated', from, to);
}

async function deleteCallBlock(formData: FormData) {
  'use server';

  const range = normalizeRange(String(formData.get('range') ?? 'daily'));
  const from = formDateParam(formData, 'from');
  const to = formDateParam(formData, 'to');
  const current = await requireAdminWriteAccess(prospectingToastHref(range, 'admin_write_denied', from, to), 'prospecting');

  const supabase = await createClient();
  const blockId = String(formData.get('block_id') ?? '').trim();

  if (!blockId) {
    redirectWithToast(range, 'missing_block', from, to);
  }

  let deleteQuery = supabase.from('sales_prospecting_blocks').delete().eq('id', blockId).select('id');
  if (!isOwnerEmail(current.user.email || current.profile.email)) {
    deleteQuery = deleteQuery.eq('created_by', current.profile.id);
  }
  const { error, data } = await deleteQuery;
  redirectWithToast(range, error || !data?.length ? 'delete_error' : 'call_deleted', from, to);
}

function followUpBlockPayload(formData: FormData) {
  return {
    activity_date: String(formData.get('activity_date') ?? '').trim(),
    block_label: String(formData.get('block_label') ?? '').trim() || null,
    followups_email: toWholeNumber(formData.get('followups_email')),
    followups_phone: toWholeNumber(formData.get('followups_phone')),
    followups_text: toWholeNumber(formData.get('followups_text')),
    deals_closed_email: toWholeNumber(formData.get('deals_closed_email')),
    deals_closed_phone: toWholeNumber(formData.get('deals_closed_phone')),
    deals_closed_text: toWholeNumber(formData.get('deals_closed_text')),
    deals_lost_email: toWholeNumber(formData.get('deals_lost_email')),
    deals_lost_phone: toWholeNumber(formData.get('deals_lost_phone')),
    deals_lost_text: toWholeNumber(formData.get('deals_lost_text')),
    notes: String(formData.get('notes') ?? '').trim() || null,
  };
}

async function saveFollowUpBlock(formData: FormData) {
  'use server';

  const range = normalizeRange(String(formData.get('range') ?? 'daily'));
  const from = formDateParam(formData, 'from');
  const to = formDateParam(formData, 'to');
  const current = await requireAdminWriteAccess(prospectingToastHref(range, 'admin_write_denied', from, to), 'prospecting');

  const supabase = await createClient();
  const payload = followUpBlockPayload(formData);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.activity_date)) {
    redirectWithToast(range, 'invalid_date', from, to);
  }

  const { error } = await supabase.from('sales_prospecting_followup_blocks').insert({
    ...payload,
    created_by: current.profile.id,
  });

  redirectWithToast(range, error ? 'save_error' : 'followup_saved', from, to);
}

async function updateFollowUpBlock(formData: FormData) {
  'use server';

  const range = normalizeRange(String(formData.get('range') ?? 'daily'));
  const from = formDateParam(formData, 'from');
  const to = formDateParam(formData, 'to');
  const current = await requireAdminWriteAccess(prospectingToastHref(range, 'admin_write_denied', from, to), 'prospecting');

  const supabase = await createClient();
  const blockId = String(formData.get('block_id') ?? '').trim();
  const payload = followUpBlockPayload(formData);

  if (!blockId) {
    redirectWithToast(range, 'missing_block', from, to);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.activity_date)) {
    redirectWithToast(range, 'invalid_date', from, to);
  }

  let updateQuery = supabase
    .from('sales_prospecting_followup_blocks')
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', blockId);
  if (!isOwnerEmail(current.user.email || current.profile.email)) {
    updateQuery = updateQuery.eq('created_by', current.profile.id);
  }
  const { error } = await updateQuery;

  redirectWithToast(range, error ? 'update_error' : 'followup_updated', from, to);
}

async function deleteFollowUpBlock(formData: FormData) {
  'use server';

  const range = normalizeRange(String(formData.get('range') ?? 'daily'));
  const from = formDateParam(formData, 'from');
  const to = formDateParam(formData, 'to');
  const current = await requireAdminWriteAccess(prospectingToastHref(range, 'admin_write_denied', from, to), 'prospecting');

  const supabase = await createClient();
  const blockId = String(formData.get('block_id') ?? '').trim();

  if (!blockId) {
    redirectWithToast(range, 'missing_block', from, to);
  }

  let deleteQuery = supabase.from('sales_prospecting_followup_blocks').delete().eq('id', blockId).select('id');
  if (!isOwnerEmail(current.user.email || current.profile.email)) {
    deleteQuery = deleteQuery.eq('created_by', current.profile.id);
  }
  const { error, data } = await deleteQuery;
  redirectWithToast(range, error || !data?.length ? 'delete_error' : 'followup_deleted', from, to);
}

export default async function ProspectingPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const currentAccess = await getCurrentAdminAccess();
  const activeRange = normalizeRange(searchParams?.range);
  const activeRangeLabel = PROSPECTING_RANGES.find((range) => range.id === activeRange)?.label ?? 'Daily';
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const today = startOfDay(new Date());
  const todayKey = formatDateKey(today);
  const thisWeekStart = startOfWeek(today);
  const thisMonthStart = startOfMonth(today);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const lastWeekEnd = addDays(thisWeekStart, -1);
  const dateWindow = normalizeDateWindow(searchParams?.from, searchParams?.to);
  const activeWindowLabel = formatDateWindowLabel(dateWindow.start, dateWindow.end);
  const quickWindows = [
    { label: 'This week', from: formatDateKey(thisWeekStart), to: todayKey },
    { label: 'Last week', from: formatDateKey(lastWeekStart), to: formatDateKey(lastWeekEnd) },
    { label: 'This month', from: formatDateKey(thisMonthStart), to: todayKey },
    { label: 'All time', from: '', to: '' },
  ];

  let callBlocksQuery = supabase.from('sales_prospecting_blocks').select('*');

  if (dateWindow.fromKey) callBlocksQuery = callBlocksQuery.gte('activity_date', dateWindow.fromKey);
  if (dateWindow.toKey) callBlocksQuery = callBlocksQuery.lte('activity_date', dateWindow.toKey);
  if (!currentAccess.isOwner) callBlocksQuery = callBlocksQuery.eq('created_by', currentAccess.profile.id);

  let followUpBlocksQuery = supabase.from('sales_prospecting_followup_blocks').select('*');

  if (dateWindow.fromKey) followUpBlocksQuery = followUpBlocksQuery.gte('activity_date', dateWindow.fromKey);
  if (dateWindow.toKey) followUpBlocksQuery = followUpBlocksQuery.lte('activity_date', dateWindow.toKey);
  if (!currentAccess.isOwner) followUpBlocksQuery = followUpBlocksQuery.eq('created_by', currentAccess.profile.id);

  const [{ data: callBlocks, error: callBlocksError }, { data: followUpBlocks, error: followUpBlocksError }] = await Promise.all([
    callBlocksQuery.order('activity_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
    followUpBlocksQuery.order('activity_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
  ]);

  const blocks = callBlocksError ? [] : ((callBlocks ?? []) as CallBlock[]);
  const followUps = followUpBlocksError ? [] : ((followUpBlocks ?? []) as FollowUpBlock[]);
  const totals = emptyTotals();
  for (const block of blocks) addCallBlockToTotals(totals, block);
  for (const block of followUps) addFollowUpBlockToTotals(totals, block);

  const outreach = totalInitialOutreach(totals);
  const samples = totalSamples(totals);
  const followUpCount = totalFollowUps(totals);
  const deals = totalDeals(totals);
  const dealsLost = totalDealsLost(totals);
  const reports = buildPeriodReports(blocks, followUps, activeRange);
  const recentCallBlocks = blocks.slice(0, 8);
  const recentFollowUpBlocks = followUps.slice(0, 6);
  const storageError = callBlocksError || followUpBlocksError;

  return (
    <div className="space-y-6">
      <FormMessages toast={toast} />
      {storageError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Prospecting storage is not ready yet. Run migrations 019, 020, and 021 to start saving activity.
        </div>
      ) : null}

      <section className="panel">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
          <div>
            <span className="eyebrow">Sales Prospecting</span>
            <h1 className="page-title mt-4">Track outreach, follow-ups, samples, and closed deals.</h1>
            <p className="page-subtitle mt-3">
              Use call blocks for the first outreach attempt, then use follow-up blocks when replies and deal activity happen later.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Outreach to Samples</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{ratio(samples, outreach)}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Samples to Deals</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{ratio(deals, samples)}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Follow-Ups to Deals</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{ratio(deals, followUpCount)}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Call Stats Window</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{activeWindowLabel}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Totals, breakdowns, and the report table use this activity window.</p>
          </div>
          <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
            {blocks.length} call block{blocks.length === 1 ? '' : 's'} - {followUps.length} follow-up block{followUps.length === 1 ? '' : 's'}
          </span>
        </div>
        <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end">
          <input type="hidden" name="range" value={activeRange} />
          <label className="text-sm font-semibold text-slate-700">
            Start date
            <input className="input mt-2" name="from" type="date" defaultValue={dateWindow.fromKey} />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            End date
            <input className="input mt-2" name="to" type="date" defaultValue={dateWindow.toKey} />
          </label>
          <button className="btn-primary w-full lg:w-auto" type="submit">Apply Range</button>
          {dateWindow.isActive ? (
            <Link className="btn-secondary inline-flex w-full lg:w-auto" href={rangeHref(activeRange)}>
              Clear
            </Link>
          ) : null}
        </form>
        <nav aria-label="Quick prospecting date ranges" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {quickWindows.map((window) => {
            const active = dateWindow.fromKey === window.from && dateWindow.toKey === window.to;
            return (
              <Link
                key={window.label}
                aria-current={active ? 'page' : undefined}
                className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                  active ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/60 text-slate-700 hover:border-teal-200 hover:bg-white'
                }`}
                href={rangeHref(activeRange, window.from, window.to)}
              >
                {window.label}
              </Link>
            );
          })}
        </nav>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Initial Outreach" value={outreach.toLocaleString()} detail="No contact, voicemail, email, made contact, and text message outcomes." />
        <MetricCard label="Samples Sent" value={samples.toLocaleString()} detail="Samples tied to contact, voicemail callback, email reply, text reply, or other source." />
        <MetricCard label="Follow-Ups" value={followUpCount.toLocaleString()} detail="Follow-up activity by email, phone, and text." />
        <MetricCard label="Deals Closed" value={deals.toLocaleString()} detail="Closed deals recorded from follow-up activity." />
        <MetricCard label="Deals Lost" value={dealsLost.toLocaleString()} detail="Lost deals recorded from follow-up activity." />
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <form action={saveCallBlock} className="card space-y-5">
          <input type="hidden" name="range" value={activeRange} />
          <DateWindowHiddenInputs from={dateWindow.fromKey} to={dateWindow.toKey} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Call Block</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Record first outreach</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Use this for the original call batch. Edit this block later when a voicemail, email, or text turns into a sample.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Activity date
              <input className="input mt-2" name="activity_date" type="date" defaultValue={todayKey} required />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Block label
              <input className="input mt-2" name="block_label" placeholder="Morning calls, detox centers, follow-up batch" />
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/55 p-4">
            <p className="text-sm font-semibold text-slate-950">Outreach outcomes</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumberField label="No contact" name="calls_no_contact" />
              <NumberField label="Left voicemail" name="calls_voicemail" />
              <NumberField label="Sent email" name="calls_email" />
              <NumberField label="Made contact" name="calls_contact" />
              <NumberField label="Text message" name="calls_text" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/55 p-4">
            <p className="text-sm font-semibold text-slate-950">Samples sent by source</p>
            <p className="mt-1 text-sm text-slate-500">If someone replies later, edit the original call block and add the sample under the source that created it.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumberField label="From made contact" name="samples_from_contact" />
              <NumberField label="From voicemail callback" name="samples_from_voicemail_callback" />
              <NumberField label="From email reply" name="samples_from_email_reply" />
              <NumberField label="From text reply" name="samples_from_text_reply" />
              <NumberField label="Other sample source" name="samples_other" />
            </div>
          </div>

          <label className="text-sm font-semibold text-slate-700">
            Notes
            <input className="input mt-2" name="notes" placeholder="Callback details, sample recipient, next step" />
          </label>

          <button className="btn-primary w-full" data-press-lock-key="prospecting-save-call-block" type="submit">Save call block</button>
        </form>

        <form action={saveFollowUpBlock} className="card space-y-5">
          <input type="hidden" name="range" value={activeRange} />
          <DateWindowHiddenInputs from={dateWindow.fromKey} to={dateWindow.toKey} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Follow-Up Block</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Record follow-up activity</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Use this when you are following up after samples, replies, quotes, or active sales conversations.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Activity date
              <input className="input mt-2" name="activity_date" type="date" defaultValue={todayKey} required />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Block label
              <input className="input mt-2" name="block_label" placeholder="Sample follow-ups, quote replies, close attempts" />
            </label>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/55 p-4">
            <p className="text-sm font-semibold text-slate-950">Follow-ups completed</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <NumberField label="Email follow-ups" name="followups_email" />
              <NumberField label="Phone follow-ups" name="followups_phone" />
              <NumberField label="Text follow-ups" name="followups_text" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/55 p-4">
            <p className="text-sm font-semibold text-slate-950">Deals closed by source</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <NumberField label="Closed by email" name="deals_closed_email" />
              <NumberField label="Closed by phone" name="deals_closed_phone" />
              <NumberField label="Closed by text" name="deals_closed_text" />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/70 bg-white/55 p-4">
            <p className="text-sm font-semibold text-slate-950">Deals lost by source</p>
            <p className="mt-1 text-sm text-slate-500">Use this when a prospect clearly says no, chooses another vendor, or stops the deal after follow-up.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <NumberField label="Lost by email" name="deals_lost_email" />
              <NumberField label="Lost by phone" name="deals_lost_phone" />
              <NumberField label="Lost by text" name="deals_lost_text" />
            </div>
          </div>

          <label className="text-sm font-semibold text-slate-700">
            Notes
            <input className="input mt-2" name="notes" placeholder="Follow-up context, decision maker, close notes" />
          </label>

          <button className="btn-primary w-full" data-press-lock-key="prospecting-save-follow-up-block" type="submit">Save follow-up block</button>
        </form>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <section className="card space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Outreach Outcomes</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">How first touches are ending</h2>
          </div>
          <BreakdownBar label="No contact" value={totals.callsNoContact} total={outreach} />
          <BreakdownBar label="Left voicemail" value={totals.callsVoicemail} total={outreach} />
          <BreakdownBar label="Sent email" value={totals.callsEmail} total={outreach} />
          <BreakdownBar label="Made contact" value={totals.callsContact} total={outreach} />
          <BreakdownBar label="Text message" value={totals.callsText} total={outreach} />
        </section>

        <section className="card space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sample Sources</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">What creates samples</h2>
          </div>
          <BreakdownBar label="Made contact to sample" value={totals.samplesFromContact} total={samples} />
          <BreakdownBar label="Voicemail callback to sample" value={totals.samplesFromVoicemailCallback} total={samples} />
          <BreakdownBar label="Email reply to sample" value={totals.samplesFromEmailReply} total={samples} />
          <BreakdownBar label="Text reply to sample" value={totals.samplesFromTextReply} total={samples} />
          <BreakdownBar label="Other sample source" value={totals.samplesOther} total={samples} />
          <div className="grid gap-3 pt-2 sm:grid-cols-4">
            <div className="rounded-2xl bg-white/60 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Contacts to Samples</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{ratio(totals.samplesFromContact, totals.callsContact)}</p>
            </div>
            <div className="rounded-2xl bg-white/60 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Emails to Samples</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{ratio(totals.samplesFromEmailReply, totals.callsEmail)}</p>
            </div>
            <div className="rounded-2xl bg-white/60 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Texts to Samples</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{ratio(totals.samplesFromTextReply, totals.callsText)}</p>
            </div>
            <div className="rounded-2xl bg-white/60 px-3 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Voicemails to Samples</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{ratio(totals.samplesFromVoicemailCallback, totals.callsVoicemail)}</p>
            </div>
          </div>
        </section>
      </section>

      <section className="card space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Reporting</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{activeRangeLabel} prospecting activity</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Grouped by {activeRangeLabel.toLowerCase()} inside {activeWindowLabel.toLowerCase()}.</p>
          </div>
          <nav aria-label="Prospecting report range" className="grid gap-2 sm:grid-cols-4">
            {PROSPECTING_RANGES.map((range) => {
              const active = activeRange === range.id;
              return (
                <Link
                  key={range.id}
                  aria-current={active ? 'page' : undefined}
                  className={`rounded-2xl border px-4 py-3 text-sm transition-all duration-200 ${
                    active ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/60 text-slate-700 hover:border-teal-200 hover:bg-white'
                  }`}
                  href={rangeHref(range.id, dateWindow.fromKey, dateWindow.toKey)}
                >
                  <span className="font-semibold">{range.label}</span>
                  <span className="mt-1 block text-xs opacity-75">{range.description}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[128rem] border-separate border-spacing-y-2 text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-4 py-2">Period</th>
                <th className="px-4 py-2 text-right">Outreach</th>
                <th className="px-4 py-2 text-right">No contact</th>
                <th className="px-4 py-2 text-right">Voicemail</th>
                <th className="px-4 py-2 text-right">Email</th>
                <th className="px-4 py-2 text-right">Contact</th>
                <th className="px-4 py-2 text-right">Text</th>
                <th className="px-4 py-2 text-right">Samples</th>
                <th className="px-4 py-2 text-right">Follow-ups</th>
                <th className="px-4 py-2 text-right">Deals won</th>
                <th className="px-4 py-2 text-right">Deals lost</th>
                <th className="px-4 py-2 text-right">Outreach to samples</th>
                <th className="px-4 py-2 text-right">Samples to deals</th>
                <th className="px-4 py-2 text-right">Follow-ups to deals</th>
                <th className="px-4 py-2 text-right">Loss rate</th>
                <th className="px-4 py-2 text-right">Contacts to samples</th>
                <th className="px-4 py-2 text-right">Emails to samples</th>
                <th className="px-4 py-2 text-right">Texts to samples</th>
                <th className="px-4 py-2 text-right">Voicemails to samples</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => {
                const reportOutreach = totalInitialOutreach(report);
                const reportSamples = totalSamples(report);
                const reportFollowUps = totalFollowUps(report);
                const reportDeals = totalDeals(report);
                const reportDealsLost = totalDealsLost(report);
                const reportDecisions = reportDeals + reportDealsLost;
                return (
                  <tr key={report.key} className="bg-white/65">
                    <td className="rounded-l-2xl px-4 py-3">
                      <p className="font-semibold text-slate-950">{report.label}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {report.callBlocks} call block{report.callBlocks === 1 ? '' : 's'} - {report.followUpBlocks} follow-up block{report.followUpBlocks === 1 ? '' : 's'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-950">{reportOutreach}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{report.callsNoContact}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{report.callsVoicemail}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{report.callsEmail}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{report.callsContact}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{report.callsText}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-950">{reportSamples}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-950">{reportFollowUps}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-950">{reportDeals}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-950">{reportDealsLost}</td>
                    <td className="px-4 py-3 text-right text-teal-800">{ratio(reportSamples, reportOutreach)}</td>
                    <td className="px-4 py-3 text-right text-teal-800">{ratio(reportDeals, reportSamples)}</td>
                    <td className="px-4 py-3 text-right text-teal-800">{ratio(reportDeals, reportFollowUps)}</td>
                    <td className="px-4 py-3 text-right text-rose-700">{ratio(reportDealsLost, reportDecisions)}</td>
                    <td className="px-4 py-3 text-right text-teal-800">{ratio(report.samplesFromContact, report.callsContact)}</td>
                    <td className="px-4 py-3 text-right text-teal-800">{ratio(report.samplesFromEmailReply, report.callsEmail)}</td>
                    <td className="px-4 py-3 text-right text-teal-800">{ratio(report.samplesFromTextReply, report.callsText)}</td>
                    <td className="rounded-r-2xl px-4 py-3 text-right text-teal-800">{ratio(report.samplesFromVoicemailCallback, report.callsVoicemail)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!reports.length ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center text-sm text-slate-500">
            No prospecting activity has been recorded yet.
          </div>
        ) : null}
      </section>

      <section className="card space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent Call Blocks</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Edit samples back into the original outreach</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {recentCallBlocks.map((block) => {
            const blockTotals = emptyCallTotals();
            addCallBlockToTotals(blockTotals, block);
            return (
              <div key={block.id} className="rounded-2xl border border-slate-200/70 bg-white/60 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{block.block_label || 'Call block'}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatLongDate(parseActivityDate(block.activity_date))}</p>
                  </div>
                  <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{totalInitialOutreach(blockTotals)} outreach</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  <SummaryTile label="No contact" value={blockTotals.callsNoContact} />
                  <SummaryTile label="Voicemail" value={blockTotals.callsVoicemail} />
                  <SummaryTile label="Email" value={blockTotals.callsEmail} />
                  <SummaryTile label="Contact" value={blockTotals.callsContact} />
                  <SummaryTile label="Text" value={blockTotals.callsText} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <SummaryTile label="Samples" value={totalSamples(blockTotals)} />
                  <SummaryTile label="Email samples" value={blockTotals.samplesFromEmailReply} />
                  <SummaryTile label="Text samples" value={blockTotals.samplesFromTextReply} />
                </div>
                {block.notes ? <p className="mt-3 text-sm leading-6 text-slate-500">{block.notes}</p> : null}
                <details className="mt-4 rounded-2xl border border-slate-200/70 bg-white/70 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-teal-800">Edit call block</summary>
                  <form action={updateCallBlock} className="mt-4 space-y-4">
                    <input type="hidden" name="range" value={activeRange} />
                    <DateWindowHiddenInputs from={dateWindow.fromKey} to={dateWindow.toKey} />
                    <input type="hidden" name="block_id" value={block.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-slate-700">
                        Activity date
                        <input className="input mt-2" name="activity_date" type="date" defaultValue={block.activity_date} required />
                      </label>
                      <label className="text-sm font-semibold text-slate-700">
                        Block label
                        <input className="input mt-2" name="block_label" defaultValue={block.block_label ?? ''} />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <NumberField defaultValue={block.calls_no_contact} label="No contact" name="calls_no_contact" />
                      <NumberField defaultValue={block.calls_voicemail} label="Left voicemail" name="calls_voicemail" />
                      <NumberField defaultValue={block.calls_email} label="Sent email" name="calls_email" />
                      <NumberField defaultValue={block.calls_contact} label="Made contact" name="calls_contact" />
                      <NumberField defaultValue={block.calls_text} label="Text message" name="calls_text" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <NumberField defaultValue={block.samples_from_contact} label="From made contact" name="samples_from_contact" />
                      <NumberField defaultValue={block.samples_from_voicemail_callback} label="From voicemail callback" name="samples_from_voicemail_callback" />
                      <NumberField defaultValue={block.samples_from_email_reply} label="From email reply" name="samples_from_email_reply" />
                      <NumberField defaultValue={block.samples_from_text_reply} label="From text reply" name="samples_from_text_reply" />
                      <NumberField defaultValue={block.samples_other} label="Other sample source" name="samples_other" />
                    </div>
                    <label className="text-sm font-semibold text-slate-700">
                      Notes
                      <input className="input mt-2" name="notes" defaultValue={block.notes ?? ''} />
                    </label>
                    <button className="btn-primary w-full" data-press-lock-key={`prospecting-update-call-block-${block.id}`} type="submit">Update call block</button>
                  </form>
                </details>
                <form action={deleteCallBlock} className="mt-3">
                  <input type="hidden" name="range" value={activeRange} />
                  <DateWindowHiddenInputs from={dateWindow.fromKey} to={dateWindow.toKey} />
                  <input type="hidden" name="block_id" value={block.id} />
                  <ConfirmSubmitButton
                    className="w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
                    confirmMessage="Delete this call block? This should only be used to remove duplicate or mistaken entries."
                    label="Delete call block"
                    pendingLabel="Deleting..."
                  />
                </form>
              </div>
            );
          })}
        </div>
        {!recentCallBlocks.length ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center text-sm text-slate-500">No call blocks have been recorded yet.</div> : null}
      </section>

      <section className="card space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent Follow-Up Blocks</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Follow-ups and closed deals</h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {recentFollowUpBlocks.map((block) => {
            const blockTotals = emptyFollowUpTotals();
            addFollowUpBlockToTotals(blockTotals, block);
            return (
              <div key={block.id} className="rounded-2xl border border-slate-200/70 bg-white/60 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{block.block_label || 'Follow-up block'}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatLongDate(parseActivityDate(block.activity_date))}</p>
                  </div>
                  <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{totalFollowUps(blockTotals)} follow-ups</p>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <SummaryTile label="Email" value={blockTotals.followupsEmail} />
                  <SummaryTile label="Phone" value={blockTotals.followupsPhone} />
                  <SummaryTile label="Text" value={blockTotals.followupsText} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <SummaryTile label="Email deals" value={blockTotals.dealsClosedEmail} />
                  <SummaryTile label="Phone deals" value={blockTotals.dealsClosedPhone} />
                  <SummaryTile label="Text deals" value={blockTotals.dealsClosedText} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <SummaryTile label="Email lost" value={blockTotals.dealsLostEmail} />
                  <SummaryTile label="Phone lost" value={blockTotals.dealsLostPhone} />
                  <SummaryTile label="Text lost" value={blockTotals.dealsLostText} />
                </div>
                {block.notes ? <p className="mt-3 text-sm leading-6 text-slate-500">{block.notes}</p> : null}
                <details className="mt-4 rounded-2xl border border-slate-200/70 bg-white/70 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-teal-800">Edit follow-up block</summary>
                  <form action={updateFollowUpBlock} className="mt-4 space-y-4">
                    <input type="hidden" name="range" value={activeRange} />
                    <DateWindowHiddenInputs from={dateWindow.fromKey} to={dateWindow.toKey} />
                    <input type="hidden" name="block_id" value={block.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-sm font-semibold text-slate-700">
                        Activity date
                        <input className="input mt-2" name="activity_date" type="date" defaultValue={block.activity_date} required />
                      </label>
                      <label className="text-sm font-semibold text-slate-700">
                        Block label
                        <input className="input mt-2" name="block_label" defaultValue={block.block_label ?? ''} />
                      </label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <NumberField defaultValue={block.followups_email} label="Email follow-ups" name="followups_email" />
                      <NumberField defaultValue={block.followups_phone} label="Phone follow-ups" name="followups_phone" />
                      <NumberField defaultValue={block.followups_text} label="Text follow-ups" name="followups_text" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <NumberField defaultValue={block.deals_closed_email} label="Closed by email" name="deals_closed_email" />
                      <NumberField defaultValue={block.deals_closed_phone} label="Closed by phone" name="deals_closed_phone" />
                      <NumberField defaultValue={block.deals_closed_text} label="Closed by text" name="deals_closed_text" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <NumberField defaultValue={block.deals_lost_email} label="Lost by email" name="deals_lost_email" />
                      <NumberField defaultValue={block.deals_lost_phone} label="Lost by phone" name="deals_lost_phone" />
                      <NumberField defaultValue={block.deals_lost_text} label="Lost by text" name="deals_lost_text" />
                    </div>
                    <label className="text-sm font-semibold text-slate-700">
                      Notes
                      <input className="input mt-2" name="notes" defaultValue={block.notes ?? ''} />
                    </label>
                    <button className="btn-primary w-full" data-press-lock-key={`prospecting-update-follow-up-block-${block.id}`} type="submit">Update follow-up block</button>
                  </form>
                </details>
                <form action={deleteFollowUpBlock} className="mt-3">
                  <input type="hidden" name="range" value={activeRange} />
                  <DateWindowHiddenInputs from={dateWindow.fromKey} to={dateWindow.toKey} />
                  <input type="hidden" name="block_id" value={block.id} />
                  <ConfirmSubmitButton
                    className="w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
                    confirmMessage="Delete this follow-up block? This should only be used to remove duplicate or mistaken entries."
                    label="Delete follow-up block"
                    pendingLabel="Deleting..."
                  />
                </form>
              </div>
            );
          })}
        </div>
        {!recentFollowUpBlocks.length ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center text-sm text-slate-500">No follow-up blocks have been recorded yet.</div> : null}
      </section>
    </div>
  );
}

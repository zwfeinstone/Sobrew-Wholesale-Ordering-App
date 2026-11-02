import type { PayrollWageEntry } from '@/lib/payroll-wages';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type DeferredPayPlan = {
  id: string;
  profile_id: string;
  label: string;
  start_date: string;
  end_date: string;
  payout_date: string;
  accrual_rate_cents: number;
  weekly_rate_cents: number;
  paid_at: string | null;
  paid_amount_cents: number | null;
  accounting_transaction_id?: string | null;
  paid_by?: string | null;
  payment_notes?: string | null;
};

export type DeferredPayEntry = PayrollWageEntry;
export type DeferredPayStatus = 'scheduled' | 'accruing' | 'awaiting_payment' | 'paid';

type EligibleTime = {
  eligibleMilliseconds: number;
  eligibleMinutes: number;
  eligibleHours: number;
  accruedCents: number;
};

export type DeferredPayEntrySummary = EligibleTime & {
  entryId: string;
  clockInAt: string;
  clockOutAt: string;
  workType: string | null;
};

export type DeferredPayWeekSummary = EligibleTime & {
  weekStartDate: string;
  weekEndDate: string;
  entryCount: number;
  /** A shift spanning weeks has only this week's time and cents in this array. */
  entries: DeferredPayEntrySummary[];
};

export type DeferredPaySummary = EligibleTime & {
  planId: string;
  asOf: string;
  status: DeferredPayStatus;
  paidCents: number;
  remainingCents: number;
  entryCount: number;
  entries: DeferredPayEntrySummary[];
  weeks: DeferredPayWeekSummary[];
};

type Interval = { start: number; end: number };
type EntryWeek = {
  entry: DeferredPayEntry;
  weekStartDate: string;
  firstPaidAt: number;
  milliseconds: number;
  cents: number;
};

function calendarDate(input: string) {
  return new Date(`${input}T00:00:00.000Z`);
}

function addCalendarDays(input: string, days: number) {
  return new Date(calendarDate(input).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function centralMidnight(input: string) {
  const date = parseCentralDateInput(input);
  if (!date || !Number.isFinite(date.getTime()) || formatCentralDateInput(date) !== input) {
    throw new RangeError(`Invalid Central calendar date: ${input}`);
  }
  return date.getTime();
}

function weekStartFor(timestamp: number) {
  const input = formatCentralDateInput(new Date(timestamp));
  const weekday = calendarDate(input).getUTCDay();
  return addCalendarDays(input, -(weekday === 0 ? 6 : weekday - 1));
}

function validateCents(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be nonnegative whole cents.`);
}

/** Subtract the union of completed breaks after clipping both shift and breaks. */
function eligibleIntervals(entry: DeferredPayEntry, start: number, end: number, now: number): Interval[] {
  if (entry.status === 'void' || entry.status === 'open' || !entry.clock_out_at) return [];
  const clockIn = Date.parse(entry.clock_in_at);
  const clockOut = Date.parse(entry.clock_out_at);
  if (!Number.isFinite(clockIn) || !Number.isFinite(clockOut) || clockOut <= clockIn || clockOut > now) return [];
  const clippedStart = Math.max(clockIn, start);
  const clippedEnd = Math.min(clockOut, end, now);
  if (clippedEnd <= clippedStart) return [];

  const breaks = (entry.admin_time_breaks ?? [])
    .filter((row) => row.status !== 'void' && row.status !== 'open' && row.break_end_at)
    .map((row) => ({ start: Math.max(clippedStart, Date.parse(row.break_start_at)), end: Math.min(clippedEnd, Date.parse(row.break_end_at!)) }))
    .filter((row) => Number.isFinite(row.start) && Number.isFinite(row.end) && row.end > row.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const intervals: Interval[] = [];
  let cursor = clippedStart;
  for (const row of breaks) {
    if (row.start > cursor) intervals.push({ start: cursor, end: row.start });
    cursor = Math.max(cursor, row.end);
  }
  if (cursor < clippedEnd) intervals.push({ start: cursor, end: clippedEnd });
  return intervals;
}

function timeSummary(milliseconds: number, accruedCents: number): EligibleTime {
  return { eligibleMilliseconds: milliseconds, eligibleMinutes: milliseconds / 60_000, eligibleHours: milliseconds / HOUR_MS, accruedCents };
}

function entrySummary(row: EntryWeek): DeferredPayEntrySummary {
  return {
    entryId: row.entry.id,
    clockInAt: row.entry.clock_in_at,
    clockOutAt: row.entry.clock_out_at!,
    workType: row.entry.work_type ?? null,
    ...timeSummary(row.milliseconds, row.cents),
  };
}

/**
 * A flat accrual independent of base wages and overtime. Supply all shifts that
 * overlap the plan, including prior-year and already-paid shifts. Dates are
 * inclusive Central calendar dates; only completed shifts as of `now` accrue.
 * Histories are chronological. Round the aggregate once, then assign remainder
 * cents to entry/week portions so both histories reconcile to that same total.
 */
export function calculateDeferredPay(
  plan: DeferredPayPlan,
  entries: readonly DeferredPayEntry[],
  now = new Date(),
  { earnedBefore }: { earnedBefore?: Date } = {},
): DeferredPaySummary {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new RangeError('The accrual date must be valid.');
  const start = centralMidnight(plan.start_date);
  const lastDay = centralMidnight(plan.end_date);
  const payout = centralMidnight(plan.payout_date);
  if (lastDay < start) throw new RangeError('The accrual end date must not precede its start date.');
  if (earnedBefore && !Number.isFinite(earnedBefore.getTime())) throw new RangeError('The earnings cutoff must be valid.');
  // A historical report clips earned time, while retaining shifts completed as
  // of the report run. This includes the right side of overnight month splits.
  const end = Math.min(centralMidnight(addCalendarDays(plan.end_date, 1)), earnedBefore?.getTime() ?? Infinity);
  validateCents(plan.accrual_rate_cents, 'The accrual rate');
  if (plan.paid_amount_cents !== null) validateCents(plan.paid_amount_cents, 'The paid amount');

  const portions: EntryWeek[] = [];
  for (const entry of entries) {
    if (entry.profile_id !== plan.profile_id) continue;
    const byWeek = new Map<string, EntryWeek>();
    for (const interval of eligibleIntervals(entry, start, end, nowMs)) {
      let cursor = interval.start;
      while (cursor < interval.end) {
        const weekStartDate = weekStartFor(cursor);
        const segmentEnd = Math.min(interval.end, centralMidnight(addCalendarDays(weekStartDate, 7)));
        const row = byWeek.get(weekStartDate) ?? { entry, weekStartDate, firstPaidAt: cursor, milliseconds: 0, cents: 0 };
        row.milliseconds += segmentEnd - cursor;
        byWeek.set(weekStartDate, row);
        cursor = segmentEnd;
      }
    }
    portions.push(...byWeek.values());
  }
  portions.sort((left, right) => left.firstPaidAt - right.firstPaidAt || left.entry.id.localeCompare(right.entry.id));

  // Integer numerators preserve millisecond precision even at rounding ties.
  const denominator = BigInt(HOUR_MS);
  const rate = BigInt(plan.accrual_rate_cents);
  const numerators = portions.map((row) => BigInt(row.milliseconds) * rate);
  const numeratorTotal = numerators.reduce((sum, numerator) => sum + numerator, 0n);
  const accruedCents = Number((numeratorTotal + denominator / 2n) / denominator);
  if (!Number.isSafeInteger(accruedCents)) throw new RangeError('The accrued amount exceeds supported currency precision.');
  portions.forEach((row, index) => { row.cents = Number(numerators[index] / denominator); });
  const remainderOrder = numerators.map((numerator, index) => ({ index, remainder: numerator % denominator }))
    .sort((left, right) => left.remainder === right.remainder ? left.index - right.index : left.remainder > right.remainder ? -1 : 1);
  const remainingPennies = accruedCents - portions.reduce((sum, row) => sum + row.cents, 0);
  for (let index = 0; index < remainingPennies; index += 1) portions[remainderOrder[index].index].cents += 1;

  const entryRows = new Map<string, DeferredPayEntrySummary>();
  const weekRows = new Map<string, DeferredPayWeekSummary>();
  for (const row of portions) {
    const part = entrySummary(row);
    const previous = entryRows.get(row.entry.id);
    entryRows.set(row.entry.id, previous ? {
      ...previous,
      ...timeSummary(previous.eligibleMilliseconds + row.milliseconds, previous.accruedCents + row.cents),
    } : part);
    const week = weekRows.get(row.weekStartDate) ?? {
      weekStartDate: row.weekStartDate,
      weekEndDate: addCalendarDays(row.weekStartDate, 6),
      entryCount: 0,
      entries: [],
      ...timeSummary(0, 0),
    };
    week.entries.push(part);
    week.entryCount += 1;
    Object.assign(week, timeSummary(week.eligibleMilliseconds + row.milliseconds, week.accruedCents + row.cents));
    weekRows.set(row.weekStartDate, week);
  }

  const paidAt = plan.paid_at ? Date.parse(plan.paid_at) : NaN;
  const hasRecordedPayment = Number.isFinite(paidAt) && paidAt <= nowMs && plan.paid_amount_cents !== null;
  const paidCents = hasRecordedPayment ? plan.paid_amount_cents! : 0;
  const remainingCents = Math.max(0, accruedCents - paidCents);
  const status: DeferredPayStatus = hasRecordedPayment && remainingCents === 0 ? 'paid'
    : nowMs < start ? 'scheduled' : nowMs < payout ? 'accruing' : 'awaiting_payment';
  return {
    planId: plan.id,
    asOf: now.toISOString(),
    status,
    ...timeSummary(portions.reduce((sum, row) => sum + row.milliseconds, 0), accruedCents),
    paidCents,
    remainingCents,
    entryCount: entryRows.size,
    entries: [...entryRows.values()],
    weeks: [...weekRows.values()].sort((left, right) => left.weekStartDate.localeCompare(right.weekStartDate)),
  };
}

import {
  formatCentralDateInput,
  normalizeMoneyCents,
  parseCentralDateInput,
  type TimeClockBreakRow,
  type TimeClockEntryRow,
} from '@/lib/time-clock';

const WEEKLY_REGULAR_MINUTES = 40 * 60;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type PayrollWageEntry = TimeClockEntryRow & {
  id: string;
  profile_id: string | null;
  admin_time_breaks?: TimeClockBreakRow[] | null;
};

export type PayrollEntryWages = {
  minutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  baseWageCents: number;
  overtimePremiumCents: number;
  wageCents: number;
};

type Interval = { start: number; end: number };

function emptyWages(): PayrollEntryWages {
  return { minutes: 0, regularMinutes: 0, overtimeMinutes: 0, baseWageCents: 0, overtimePremiumCents: 0, wageCents: 0 };
}

function calendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addCalendarDays(value: string, days: number) {
  return new Date(calendarDate(value).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function mondayDateInput(date: Date) {
  const input = formatCentralDateInput(date);
  const weekday = calendarDate(input).getUTCDay();
  return addCalendarDays(input, -(weekday === 0 ? 6 : weekday - 1));
}

/** Include every full Central workweek touched by the inclusive selection. */
export function payrollOvertimeContextRange(start: Date, end: Date): { start: Date; endExclusive: Date } {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) {
    throw new RangeError('Payroll dates must be valid and the end must not precede the start.');
  }
  return {
    start: parseCentralDateInput(mondayDateInput(start))!,
    endExclusive: parseCentralDateInput(addCalendarDays(mondayDateInput(end), 7))!,
  };
}

/** Subtract the union of completed breaks, clipped to the actual shift. */
function paidIntervals(entry: PayrollWageEntry): Interval[] {
  if (entry.status === 'void' || entry.status === 'open' || !entry.clock_out_at) return [];
  const start = Date.parse(entry.clock_in_at);
  const end = Date.parse(entry.clock_out_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const breaks = (entry.admin_time_breaks ?? [])
    .filter((entryBreak) => entryBreak.status !== 'void' && entryBreak.break_end_at)
    .map((entryBreak) => ({
      start: Math.max(start, Date.parse(entryBreak.break_start_at)),
      end: Math.min(end, Date.parse(entryBreak.break_end_at!)),
    }))
    .filter((entryBreak) => Number.isFinite(entryBreak.start) && Number.isFinite(entryBreak.end) && entryBreak.end > entryBreak.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const intervals: Interval[] = [];
  let cursor = start;
  for (const entryBreak of breaks) {
    if (entryBreak.start > cursor) intervals.push({ start: cursor, end: entryBreak.start });
    cursor = Math.max(cursor, entryBreak.end);
  }
  if (cursor < end) intervals.push({ start: cursor, end });
  return intervals;
}

/**
 * Calculate hourly pay with a 50% premium after 40 paid hours per employee,
 * Monday–Sunday in Central time. Supply the full workweek before filtering rows.
 * Each entry keeps its snapshotted rate; paid/locked entries still use up hours.
 */
export function calculatePayrollWages(entries: readonly PayrollWageEntry[]): Map<string, PayrollEntryWages> {
  const wages = new Map<string, PayrollEntryWages>();
  const employeeWeeks = new Map<string, Map<string, number>>();
  const ordered = [...entries].sort((left, right) => {
    const leftTime = Date.parse(left.clock_in_at);
    const rightTime = Date.parse(right.clock_in_at);
    const byTime = (Number.isFinite(leftTime) ? leftTime : Infinity) - (Number.isFinite(rightTime) ? rightTime : Infinity);
    return byTime || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });

  for (const entry of ordered) {
    const pay = emptyWages();
    // Missing identities cannot safely be combined into one employee's week.
    const employeeKey = entry.profile_id ? `profile:${entry.profile_id}` : `entry:${entry.id}`;
    const weeks = employeeWeeks.get(employeeKey) ?? new Map<string, number>();
    employeeWeeks.set(employeeKey, weeks);

    for (const interval of paidIntervals(entry)) {
      let cursor = interval.start;
      while (cursor < interval.end) {
        const week = mondayDateInput(new Date(cursor));
        const nextWeek = parseCentralDateInput(addCalendarDays(week, 7))!.getTime();
        const segmentEnd = Math.min(interval.end, nextWeek);
        const minutes = (segmentEnd - cursor) / MINUTE_MS;
        const priorMinutes = weeks.get(week) ?? 0;
        const regularMinutes = Math.min(minutes, Math.max(0, WEEKLY_REGULAR_MINUTES - priorMinutes));
        pay.minutes += minutes;
        pay.regularMinutes += regularMinutes;
        pay.overtimeMinutes += minutes - regularMinutes;
        weeks.set(week, priorMinutes + minutes);
        cursor = segmentEnd;
      }
    }

    const rate = Math.max(0, normalizeMoneyCents(entry.hourly_rate_cents_snapshot));
    pay.baseWageCents = Math.round(pay.minutes / 60 * rate);
    pay.overtimePremiumCents = Math.round(pay.overtimeMinutes / 60 * rate * 0.5);
    pay.wageCents = pay.baseWageCents + pay.overtimePremiumCents;
    wages.set(entry.id, pay);
  }
  return wages;
}

function distributeCents(total: number, weights: readonly number[], weightSum: number) {
  const shares = weights.map((weight) => total * weight / weightSum);
  const allocated = shares.map(Math.floor);
  const remaining = Math.round(total - allocated.reduce((sum, cents) => sum + cents, 0));
  const largestRemainders = shares
    .map((share, index) => ({ index, remainder: share - allocated[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) allocated[largestRemainders[index].index] += 1;
  return allocated;
}

/**
 * Share an entry's pay across labor allocations (including any unallocated time).
 * Base pay and overtime premium each preserve their cent totals. Zero weights
 * receive nothing; if every weight is zero, the first slot retains the total.
 */
export function distributePayrollWages(pay: PayrollEntryWages, weights: readonly number[]): PayrollEntryWages[] {
  if (weights.length === 0) return [];
  const normalized = weights.map((weight) => Number.isFinite(weight) ? Math.max(0, weight) : 0);
  let weightSum = normalized.reduce((sum, weight) => sum + weight, 0);
  if (weightSum === 0) {
    normalized[0] = 1;
    weightSum = 1;
  }
  const base = distributeCents(pay.baseWageCents, normalized, weightSum);
  const premium = distributeCents(pay.overtimePremiumCents, normalized, weightSum);
  const lastPositive = normalized.reduce((last, weight, index) => weight > 0 ? index : last, 0);
  let remainingMinutes = pay.minutes;
  let remainingRegularMinutes = pay.regularMinutes;
  let remainingOvertimeMinutes = pay.overtimeMinutes;

  return normalized.map((weight, index) => {
    const ratio = weight / weightSum;
    const minutes = index === lastPositive ? remainingMinutes : pay.minutes * ratio;
    const regularMinutes = index === lastPositive ? remainingRegularMinutes : pay.regularMinutes * ratio;
    const overtimeMinutes = index === lastPositive ? remainingOvertimeMinutes : pay.overtimeMinutes * ratio;
    remainingMinutes -= minutes;
    remainingRegularMinutes -= regularMinutes;
    remainingOvertimeMinutes -= overtimeMinutes;
    return {
      minutes,
      regularMinutes,
      overtimeMinutes,
      baseWageCents: base[index],
      overtimePremiumCents: premium[index],
      wageCents: base[index] + premium[index],
    };
  });
}

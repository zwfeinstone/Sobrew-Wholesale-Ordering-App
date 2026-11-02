import { distributePayrollWages, type PayrollWageEntry } from '@/lib/payroll-wages';
import { formatCentralDateInput, parseCentralDateInput, type TimeClockBreakRow } from '@/lib/time-clock';
import { fetchAllByIds, type QueryError } from '@/lib/supabase/pagination';

type SupabaseLike = { from: (table: string) => any };
type Interval = { start: number; end: number };

export type HourlyOffsetCommissionSettings = {
  profile_id: string;
  commission_percent: number | string | null;
  hourly_offset_enabled?: boolean;
  hourly_offset_start_month?: string | null;
};

export type MonthlyHourlyBaseWages = {
  hourlyBaseWagesCents: number;
  settlementBlockedReason: string | null;
};

export function commissionHourlyOffsetApplies(settings: HourlyOffsetCommissionSettings | undefined, month: string) {
  if (!settings?.hourly_offset_enabled) return false;
  const start = settings.hourly_offset_start_month;
  if (start && !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(start)) throw new Error('The hourly commission offset start month is invalid.');
  return !start || month >= start;
}

function nextMonth(month: string) {
  const date = new Date(`${month}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function monthBounds(month: string) {
  return { start: parseCentralDateInput(month)!.getTime(), end: parseCentralDateInput(nextMonth(month))!.getTime() };
}

/** Completed, paid intervals after subtracting the union of unpaid breaks. */
function paidIntervals(entry: PayrollWageEntry, start: number, end: number): Interval[] {
  const breaks = (entry.admin_time_breaks ?? [])
    .filter((row) => row.status !== 'void')
    .map((row) => ({ start: Math.max(start, Date.parse(row.break_start_at)), end: Math.min(end, Date.parse(row.break_end_at!)) }))
    .filter((row) => row.end > row.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const paid: Interval[] = [];
  let cursor = start;
  for (const entryBreak of breaks) {
    if (entryBreak.start > cursor) paid.push({ start: cursor, end: entryBreak.start });
    cursor = Math.max(cursor, entryBreak.end);
  }
  if (cursor < end) paid.push({ start: cursor, end });
  return paid;
}

/**
 * Base hourly wages only: every work type, saved hourly rate, no overtime premium
 * or SPIFFs. Split paid intervals at Central month boundaries and preserve each
 * shift's rounded wage total when a shift crosses months.
 */
export function calculateMonthlyHourlyBaseWages(
  entries: readonly PayrollWageEntry[], month: string, now = new Date(),
): MonthlyHourlyBaseWages {
  const bounds = monthBounds(month);
  let hourlyBaseWagesCents = 0;
  let unfinished = false;
  let unapproved = false;
  for (const entry of entries) {
    if (entry.status === 'void') continue;
    const clockIn = Date.parse(entry.clock_in_at);
    const clockOut = entry.clock_out_at ? Date.parse(entry.clock_out_at) : Infinity;
    if (!Number.isFinite(clockIn) || (entry.clock_out_at && (!Number.isFinite(clockOut) || clockOut <= clockIn))) {
      throw new Error('A time entry has invalid dates; correct it before calculating commission.');
    }
    if (clockIn >= bounds.end || clockOut <= bounds.start) continue;
    if (!entry.clock_out_at || entry.status === 'open' || clockOut > now.getTime()) {
      unfinished = true;
      continue;
    }
    if (entry.status !== 'approved' && entry.status !== 'locked') unapproved = true;
    if ((entry.admin_time_breaks ?? []).some((row) => row.status !== 'void' && (!row.break_end_at || row.status === 'open'))) {
      unfinished = true;
      continue;
    }
    for (const entryBreak of entry.admin_time_breaks ?? []) {
      if (entryBreak.status === 'void') continue;
      const start = Date.parse(entryBreak.break_start_at);
      const end = Date.parse(entryBreak.break_end_at!);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        throw new Error('A time entry has invalid break dates; correct it before calculating commission.');
      }
    }
    const rate = Number(entry.hourly_rate_cents_snapshot);
    if (entry.hourly_rate_cents_snapshot == null || !Number.isSafeInteger(rate) || rate < 0) {
      throw new Error('A time entry has an invalid hourly rate; correct it before calculating commission.');
    }
    const byMonth = new Map<string, number>();
    for (const interval of paidIntervals(entry, clockIn, clockOut)) {
      let cursor = interval.start;
      while (cursor < interval.end) {
        const portionMonth = `${formatCentralDateInput(new Date(cursor)).slice(0, 7)}-01`;
        const end = Math.min(interval.end, monthBounds(portionMonth).end);
        byMonth.set(portionMonth, (byMonth.get(portionMonth) ?? 0) + (end - cursor) / 60_000);
        cursor = end;
      }
    }
    const months = [...byMonth.keys()];
    const minutes = [...byMonth.values()].reduce((sum, value) => sum + value, 0);
    const baseWageCents = Math.round(minutes / 60 * rate);
    const portions = distributePayrollWages({ minutes, regularMinutes: minutes, overtimeMinutes: 0,
      baseWageCents, overtimePremiumCents: 0, wageCents: baseWageCents }, [...byMonth.values()]);
    const index = months.indexOf(month);
    if (index !== -1) hourlyBaseWagesCents += portions[index].baseWageCents;
  }
  return { hourlyBaseWagesCents, settlementBlockedReason: unfinished
    ? 'Complete all shifts and breaks for this month before paying commission.'
    : unapproved ? 'Approve or lock all time entries for this month before paying commission.' : null };
}

/** Only offset participants need wage reads; both shifts and breaks are paginated. */
export async function loadCommissionHourlyEntries(supabase: SupabaseLike, profileIds: string[], months: string[]): Promise<{
  entries: PayrollWageEntry[]; error: QueryError | null;
}> {
  if (!profileIds.length || !months.length) return { entries: [], error: null };
  const firstMonth = [...months].sort()[0];
  const lastMonth = [...months].sort().at(-1)!;
  const start = new Date(monthBounds(firstMonth).start).toISOString();
  const end = new Date(monthBounds(lastMonth).end).toISOString();
  const entries = await fetchAllByIds<PayrollWageEntry>(profileIds, (ids, from, to) => supabase.from('admin_time_entries')
    .select('id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,work_type')
    .in('profile_id', ids).or(`clock_out_at.is.null,clock_out_at.gt.${start}`)
    .lt('clock_in_at', end).order('id').range(from, to));
  if (entries.error) return { entries: [], error: entries.error };
  const scopedEntries = entries.data.filter((entry) => entry.profile_id && profileIds.includes(entry.profile_id));
  const breaks = await fetchAllByIds<TimeClockBreakRow & { time_entry_id: string }>(scopedEntries.map((entry) => entry.id), (ids, from, to) => supabase.from('admin_time_breaks')
    .select('time_entry_id,break_start_at,break_end_at,status').in('time_entry_id', ids).order('id').range(from, to));
  if (breaks.error) return { entries: [], error: breaks.error };
  const breaksByEntry = new Map<string, TimeClockBreakRow[]>();
  for (const entryBreak of breaks.data) {
    const rows = breaksByEntry.get(entryBreak.time_entry_id) ?? [];
    rows.push(entryBreak);
    breaksByEntry.set(entryBreak.time_entry_id, rows);
  }
  return { entries: scopedEntries.map((entry) => ({ ...entry, admin_time_breaks: breaksByEntry.get(entry.id) ?? [] })), error: null };
}

import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type SupabaseLike = {
  from: (table: string) => any;
};

type PayrollStatusEntryRow = {
  clock_out_at: string | null;
  id: string;
  status: string | null;
};

type PayrollWeekWindow = {
  dueDateInput: string;
  weekEnd: Date;
  weekEndInput: string;
  weekStart: Date;
  weekStartInput: string;
};

export type WeeklyPayrollStatus = PayrollWeekWindow & {
  badgeCount: number;
  hasCoveringLock: boolean;
  isComplete: boolean;
  isDue: boolean;
  isOverdue: boolean;
  needsApproval: boolean;
  openEntryCount: number;
  payrollHref: string;
  unapprovedEntryCount: number;
};

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

function compareDateInputs(left: string, right: string) {
  return utcDateFromInput(left).getTime() - utcDateFromInput(right).getTime();
}

function weekdayForDateInput(value: string) {
  return utcDateFromInput(value).getUTCDay();
}

function buildWindow(startInput: string): PayrollWeekWindow {
  const weekEndInput = addCalendarDays(startInput, 4);
  const weekStart = parseCentralDateInput(startInput);
  const weekEnd = parseCentralDateInput(weekEndInput, true);
  if (!weekStart || !weekEnd) {
    throw new Error(`Invalid payroll week bounds: ${startInput} to ${weekEndInput}`);
  }
  return {
    dueDateInput: weekEndInput,
    weekEnd,
    weekEndInput,
    weekStart,
    weekStartInput: startInput,
  };
}

export function getCurrentPayrollWeekWindow(now = new Date()): PayrollWeekWindow {
  const todayInput = formatCentralDateInput(now);
  const weekday = weekdayForDateInput(todayInput);
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  return buildWindow(addCalendarDays(todayInput, -daysSinceMonday));
}

function priorPayrollWeekWindow(window: PayrollWeekWindow) {
  return buildWindow(addCalendarDays(window.weekStartInput, -7));
}

function duePayrollWindows(now = new Date()) {
  const current = getCurrentPayrollWeekWindow(now);
  const previous = priorPayrollWeekWindow(current);
  const todayInput = formatCentralDateInput(now);
  const currentWeekIsDue = compareDateInputs(todayInput, current.dueDateInput) >= 0;
  return currentWeekIsDue ? [previous, current] : [previous];
}

function payrollHrefFor(window: PayrollWeekWindow) {
  const search = new URLSearchParams({
    from: window.weekStartInput,
    tab: 'review',
    to: window.weekEndInput,
  });
  return `/admin/payroll?${search.toString()}`;
}

async function evaluatePayrollWindow(supabase: SupabaseLike, window: PayrollWeekWindow, now: Date): Promise<WeeklyPayrollStatus> {
  const [{ data: entries, error: entriesError }, { data: locks, error: locksError }] = await Promise.all([
    supabase
      .from('admin_time_entries')
      .select('id,status,clock_out_at')
      .gte('clock_in_at', window.weekStart.toISOString())
      .lte('clock_in_at', window.weekEnd.toISOString())
      .limit(50000),
    supabase
      .from('admin_payroll_locks')
      .select('id,lock_start_at,lock_end_at')
      .lte('lock_start_at', window.weekStart.toISOString())
      .gte('lock_end_at', window.weekEnd.toISOString())
      .limit(1),
  ]);

  if (entriesError || locksError) {
    console.error('[payroll-status] weekly payroll status failed', {
      entriesError,
      locksError,
      weekEnd: window.weekEnd.toISOString(),
      weekStart: window.weekStart.toISOString(),
    });
  }

  const rows = ((entries ?? []) as PayrollStatusEntryRow[]).filter((entry) => entry.status !== 'void');
  const openEntryCount = rows.filter((entry) => !entry.clock_out_at).length;
  const unapprovedEntryCount = rows.filter((entry) => entry.clock_out_at && !['approved', 'locked'].includes(entry.status ?? '')).length;
  const hasCoveringLock = Boolean((locks ?? []).length);
  const isComplete = hasCoveringLock && openEntryCount === 0 && unapprovedEntryCount === 0;
  const todayInput = formatCentralDateInput(now);
  const isDue = !isComplete && compareDateInputs(todayInput, window.dueDateInput) >= 0;
  const isOverdue = isDue && compareDateInputs(todayInput, window.dueDateInput) > 0;
  const needsApproval = isDue && !isComplete;
  const blockerCount = openEntryCount + unapprovedEntryCount;

  return {
    ...window,
    badgeCount: needsApproval ? Math.max(1, blockerCount) : 0,
    hasCoveringLock,
    isComplete,
    isDue,
    isOverdue,
    needsApproval,
    openEntryCount,
    payrollHref: payrollHrefFor(window),
    unapprovedEntryCount,
  };
}

export async function getWeeklyPayrollStatus({
  now = new Date(),
  supabase = supabaseAdmin,
}: {
  now?: Date;
  supabase?: SupabaseLike;
} = {}) {
  const windows = duePayrollWindows(now);
  const statuses = await Promise.all(windows.map((window) => evaluatePayrollWindow(supabase, window, now)));
  return statuses.find((status) => status.needsApproval) ?? statuses[statuses.length - 1];
}

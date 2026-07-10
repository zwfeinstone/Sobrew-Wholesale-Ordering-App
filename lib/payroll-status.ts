import { cache } from 'react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const PAYROLL_RESULT_LIMIT = 1000;

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

export type MonthlySalaryPayrollWindow = {
  dueDateInput: string;
  payrollMonthInput: string;
  periodEnd: Date;
  periodEndInput: string;
  periodStart: Date;
  periodStartInput: string;
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

export type MonthlySalaryPayrollStatus = MonthlySalaryPayrollWindow & {
  badgeCount: number;
  dueEmployeeCount: number;
  employeeCount: number;
  isComplete: boolean;
  isDue: boolean;
  isOverdue: boolean;
  needsApproval: boolean;
  paidEmployeeCount: number;
  paidSalaryPayCents: number;
  payrollHref: string;
  salaryPayCents: number;
  unpaidSalaryPayCents: number;
};

export type PayrollStatus = {
  badgeCount: number;
  monthlySalary: MonthlySalaryPayrollStatus;
  weekly: WeeklyPayrollStatus;
};

type SalarySettingRow = {
  active: boolean | null;
  compensation_type: string | null;
  profile_id: string;
  salary_amount_cents: number | string | null;
  salary_frequency: string | null;
};

type SalaryPaymentRow = {
  paid_at: string | null;
  profile_id: string;
  salary_pay_cents: number | string | null;
};

type ProfileStatusRow = {
  id: string;
  is_active: boolean | null;
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

function addCalendarMonths(value: string, months: number) {
  const date = utcDateFromInput(value);
  return dateInputFromUtcDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)));
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

export function getCurrentMonthlySalaryPayrollWindow(now = new Date()): MonthlySalaryPayrollWindow {
  const todayInput = formatCentralDateInput(now);
  const currentMonthStartInput = `${todayInput.slice(0, 8)}01`;
  const periodStartInput = addCalendarMonths(currentMonthStartInput, -1);
  const periodEndInput = addCalendarDays(currentMonthStartInput, -1);
  const periodStart = parseCentralDateInput(periodStartInput);
  const periodEnd = parseCentralDateInput(periodEndInput, true);
  if (!periodStart || !periodEnd) {
    throw new Error(`Invalid monthly salary payroll bounds: ${periodStartInput} to ${periodEndInput}`);
  }
  return {
    dueDateInput: currentMonthStartInput,
    payrollMonthInput: periodStartInput,
    periodEnd,
    periodEndInput,
    periodStart,
    periodStartInput,
  };
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

function monthlySalaryPayrollHrefFor(window: MonthlySalaryPayrollWindow) {
  const search = new URLSearchParams({
    from: window.periodStartInput,
    tab: 'review',
    to: window.periodEndInput,
  });
  return `/admin/payroll?${search.toString()}`;
}

function moneyCents(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function evaluatePayrollWindow(supabase: SupabaseLike, window: PayrollWeekWindow, now: Date): Promise<WeeklyPayrollStatus> {
  const [{ data: entries, error: entriesError }, { data: locks, error: locksError }] = await Promise.all([
    supabase
      .from('admin_time_entries')
      .select('id,status,clock_out_at')
      .gte('clock_in_at', window.weekStart.toISOString())
      .lte('clock_in_at', window.weekEnd.toISOString())
      .limit(PAYROLL_RESULT_LIMIT),
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

async function evaluateMonthlySalaryPayroll(supabase: SupabaseLike, window: MonthlySalaryPayrollWindow, now: Date): Promise<MonthlySalaryPayrollStatus> {
  const todayInput = formatCentralDateInput(now);
  const settingsResult = await supabase
    .from('admin_time_settings')
    .select('profile_id,active,compensation_type,salary_amount_cents,salary_frequency')
    .limit(PAYROLL_RESULT_LIMIT);

  if (settingsResult.error) {
    console.error('[payroll-status] monthly salary settings failed', {
      error: settingsResult.error,
      payrollMonth: window.payrollMonthInput,
    });
  }

  const settings = ((settingsResult.data ?? []) as SalarySettingRow[])
    .filter((setting) => setting.active !== false)
    .filter((setting) => setting.compensation_type === 'salary')
    .filter((setting) => setting.salary_frequency === 'monthly')
    .filter((setting) => moneyCents(setting.salary_amount_cents) > 0);
  const profileIds = [...new Set(settings.map((setting) => setting.profile_id))];
  const profilesResult = profileIds.length
    ? await supabase.from('profiles').select('id,is_active').in('id', profileIds)
    : { data: [] as ProfileStatusRow[], error: null };

  if (profilesResult.error) {
    console.error('[payroll-status] monthly salary profiles failed', {
      error: profilesResult.error,
      payrollMonth: window.payrollMonthInput,
    });
  }

  const activeProfileIds = new Set(((profilesResult.data ?? []) as ProfileStatusRow[]).filter((profile) => profile.is_active !== false).map((profile) => profile.id));
  const employees = settings.filter((setting) => activeProfileIds.has(setting.profile_id));
  const paymentsResult = await supabase
    .from('admin_salary_payroll_payments')
    .select('profile_id,salary_pay_cents,paid_at')
    .eq('payroll_month', window.payrollMonthInput)
    .limit(PAYROLL_RESULT_LIMIT);

  if (paymentsResult.error) {
    console.error('[payroll-status] monthly salary payments failed', {
      error: paymentsResult.error,
      payrollMonth: window.payrollMonthInput,
    });
  }

  const paidByProfile = new Map(((paymentsResult.data ?? []) as SalaryPaymentRow[]).filter((payment) => payment.paid_at).map((payment) => [payment.profile_id, payment]));
  const salaryPayCents = employees.reduce((sum, setting) => sum + moneyCents(setting.salary_amount_cents), 0);
  const unpaidEmployees = employees.filter((setting) => !paidByProfile.has(setting.profile_id));
  const unpaidSalaryPayCents = unpaidEmployees.reduce((sum, setting) => sum + moneyCents(setting.salary_amount_cents), 0);
  const paidSalaryPayCents = [...paidByProfile.values()].reduce((sum, payment) => sum + moneyCents(payment.salary_pay_cents), 0);
  const isComplete = employees.length > 0 && unpaidEmployees.length === 0;
  const isDue = employees.length > 0 && !isComplete && compareDateInputs(todayInput, window.dueDateInput) >= 0;
  const isOverdue = isDue && compareDateInputs(todayInput, window.dueDateInput) > 0;

  return {
    ...window,
    badgeCount: isDue ? unpaidEmployees.length : 0,
    dueEmployeeCount: unpaidEmployees.length,
    employeeCount: employees.length,
    isComplete,
    isDue,
    isOverdue,
    needsApproval: isDue,
    paidEmployeeCount: employees.length - unpaidEmployees.length,
    paidSalaryPayCents,
    payrollHref: monthlySalaryPayrollHrefFor(window),
    salaryPayCents,
    unpaidSalaryPayCents,
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

export async function getMonthlySalaryPayrollStatus({
  now = new Date(),
  supabase = supabaseAdmin,
}: {
  now?: Date;
  supabase?: SupabaseLike;
} = {}) {
  return evaluateMonthlySalaryPayroll(supabase, getCurrentMonthlySalaryPayrollWindow(now), now);
}

export async function getPayrollStatus({
  now = new Date(),
  supabase = supabaseAdmin,
}: {
  now?: Date;
  supabase?: SupabaseLike;
} = {}): Promise<PayrollStatus> {
  const [weekly, monthlySalary] = await Promise.all([
    getWeeklyPayrollStatus({ now, supabase }),
    getMonthlySalaryPayrollStatus({ now, supabase }),
  ]);
  return {
    badgeCount: weekly.badgeCount + monthlySalary.badgeCount,
    monthlySalary,
    weekly,
  };
}

/** Deduplicates the layout badge and dashboard alert queries within one render. */
export const getCachedPayrollStatus = cache(async () => getPayrollStatus());

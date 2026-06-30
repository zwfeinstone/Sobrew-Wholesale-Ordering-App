export const TIME_CLOCK_TIME_ZONE = 'America/Chicago';

export const LABOR_WORK_TYPES = [
  { label: 'Production', value: 'production' },
  { label: 'Packing', value: 'packing' },
  { label: 'Receiving', value: 'receiving' },
  { label: 'Shipping', value: 'shipping' },
  { label: 'Sales', value: 'sales' },
  { label: 'Admin', value: 'admin' },
  { label: 'Cleaning', value: 'cleaning' },
  { label: 'Other', value: 'other' },
] as const;

export const UNASSIGNED_WORK_TYPE = 'unassigned';

export type LaborWorkType = (typeof LABOR_WORK_TYPES)[number]['value'];
export type TimeEntryWorkType = LaborWorkType | typeof UNASSIGNED_WORK_TYPE;

export const COMPENSATION_TYPES = [
  { label: 'Hourly', value: 'hourly' },
  { label: 'Salary', value: 'salary' },
] as const;

export const SALARY_PAY_FREQUENCIES = [
  { label: 'Annual salary', value: 'annual' },
  { label: 'Monthly salary', value: 'monthly' },
  { label: 'Semimonthly paycheck', value: 'semimonthly' },
  { label: 'Biweekly paycheck', value: 'biweekly' },
  { label: 'Weekly paycheck', value: 'weekly' },
] as const;

export type CompensationType = (typeof COMPENSATION_TYPES)[number]['value'];
export type SalaryPayFrequency = (typeof SALARY_PAY_FREQUENCIES)[number]['value'];

export type TimeClockBreakRow = {
  break_end_at: string | null;
  break_start_at: string;
  status: string | null;
};

export type TimeClockEntryRow = {
  clock_in_at: string;
  clock_out_at: string | null;
  hourly_rate_cents_snapshot: number | string | null;
  status: string | null;
  work_type?: string | null;
};

const laborWorkTypeValues = new Set<string>(LABOR_WORK_TYPES.map((workType) => workType.value));
const compensationTypeValues = new Set<string>(COMPENSATION_TYPES.map((type) => type.value));
const salaryPayFrequencyValues = new Set<string>(SALARY_PAY_FREQUENCIES.map((frequency) => frequency.value));

export function isLaborWorkType(value: string | null | undefined): value is LaborWorkType {
  return laborWorkTypeValues.has(String(value ?? ''));
}

export function normalizeWorkType(value: string | null | undefined): TimeEntryWorkType {
  const raw = String(value ?? '').trim();
  return isLaborWorkType(raw) ? raw : UNASSIGNED_WORK_TYPE;
}

export function normalizeCompensationType(value: string | null | undefined): CompensationType {
  const raw = String(value ?? '').trim();
  return compensationTypeValues.has(raw) ? raw as CompensationType : 'hourly';
}

export function normalizeSalaryPayFrequency(value: string | null | undefined): SalaryPayFrequency {
  const raw = String(value ?? '').trim();
  return salaryPayFrequencyValues.has(raw) ? raw as SalaryPayFrequency : 'annual';
}

export function workTypeLabel(value: string | null | undefined) {
  const normalized = normalizeWorkType(value);
  if (normalized === UNASSIGNED_WORK_TYPE) return 'Unassigned';
  return LABOR_WORK_TYPES.find((workType) => workType.value === normalized)?.label ?? 'Unassigned';
}

export function compensationTypeLabel(value: string | null | undefined) {
  const normalized = normalizeCompensationType(value);
  return COMPENSATION_TYPES.find((type) => type.value === normalized)?.label ?? 'Hourly';
}

export function salaryPayFrequencyLabel(value: string | null | undefined) {
  const normalized = normalizeSalaryPayFrequency(value);
  return SALARY_PAY_FREQUENCIES.find((frequency) => frequency.value === normalized)?.label ?? 'Annual salary';
}

const centralDateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  timeZone: TIME_CLOCK_TIME_ZONE,
  timeZoneName: 'short',
  year: 'numeric',
});

const centralDateOnlyFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIME_CLOCK_TIME_ZONE,
  year: 'numeric',
});

const centralInputFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  timeZone: TIME_CLOCK_TIME_ZONE,
  year: 'numeric',
});

function partsFor(date: Date, formatter: Intl.DateTimeFormat) {
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

function timeZoneOffsetMs(date: Date) {
  const parts = partsFor(
    date,
    new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone: TIME_CLOCK_TIME_ZONE,
      year: 'numeric',
    })
  );
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return localAsUtc - date.getTime();
}

function zonedTimeToUtc(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return new Date(utcGuess.getTime() - timeZoneOffsetMs(utcGuess));
}

export function normalizeMoneyCents(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dollarsToCents(value: string | null | undefined) {
  const parsed = Number.parseFloat(String(value ?? '0'));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

export function dollarsInputFromCents(value: number | string | null | undefined) {
  return (normalizeMoneyCents(value) / 100).toFixed(2);
}

export function formatCentralDateTime(value: string | Date | null | undefined, fallback = 'Open') {
  if (!value) return fallback;
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? fallback : centralDateFormatter.format(date);
}

export function formatCentralDateInput(value: string | Date | null | undefined = new Date()) {
  const date = typeof value === 'string' ? new Date(value) : value ?? new Date();
  const parts = partsFor(date, centralDateOnlyFormatter);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatCentralDateTimeInput(value: string | Date | null | undefined) {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const parts = partsFor(date, centralInputFormatter);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function parseCentralDateInput(value: string | null | undefined, endOfDay = false) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return zonedTimeToUtc(Number(year), Number(month), Number(day), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
}

export function parseCentralDateTimeInput(value: string | null | undefined) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return zonedTimeToUtc(Number(year), Number(month), Number(day), Number(hour), Number(minute), 0);
}

export function minutesBetween(start: string | Date | null | undefined, end: string | Date | null | undefined) {
  if (!start || !end) return 0;
  const startDate = typeof start === 'string' ? new Date(start) : start;
  const endDate = typeof end === 'string' ? new Date(end) : end;
  const minutes = (endDate.getTime() - startDate.getTime()) / 60000;
  return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
}

export function completedBreakMinutes(breaks: TimeClockBreakRow[]) {
  return breaks
    .filter((entryBreak) => entryBreak.status !== 'void')
    .reduce((total, entryBreak) => total + minutesBetween(entryBreak.break_start_at, entryBreak.break_end_at), 0);
}

export function shiftMinutes(entry: TimeClockEntryRow) {
  return minutesBetween(entry.clock_in_at, entry.clock_out_at);
}

export function paidMinutes(entry: TimeClockEntryRow, breaks: TimeClockBreakRow[]) {
  if (!entry.clock_out_at || entry.status === 'void') return 0;
  return Math.max(0, shiftMinutes(entry) - completedBreakMinutes(breaks));
}

export function hoursFromMinutes(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100;
}

export function wageCentsForMinutes(minutes: number, hourlyRateCents: number | string | null | undefined) {
  return Math.round((minutes / 60) * normalizeMoneyCents(hourlyRateCents));
}

function salaryAnnualizedCents(amountCents: number, frequency: SalaryPayFrequency) {
  if (frequency === 'weekly') return amountCents * 52;
  if (frequency === 'biweekly') return amountCents * 26;
  if (frequency === 'semimonthly') return amountCents * 24;
  if (frequency === 'monthly') return amountCents * 12;
  return amountCents;
}

export function salaryCentsForDateRange({
  end,
  salaryAmountCents,
  salaryFrequency,
  start,
}: {
  end: Date;
  salaryAmountCents: number | string | null | undefined;
  salaryFrequency: string | null | undefined;
  start: Date;
}) {
  const amountCents = normalizeMoneyCents(salaryAmountCents);
  if (amountCents <= 0 || end < start) return 0;
  const frequency = normalizeSalaryPayFrequency(salaryFrequency);
  const rangeMs = end.getTime() - start.getTime();
  const days = Math.max(1, Math.round(rangeMs / 86400000));
  return Math.round((salaryAnnualizedCents(amountCents, frequency) / 365) * days);
}

export function hoursLabel(minutes: number) {
  return hoursFromMinutes(minutes).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

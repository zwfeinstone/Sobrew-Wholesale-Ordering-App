export const RECURRING_FREQUENCY_OPTIONS = [
  { value: '1_week', label: 'Every 1 week', days: 7 },
  { value: '2_weeks', label: 'Every 2 weeks', days: 14 },
  { value: '3_weeks', label: 'Every 3 weeks', days: 21 },
  { value: '4_weeks', label: 'Every 4 weeks', days: 28 },
  { value: '5_weeks', label: 'Every 5 weeks', days: 35 },
  { value: '6_weeks', label: 'Every 6 weeks', days: 42 },
] as const;

export type RecurringFrequency = (typeof RECURRING_FREQUENCY_OPTIONS)[number]['value'];

export function isRecurringFrequency(value: string): value is RecurringFrequency {
  return RECURRING_FREQUENCY_OPTIONS.some((option) => option.value === value);
}

export function daysForRecurringFrequency(frequency: string) {
  return RECURRING_FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.days ?? null;
}

export function labelForRecurringFrequency(frequency: string) {
  return RECURRING_FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? 'Custom schedule';
}

export const RECURRING_ORDER_TIME_ZONE = 'America/Chicago';

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

const recurringDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: RECURRING_ORDER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const recurringDateDisplayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function calendarDateFor(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === '') return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = recurringDatePartsFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);

  if (!year || !month || !day) return null;
  return { year, month, day };
}

function addCalendarDays(date: CalendarDate, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate) {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function dateFromCalendarDate(date: CalendarDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
}

export function nextRecurringOrderCalendarDate(frequency: string, anchorDate: string | number | Date | null | undefined) {
  const anchor = calendarDateFor(anchorDate);
  const daysToAdd = daysForRecurringFrequency(frequency);
  if (!anchor || !daysToAdd) return null;
  return addCalendarDays(anchor, daysToAdd);
}

export function nextRecurringOrderDate(frequency: string, anchorDate: string | number | Date | null | undefined) {
  const nextDate = nextRecurringOrderCalendarDate(frequency, anchorDate);
  return nextDate ? dateFromCalendarDate(nextDate) : null;
}

export function formatNextRecurringOrderDate(frequency: string, anchorDate: string | number | Date | null | undefined) {
  const nextDate = nextRecurringOrderDate(frequency, anchorDate);
  return nextDate ? recurringDateDisplayFormatter.format(nextDate) : 'N/A';
}

export function isRecurringOrderDue(
  frequency: string,
  anchorDate: string | number | Date | null | undefined,
  now: string | number | Date = new Date()
) {
  const nextDate = nextRecurringOrderCalendarDate(frequency, anchorDate);
  const currentDate = calendarDateFor(now);
  return Boolean(nextDate && currentDate && compareCalendarDates(nextDate, currentDate) <= 0);
}

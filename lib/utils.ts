export const toCents = (value: string) => {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error('Invalid price');
  }
  return Math.round(parsed * 100);
};

export const usd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export const APP_TIME_ZONE = 'America/Chicago';

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
}

function dateFromDisplayValue(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = typeof value === 'string'
    ? parseDateOnly(value) ?? new Date(value)
    : value;
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAppDateTime(value: string | Date | null | undefined, fallback = 'Unknown') {
  const date = dateFromDisplayValue(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: APP_TIME_ZONE,
  }).format(date);
}

export function formatAppDate(
  value: string | Date | null | undefined,
  fallback = 'Unknown',
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
) {
  const date = dateFromDisplayValue(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(date);
}

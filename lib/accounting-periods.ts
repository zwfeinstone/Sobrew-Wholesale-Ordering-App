import { APP_TIME_ZONE } from '@/lib/utils';

export type AccountingPeriodPresetId = 'last_month' | 'last_quarter' | 'last_year' | 'year_to_date';

export type AccountingPeriodPreset = {
  id: AccountingPeriodPresetId;
  label: string;
  start: string;
  end: string;
};

const businessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function calendarDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

export function getAccountingPeriodPresets(now: Date = new Date()): AccountingPeriodPreset[] {
  const parts = businessDateFormatter.formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')!.value);
  const month = Number(parts.find((part) => part.type === 'month')!.value) - 1;
  const day = Number(parts.find((part) => part.type === 'day')!.value);
  const quarterStartMonth = Math.floor(month / 3) * 3;

  // Convert the business calendar date to UTC before doing calendar arithmetic,
  // so daylight-saving changes cannot shift any inclusive period boundary.
  return [
    {
      id: 'last_month',
      label: 'Last month',
      start: calendarDate(year, month - 1, 1),
      end: calendarDate(year, month, 0),
    },
    {
      id: 'last_quarter',
      label: 'Last quarter',
      start: calendarDate(year, quarterStartMonth - 3, 1),
      end: calendarDate(year, quarterStartMonth, 0),
    },
    {
      id: 'last_year',
      label: 'Last year',
      start: calendarDate(year - 1, 0, 1),
      end: calendarDate(year - 1, 11, 31),
    },
    {
      id: 'year_to_date',
      label: 'Year to date',
      start: calendarDate(year, 0, 1),
      end: calendarDate(year, month, day),
    },
  ];
}

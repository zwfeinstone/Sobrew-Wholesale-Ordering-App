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

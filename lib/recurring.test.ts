import { describe, expect, it } from 'vitest';
import {
  formatNextRecurringOrderDate,
  isRecurringFrequency,
  isRecurringOrderDue,
  nextRecurringOrderCalendarDate,
} from '@/lib/recurring';

describe('recurring order dates', () => {
  it('recognizes only supported frequencies', () => {
    expect(isRecurringFrequency('2_weeks')).toBe(true);
    expect(isRecurringFrequency('monthly')).toBe(false);
  });

  it('adds calendar weeks without drifting across daylight saving time', () => {
    expect(nextRecurringOrderCalendarDate('2_weeks', '2026-03-01T18:00:00.000Z')).toEqual({
      year: 2026,
      month: 3,
      day: 15,
    });
  });

  it('uses the Chicago calendar day for due checks', () => {
    const anchor = '2026-07-10T04:30:00.000Z'; // Jul 9 in Chicago
    expect(isRecurringOrderDue('2_weeks', anchor, '2026-07-23T20:00:00.000Z')).toBe(true);
    expect(isRecurringOrderDue('2_weeks', anchor, '2026-07-22T20:00:00.000Z')).toBe(false);
  });

  it('formats the checkout preview date', () => {
    expect(formatNextRecurringOrderDate('2_weeks', '2026-07-10T18:00:00.000Z')).toBe('Jul 24, 2026');
  });
});

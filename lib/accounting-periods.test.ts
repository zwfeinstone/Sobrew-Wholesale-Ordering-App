import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAccountingPeriodPresets } from '@/lib/accounting-periods';

afterEach(() => {
  vi.useRealTimers();
});

describe('accounting period presets', () => {
  it('provides complete calendar periods and year to date in dropdown order', () => {
    expect(getAccountingPeriodPresets(new Date('2026-10-06T17:00:00Z'))).toEqual([
      { id: 'last_month', label: 'Last month', start: '2026-09-01', end: '2026-09-30' },
      { id: 'last_quarter', label: 'Last quarter', start: '2026-07-01', end: '2026-09-30' },
      { id: 'last_year', label: 'Last year', start: '2025-01-01', end: '2025-12-31' },
      { id: 'year_to_date', label: 'Year to date', start: '2026-01-01', end: '2026-10-06' },
    ]);
  });

  it('rolls the previous month and quarter into the prior year in January', () => {
    expect(getAccountingPeriodPresets(new Date('2026-01-01T06:00:00Z'))).toEqual([
      { id: 'last_month', label: 'Last month', start: '2025-12-01', end: '2025-12-31' },
      { id: 'last_quarter', label: 'Last quarter', start: '2025-10-01', end: '2025-12-31' },
      { id: 'last_year', label: 'Last year', start: '2025-01-01', end: '2025-12-31' },
      { id: 'year_to_date', label: 'Year to date', start: '2026-01-01', end: '2026-01-01' },
    ]);
  });

  it.each([
    ['2026-04-01T05:00:00Z', '2026-01-01', '2026-03-31'],
    ['2026-07-01T05:00:00Z', '2026-04-01', '2026-06-30'],
    ['2026-10-01T05:00:00Z', '2026-07-01', '2026-09-30'],
  ])('starts a new previous quarter at the Central boundary %s', (now, start, end) => {
    expect(getAccountingPeriodPresets(new Date(now)).find((period) => period.id === 'last_quarter'))
      .toMatchObject({ start, end });
  });

  it.each([
    ['2024-03-15T17:00:00Z', '2024-02-01', '2024-02-29'],
    ['2025-03-15T17:00:00Z', '2025-02-01', '2025-02-28'],
  ])('uses the correct February length for %s', (now, start, end) => {
    expect(getAccountingPeriodPresets(new Date(now)).find((period) => period.id === 'last_month'))
      .toMatchObject({ start, end });
  });

  it('keeps December periods until the new year begins in the business timezone', () => {
    expect(getAccountingPeriodPresets(new Date('2026-01-01T05:59:59Z'))).toEqual([
      { id: 'last_month', label: 'Last month', start: '2025-11-01', end: '2025-11-30' },
      { id: 'last_quarter', label: 'Last quarter', start: '2025-07-01', end: '2025-09-30' },
      { id: 'last_year', label: 'Last year', start: '2024-01-01', end: '2024-12-31' },
      { id: 'year_to_date', label: 'Year to date', start: '2025-01-01', end: '2025-12-31' },
    ]);
  });

  it('keeps March periods just before a daylight-saving-time quarter boundary', () => {
    const periods = getAccountingPeriodPresets(new Date('2026-04-01T04:59:59Z'));
    expect(periods.find((period) => period.id === 'last_month')).toMatchObject({
      start: '2026-02-01', end: '2026-02-28',
    });
    expect(periods.find((period) => period.id === 'last_quarter')).toMatchObject({
      start: '2025-10-01', end: '2025-12-31',
    });
    expect(periods.find((period) => period.id === 'year_to_date')).toMatchObject({
      start: '2026-01-01', end: '2026-03-31',
    });
  });

  it('defaults to the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T17:00:00Z'));

    expect(getAccountingPeriodPresets()).toEqual(
      getAccountingPeriodPresets(new Date('2026-10-06T17:00:00Z')),
    );
  });
});

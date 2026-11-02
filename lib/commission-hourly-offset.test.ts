import { describe, expect, it } from 'vitest';
import { calculateMonthlyHourlyBaseWages, commissionHourlyOffsetApplies } from '@/lib/commission-hourly-offset';
import type { PayrollWageEntry } from '@/lib/payroll-wages';

const now = new Date('2026-12-02T12:00:00Z');
const entry = (overrides: Partial<PayrollWageEntry> = {}): PayrollWageEntry => ({
  id: 'shift', profile_id: 'thomas', status: 'approved', hourly_rate_cents_snapshot: 1500,
  clock_in_at: '2026-10-15T08:00:00-05:00', clock_out_at: '2026-10-15T16:00:00-05:00',
  admin_time_breaks: [], ...overrides,
});

describe('monthly commission hourly offset wages', () => {
  it('includes paid and submitted shifts at their saved rates and deducts overlapping breaks once', () => {
    const wages = calculateMonthlyHourlyBaseWages([
      entry({ status: 'locked', admin_time_breaks: [
        { break_start_at: '2026-10-15T11:00:00-05:00', break_end_at: '2026-10-15T12:00:00-05:00', status: 'completed' },
        { break_start_at: '2026-10-15T11:30:00-05:00', break_end_at: '2026-10-15T12:30:00-05:00', status: 'completed' },
        { break_start_at: '2026-10-15T13:00:00-05:00', break_end_at: '2026-10-15T14:00:00-05:00', status: 'void' },
      ] }),
      entry({ id: 'second', status: 'submitted', hourly_rate_cents_snapshot: 2000, work_type: 'production' }),
      entry({ id: 'void', status: 'void' }),
    ], '2026-10-01', now);
    expect(wages.hourlyBaseWagesCents).toBe(6.5 * 1500 + 8 * 2000);
    expect(wages.settlementBlockedReason).toContain('Approve or lock');
  });

  it('excludes overtime premiums from the wage threshold', () => {
    const shifts = Array.from({ length: 6 }, (_, i) => entry({ id: `shift-${i}`,
      clock_in_at: `2026-10-${19 + i}T08:00:00-05:00`, clock_out_at: `2026-10-${19 + i}T16:00:00-05:00` }));
    expect(calculateMonthlyHourlyBaseWages(shifts, '2026-10-01', now)).toEqual({ hourlyBaseWagesCents: 48 * 1500, settlementBlockedReason: null });
  });

  it('splits overnight shifts and unpaid breaks at Central month boundaries', () => {
    const shift = entry({ clock_in_at: '2026-10-31T23:00:00-05:00', clock_out_at: '2026-11-01T02:00:00-05:00',
      admin_time_breaks: [{ break_start_at: '2026-10-31T23:45:00-05:00', break_end_at: '2026-11-01T00:15:00-05:00', status: 'completed' }] });
    expect(calculateMonthlyHourlyBaseWages([shift], '2026-10-01', now).hourlyBaseWagesCents).toBe(1125);
    expect(calculateMonthlyHourlyBaseWages([shift], '2026-11-01', now).hourlyBaseWagesCents).toBe(2625);
  });

  it('preserves rounded shift cents across month boundaries', () => {
    const shift = entry({ clock_in_at: '2026-10-31T23:59:58-05:00', clock_out_at: '2026-11-01T00:00:02-05:00' });
    const october = calculateMonthlyHourlyBaseWages([shift], '2026-10-01', now).hourlyBaseWagesCents;
    const november = calculateMonthlyHourlyBaseWages([shift], '2026-11-01', now).hourlyBaseWagesCents;
    expect(october + november).toBe(2);
  });

  it('uses elapsed paid time through daylight saving changes', () => {
    const shift = entry({ clock_in_at: '2026-11-01T00:00:00-05:00', clock_out_at: '2026-11-01T03:00:00-06:00' });
    expect(calculateMonthlyHourlyBaseWages([shift], '2026-11-01', now).hourlyBaseWagesCents).toBe(6000);
  });

  it.each([
    { status: 'open', clock_out_at: null },
    { admin_time_breaks: [{ break_start_at: '2026-10-15T12:00:00-05:00', break_end_at: null, status: 'open' }] },
  ])('blocks settlement while an overlapping shift or break is unfinished (%j)', (changes) => {
    expect(calculateMonthlyHourlyBaseWages([entry(changes)], '2026-10-01', now).settlementBlockedReason).toContain('Complete all');
  });

  it('includes prior-month open shifts as unresolved and ignores unrelated future shifts', () => {
    expect(calculateMonthlyHourlyBaseWages([entry({ clock_in_at: '2026-09-30T23:00:00-05:00', clock_out_at: null, status: 'open' })], '2026-10-01', now).settlementBlockedReason).toBeTruthy();
    expect(calculateMonthlyHourlyBaseWages([entry({ clock_in_at: '2026-11-15T08:00:00-06:00', clock_out_at: null, status: 'open' })], '2026-10-01', now)).toEqual({ hourlyBaseWagesCents: 0, settlementBlockedReason: null });
  });

  it('fails closed on malformed wage data', () => {
    expect(() => calculateMonthlyHourlyBaseWages([entry({ hourly_rate_cents_snapshot: null })], '2026-10-01', now)).toThrow('invalid hourly rate');
  });

  it('applies only to enabled profiles from their effective month', () => {
    const setting = { profile_id: 'thomas', commission_percent: 10, hourly_offset_enabled: true, hourly_offset_start_month: '2026-10-01' };
    expect(commissionHourlyOffsetApplies(setting, '2026-09-01')).toBe(false);
    expect(commissionHourlyOffsetApplies(setting, '2026-10-01')).toBe(true);
    expect(commissionHourlyOffsetApplies({ ...setting, hourly_offset_enabled: false }, '2026-10-01')).toBe(false);
    expect(() => commissionHourlyOffsetApplies({ ...setting, hourly_offset_start_month: '2026-13-01' }, '2026-10-01')).toThrow('invalid');
  });
});

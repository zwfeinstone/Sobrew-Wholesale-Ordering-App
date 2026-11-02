import { describe, expect, it } from 'vitest';
import { calculateDeferredPay, type DeferredPayEntry, type DeferredPayPlan, type DeferredPaySummary } from '@/lib/deferred-pay';

const plan: DeferredPayPlan = {
  id: 'plan-1', profile_id: 'haskins', label: 'January 4 payout', start_date: '2026-10-07', end_date: '2027-01-03',
  payout_date: '2027-01-04', accrual_rate_cents: 500, weekly_rate_cents: 1500, paid_at: null, paid_amount_cents: null,
};
const afterPlan = new Date('2027-01-04T18:00:00Z');

function shift(id: string, clockIn: string, clockOut: string | null, overrides: Partial<DeferredPayEntry> = {}): DeferredPayEntry {
  return { id, profile_id: plan.profile_id, clock_in_at: clockIn, clock_out_at: clockOut, hourly_rate_cents_snapshot: 1500, status: 'submitted', work_type: 'sales', ...overrides };
}

function reconciles(summary: DeferredPaySummary) {
  expect(summary.entries.reduce((sum, row) => sum + row.accruedCents, 0)).toBe(summary.accruedCents);
  expect(summary.weeks.reduce((sum, row) => sum + row.accruedCents, 0)).toBe(summary.accruedCents);
  expect(summary.entries.reduce((sum, row) => sum + row.eligibleMilliseconds, 0)).toBe(summary.eligibleMilliseconds);
  expect(summary.weeks.reduce((sum, row) => sum + row.eligibleMilliseconds, 0)).toBe(summary.eligibleMilliseconds);
  for (const week of summary.weeks) {
    expect(week.entries.reduce((sum, row) => sum + row.accruedCents, 0)).toBe(week.accruedCents);
    expect(week.entries.reduce((sum, row) => sum + row.eligibleMilliseconds, 0)).toBe(week.eligibleMilliseconds);
  }
}

describe('calculateDeferredPay', () => {
  it('accrues a flat $5 for every paid hour across all labor tags and weekends, independent of wage or overtime rates', () => {
    const entries = Array.from({ length: 6 }, (_, day) => shift(`shift-${day}`, `2026-10-${String(7 + day).padStart(2, '0')}T08:00:00-05:00`, `2026-10-${String(7 + day).padStart(2, '0')}T18:00:00-05:00`, {
      work_type: ['sales', 'production', 'admin', 'other', 'unassigned', 'packing'][day],
      hourly_rate_cents_snapshot: day === 0 ? 5000 : 1500,
      status: day === 1 ? 'locked' : 'approved',
    }));
    const summary = calculateDeferredPay(plan, entries, afterPlan);
    expect(summary).toMatchObject({ eligibleHours: 60, accruedCents: 30000, remainingCents: 30000, entryCount: 6, status: 'awaiting_payment' });
    reconciles(summary);
  });

  it('requires the exact employee and a valid completed shift whose clock-out has happened', () => {
    const valid = shift('eligible', '2026-10-07T08:00:00-05:00', '2026-10-07T16:00:00-05:00');
    const entries = [valid,
      { ...valid, id: 'other', profile_id: 'someone-else' },
      { ...valid, id: 'missing-profile', profile_id: null },
      { ...valid, id: 'void', status: 'void' },
      { ...valid, id: 'open-with-end', status: 'open' },
      { ...valid, id: 'incomplete', clock_out_at: null },
      { ...valid, id: 'future-end', clock_out_at: '2026-10-07T18:00:00-05:00' },
      { ...valid, id: 'reversed', clock_out_at: '2026-10-07T07:00:00-05:00' },
      { ...valid, id: 'invalid', clock_in_at: 'invalid' },
    ];
    const summary = calculateDeferredPay(plan, entries, new Date('2026-10-07T17:00:00-05:00'));
    expect(summary.entries.map((entry) => entry.entryId)).toEqual(['eligible']);
    expect(summary.accruedCents).toBe(4000);
  });

  it('subtracts overlapping breaks once and clips breaks to the eligible interval', () => {
    const entry = shift('breaks', '2026-10-07T08:00:00-05:00', '2026-10-07T18:00:00-05:00', { admin_time_breaks: [
      { break_start_at: '2026-10-07T07:00:00-05:00', break_end_at: '2026-10-07T09:00:00-05:00', status: 'completed' },
      { break_start_at: '2026-10-07T12:00:00-05:00', break_end_at: '2026-10-07T14:00:00-05:00', status: 'completed' },
      { break_start_at: '2026-10-07T13:00:00-05:00', break_end_at: '2026-10-07T15:00:00-05:00', status: 'completed' },
      { break_start_at: '2026-10-07T09:00:00-05:00', break_end_at: '2026-10-07T10:00:00-05:00', status: 'void' },
      { break_start_at: '2026-10-07T10:00:00-05:00', break_end_at: null, status: 'open' },
      { break_start_at: 'invalid', break_end_at: '2026-10-07T10:00:00-05:00', status: 'completed' },
    ] });
    expect(calculateDeferredPay(plan, [entry], afterPlan)).toMatchObject({ eligibleHours: 6, accruedCents: 3000 });
  });

  it('clips overnight shifts to the inclusive Central start/end dates and excludes January 4 work', () => {
    const entries = [
      shift('start', '2026-10-06T22:00:00-05:00', '2026-10-07T02:00:00-05:00', { admin_time_breaks: [
        { break_start_at: '2026-10-06T23:30:00-05:00', break_end_at: '2026-10-07T00:30:00-05:00', status: 'completed' },
      ] }),
      shift('end', '2027-01-03T22:00:00-06:00', '2027-01-04T02:00:00-06:00'),
      shift('before', '2026-10-06T22:00:00-05:00', '2026-10-07T00:00:00-05:00'),
      shift('after', '2027-01-04T00:00:00-06:00', '2027-01-04T02:00:00-06:00'),
    ];
    const summary = calculateDeferredPay(plan, entries, afterPlan);
    expect(summary).toMatchObject({ eligibleHours: 3.5, accruedCents: 1750, entryCount: 2 });
    expect(summary.weeks.map((row) => row.weekStartDate)).toEqual(['2026-10-05', '2026-12-28']);
    reconciles(summary);
  });

  it('counts actual elapsed hours across the Central fall DST change', () => {
    const entry = shift('dst', '2026-11-01T00:00:00-05:00', '2026-11-01T03:00:00-06:00');
    const summary = calculateDeferredPay(plan, [entry], afterPlan);
    expect(summary).toMatchObject({ eligibleHours: 4, accruedCents: 2000 });
    expect(summary.weeks[0]).toMatchObject({ weekStartDate: '2026-10-26', weekEndDate: '2026-11-01', eligibleHours: 4 });
  });

  it('splits a Sunday/Monday overnight shift into Central weeks, keeping shift totals intact', () => {
    const entry = shift('cross-week', '2026-10-11T23:00:00-05:00', '2026-10-12T02:00:00-05:00');
    const summary = calculateDeferredPay(plan, [entry], afterPlan);
    expect(summary.weeks.map((week) => [week.weekStartDate, week.eligibleHours, week.accruedCents])).toEqual([
      ['2026-10-05', 1, 500], ['2026-10-12', 2, 1000],
    ]);
    expect(summary.entries[0]).toMatchObject({ eligibleHours: 3, accruedCents: 1500 });
    expect(summary.entryCount).toBe(1);
    reconciles(summary);
  });

  it('uses precise milliseconds and reconciles pennies across shifts, weeks, and input orders', () => {
    const entries = [
      shift('z', '2026-10-11T23:59:58.000-05:00', '2026-10-12T00:00:02.000-05:00'),
      shift('b', '2026-10-14T10:00:00.000-05:00', '2026-10-14T10:00:04.000-05:00'),
      shift('a', '2026-10-14T10:00:00.000-05:00', '2026-10-14T10:00:04.000-05:00'),
    ];
    const summary = calculateDeferredPay(plan, entries, afterPlan);
    expect(summary).toMatchObject({ eligibleMilliseconds: 12000, accruedCents: 2 });
    expect(summary.eligibleHours).toBe(12000 / 3600000);
    expect(summary.entries.map((row) => [row.entryId, row.accruedCents])).toEqual([['z', 0], ['a', 1], ['b', 1]]);
    expect(calculateDeferredPay(plan, [...entries].reverse(), afterPlan)).toEqual(summary);
    reconciles(summary);
  });

  it('retains millisecond precision at a half-cent rounding boundary', () => {
    const exactlyHalf = shift('half', '2026-10-07T08:00:00.000-05:00', '2026-10-07T08:00:03.600-05:00');
    const belowHalf = { ...exactlyHalf, clock_out_at: '2026-10-07T08:00:03.599-05:00' };
    expect(calculateDeferredPay(plan, [exactlyHalf], afterPlan).accruedCents).toBe(1);
    expect(calculateDeferredPay(plan, [belowHalf], afterPlan).accruedCents).toBe(0);
  });

  it('keeps October–December hours when viewed in January and never auto-marks a due balance paid', () => {
    const entries = [shift('oct', '2026-10-07T08:00:00-05:00', '2026-10-07T16:00:00-05:00'), shift('jan', '2027-01-03T08:00:00-06:00', '2027-01-03T16:00:00-06:00')];
    expect(calculateDeferredPay(plan, entries, new Date('2026-10-06T12:00:00-05:00'))).toMatchObject({ status: 'scheduled', accruedCents: 0 });
    expect(calculateDeferredPay(plan, entries, new Date('2026-10-07T16:00:00-05:00'))).toMatchObject({ status: 'accruing', accruedCents: 4000 });
    expect(calculateDeferredPay(plan, entries, new Date('2027-01-04T00:00:00-06:00'))).toMatchObject({ status: 'awaiting_payment', accruedCents: 8000, paidCents: 0, remainingCents: 8000 });
    expect(calculateDeferredPay(plan, [], afterPlan).status).toBe('awaiting_payment');
  });

  it('requires an actual payment timestamp and amount, exposes partial payment, and reopens corrected balances', () => {
    const entries = [shift('one', '2026-10-07T08:00:00-05:00', '2026-10-07T16:00:00-05:00')];
    const payment = { paid_at: '2027-01-04T10:00:00-06:00', paid_amount_cents: 4000 };
    expect(calculateDeferredPay({ ...plan, ...payment }, entries, afterPlan)).toMatchObject({ status: 'paid', paidCents: 4000, remainingCents: 0 });
    expect(calculateDeferredPay({ ...plan, ...payment, paid_amount_cents: 2000 }, entries, afterPlan)).toMatchObject({ status: 'awaiting_payment', paidCents: 2000, remainingCents: 2000 });
    expect(calculateDeferredPay({ ...plan, ...payment, paid_at: null }, entries, afterPlan)).toMatchObject({ status: 'awaiting_payment', paidCents: 0, remainingCents: 4000 });
    expect(calculateDeferredPay({ ...plan, ...payment, paid_amount_cents: null }, entries, afterPlan)).toMatchObject({ status: 'awaiting_payment', paidCents: 0 });
    expect(calculateDeferredPay({ ...plan, ...payment }, entries, new Date('2027-01-04T09:00:00-06:00'))).toMatchObject({ status: 'awaiting_payment', paidCents: 0 });
    const corrected = [{ ...entries[0], clock_out_at: '2026-10-07T17:00:00-05:00' }];
    expect(calculateDeferredPay({ ...plan, ...payment }, corrected, afterPlan)).toMatchObject({ status: 'awaiting_payment', accruedCents: 4500, remainingCents: 500 });
    expect(calculateDeferredPay({ ...plan, ...payment, paid_amount_cents: 5000 }, entries, afterPlan)).toMatchObject({ status: 'paid', remainingCents: 0, paidCents: 5000 });
  });

  it('does not mutate the plan or source time records', () => {
    const entry = shift('one', '2026-10-07T08:00:00-05:00', '2026-10-07T16:00:00-05:00');
    Object.freeze(entry);
    expect(() => calculateDeferredPay(Object.freeze({ ...plan }), Object.freeze([entry]), afterPlan)).not.toThrow();
    expect(entry.hourly_rate_cents_snapshot).toBe(1500);
    expect(entry.status).toBe('submitted');
  });

  it('rejects invalid plan dates and currency so malformed settings cannot quietly accrue pay', () => {
    expect(() => calculateDeferredPay({ ...plan, start_date: '2026-02-30' }, [], afterPlan)).toThrow(RangeError);
    expect(() => calculateDeferredPay({ ...plan, end_date: '2026-10-06' }, [], afterPlan)).toThrow(RangeError);
    expect(() => calculateDeferredPay({ ...plan, accrual_rate_cents: -1 }, [], afterPlan)).toThrow(RangeError);
    expect(() => calculateDeferredPay({ ...plan, accrual_rate_cents: 0.5 }, [], afterPlan)).toThrow(RangeError);
    expect(() => calculateDeferredPay({ ...plan, paid_amount_cents: NaN }, [], afterPlan)).toThrow(RangeError);
    expect(() => calculateDeferredPay(plan, [], new Date('invalid'))).toThrow(RangeError);
  });
});

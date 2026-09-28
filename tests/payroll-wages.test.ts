import { describe, expect, it } from 'vitest';
import {
  calculatePayrollWages,
  distributePayrollWages,
  payrollOvertimeContextRange,
  type PayrollEntryWages,
  type PayrollWageEntry,
} from '@/lib/payroll-wages';

function shift(id: string, clockIn: string, hours: number, overrides: Partial<PayrollWageEntry> = {}): PayrollWageEntry {
  return {
    id,
    profile_id: 'employee-a',
    clock_in_at: clockIn,
    clock_out_at: new Date(Date.parse(clockIn) + hours * 3_600_000).toISOString(),
    hourly_rate_cents_snapshot: 2000,
    status: 'submitted',
    ...overrides,
  };
}

function week(hoursPerDay: number, overrides: Partial<PayrollWageEntry> = {}) {
  return [21, 22, 23, 24, 25].map((day) => shift(`day-${day}`, `2026-09-${day}T08:00:00-05:00`, hoursPerDay, overrides));
}

function sumWages(wages: Iterable<PayrollEntryWages>): PayrollEntryWages {
  return [...wages].reduce((sum, pay) => ({
    minutes: sum.minutes + pay.minutes,
    regularMinutes: sum.regularMinutes + pay.regularMinutes,
    overtimeMinutes: sum.overtimeMinutes + pay.overtimeMinutes,
    baseWageCents: sum.baseWageCents + pay.baseWageCents,
    overtimePremiumCents: sum.overtimePremiumCents + pay.overtimePremiumCents,
    wageCents: sum.wageCents + pay.wageCents,
  }), { minutes: 0, regularMinutes: 0, overtimeMinutes: 0, baseWageCents: 0, overtimePremiumCents: 0, wageCents: 0 });
}

describe('calculatePayrollWages', () => {
  it('pays exactly 40 hours at the regular rate', () => {
    expect(sumWages(calculatePayrollWages(week(8)).values())).toEqual({
      minutes: 2400, regularMinutes: 2400, overtimeMinutes: 0,
      baseWageCents: 80_000, overtimePremiumCents: 0, wageCents: 80_000,
    });
  });

  it('pays hours above 40 at time and a half, including the threshold inside a shift', () => {
    const wages = calculatePayrollWages(week(9));
    expect(sumWages(wages.values()).wageCents).toBe(95_000);
    expect(wages.get('day-25')).toEqual({
      minutes: 540, regularMinutes: 240, overtimeMinutes: 300,
      baseWageCents: 18_000, overtimePremiumCents: 5_000, wageCents: 23_000,
    });
  });

  it('is deterministic for unsorted input and tied clock-in times', () => {
    const entries = [...week(9)];
    const reversed = [...entries].reverse();
    expect([...calculatePayrollWages(reversed)]).toEqual([...calculatePayrollWages(entries)]);
    expect(reversed[0].id).toBe('day-25');
    const tied = [
      shift('b', '2026-09-21T00:00:00-05:00', 5, { hourly_rate_cents_snapshot: 3000 }),
      shift('a', '2026-09-21T00:00:00-05:00', 40),
    ];
    expect(calculatePayrollWages(tied).get('b')?.overtimePremiumCents).toBe(7500);
  });

  it('tracks each employee separately and retains the snapshotted rate on overtime shifts', () => {
    const entries = [
      ...week(8),
      shift('saturday-a', '2026-09-26T08:00:00-05:00', 5, { hourly_rate_cents_snapshot: '3000' }),
      shift('saturday-b', '2026-09-26T08:00:00-05:00', 5, { profile_id: 'employee-b' }),
    ];
    const wages = calculatePayrollWages(entries);
    expect(wages.get('saturday-a')?.wageCents).toBe(22_500);
    expect(wages.get('saturday-b')?.wageCents).toBe(10_000);
    expect(wages.get('saturday-b')?.overtimeMinutes).toBe(0);
  });

  it('resets the threshold on Monday even when several weeks are supplied', () => {
    const wages = calculatePayrollWages([
      ...week(9),
      shift('next-monday', '2026-09-28T00:00:00-05:00', 8),
    ]);
    expect(wages.get('next-monday')?.overtimeMinutes).toBe(0);
    expect(wages.get('next-monday')?.wageCents).toBe(16_000);
  });

  it('counts previously locked and approved time toward the threshold', () => {
    const entries = week(8).map((entry, index) => ({ ...entry, status: index % 2 ? 'approved' : 'locked' }));
    const wages = calculatePayrollWages([...entries, shift('unpaid', '2026-09-26T08:00:00-05:00', 2)]);
    expect(wages.get('unpaid')?.wageCents).toBe(6000);
    expect(wages.get('unpaid')?.overtimeMinutes).toBe(120);
  });

  it('excludes void and open entries, including malformed closed entries marked open', () => {
    const entries = [
      shift('void', '2026-09-21T00:00:00-05:00', 40, { status: 'void' }),
      shift('open', '2026-09-23T00:00:00-05:00', 40, { clock_out_at: null }),
      shift('status-open', '2026-09-24T00:00:00-05:00', 40, { status: 'open' }),
      shift('valid', '2026-09-26T08:00:00-05:00', 2),
    ];
    const wages = calculatePayrollWages(entries);
    for (const id of ['void', 'open', 'status-open']) expect(wages.get(id)?.minutes).toBe(0);
    expect(wages.get('valid')?.overtimeMinutes).toBe(0);
  });

  it('subtracts completed breaks but ignores void or unfinished breaks', () => {
    const entries = week(9).map((entry) => ({
      ...entry,
      admin_time_breaks: [
        { status: 'completed', break_start_at: entry.clock_in_at, break_end_at: new Date(Date.parse(entry.clock_in_at) + 3_600_000).toISOString() },
        { status: 'void', break_start_at: entry.clock_in_at, break_end_at: entry.clock_out_at },
        { status: 'open', break_start_at: entry.clock_in_at, break_end_at: null },
      ],
    }));
    expect(sumWages(calculatePayrollWages(entries).values())).toEqual({
      minutes: 2400, regularMinutes: 2400, overtimeMinutes: 0,
      baseWageCents: 80_000, overtimePremiumCents: 0, wageCents: 80_000,
    });
  });

  it('clips break intervals to the shift and subtracts overlapping breaks only once', () => {
    const entry = shift('clipped', '2026-09-21T08:00:00-05:00', 8, {
      admin_time_breaks: [
        { status: 'completed', break_start_at: '2026-09-21T07:00:00-05:00', break_end_at: '2026-09-21T09:00:00-05:00' },
        { status: 'completed', break_start_at: '2026-09-21T08:30:00-05:00', break_end_at: '2026-09-21T10:00:00-05:00' },
        { status: 'completed', break_start_at: '2026-09-21T17:00:00-05:00', break_end_at: '2026-09-21T18:00:00-05:00' },
      ],
    });
    expect(calculatePayrollWages([entry]).get(entry.id)?.minutes).toBe(360);
  });

  it('does not group unrelated entries with missing employee identities', () => {
    const wages = calculatePayrollWages(week(9, { profile_id: null }));
    expect(sumWages(wages.values()).overtimeMinutes).toBe(0);
    expect(sumWages(wages.values()).wageCents).toBe(90_000);
  });

  it('splits overnight time and its break at the Central Monday boundary', () => {
    const overnight = shift('overnight', '2026-09-27T22:00:00-05:00', 4, {
      admin_time_breaks: [{
        status: 'completed', break_start_at: '2026-09-27T23:30:00-05:00', break_end_at: '2026-09-28T00:30:00-05:00',
      }],
    });
    const wages = calculatePayrollWages([...week(8), overnight]);
    expect(wages.get('overnight')).toEqual({
      minutes: 180, regularMinutes: 90, overtimeMinutes: 90,
      baseWageCents: 6000, overtimePremiumCents: 1500, wageCents: 7500,
    });
  });

  it('uses actual elapsed hours across spring daylight saving and resets after Sunday', () => {
    const wages = calculatePayrollWages([
      shift('prior', '2026-03-02T00:00:00-06:00', 36),
      shift('spring', '2026-03-08T00:00:00-06:00', 4), // Ends at 05:00 CDT.
      shift('sunday-night', '2026-03-08T23:00:00-05:00', 3),
    ]);
    expect(wages.get('spring')?.overtimeMinutes).toBe(0);
    expect(wages.get('sunday-night')?.overtimeMinutes).toBe(60);
    expect(wages.get('sunday-night')?.regularMinutes).toBe(120);
  });

  it('uses actual elapsed hours across the repeated fall hour', () => {
    const wages = calculatePayrollWages([
      shift('prior', '2026-10-26T00:00:00-05:00', 39),
      shift('fall', '2026-11-01T00:00:00-05:00', 3), // Ends at 02:00 CST.
    ]);
    expect(wages.get('fall')?.regularMinutes).toBe(60);
    expect(wages.get('fall')?.overtimeMinutes).toBe(120);
  });

  it('keeps fractional minutes and rounds base and overtime premium to cents', () => {
    const wages = calculatePayrollWages([
      ...week(8),
      shift('seconds', '2026-09-26T08:00:00-05:00', 1 / 120, { hourly_rate_cents_snapshot: 1000 }),
    ]);
    expect(wages.get('seconds')).toEqual({
      minutes: 0.5, regularMinutes: 0, overtimeMinutes: 0.5,
      baseWageCents: 8, overtimePremiumCents: 4, wageCents: 12,
    });
  });

  it('treats invalid or reversed entry dates as zero paid time', () => {
    const wages = calculatePayrollWages([
      shift('bad-start', '2026-09-21T08:00:00-05:00', 8, { clock_in_at: 'bad' }),
      shift('bad-end', '2026-09-21T08:00:00-05:00', 8, { clock_out_at: 'bad' }),
      shift('reversed', '2026-09-21T08:00:00-05:00', -8),
    ]);
    expect(sumWages(wages.values()).wageCents).toBe(0);
  });
});

describe('payrollOvertimeContextRange', () => {
  it('expands a partial selection to whole Central weeks', () => {
    const range = payrollOvertimeContextRange(new Date('2026-09-24T05:00:00Z'), new Date('2026-09-25T23:00:00-05:00'));
    expect(range.start.toISOString()).toBe('2026-09-21T05:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-09-28T05:00:00.000Z');
  });

  it('includes the new week when the inclusive selection ends on Monday', () => {
    const range = payrollOvertimeContextRange(new Date('2026-09-27T12:00:00-05:00'), new Date('2026-09-28T00:00:00-05:00'));
    expect(range.start.toISOString()).toBe('2026-09-21T05:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2026-10-05T05:00:00.000Z');
  });

  it('uses a 167-hour spring workweek and a 169-hour fall workweek', () => {
    const spring = payrollOvertimeContextRange(new Date('2026-03-08T06:00:00Z'), new Date('2026-03-08T23:00:00-05:00'));
    expect(spring.start.toISOString()).toBe('2026-03-02T06:00:00.000Z');
    expect(spring.endExclusive.toISOString()).toBe('2026-03-09T05:00:00.000Z');
    const fall = payrollOvertimeContextRange(new Date('2026-11-01T05:00:00Z'), new Date('2026-11-01T23:00:00-06:00'));
    expect(fall.start.toISOString()).toBe('2026-10-26T05:00:00.000Z');
    expect(fall.endExclusive.toISOString()).toBe('2026-11-02T06:00:00.000Z');
  });

  it('rejects invalid and reversed selections', () => {
    expect(() => payrollOvertimeContextRange(new Date('bad'), new Date())).toThrow(RangeError);
    expect(() => payrollOvertimeContextRange(new Date('2026-09-25'), new Date('2026-09-21'))).toThrow(RangeError);
  });
});

describe('distributePayrollWages', () => {
  const pay: PayrollEntryWages = {
    minutes: 3, regularMinutes: 1, overtimeMinutes: 2,
    baseWageCents: 101, overtimePremiumCents: 17, wageCents: 118,
  };

  it('preserves every cent across tags and unallocated time', () => {
    const shares = distributePayrollWages(pay, [1, 1, 1]);
    expect(shares.map((share) => share.baseWageCents)).toEqual([34, 34, 33]);
    expect(shares.map((share) => share.overtimePremiumCents)).toEqual([6, 6, 5]);
    expect(sumWages(shares)).toEqual(pay);
    for (const share of shares) expect(share.wageCents).toBe(share.baseWageCents + share.overtimePremiumCents);
  });

  it('uses proportional weights while giving zero-weight allocations no pay', () => {
    const shares = distributePayrollWages(pay, [0, 1, 2, 0]);
    expect(shares.map((share) => share.minutes)).toEqual([0, 1, 2, 0]);
    expect(shares.map((share) => share.baseWageCents)).toEqual([0, 34, 67, 0]);
    expect(sumWages(shares)).toEqual(pay);
  });

  it('supports empty, zero, and invalid weights without losing positive pay', () => {
    expect(distributePayrollWages(pay, [])).toEqual([]);
    expect(distributePayrollWages(pay, [0, 0])[0]).toEqual(pay);
    expect(distributePayrollWages(pay, [-1, NaN])[0]).toEqual(pay);
    expect(sumWages(distributePayrollWages({ ...pay, minutes: 0, regularMinutes: 0, overtimeMinutes: 0, baseWageCents: 0, overtimePremiumCents: 0, wageCents: 0 }, [0, 0])).wageCents).toBe(0);
  });
});

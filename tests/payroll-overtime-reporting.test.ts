import { describe, expect, it } from 'vitest';
import { buildAccountingLaborSummary, type AccountingPayrollTimeEntryRow } from '@/lib/accounting-pnl-statement';
import { buildLaborPaidGpmSummary } from '@/lib/labor-paid-gpm-reporting';
import type { ProfitabilityTotals } from '@/lib/profitability-reporting';

const earlierShifts: AccountingPayrollTimeEntryRow[] = [6, 7, 8, 9].map((day) => ({
  id: `earlier-${day}`,
  profile_id: 'employee',
  clock_in_at: `2026-07-${day.toString().padStart(2, '0')}T12:00:00Z`,
  clock_out_at: `2026-07-${day.toString().padStart(2, '0')}T22:00:00Z`,
  status: 'locked',
  work_type: 'shipping',
  hourly_rate_cents_snapshot: 2000,
}));

const selectedShift: AccountingPayrollTimeEntryRow = {
  id: 'selected',
  profile_id: 'employee',
  clock_in_at: '2026-07-10T12:00:00Z',
  clock_out_at: '2026-07-10T17:00:00Z',
  status: 'approved',
  work_type: 'production',
  hourly_rate_cents_snapshot: 2000,
};

const current = {
  totalCogsCents: 30000, laborCents: 10000, revenueCents: 100000, grossProfitCents: 70000, marginPercent: 70,
} as ProfitabilityTotals;

describe('overtime in labor reports', () => {
  it('includes earlier paid shifts and other work tags in the threshold, but only selected shifts in P&L wages', () => {
    const summary = buildAccountingLaborSummary({
      allocations: [], salaryPayments: [], timeEntries: [selectedShift],
      overtimeContextEntries: [...earlierShifts, selectedShift],
    });

    expect(summary.productionLaborCogsCents).toBe(15000);
    expect(summary.totalLaborCents).toBe(15000);
    expect(summary.otherSalariesCents).toBe(0);
  });

  it('preserves allocated base amounts, adds the overtime premium, and includes remaining unallocated wages', () => {
    const shift = { ...selectedShift, work_type: 'shipping' };
    const summary = buildAccountingLaborSummary({
      allocations: [{ time_entry_id: shift.id, minutes: 180, work_type: 'production', wage_cents: 7000 }],
      salaryPayments: [], timeEntries: [shift], overtimeContextEntries: [...earlierShifts, shift],
    });

    expect(summary.productionLaborCogsCents).toBe(10000);
    expect(summary.otherSalariesCents).toBe(6000);
    expect(summary.totalLaborCents).toBe(16000);
  });

  it('keeps overtime when a Labor Paid GPM trend bucket has only the last shift of a workweek', () => {
    const summary = buildLaborPaidGpmSummary({
      allocations: [], current, entries: [selectedShift],
      overtimeContextEntries: [...earlierShifts, selectedShift], productionRuns: [], salaryPayments: [],
    });

    expect(summary.hourlyLaborPaidCents).toBe(15000);
    expect(summary.productionHours).toBe(5);
    expect(summary.actualTotalCogsCents).toBe(35000);
    expect(summary.actualLaborGpmPercent).toBe(65);
  });

  it('includes the production remainder of a partially allocated overtime shift', () => {
    const summary = buildLaborPaidGpmSummary({
      allocations: [{ time_entry_id: selectedShift.id, minutes: 180, work_type: 'shipping', wage_cents: 6000 }],
      current, entries: [selectedShift], overtimeContextEntries: [...earlierShifts, selectedShift],
      productionRuns: [], salaryPayments: [],
    });

    expect(summary.hourlyLaborPaidCents).toBe(6000);
    expect(summary.productionHours).toBe(2);
    expect(summary.hourlyEntryCount).toBe(1);
  });
});

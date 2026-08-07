import { describe, expect, it } from 'vitest';
import { buildLaborPaidGpmSummary } from './labor-paid-gpm-reporting';
import type { ProfitabilityTotals } from './profitability-reporting';

function totals(overrides: Partial<ProfitabilityTotals>): ProfitabilityTotals {
  return {
    brandingLabelCents: 0,
    donationCogsCents: 0,
    estimatedLineCount: 0,
    fixedCents: 0,
    fixedOtherCents: 0,
    grossProfitCents: 70000,
    laborCents: 10000,
    marginPercent: 70,
    materialCents: 20000,
    orderCount: 1,
    processingFeeCogsCents: 0,
    productCogsCents: 30000,
    revenueCents: 100000,
    shippingCogsCents: 0,
    shippingLabelCents: 0,
    snapshotLineCount: 1,
    tapeCents: 0,
    totalCogsCents: 30000,
    unitsSold: 1,
    ...overrides,
  };
}

describe('buildLaborPaidGpmSummary', () => {
  it('replaces shipped labor COGS with production-tagged payroll labor', () => {
    const summary = buildLaborPaidGpmSummary({
      allocations: [],
      current: totals({}),
      entries: [
        {
          admin_time_breaks: [],
          clock_in_at: '2026-07-10T14:00:00.000Z',
          clock_out_at: '2026-07-10T16:00:00.000Z',
          hourly_rate_cents_snapshot: 2000,
          id: 'entry-production',
          locked_at: '2026-07-12T00:00:00.000Z',
          profile_id: 'profile-1',
          status: 'locked',
          work_type: 'production',
        },
        {
          admin_time_breaks: [],
          clock_in_at: '2026-07-10T17:00:00.000Z',
          clock_out_at: '2026-07-10T18:00:00.000Z',
          hourly_rate_cents_snapshot: 2500,
          id: 'entry-shipping',
          locked_at: '2026-07-12T00:00:00.000Z',
          profile_id: 'profile-2',
          status: 'locked',
          work_type: 'shipping',
        },
      ],
      productionRuns: [
        {
          actual_labor_cost_cents: 3000,
          quantity_produced: 10,
          quantity_voided: 0,
          status: 'completed',
        },
      ],
      salaryPayments: [
        {
          id: 'salary-production',
          paid_at: '2026-07-31T15:00:00.000Z',
          salary_labor_work_type: 'production',
          salary_pay_cents: 6000,
        },
      ],
    });

    expect(summary.hourlyLaborPaidCents).toBe(4000);
    expect(summary.salaryLaborPaidCents).toBe(6000);
    expect(summary.actualLaborPaidCents).toBe(10000);
    expect(summary.actualTotalCogsCents).toBe(30000);
    expect(summary.actualLaborGpmPercent).toBe(70);
    expect(summary.hourlyEntryCount).toBe(1);
    expect(summary.productionRunLaborCogsCents).toBe(3000);
    expect(summary.laborDifferenceCents).toBe(7000);
  });

  it('uses allocation rows before entry-level work tags and wages', () => {
    const summary = buildLaborPaidGpmSummary({
      allocations: [
        {
          minutes: 30,
          time_entry_id: 'entry-mixed',
          wage_cents: 1500,
          work_type: 'production',
        },
      ],
      current: totals({ laborCents: 10000 }),
      entries: [
        {
          admin_time_breaks: [],
          clock_in_at: '2026-07-10T14:00:00.000Z',
          clock_out_at: '2026-07-10T16:00:00.000Z',
          hourly_rate_cents_snapshot: 2000,
          id: 'entry-mixed',
          locked_at: null,
          profile_id: 'profile-1',
          status: 'approved',
          work_type: 'shipping',
        },
      ],
      productionRuns: [],
      salaryPayments: [],
    });

    expect(summary.hourlyLaborPaidCents).toBe(1500);
    expect(summary.productionHours).toBe(0.5);
    expect(summary.unlockedProductionEntryCount).toBe(1);
  });

  it('uses explicit production run labor COGS for labor difference when provided', () => {
    const summary = buildLaborPaidGpmSummary({
      allocations: [],
      current: totals({ laborCents: 10000 }),
      entries: [],
      productionRunLaborCogsCents: 2500,
      productionRuns: [
        {
          actual_labor_cost_cents: 9000,
          quantity_produced: 10,
          quantity_voided: 0,
          status: 'completed',
        },
      ],
      salaryPayments: [
        {
          id: 'salary-production',
          paid_at: '2026-07-31T15:00:00.000Z',
          salary_labor_work_type: 'production',
          salary_pay_cents: 6000,
        },
      ],
    });

    expect(summary.actualLaborPaidCents).toBe(6000);
    expect(summary.productionRunLaborCogsCents).toBe(2500);
    expect(summary.laborDifferenceCents).toBe(3500);
  });
});

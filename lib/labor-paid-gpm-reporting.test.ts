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
  it('adds earned deferred production pay only to the accrual comparison and preserves base payroll and shipped COGS', () => {
    const input = {
      allocations: [],
      current: totals({}),
      entries: [{
        id: 'production', profile_id: 'employee', status: 'approved', work_type: 'production',
        clock_in_at: '2026-10-07T13:00:00Z', clock_out_at: '2026-10-07T21:00:00Z',
        hourly_rate_cents_snapshot: 1500, admin_time_breaks: [],
      }],
      productionRuns: [], salaryPayments: [],
    };
    const base = buildLaborPaidGpmSummary(input);
    const summary = buildLaborPaidGpmSummary({ ...input, deferredProductionAccruedCents: 4000 });
    expect(summary.actualLaborPaidCents).toBe(12000);
    expect(summary.actualLaborPaidCents).toBe(base.actualLaborPaidCents);
    expect(summary.shippedTotalCogsCents).toBe(base.shippedTotalCogsCents);
    expect(summary.actualTotalCogsCents).toBe(base.actualTotalCogsCents);
    expect(summary).toMatchObject({
      deferredProductionAccruedCents: 4000, accruedLaborCostCents: 16000,
      accrualTotalCogsCents: 36000, accrualGrossProfitCents: 64000, accrualGpmPercent: 64,
    });
  });

  it('leaves the comparison unchanged when the period has no new deferred production expense', () => {
    const summary = buildLaborPaidGpmSummary({ allocations: [], current: totals({}), entries: [], productionRuns: [], salaryPayments: [] });
    expect(summary.deferredProductionAccruedCents).toBe(0);
    expect(summary.accrualTotalCogsCents).toBe(summary.actualTotalCogsCents);
    expect(summary.accrualGpmPercent).toBe(summary.actualLaborGpmPercent);
  });

  it('preserves a negative cent of period category rounding so the comparison reconciles to Accounting', () => {
    const summary = buildLaborPaidGpmSummary({
      allocations: [], current: totals({}), entries: [], productionRuns: [], salaryPayments: [],
      deferredProductionAccruedCents: -1,
    });
    expect(summary.deferredProductionAccruedCents).toBe(-1);
    expect(summary.accruedLaborCostCents).toBe(-1);
    expect(summary.accrualTotalCogsCents).toBe(summary.actualTotalCogsCents - 1);
    expect(summary.accrualGrossProfitCents).toBe(summary.actualGrossProfitCents + 1);
  });

  it.each(['profile-1', null])('preserves production payroll labor with profile %s', (profileId) => {
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
          profile_id: profileId,
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

import { describe, expect, it } from 'vitest';
import { buildDeferredPayAccountingSummary } from './deferred-pay-accounting';
import { calculateDeferredPay, type DeferredPayEntry, type DeferredPayPlan } from './deferred-pay';
import { buildAccountingPnlStatement } from './accounting-pnl-statement';
import { createAccountingPnlPdf } from './accounting-pnl-pdf';

const plan: DeferredPayPlan = {
  id: 'plan', profile_id: 'haskins', label: 'Deferred pay', start_date: '2026-10-07', end_date: '2027-01-03',
  payout_date: '2027-01-04', accrual_rate_cents: 500, weekly_rate_cents: 1500, paid_at: null, paid_amount_cents: null,
};
const now = new Date('2027-02-01T18:00:00Z');
const entry: DeferredPayEntry = { id: 'shift', profile_id: 'haskins', clock_in_at: '2026-10-07T08:00:00-05:00', clock_out_at: '2026-10-07T16:00:00-05:00', hourly_rate_cents_snapshot: 1500, status: 'locked', work_type: 'sales' };
const build = (start: string, end: string, entries = [entry], overrides: Partial<DeferredPayPlan> = {}) => buildDeferredPayAccountingSummary({ plans: [{ ...plan, ...overrides }], entries, start, end, now });

describe('deferred payroll accounting', () => {
  it('expenses earned October pay and carries it as a liability until the recorded January payment', () => {
    const paid = { paid_at: '2027-01-04T06:00:00Z', paid_amount_cents: 4000, accounting_transaction_id: 'bank' };
    expect(build('2026-10-01', '2026-10-31', [entry], paid)).toMatchObject({ openingLiabilityCents: 0, accruedCents: 4000, paidCents: 0, closingLiabilityCents: 4000, operatingAccruedCents: 4000, productionAccruedCents: 0 });
    expect(build('2026-12-01', '2026-12-31', [entry], paid)).toMatchObject({ openingLiabilityCents: 4000, accruedCents: 0, paidCents: 0, closingLiabilityCents: 4000 });
    expect(build('2027-01-04', '2027-01-31', [entry], paid)).toMatchObject({ openingLiabilityCents: 4000, accruedCents: 0, paidCents: 4000, closingLiabilityCents: 0, settlementTransactionIds: ['bank'] });
    expect(build('2027-01-05', '2027-01-31', [entry], paid)).toMatchObject({ openingLiabilityCents: 0, accruedCents: 0, paidCents: 0, closingLiabilityCents: 0 });
  });

  it('splits overnight year-end shifts by actual Central earned time, net of crossing breaks', () => {
    const overnight = { ...entry, clock_in_at: '2026-12-31T23:00:00-06:00', clock_out_at: '2027-01-01T02:00:00-06:00', admin_time_breaks: [
      { break_start_at: '2026-12-31T23:45:00-06:00', break_end_at: '2027-01-01T00:15:00-06:00', status: 'closed' },
    ] };
    expect(build('2026-12-01', '2026-12-31', [overnight])).toMatchObject({ eligibleHours: 0.75, accruedCents: 375, closingLiabilityCents: 375 });
    expect(build('2027-01-01', '2027-01-31', [overnight])).toMatchObject({ eligibleHours: 1.75, openingLiabilityCents: 375, accruedCents: 875, closingLiabilityCents: 1250 });
  });

  it('preserves cumulative pennies across adjacent months and reconciles to employee Week Hours', () => {
    const entries = [
      { ...entry, id: 'oct', clock_in_at: '2026-10-31T23:59:58-05:00', clock_out_at: '2026-11-01T00:00:02-05:00' },
      { ...entry, id: 'nov', clock_in_at: '2026-11-30T23:59:58-06:00', clock_out_at: '2026-12-01T00:00:02-06:00' },
      { ...entry, id: 'dec', clock_in_at: '2026-12-31T23:59:58-06:00', clock_out_at: '2027-01-01T00:00:02-06:00' },
    ];
    const periods = [['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31'], ['2027-01-01', '2027-01-31']].map(([start, end]) => build(start, end, entries));
    expect(periods.reduce((sum, row) => sum + row.accruedCents, 0)).toBe(calculateDeferredPay(plan, entries, now).accruedCents);
    periods.forEach((row, index) => {
      expect(row.openingLiabilityCents + row.accruedCents - row.paidCents).toBe(row.closingLiabilityCents);
      expect(row.byWorkType.reduce((sum, part) => sum + part.accruedCents, 0)).toBe(row.accruedCents);
      if (index) expect(row.openingLiabilityCents).toBe(periods[index - 1].closingLiabilityCents);
    });
  });

  it('uses labor allocation proportions and keeps unallocated hours on the shift tag', () => {
    const summary = buildDeferredPayAccountingSummary({ plans: [plan], entries: [entry], now, start: '2026-10-01', end: '2026-10-31', allocations: [
      { time_entry_id: entry.id, minutes: 240, work_type: 'production' },
      { time_entry_id: entry.id, minutes: 120, work_type: 'admin' },
    ] });
    expect(summary).toMatchObject({ accruedCents: 4000, productionAccruedCents: 2000, operatingAccruedCents: 2000 });
    expect(summary.byWorkType.map((row) => [row.workType, row.eligibleHours, row.accruedCents])).toEqual([['admin', 2, 1000], ['production', 4, 2000], ['sales', 2, 1000]]);
  });

  it('reconciles monthly expense categories to the full period, including cent reclassifications without new production hours', () => {
    const entries = [
      { ...entry, id: 'oct', work_type: 'production', clock_in_at: '2026-10-31T12:00:00-05:00', clock_out_at: '2026-10-31T12:00:04-05:00' },
      { ...entry, id: 'nov', work_type: 'admin', clock_in_at: '2026-11-30T12:00:00-06:00', clock_out_at: '2026-11-30T12:00:04-06:00' },
      { ...entry, id: 'dec', work_type: 'production', clock_in_at: '2026-12-31T12:00:00-06:00', clock_out_at: '2026-12-31T12:00:04-06:00' },
    ];
    const periods = [['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30'], ['2026-12-01', '2026-12-31']]
      .map(([start, end]) => build(start, end, entries));
    const annual = build('2026-01-01', '2026-12-31', entries);
    expect(periods[1]).toMatchObject({ accruedCents: 0, productionAccruedCents: -1, operatingAccruedCents: 1 });
    expect(periods[1].byWorkType.find((row) => row.workType === 'production')).toMatchObject({ eligibleHours: 0, accruedCents: -1 });
    for (const key of ['accruedCents', 'productionAccruedCents', 'operatingAccruedCents'] as const) {
      expect(periods.reduce((sum, period) => sum + period[key], 0)).toBe(annual[key]);
    }
    for (const row of annual.byWorkType) {
      expect(periods.reduce((sum, period) => sum + (period.byWorkType.find((part) => part.workType === row.workType)?.accruedCents ?? 0), 0)).toBe(row.accruedCents);
    }
    const statement = buildAccountingPnlStatement({ categories: [], transactions: [], deferredPay: periods[1] });
    expect(statement.adjustedPnl).toMatchObject({ cogsCents: -1, operatingExpenseCents: 1, netIncomeCents: 0 });
  });

  it('does not recognize future/open/void shifts or future payment records', () => {
    const summary = buildDeferredPayAccountingSummary({ plans: [{ ...plan, paid_at: '2027-01-04T06:00:00Z', paid_amount_cents: 4000 }], entries: [entry, { ...entry, id: 'open', status: 'open' }, { ...entry, id: 'void', status: 'void' }], now: new Date('2026-10-07T15:00:00-05:00'), start: '2026-10-01', end: '2027-01-31' });
    expect(summary).toMatchObject({ accruedCents: 0, paidCents: 0, closingLiabilityCents: 0 });
  });

  it('exposes credit balances after corrections, instead of losing the liability reconciliation', () => {
    expect(build('2027-01-01', '2027-01-31', [], { paid_at: '2027-01-04T06:00:00Z', paid_amount_cents: 4000 })).toMatchObject({ accruedCents: 0, paidCents: 4000, closingLiabilityCents: -4000, byWorkType: [{ workType: 'unassigned', paidCents: 4000 }] });
  });
});

describe('deferred payroll P&L bridge', () => {
  const payroll = { id: 'payroll', name: 'Payroll', category_type: 'expense', pnl_section: 'operating_expenses' as const };
  const bank = { id: 'bank', amount_cents: 50000, transaction_date: '2026-10-08', status: 'categorized', category_id: payroll.id, accounting_categories: payroll };

  it('adds earned production expense after the base payroll reclass without absorbing it', () => {
    const production = { ...entry, work_type: 'production' };
    const deferredPay = build('2026-10-01', '2026-10-31', [production]);
    const baseline = buildAccountingPnlStatement({ categories: [payroll], transactions: [bank], payrollTimeEntries: [production] });
    const statement = buildAccountingPnlStatement({ categories: [payroll], transactions: [bank], payrollTimeEntries: [production], deferredPay });
    expect(statement.laborReclassCents).toBe(baseline.laborReclassCents);
    expect(statement.adjustedPnl.cogsCents - baseline.adjustedPnl.cogsCents).toBe(4000);
    expect(statement.adjustedPnl.operatingExpenseCents).toBe(baseline.adjustedPnl.operatingExpenseCents);
    expect(statement.adjustedPnl.netIncomeCents).toBe(baseline.adjustedPnl.netIncomeCents - 4000);
  });

  it('adds sales deferred pay only to operating expense and carries it into PDF detail', () => {
    const statement = buildAccountingPnlStatement({ categories: [], transactions: [], deferredPay: build('2026-10-01', '2026-10-31') });
    expect(statement.adjustedPnl).toMatchObject({ cogsCents: 0, grossProfitCents: 0, operatingExpenseCents: 4000, netIncomeCents: -4000 });
    expect(statement.categoryBreakdown[0].rows[0]).toMatchObject({ totalCents: 4000, label: 'Deferred operating pay earned' });
    const pdf = new TextDecoder().decode(createAccountingPnlPdf({ statement, period: { start: '2026-10-01', end: '2026-10-31' }, generatedAt: now }));
    expect(pdf).toContain('Deferred Operating Pay Earned');
    expect(pdf).toContain('Closing Balance Owed');
  });

  it('excludes linked settlement from P&L even when bank category is wrong, preserving input cash activity', () => {
    const deferredPay = build('2027-01-04', '2027-01-31', [entry], { paid_at: '2027-01-04T06:00:00Z', paid_amount_cents: 4000, accounting_transaction_id: 'bank' });
    const transactions = [{ ...bank, transaction_date: '2027-01-04', amount_cents: 4000 }];
    const statement = buildAccountingPnlStatement({ categories: [payroll], transactions, deferredPay });
    expect(statement.adjustedPnl).toMatchObject({ netIncomeCents: 0, operatingExpenseCents: 0 });
    expect(statement.payrollOperatingExpenseCents).toBe(0);
    expect(statement.categoryBreakdown).toEqual([]);
    expect(transactions[0]).toMatchObject({ amount_cents: 4000, status: 'categorized', category_id: 'payroll' });
  });

  it('keeps production-run fallback and ignores excluded payroll in the reclass', () => {
    const statement = buildAccountingPnlStatement({ categories: [payroll], transactions: [{ ...bank, status: 'excluded' }], productionRuns: [{ actual_labor_cost_cents: 1000, quantity_produced: 1, quantity_voided: 0, status: 'completed' }], deferredPay: build('2026-10-01', '2026-10-31', [{ ...entry, work_type: 'production' }]) });
    expect(statement).toMatchObject({ laborCogsCents: 1000, laborReclassCents: 0, deferredProductionAccrualCents: 4000 });
    expect(statement.adjustedPnl.cogsCents).toBe(5000);
  });
});

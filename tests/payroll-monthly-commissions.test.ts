import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PayrollMonthlyCommissions from '@/components/payroll-monthly-commissions';
import { emptyCommissionSummary } from '@/lib/commissions';
import type { PayrollCommissionRow } from '@/lib/payroll-commissions';

vi.mock('next/link', () => ({ default: 'a' }));

function row(overrides: Partial<PayrollCommissionRow> = {}): PayrollCommissionRow {
  return {
    salesProfileId: 'thomas', summary: { ...emptyCommissionSummary(), commissionCents: 30000, grossProfitCents: 300000, orderCount: 1 },
    payout: null, amountOwedCents: 15000, cogsEstimated: false, eligibleOrderIds: ['order'], paidOrderIds: [],
    pendingInvoiceOrderIds: [], pendingInvoiceCount: 0, pendingInvoiceCents: 0,
    hourlyOffsetEnabled: true, hourlyBaseWagesCents: 15000, netCommissionCents: 15000, commissionPercent: 10,
    settlementBlockedReason: null, ...overrides,
  };
}

function render(commissionRow: PayrollCommissionRow, currentMonth = '2026-11-01') {
  return renderToStaticMarkup(createElement(PayrollMonthlyCommissions, {
    action: async () => {}, canEdit: true, commissionMonth: '2026-10-01', currentMonth,
    error: false, profiles: new Map([['thomas', { id: 'thomas', full_name: 'Thomas', email: 'thomas@example.test', is_active: true }]]),
    rows: [commissionRow], salesProfileIds: ['thomas'], selectedAdmin: '', currentParams: {}, activeTab: 'payments', returnTo: '/admin/payroll',
  }));
}

const plainText = (markup: string) => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

describe('monthly hourly-offset commission display', () => {
  it('separates the GP percentage, gross amount, wages, and extra payment', () => {
    const markup = render(row());
    const content = plainText(markup);
    expect(content).toContain('Commissions owed $150.00');
    expect(content).toContain('10% of gross profit');
    expect(content).toContain('Gross commission: $300.00');
    expect(content).toContain('Monthly hourly wages: $150.00');
    expect(content).toContain('Extra commission: $150.00');
    expect(content).toContain('First-order SPIFFs remain separate');
    expect(markup).toContain('name="payment_amount_cents" value="15000"');
  });

  it('offers no payment when gross commission does not exceed hourly wages', () => {
    const markup = render(row({ hourlyBaseWagesCents: 40000, netCommissionCents: 0, amountOwedCents: 0 }));
    expect(plainText(markup)).toContain('Extra commission: $0.00');
    expect(plainText(markup)).toContain('No commission due');
    expect(markup).not.toContain('Mark commission paid');
  });

  it('keeps the current month visible without allowing payment', () => {
    const markup = render(row(), '2026-10-01');
    expect(plainText(markup)).toContain('Accrued commissions $150.00');
    expect(plainText(markup)).toContain('Pay on Nov 1, 2026');
    expect(markup).not.toContain('Mark commission paid');
  });

  it('explains incomplete time entries and withholds payment controls', () => {
    const markup = render(row({ settlementBlockedReason: 'Approve or lock all time entries for this month before paying commission.' }));
    expect(plainText(markup)).toContain('Needs review');
    expect(plainText(markup)).toContain('$150.00 pending review');
    expect(plainText(markup)).toContain('Approve or lock all time entries');
    expect(markup).not.toContain('Mark commission paid');
  });

  it('keeps standard commission displays free of hourly-offset details', () => {
    const markup = render(row({ hourlyOffsetEnabled: false, netCommissionCents: 30000, amountOwedCents: 30000 }));
    expect(plainText(markup)).toContain('Commissions owed $300.00');
    expect(markup).not.toContain('Monthly hourly wages');
    expect(markup).not.toContain('First-order SPIFFs remain separate');
  });
});

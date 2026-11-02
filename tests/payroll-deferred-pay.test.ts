import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PayrollDeferredPay, { type DeferredPayBankTransaction } from '@/components/payroll-deferred-pay';
import { buildDeferredPayAccountingSummary } from '@/lib/deferred-pay-accounting';
import type { DeferredPayEntry, DeferredPayPlan } from '@/lib/deferred-pay';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  requireEdit: vi.fn(async () => ({})),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionEdit: state.requireEdit }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('@/lib/deferred-pay-settlement', () => ({ recordDeferredPayPayment: vi.fn(), linkDeferredPayPayment: vi.fn() }));
vi.mock('next/link', () => ({ default: 'a' }));

import { GET } from '@/app/api/export/deferred-pay/route';

const plan: DeferredPayPlan = {
  id: 'plan-1', profile_id: 'haskins', label: 'January 4 deferred pay',
  start_date: '2026-10-07', end_date: '2027-01-03', payout_date: '2027-01-04',
  weekly_rate_cents: 1500, accrual_rate_cents: 500, paid_at: null, paid_amount_cents: null,
};
const entries: DeferredPayEntry[] = [
  { id: 'october', profile_id: 'haskins', clock_in_at: '2026-10-07T13:00:00Z', clock_out_at: '2026-10-07T21:00:00Z', status: 'locked', hourly_rate_cents_snapshot: 1500, work_type: 'sales' },
  { id: 'january', profile_id: 'haskins', clock_in_at: '2027-01-03T14:00:00Z', clock_out_at: '2027-01-03T16:00:00Z', status: 'approved', hourly_rate_cents_snapshot: 1500, work_type: 'sales' },
];
const now = new Date('2027-01-04T18:00:00Z');

function summary(overrides: Partial<DeferredPayPlan> = {}, asOf = now, sourceEntries = entries) {
  return buildDeferredPayAccountingSummary({
    plans: [{ ...plan, ...overrides }], entries: sourceEntries, employeeNames: { haskins: 'Haskins' },
    start: '2027-01-01', end: '2027-01-31', now: asOf,
  });
}

function bank(id: string, overrides: Partial<DeferredPayBankTransaction> = {}): DeferredPayBankTransaction {
  return {
    id, transaction_date: '2027-01-04', account_type: 'bank', account_name: 'Checking',
    original_description: `Payment ${id}`, merchant_name: null, amount_cents: 5000, status: 'needs_review', ...overrides,
  };
}

function render(props: Partial<Parameters<typeof PayrollDeferredPay>[0]> = {}) {
  return renderToStaticMarkup(createElement(PayrollDeferredPay, {
    summary: summary(), error: false, canEditPayroll: true, canEditAccounting: true,
    returnTo: '/admin/payroll?tab=payments&admin=haskins', bankTransactions: [bank('matching')], ...props,
  }));
}
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

afterEach(() => vi.useRealTimers());

describe('deferred payroll controls', () => {
  it('keeps current liability independent of the report period and weekly paid locks', () => {
    const html = render();
    expect(plain(html)).toContain('Current deferred liability $50.00');
    expect(plain(html)).toContain('Deferred payable now $50.00');
    expect(plain(html)).toContain('Eligible hours accrued 10.00 hrs');
    expect(plain(html)).toContain('$15.00/hr paid weekly + $5.00/hr deferred');
    expect(html).toContain('name="expected_amount_cents" value="5000"');
    const dateInput = html.match(/<input\b[^>]*name="paid_date"[^>]*>/)?.[0] ?? '';
    for (const attribute of ['required=""', 'min="2027-01-04"', 'max="2027-01-04"', 'value="2027-01-04"']) expect(dateInput).toContain(attribute);
    expect(html).not.toContain('name="lock_start"');
    expect(html).toContain('no funds are transferred');
  });

  it('does not offer payment before January 4 or to a read-only viewer', () => {
    const before = render({ summary: summary({}, new Date('2027-01-03T23:00:00Z')) });
    expect(plain(before)).toContain('Deferred payable now $0.00');
    expect(before).not.toContain('<form');
    expect(before).toContain('Payment can be recorded on or after Jan 4, 2027');
    const readonly = render({ canEditPayroll: false });
    expect(readonly).not.toContain('<form');
    expect(readonly).toContain('View only');
  });

  it('only offers unlinked dedicated bank outflows with the full gross amount and accounting edit access', () => {
    const data = summary();
    data.settlementTransactionIds = ['used'];
    const html = render({ summary: data, bankTransactions: [
      bank('matching'), bank('used'), bank('net', { amount_cents: 4500 }),
      bank('card', { account_type: 'credit_card' }), bank('excluded', { status: 'excluded' }),
      bank('future', { transaction_date: '2027-01-05' }), bank('before-due', { transaction_date: '2027-01-03' }),
    ] });
    expect(html).toContain('<option value="matching">');
    for (const id of ['used', 'net', 'card', 'excluded', 'future', 'before-due']) expect(html).not.toContain(`<option value="${id}">`);
    const withoutAccounting = render({ canEditAccounting: false });
    expect(withoutAccounting).toContain('Record payment');
    expect(withoutAccounting).not.toContain('name="accounting_transaction_id"');
  });

  it('supports a later bank match without offering a second payment', () => {
    const html = render({ summary: summary({ paid_at: '2027-01-04T18:00:00Z', paid_amount_cents: 5000 }) });
    expect(html).toContain('Match recorded payment to a bank transaction');
    expect(html).not.toContain('Record lump-sum payment');
    expect(plain(html)).toContain('Remaining balance $0.00');
    expect(html).toContain('name="expected_amount_cents" value="5000"');
    expect(render({ summary: summary({ paid_at: '2027-01-04T18:00:00Z', paid_amount_cents: 5000, accounting_transaction_id: 'matching' }) })).not.toContain('<form');
  });

  it('shows signed overpayment corrections and reports period accrual separately from paid money', () => {
    const corrected = render({ summary: summary({ paid_at: now.toISOString(), paid_amount_cents: 5000 }, now, [entries[0]]) });
    expect(plain(corrected)).toContain('Remaining balance -$10.00');
    expect(corrected).toContain('Balance needs review');
    const report = render({ mode: 'report', summary: summary({ paid_at: now.toISOString(), paid_amount_cents: 5000 }) });
    expect(plain(report)).toContain('Opening liability $40.00');
    expect(plain(report)).toContain('Accrued in period $10.00');
    expect(plain(report)).toContain('Paid in period $50.00');
    expect(plain(report)).toContain('Closing liability $0.00');
    expect(report).not.toContain('<form');
  });

  it('shows unavailable balances on data failure instead of a zero liability or payment action', () => {
    const html = render({ summary: null, error: true });
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('$0.00');
    expect(html).not.toContain('<form');
  });
});

describe('deferred payroll CSV', () => {
  it('exports a January rollforward with October opening liability and the recorded settlement', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    state.client = supabaseReadStub({ maxRows: 1, tables: {
      admin_deferred_pay_plans: [{ ...plan, paid_at: now.toISOString(), paid_amount_cents: 5000, accounting_transaction_id: 'bank-1' }],
      admin_time_entries: entries,
      profiles: [{ id: 'haskins', full_name: 'Haskins', email: 'haskins@example.test' }],
    } }).client;
    const response = await GET(new NextRequest('https://example.test/api/export/deferred-pay?from=2027-01-01&to=2027-01-31&admin=haskins'));
    expect(state.requireEdit).toHaveBeenCalledWith('payroll', '/admin/payroll?error=write_denied');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const lines = (await response.text()).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"All labor tags","2.00","40.00","10.00","50.00","0.00","15.00","5.00"');
    expect(lines[1]).toContain('"2027-01-04","bank-1"');
  });

  it('rejects invalid dates and refuses a partial export on load failure', async () => {
    expect((await GET(new NextRequest('https://example.test/api/export/deferred-pay?from=2027-02-30&to=2027-03-01'))).status).toBe(400);
    state.client = supabaseReadStub({ fail: (read) => read.table === 'admin_deferred_pay_plans' ? 'Unavailable' : undefined }).client;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await GET(new NextRequest('https://example.test/api/export/deferred-pay?from=2027-01-01&to=2027-01-31'));
      expect(response.status).toBe(500);
      expect(response.headers.get('content-disposition')).toBeNull();
    } finally { log.mockRestore(); }
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof supabaseReadStub>['client'] }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: vi.fn(async () => ({})) }));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => state.client }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/components/accounting-bulk-selection-controls', () => ({ default: () => null }));
vi.mock('@/components/pending-submit-button', () => ({ default: () => null }));
vi.mock('@/components/status-toast', () => ({ default: () => null }));

import AccountingPage from '@/app/admin/accounting/page';

describe('accounting tab data requirements', () => {
  it('keeps deferred earnings in the P&L without the payroll summary card', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-05T18:00:00Z'));
    state.client = supabaseReadStub({ tables: {
      admin_deferred_pay_plans: [{ id: 'plan', profile_id: 'employee', label: 'Deferred pay', start_date: '2026-10-07', end_date: '2027-01-03', payout_date: '2027-01-04', accrual_rate_cents: 500, weekly_rate_cents: 1500, paid_at: null, paid_amount_cents: null }],
      admin_time_entries: [{ id: 'shift', profile_id: 'employee', clock_in_at: '2026-10-07T13:00:00Z', clock_out_at: '2026-10-07T21:00:00Z', hourly_rate_cents_snapshot: 1500, status: 'locked', work_type: 'sales' }],
    } }).client;
    try {
      const markup = renderToStaticMarkup(await AccountingPage({ searchParams: Promise.resolve({ view: 'pnl', start: '2026-10-01', end: '2026-10-31' }) }));
      expect(markup).not.toContain('Earned pay and balance owed');
      expect(markup).toMatch(/Deferred operating pay earned<\/td><td[^>]*>\(\$40\.00\)/);
      expect(markup).toMatch(/Net income<\/td><td[^>]*>-\$40\.00/);
      expect(markup).not.toContain('Closing balance owed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not render misleading totals when deferred plans are unavailable', async () => {
    state.client = supabaseReadStub({ fail: (read) => read.table === 'admin_deferred_pay_plans' ? 'Ledger unavailable' : undefined }).client;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const markup = renderToStaticMarkup(await AccountingPage({ searchParams: Promise.resolve({ view: 'pnl' }) }));
      expect(markup).toContain('Accounting data could not be loaded');
      expect(markup).not.toContain('Net income');
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    ['upload', []],
    ['review', ['accounting_categories', 'accounting_transactions']],
    ['categories', ['accounting_categories', 'accounting_transactions']],
    ['imports', ['accounting_upload_batches']],
    ['last_updates', ['accounting_transactions', 'accounting_transactions']],
  ] as const)('loads only visible data for %s', async (view, expectedTables) => {
    const stub = supabaseReadStub();
    state.client = stub.client;
    await AccountingPage({ searchParams: Promise.resolve({ view }) });
    expect(stub.reads.map((read) => read.table).sort()).toEqual([...expectedTables].sort());
  });

  it('shows an error instead of financial figures when a required payroll source fails', async () => {
    const stub = supabaseReadStub({ fail: (read) => read.table === 'admin_time_entries' ? 'Payroll unavailable' : undefined });
    state.client = stub.client;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const markup = renderToStaticMarkup(await AccountingPage({ searchParams: Promise.resolve({ view: 'pnl' }) }));
      expect(markup).toContain('Accounting data could not be loaded');
      expect(markup).not.toContain('Adjusted gross profit');
      expect(markup).not.toContain('Production run labor estimate');
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    ['2026-09-01', '2026-09-30', '2026-10-01'],
    ['2026-07-01', '2026-09-30', '2026-10-01'],
    ['2025-01-01', '2025-12-31', '2026-01-01'],
  ])('uses the selected period %s through %s for the P&L data and date controls', async (start, end, endExclusive) => {
    const stub = supabaseReadStub();
    state.client = stub.client;
    const markup = renderToStaticMarkup(await AccountingPage({ searchParams: Promise.resolve({ view: 'pnl', start, end }) }));
    expect(markup).toContain('P&amp;L period');
    for (const label of ['Last month', 'Last quarter', 'Last year', 'Year to date', 'Custom dates']) {
      expect(markup).toContain(`>${label}</option>`);
    }
    expect(markup).toContain(`value="${start}"`);
    expect(markup).toContain(`value="${end}"`);
    expect(markup).toContain('formAction="/admin/accounting/pnl-statement"');
    const transactionsRead = stub.reads.find((read) => read.table === 'accounting_transactions');
    expect(transactionsRead?.filters).toEqual(expect.arrayContaining([
      { operator: 'gte', column: 'transaction_date', value: start },
      { operator: 'lt', column: 'transaction_date', value: endExclusive },
    ]));
    const salaryRead = stub.reads.find((read) => read.table === 'admin_salary_payroll_payments');
    expect(salaryRead?.filters).toEqual(expect.arrayContaining([
      { operator: 'lte', column: 'period_start_date', value: end },
      { operator: 'gte', column: 'period_end_date', value: start },
    ]));
  });

  it('keeps transaction review filters when applying custom dates', async () => {
    state.client = supabaseReadStub().client;
    const markup = renderToStaticMarkup(await AccountingPage({
      searchParams: Promise.resolve({ view: 'review', start: '2026-08-02', end: '2026-08-19', category: 'coffee', q: 'vendor' }),
    }));
    expect(markup).toContain('name="view" value="review"');
    expect(markup).toContain('name="category" value="coffee"');
    expect(markup).toContain('name="q" value="vendor"');
  });

  it('keeps the default P&L and Year to date on the same Central calendar date at New Year', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T05:59:00Z'));
    state.client = supabaseReadStub().client;
    try {
      const markup = renderToStaticMarkup(await AccountingPage({ searchParams: Promise.resolve({ view: 'pnl' }) }));
      expect(markup).toContain('<option value="year_to_date" selected="">Year to date</option>');
      expect(markup).toContain('value="2025-01-01"');
      expect(markup).toContain('value="2025-12-31"');
    } finally {
      vi.useRealTimers();
    }
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof supabaseReadStub>['client'] }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: vi.fn(async () => ({})) }));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => state.client }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/accounting-bulk-selection-controls', () => ({ default: () => null }));
vi.mock('@/components/pending-submit-button', () => ({ default: () => null }));
vi.mock('@/components/status-toast', () => ({ default: () => null }));

import AccountingPage from '@/app/admin/accounting/page';

describe('accounting tab data requirements', () => {
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
});

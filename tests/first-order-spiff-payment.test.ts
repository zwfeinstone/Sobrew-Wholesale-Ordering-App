import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  authorize: vi.fn(), eligibility: vi.fn(), update: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ access: {}, profile: { id: 'reviewer' } }),
  requireAdminSectionEdit: state.authorize,
  adminCanEdit: () => true,
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      ...state.client.from(table),
      update: (payload: Record<string, unknown>) => state.update(table, payload),
    }),
  },
}));
vi.mock('@/lib/admin-audit', () => ({ recordAdminAuditLog: state.audit }));
vi.mock('@/lib/commission-invoice-eligibility', () => ({ getCommissionInvoiceEligibility: state.eligibility }));
vi.mock('@/lib/payroll-commissions', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  loadPayrollCommissions: async () => ({ rows: [], error: null }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/status-toast', () => ({ default: () => null }));

import PayrollPage from '@/app/admin/payroll/page';

type Action = (formData: FormData) => Promise<void>;
function findAction(node: ReactNode): Action | undefined {
  if (Array.isArray(node)) return node.map(findAction).find(Boolean);
  if (!isValidElement<{ action?: Action; children?: ReactNode }>(node)) return;
  if (node.type === 'form' && node.props.action?.name === 'markWeeklySalesSpiffPaid') return node.props.action;
  return findAction(node.props.children);
}

function eligibility(paidOrderIds: string[] = [], error: string | null = null) {
  return { error, paidOrderIds: new Set(paidOrderIds), unpaidOrderIds: new Set(), missingInvoiceOrderIds: new Set() };
}

function setSpiff(firstOrderId: string | null = 'first-order', paidAt: string | null = null, historical = false) {
  state.client = supabaseReadStub({ tables: {
    profiles: [{ id: 'sales-rep', full_name: 'Sales Rep', email: 'sales@example.test', is_active: true }],
    admin_commission_settings: [{ profile_id: 'sales-rep', commission_percent: 5, is_sales_rep: true }],
    admin_weekly_sales_spiffs: [{
      id: 'spiff', profile_id: 'sales-rep', first_order_id: firstOrderId, amount_cents: 5000,
      week_start_date: historical ? '2026-09-21' : '2026-09-28', week_end_date: historical ? '2026-09-27' : '2026-10-04',
      notes: historical ? 'Automatic first-order SPIFF: historical unpaid customer.' : 'Sales SPIFF', paid_at: paidAt,
    }],
  } }).client;
}

async function action(historical = false) {
  const result = findAction(await PayrollPage({ searchParams: Promise.resolve({ tab: 'payments', from: historical ? '2026-09-21' : '2026-09-28', to: historical ? '2026-09-27' : '2026-10-04' }) }));
  expect(result).toBeTypeOf('function');
  // Assertions below concern the fresh check at submission, after page display.
  state.eligibility.mockClear();
  return result!;
}

function form() {
  const data = new FormData();
  data.set('spiff_id', 'spiff');
  data.set('return_to', '/admin/payroll?tab=payments');
  data.set('first_order_id', 'forged-paid-order');
  data.set('paid_by', 'forged-actor');
  return data;
}

function updateQuery(updatedId: string | null = 'spiff') {
  return {
    eq: (column: string, value: string) => {
      expect([column, value]).toEqual(['id', 'spiff']);
      return { is: (column: string, value: null) => {
        expect([column, value]).toEqual(['paid_at', null]);
        return { select: (columns: string) => {
          expect(columns).toBe('id');
          return { maybeSingle: async () => ({ error: null, data: updatedId ? { id: updatedId } : null }) };
        } };
      } };
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T16:00:00.000Z'));
  vi.clearAllMocks();
  setSpiff();
  state.authorize.mockResolvedValue({ profile: { id: 'reviewer' } });
  state.eligibility.mockResolvedValue(eligibility(['first-order']));
  state.update.mockImplementation(() => updateQuery());
  state.audit.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('first-order SPIFF payment boundary', () => {
  it.each(['unpaid', 'partially paid', 'missing'])('rejects direct submission when the first-order invoice is %s', async () => {
    const pay = await action();
    state.eligibility.mockResolvedValueOnce(eligibility());

    await expect(pay(form())).rejects.toThrow('error=spiff_invoice_unpaid');

    expect(state.eligibility).toHaveBeenCalledExactlyOnceWith(['first-order']);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('holds the payout when QuickBooks verification fails, even if a result contains paid IDs', async () => {
    const pay = await action();
    state.eligibility.mockResolvedValueOnce(eligibility(['first-order'], 'QuickBooks unavailable'));

    await expect(pay(form())).rejects.toThrow('error=spiff_invoice_error');

    expect(state.update).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('uses the stored first order and current administrator when its invoice is paid', async () => {
    const pay = await action();

    await expect(pay(form())).rejects.toThrow('success=spiff_paid');

    expect(state.eligibility).toHaveBeenCalledExactlyOnceWith(['first-order']);
    expect(state.authorize.mock.invocationCallOrder[0]).toBeLessThan(state.eligibility.mock.invocationCallOrder[0]);
    expect(state.eligibility.mock.invocationCallOrder[0]).toBeLessThan(state.update.mock.invocationCallOrder[0]);
    expect(state.update).toHaveBeenCalledExactlyOnceWith('admin_weekly_sales_spiffs', {
      paid_at: '2026-10-02T16:00:00.000Z', paid_by: 'reviewer',
      updated_at: '2026-10-02T16:00:00.000Z', updated_by: 'reviewer',
    });
    expect(state.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'weekly_sales_spiff_marked_paid', actorProfileId: 'reviewer', targetProfileId: 'sales-rep',
    }));
  });

  it('keeps manual SPIFF payments independent of invoice verification', async () => {
    setSpiff(null);
    const pay = await action();
    state.eligibility.mockResolvedValue(eligibility([], 'QuickBooks unavailable'));

    await expect(pay(form())).rejects.toThrow('success=spiff_paid');

    expect(state.eligibility).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenCalledOnce();
    expect(state.audit).toHaveBeenCalledOnce();
  });

  it('preserves an existing unpaid first-order SPIFF without backfilling an invoice requirement', async () => {
    setSpiff(null, null, true);
    const pay = await action(true);
    state.eligibility.mockResolvedValue(eligibility([], 'QuickBooks unavailable'));

    await expect(pay(form())).rejects.toThrow('success=spiff_paid');

    expect(state.eligibility).not.toHaveBeenCalled();
    expect(state.update).toHaveBeenCalledOnce();
    expect(state.audit).toHaveBeenCalledOnce();
  });

  it('rejects unauthorized submissions before invoice checks or mutations', async () => {
    const pay = await action();
    state.authorize.mockRejectedValueOnce(new Error('Payroll edit denied'));

    await expect(pay(form())).rejects.toThrow('Payroll edit denied');

    expect(state.eligibility).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('does not pay an already-paid SPIFF twice', async () => {
    const pay = await action();
    setSpiff('first-order', '2026-10-01T16:00:00.000Z');

    await expect(pay(form())).rejects.toThrow('success=spiff_already_paid');

    expect(state.eligibility).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('does not bypass invoice verification when the first-order migration is missing', async () => {
    const pay = await action();
    state.client = supabaseReadStub({ fail: (read) => read.columns === '*,first_order_id' ? 'Column first_order_id does not exist' : undefined }).client;

    await expect(pay(form())).rejects.toThrow('error=save_error');

    expect(state.eligibility).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('does not create a second audit if another request pays the same SPIFF first', async () => {
    const pay = await action();
    state.update.mockImplementationOnce(() => updateQuery(null));

    await expect(pay(form())).rejects.toThrow('success=spiff_already_paid');

    expect(state.update).toHaveBeenCalledOnce();
    expect(state.audit).not.toHaveBeenCalled();
  });
});

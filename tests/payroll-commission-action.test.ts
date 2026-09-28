import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  authorize: vi.fn(), recordPayment: vi.fn(), audit: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ access: {}, profile: { id: 'reviewer' } }),
  requireAdminSectionEdit: state.authorize,
  adminCanEdit: () => true,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('@/lib/admin-audit', () => ({ recordAdminAuditLog: state.audit }));
vi.mock('@/lib/payroll-commissions', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  loadPayrollCommissions: async () => ({ rows: [], error: null }),
  recordPayrollCommissionPaid: state.recordPayment,
}));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/status-toast', () => ({ default: () => null }));

import PayrollPage from '@/app/admin/payroll/page';
import PayrollMonthlyCommissions from '@/components/payroll-monthly-commissions';

type Action = (formData: FormData) => Promise<void>;
function commissionAction(node: ReactNode): Action | undefined {
  if (Array.isArray(node)) return node.map(commissionAction).find(Boolean);
  if (!isValidElement<{ action?: Action; children?: ReactNode }>(node)) return;
  if (node.type === PayrollMonthlyCommissions) return node.props.action;
  return commissionAction(node.props.children);
}

async function action() {
  const result = commissionAction(await PayrollPage({ searchParams: Promise.resolve({ tab: 'payments' }) }));
  expect(result).toBeTypeOf('function');
  return result!;
}

function form(returnTo = '/admin/payroll?tab=payments&commission_month=2026-08&admin=casey&success=old&error=old') {
  const data = new FormData();
  data.set('sales_profile_id', 'casey');
  data.set('commission_month', '2026-08-01');
  data.set('return_to', returnTo);
  data.set('commission_cents', '999999'); // Displayed or submitted amounts are never authoritative.
  data.set('actor_profile_id', 'forged-actor');
  return data;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-25T16:00:00.000Z'));
  vi.clearAllMocks();
  state.client = supabaseReadStub().client;
  state.authorize.mockResolvedValue({ profile: { id: 'reviewer' } });
  state.recordPayment.mockResolvedValue({ payout: { id: 'payout', commission_cents: 12500, status: 'paid' }, before: null });
  state.audit.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('monthly commission payroll action boundary', () => {
  it('authorizes before recording, trusts the service amount, audits once, and refreshes shared commission views', async () => {
    const pay = await action();
    await expect(pay(form())).rejects.toThrow('REDIRECT /admin/payroll?tab=payments&commission_month=2026-08&admin=casey&success=commission_paid#monthly-commissions');
    expect(state.authorize).toHaveBeenCalledWith('payroll', '/admin/payroll?error=write_denied');
    expect(state.authorize.mock.invocationCallOrder[0]).toBeLessThan(state.recordPayment.mock.invocationCallOrder[0]);
    expect(state.recordPayment).toHaveBeenCalledExactlyOnceWith({ commissionMonth: '2026-08-01', salesProfileId: 'casey', actorProfileId: 'reviewer' });
    expect(state.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'monthly_commission_paid', actorProfileId: 'reviewer', targetProfileId: 'casey',
      sectionKey: 'payroll', before: null, after: { id: 'payout', commission_cents: 12500, status: 'paid' },
    }));
    expect(state.revalidate.mock.calls).toEqual([['/admin/payroll'], ['/admin/sales-admin'], ['/admin/commission']]);
  });

  it('does not reach the payment service when payroll edit access is denied', async () => {
    const pay = await action();
    state.authorize.mockRejectedValueOnce(new Error('Payroll edit denied'));
    await expect(pay(form())).rejects.toThrow('Payroll edit denied');
    expect(state.recordPayment).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it('reports an already-recorded payment without creating another audit record', async () => {
    const pay = await action();
    state.recordPayment.mockResolvedValueOnce({ alreadyPaid: true, payout: { id: 'existing-payment', commission_cents: 12500, status: 'paid' } });
    await expect(pay(form())).rejects.toThrow('success=commission_already_paid#monthly-commissions');
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.recordPayment).toHaveBeenCalledOnce();
    expect(state.revalidate).toHaveBeenCalledWith('/admin/payroll');
  });

  it('returns a service failure to the monthly section without a success audit or cache refresh', async () => {
    const pay = await action();
    state.recordPayment.mockResolvedValueOnce({ error: { message: 'Payment month is not complete.' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(pay(form())).rejects.toThrow('REDIRECT /admin/payroll?tab=payments&commission_month=2026-08&admin=casey&error=commission_payment_error#monthly-commissions');
      expect(state.audit).not.toHaveBeenCalled();
      expect(state.revalidate).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it('keeps the payment redirect inside payroll when given a foreign return location', async () => {
    const pay = await action();
    await expect(pay(form('https://example.test/external'))).rejects.toThrow('REDIRECT /admin/payroll?success=commission_paid#monthly-commissions');
  });
});

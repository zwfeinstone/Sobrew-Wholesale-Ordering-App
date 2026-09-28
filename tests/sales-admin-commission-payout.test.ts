import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub, type SupabaseRead } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as { from: (table: string) => any },
  audit: vi.fn(),
  recordPaid: vi.fn(),
  revalidate: vi.fn(),
  requireEdit: vi.fn(async () => ({ profile: { id: 'owner' } })),
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: vi.fn(async () => ({ isOwner: true, profile: { id: 'owner' } })),
  requireAdminSectionEdit: state.requireEdit,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('@/lib/admin-audit', () => ({ recordAdminAuditLog: state.audit }));
vi.mock('@/lib/payroll-commissions', () => ({ recordPayrollCommissionPaid: state.recordPaid }));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); } }));

import SalesAdminPage from '@/app/admin/sales-admin/page';

type ServerAction = (formData: FormData) => Promise<void>;

function hasPayoutField(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasPayoutField);
  if (!isValidElement<{ name?: string; children?: ReactNode }>(node)) return false;
  return node.props.name === 'payout_action' || hasPayoutField(node.props.children);
}

function findPayoutAction(node: ReactNode): ServerAction | undefined {
  if (Array.isArray(node)) return node.map(findPayoutAction).find(Boolean);
  if (!isValidElement<{ action?: ServerAction; children?: ReactNode }>(node)) return;
  if (node.type === 'form' && node.props.action && hasPayoutField(node.props.children)) return node.props.action;
  return findPayoutAction(node.props.children);
}

async function payoutAction() {
  state.client = supabaseReadStub({ tables: {
    profiles: [{ id: 'rep', full_name: 'Sales Rep', email: 'sales@example.test', is_active: true }],
    admin_commission_settings: [{ profile_id: 'rep', is_sales_rep: true }],
    admin_labor_tag_assignments: [{ profile_id: 'rep', work_type: 'sales' }],
  } }).client;
  const action = findPayoutAction(await SalesAdminPage({ searchParams: Promise.resolve({ month: '2026-08' }) }));
  expect(action).toBeTypeOf('function');
  return action!;
}

function form(action: 'locked' | 'paid') {
  const data = new FormData();
  data.set('sales_profile_id', 'rep');
  data.set('commission_month', '2026-08-01');
  data.set('payout_action', action);
  return data;
}

function mutationStub({
  tables = {},
  fail,
  insertError = null,
}: {
  tables?: Record<string, Array<Record<string, unknown>>>;
  fail?: (read: SupabaseRead) => string | undefined;
  insertError?: { code: string; message: string } | null;
} = {}) {
  const readStub = supabaseReadStub({ tables, fail, maxRows: 1 });
  const insert = vi.fn(async (_payload: unknown) => ({ data: null, error: insertError }));
  state.client = { from: (table) => ({ ...readStub.client.from(table), insert }) };
  return { ...readStub, insert };
}

beforeEach(() => {
  state.audit.mockReset();
  state.recordPaid.mockReset();
  state.revalidate.mockReset();
  state.requireEdit.mockReset().mockResolvedValue({ profile: { id: 'owner' } });
});

describe('Sales Admin commission payout protection', () => {
  it.each([
    ['locked', null, 'payout_locked'],
    ['paid', null, 'payout_paid'],
    ['locked', '2026-09-01T12:00:00Z', 'payout_paid'],
  ])('does not overwrite an existing %s payout with paid_at %s', async (status, paidAt, toast) => {
    const action = await payoutAction();
    const stub = mutationStub({ tables: { monthly_commission_payouts: [{ id: 'payout', status, paid_at: paidAt, commission_cents: 12345 }] } });

    await expect(action(form('locked'))).rejects.toThrow(`toast=${toast}`);
    expect(stub.insert).not.toHaveBeenCalled();
    expect(stub.reads.map((read) => read.table)).toEqual(['monthly_commission_payouts']);
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it('stops when an existing payout cannot be checked', async () => {
    const action = await payoutAction();
    const stub = mutationStub({ fail: () => 'Unavailable' });

    await expect(action(form('locked'))).rejects.toThrow('toast=payout_error');
    expect(stub.insert).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('locks all pages of shipment snapshots once and audits the frozen total', async () => {
    const action = await payoutAction();
    const stub = mutationStub({ tables: { order_commission_snapshots: [
      { id: 'first', commission_cents: 100.25, revenue_cents: 1000 },
      { id: 'second', commission_cents: 200.5, revenue_cents: 2000 },
    ] } });

    await expect(action(form('locked'))).rejects.toThrow('toast=payout_locked');
    expect(stub.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sales_profile_id: 'rep', commission_month: '2026-08-01', commission_cents: 300.75,
      order_count: 2, revenue_cents: 3000, status: 'locked', paid_at: null, paid_by: null,
    }));
    const reads = stub.reads.filter((read) => read.table === 'order_commission_snapshots');
    expect(reads).toHaveLength(3);
    expect(reads.every((read) => read.orders.at(-1)?.column === 'id')).toBe(true);
    expect(reads[0].filters).toEqual([
      { operator: 'eq', column: 'sales_profile_id', value: 'rep' },
      { operator: 'eq', column: 'commission_month', value: '2026-08-01' },
    ]);
    expect(state.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'monthly_commission_locked', before: null, sectionKey: 'sales_admin',
      after: expect.objectContaining({ commission_cents: 300.75 }),
    }));
    expect(state.revalidate.mock.calls).toEqual([['/admin/payroll'], ['/admin/sales-admin'], ['/admin/commission']]);
  });

  it('does not lock partial data when a later snapshot page fails', async () => {
    const action = await payoutAction();
    const stub = mutationStub({
      tables: { order_commission_snapshots: [{ id: 'first', commission_cents: 100 }, { id: 'second', commission_cents: 200 }] },
      fail: (read) => read.table === 'order_commission_snapshots' && read.from > 0 ? 'Later page failed' : undefined,
    });

    await expect(action(form('locked'))).rejects.toThrow('toast=payout_error');
    expect(stub.insert).not.toHaveBeenCalled();
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('fails safely when another screen creates the payout before the lock insert', async () => {
    const action = await payoutAction();
    const stub = mutationStub({ insertError: { code: '23505', message: 'Duplicate payout' } });

    await expect(action(form('locked'))).rejects.toThrow('toast=payout_error');
    expect(stub.insert).toHaveBeenCalledTimes(1);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('uses the shared payment service and audits its preserved before/after amounts', async () => {
    const action = await payoutAction();
    const stub = mutationStub();
    const before = { id: 'payout', status: 'locked', commission_cents: 12345 };
    const payout = { ...before, status: 'paid', paid_at: '2026-09-01T12:00:00Z' };
    state.recordPaid.mockResolvedValue({ before, payout });

    await expect(action(form('paid'))).rejects.toThrow('toast=payout_paid');
    expect(state.recordPaid).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      actorProfileId: 'owner', salesProfileId: 'rep', commissionMonth: '2026-08-01',
    }));
    expect(state.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'monthly_commission_paid', before, after: payout, sectionKey: 'sales_admin', targetProfileId: 'rep',
    }));
    expect(stub.insert).not.toHaveBeenCalled();
    expect(stub.reads).toEqual([]);
    expect(state.revalidate.mock.calls).toEqual([['/admin/payroll'], ['/admin/sales-admin'], ['/admin/commission']]);
  });

  it('does not record another payment or audit for an already paid commission', async () => {
    const action = await payoutAction();
    mutationStub();
    state.recordPaid.mockResolvedValue({ alreadyPaid: true, payout: { id: 'payout', status: 'paid', commission_cents: 12345 } });

    await expect(action(form('paid'))).rejects.toThrow('toast=payout_paid');
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });

  it('reports a payment-service failure without recording an audit', async () => {
    const action = await payoutAction();
    mutationStub();
    state.recordPaid.mockResolvedValue({ error: { message: 'Payment unavailable' } });

    await expect(action(form('paid'))).rejects.toThrow('toast=payout_error');
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('requires Sales Admin edit access before reading or recording a payout', async () => {
    const action = await payoutAction();
    const stub = mutationStub();
    state.requireEdit.mockRejectedValue(new Error('Write denied'));

    await expect(action(form('paid'))).rejects.toThrow('Write denied');
    expect(state.requireEdit).toHaveBeenCalledWith('sales_admin', '/admin/sales-admin?toast=write_denied');
    expect(state.recordPaid).not.toHaveBeenCalled();
    expect(stub.reads).toEqual([]);
    expect(stub.insert).not.toHaveBeenCalled();
  });
});

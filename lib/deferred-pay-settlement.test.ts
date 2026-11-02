import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  section: vi.fn(), load: vi.fn(), client: vi.fn(), rpc: vi.fn(), query: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionEdit: mocks.section }));
vi.mock('@/lib/deferred-pay-data', () => ({ loadDeferredPayForProfile: mocks.load }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: mocks.client }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

import { linkDeferredPayPayment, recordDeferredPayPayment } from './deferred-pay-settlement';

const PLAN_ID = '10000000-0000-4000-8000-000000000001';
const EMPLOYEE_ID = '10000000-0000-4000-8000-000000000002';
const ACTOR_ID = '10000000-0000-4000-8000-000000000003';
const BANK_ID = '10000000-0000-4000-8000-000000000004';
const plan = {
  id: PLAN_ID, profile_id: EMPLOYEE_ID, payout_date: '2027-01-04', end_date: '2027-01-03',
  paid_at: null as string | null, paid_amount_cents: null as number | null, accounting_transaction_id: null as string | null,
};
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ plan_id: PLAN_ID, expected_amount_cents: '3625',
    paid_date: '2027-01-04', return_to: '/admin/payroll?tab=payments', ...overrides })) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-01-05T18:00:00Z'));
  mocks.section.mockResolvedValue({ profile: { id: ACTOR_ID } });
  mocks.query.mockResolvedValue({ data: { ...plan }, error: null });
  const query = { select: () => query, eq: () => query, maybeSingle: mocks.query };
  mocks.client.mockReturnValue({ from: () => query, rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.load.mockResolvedValue({ data: [{ plan, summary: { accruedCents: 3625, remainingCents: 3625 } }], error: null });
});
afterEach(() => vi.useRealTimers());

describe('recording deferred hourly pay', () => {
  it('checks payroll permission before acquiring service access', async () => {
    mocks.section.mockRejectedValue(new Error('denied'));
    await expect(recordDeferredPayPayment(form())).rejects.toThrow('denied');
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('recalculates the full plan and records only its actual full payment with the authenticated actor', async () => {
    await expect(recordDeferredPayPayment(form({ actor_id: EMPLOYEE_ID, payment_notes: 'Paid by bank transfer' })))
      .rejects.toThrow('success=deferred_pay_paid');
    expect(mocks.load).toHaveBeenCalledWith(mocks.client.mock.results[0].value, EMPLOYEE_ID, new Date('2027-01-05T18:00:00Z'));
    expect(mocks.rpc).toHaveBeenCalledWith('settle_deferred_hourly_pay', {
      p_actor_id: ACTOR_ID, p_plan_id: PLAN_ID, p_expected_amount_cents: 3625,
      p_paid_date: '2027-01-04', p_payment_notes: 'Paid by bank transfer', p_link_only: false,
    });
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual(['/admin/payroll', '/admin/week-hours', '/admin/accounting', '/admin/reports']);
  });

  it('requires accounting edit access before loading or matching a bank transaction', async () => {
    mocks.section.mockImplementation(async (section: string) => {
      if (section === 'accounting') throw new Error('accounting denied');
      return { profile: { id: ACTOR_ID } };
    });
    await expect(recordDeferredPayPayment(form({ accounting_transaction_id: BANK_ID }))).rejects.toThrow('accounting denied');
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ paid_date: '2027-01-03' }, 'deferred_pay_invalid_date'],
    [{ paid_date: '2027-01-06' }, 'deferred_pay_invalid_date'],
    [{ paid_date: '2027-02-30' }, 'deferred_pay_invalid_date'],
    [{ expected_amount_cents: '1000' }, 'deferred_pay_amount_changed'],
    [{ expected_amount_cents: '0' }, 'deferred_pay_invalid'],
    [{ plan_id: 'not-a-plan' }, 'deferred_pay_invalid'],
    [{ accounting_transaction_id: 'bad-bank-id' }, 'deferred_pay_invalid'],
  ])('rejects invalid or partial payment %j', async (overrides, code) => {
    await expect(recordDeferredPayPayment(form(overrides))).rejects.toThrow(`error=${code}`);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not record before January 4 Central even if UTC is already January 4', async () => {
    vi.setSystemTime(new Date('2027-01-04T03:00:00Z'));
    await expect(recordDeferredPayPayment(form())).rejects.toThrow('deferred_pay_not_due');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a plan already paid without recalculating shifts or recording again', async () => {
    mocks.query.mockResolvedValue({ data: { ...plan, paid_at: '2027-01-04T06:00:00Z', paid_amount_cents: 3625 }, error: null });
    await expect(recordDeferredPayPayment(form())).rejects.toThrow('deferred_pay_already_paid');
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails closed when the full accrual cannot be loaded', async () => {
    mocks.load.mockResolvedValue({ data: null, error: { message: 'Break page unavailable' } });
    await expect(recordDeferredPayPayment(form())).rejects.toThrow('deferred_pay_load_error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('preserves atomic RPC failure and does not refresh a false success', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'deferred_pay_amount_changed' } });
    await expect(recordDeferredPayPayment(form())).rejects.toThrow('error=deferred_pay_amount_changed');
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it('restricts return URLs to the actual payroll route', async () => {
    await expect(recordDeferredPayPayment(form({ return_to: 'https://evil.example/admin/payroll' })))
      .rejects.toThrow('redirect:/admin/payroll?tab=payments&success=deferred_pay_paid');
  });
});

describe('linking a later bank import', () => {
  beforeEach(() => {
    mocks.query.mockResolvedValue({ data: { ...plan, paid_at: '2027-01-04T06:00:00Z', paid_amount_cents: 3625 }, error: null });
  });

  it('uses the recorded gross and requires both edit permissions without changing payment history', async () => {
    await expect(linkDeferredPayPayment(form({ accounting_transaction_id: BANK_ID }))).rejects.toThrow('success=deferred_pay_linked');
    expect(mocks.section.mock.calls.map(([section]) => section)).toEqual(['payroll', 'accounting']);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('settle_deferred_hourly_pay', {
      p_actor_id: ACTOR_ID, p_plan_id: PLAN_ID, p_expected_amount_cents: 3625,
      p_accounting_transaction_id: BANK_ID, p_link_only: true,
    });
  });

  it('rejects unmatched gross amounts and never treats the difference as another payment', async () => {
    await expect(linkDeferredPayPayment(form({ accounting_transaction_id: BANK_ID, expected_amount_cents: '3500' })))
      .rejects.toThrow('deferred_pay_amount_changed');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('cannot attach a bank record to an unpaid plan', async () => {
    mocks.query.mockResolvedValue({ data: plan, error: null });
    await expect(linkDeferredPayPayment(form({ accounting_transaction_id: BANK_ID }))).rejects.toThrow('deferred_pay_not_paid');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ permission: vi.fn(), client: vi.fn(), parse: vi.fn(), record: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionEdit: mocks.permission }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: mocks.client }));
vi.mock('@/lib/payroll-payment', () => ({ parsePayrollPaymentSnapshots: mocks.parse, recordReviewedPayrollPayments: mocks.record }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (value: string) => { throw new Error(`redirect:${value}`); } }));

import { recordPayrollPayments } from './payroll-payment-actions';

function form(returnTo = '/admin/payroll?from=2026-10-12&success=old#payroll') {
  const data = new FormData();
  data.set('return_to', returnTo);
  data.set('payment_rows', 'reviewed rows');
  data.set('lock_start', '2026-10-12');
  data.set('lock_end', '2026-10-16');
  data.set('actor_id', 'forged-actor');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.permission.mockResolvedValue({ profile: { id: 'authenticated-actor' } });
  mocks.client.mockReturnValue({ from: vi.fn() });
  mocks.parse.mockReturnValue([{ profileId: 'employee' }]);
  mocks.record.mockResolvedValue({ recordedCount: 1, completedEmployees: 1 });
});

describe('consolidated payroll server action', () => {
  it('checks edit permission before parsing or acquiring service access', async () => {
    mocks.permission.mockRejectedValue(new Error('denied'));
    await expect(recordPayrollPayments(form())).rejects.toThrow('denied');
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it('uses the authenticated actor and refreshes payment destinations', async () => {
    await expect(recordPayrollPayments(form())).rejects.toThrow('success=payroll_payment_recorded#payroll');
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: 'authenticated-actor',
      startInput: '2026-10-12', endInput: '2026-10-16' }));
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual([
      '/admin/payroll', '/admin/week-hours', '/admin/sales-admin', '/admin/commission', '/admin/reports', '/admin/accounting', '/admin',
    ]);
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin', 'layout');
  });

  it('refreshes after partial recording and shows its warning instead of success', async () => {
    mocks.record.mockResolvedValue({ error: 'payroll_payment_partial', recordedCount: 1, completedEmployees: 0 });
    await expect(recordPayrollPayments(form())).rejects.toThrow('redirect:/admin/payroll?from=2026-10-12&error=payroll_payment_partial#payroll');
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/payroll');
  });

  it.each(['https://evil.example/admin/payroll', '/admin/payroll-other', '//evil.example/admin/payroll'])('rejects return destination %s', async (url) => {
    await expect(recordPayrollPayments(form(url))).rejects.toThrow('redirect:/admin/payroll?success=payroll_payment_recorded');
  });

  it('rejects invalid snapshots without service access', async () => {
    mocks.parse.mockReturnValue(null);
    await expect(recordPayrollPayments(form())).rejects.toThrow('error=payroll_payment_invalid');
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

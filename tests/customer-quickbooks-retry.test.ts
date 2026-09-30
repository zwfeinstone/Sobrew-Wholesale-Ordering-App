import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ write: vi.fn(), scope: vi.fn(), sync: vi.fn() }));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: mocks.write }));
vi.mock('@/lib/admin-center-scope', () => ({ requireCenterAccess: mocks.scope }));
vi.mock('@/lib/quickbooks', () => ({ createQuickBooksCustomerFromPortalCenter: mocks.sync }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import { retryCustomerQuickBooksSync } from '@/app/admin/users/[id]/quickbooks-actions';

function form() {
  const value = new FormData();
  value.set('center_id', 'center-1');
  return value;
}
beforeEach(() => { vi.resetAllMocks(); });

describe('customer QuickBooks retry', () => {
  it('requires centers edit access and access to the specific center before syncing', async () => {
    await expect(retryCustomerQuickBooksSync(form())).rejects.toThrow('REDIRECT:/admin/users/center-1?success=quickbooks_linked');
    expect(mocks.write).toHaveBeenCalledWith('/admin/users/center-1?error=admin_write_denied', 'centers');
    expect(mocks.scope).toHaveBeenCalledWith('center-1', '/admin/users/center-1?error=admin_write_denied');
    expect(mocks.write.mock.invocationCallOrder[0]).toBeLessThan(mocks.scope.mock.invocationCallOrder[0]);
    expect(mocks.scope.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0]);
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith('center-1');
  });

  it.each(['write', 'scope'] as const)('does not call QuickBooks when %s access is denied', async (permission) => {
    mocks[permission].mockRejectedValue(new Error('Denied'));
    await expect(retryCustomerQuickBooksSync(form())).rejects.toThrow('Denied');
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it('returns a failed retry to the same saved customer', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sync.mockRejectedValue(new Error('Offline'));
    await expect(retryCustomerQuickBooksSync(form())).rejects.toThrow('REDIRECT:/admin/users/center-1?error=quickbooks_sync_failed');
    consoleError.mockRestore();
  });
});

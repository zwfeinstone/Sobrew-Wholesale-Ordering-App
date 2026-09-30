'use server';

import { redirect } from 'next/navigation';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { requireCenterAccess } from '@/lib/admin-center-scope';
import { createQuickBooksCustomerFromPortalCenter } from '@/lib/quickbooks';

export async function retryCustomerQuickBooksSync(formData: FormData) {
  const centerId = String(formData.get('center_id') ?? '').trim();
  const deniedHref = centerId ? `/admin/users/${centerId}?error=admin_write_denied` : '/admin/users';
  await requireAdminWriteAccess(deniedHref, 'centers');
  if (!centerId) redirect('/admin/users');
  await requireCenterAccess(centerId, deniedHref);
  try {
    await createQuickBooksCustomerFromPortalCenter(centerId);
  } catch (error) {
    console.error('[admin-centers] QuickBooks retry failed', { centerId, error });
    redirect(`/admin/users/${centerId}?error=quickbooks_sync_failed`);
  }
  redirect(`/admin/users/${centerId}?success=quickbooks_linked`);
}

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';

export const ADMIN_WRITE_EMAIL = 'zach@sobrew.com';

export function isAdminWriteAllowed(email: string | null | undefined) {
  return (email ?? '').trim().toLowerCase() === ADMIN_WRITE_EMAIL;
}

export async function requireAdminWriteAccess(redirectTo = '/admin?toast=admin_write_denied') {
  const { user, profile } = await requireAdmin();
  if (!isAdminWriteAllowed(user.email || profile?.email)) {
    redirect(redirectTo);
  }

  return { user, profile };
}

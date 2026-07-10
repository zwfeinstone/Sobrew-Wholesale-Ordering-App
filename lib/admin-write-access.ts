import { redirect } from 'next/navigation';
import type { AdminPermissionKey } from '@/lib/admin-permission-definitions';
import { hasSuperadminAccess } from '@/lib/admin-permission-definitions';
import { requireAdmin } from '@/lib/auth';
import { adminCanEdit } from '@/lib/admin-permissions';

export function isAdminWriteAllowed(email: string | null | undefined, isSuperadmin?: boolean | null) {
  return hasSuperadminAccess(email, isSuperadmin);
}

export async function requireAdminWriteAccess(redirectTo = '/admin?toast=admin_write_denied', sectionKey?: AdminPermissionKey) {
  const { adminAccess, user, profile } = await requireAdmin();
  const email = user.email || profile?.email;
  if (isAdminWriteAllowed(email, profile?.is_superadmin)) {
    return { user, profile };
  }

  if (!sectionKey) {
    redirect(redirectTo);
  }

  if (!adminAccess || !adminCanEdit(adminAccess, sectionKey)) {
    redirect(redirectTo);
  }

  return { user, profile };
}

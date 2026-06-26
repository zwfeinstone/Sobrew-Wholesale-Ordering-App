import { redirect } from 'next/navigation';
import type { AdminPermissionKey } from '@/lib/admin-permission-definitions';
import { isOwnerEmail } from '@/lib/admin-permission-definitions';
import { requireAdmin } from '@/lib/auth';
import { getAdminAccessForProfile, adminCanEdit } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';

export const ADMIN_WRITE_EMAIL = 'zach@sobrew.com';

export function isAdminWriteAllowed(email: string | null | undefined) {
  return isOwnerEmail(email);
}

export async function requireAdminWriteAccess(redirectTo = '/admin?toast=admin_write_denied', sectionKey?: AdminPermissionKey) {
  const { user, profile } = await requireAdmin();
  const email = user.email || profile?.email;
  if (isAdminWriteAllowed(email)) {
    return { user, profile };
  }

  if (!sectionKey) {
    redirect(redirectTo);
  }

  const supabase = await createClient();
  const access = await getAdminAccessForProfile({ email, profileId: profile.id, supabase });
  if (!adminCanEdit(access, sectionKey)) {
    redirect(redirectTo);
  }

  return { user, profile };
}

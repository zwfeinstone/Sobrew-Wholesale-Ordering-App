import { cache } from 'react';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_PERMISSION_KEYS,
  ADMIN_SECTION_LABELS,
  canEditAdminSection,
  canViewAdminSection,
  enforceOwnerOnlyPermissions,
  firstAllowedAdminHref,
  hasSuperadminAccess,
  legacyReadOnlyAccessMap,
  normalizeAccessMap,
  ownerAccessMap,
  type AdminAccessMap,
  type AdminPermissionKey,
} from '@/lib/admin-permission-definitions';

type SupabaseLike = {
  from: (table: string) => any;
};

type ProfileLike = {
  email?: string | null;
  id: string;
  is_superadmin?: boolean | null;
};

export type CurrentAdminAccess = {
  access: AdminAccessMap;
  centerScope: string[] | null;
  firstAllowedHref: string;
  isOwner: boolean;
  isSuperadmin: boolean;
  profile: any;
  user: any;
};

function mapFromRows(rows: Array<{ can_edit: boolean | null; can_view: boolean | null; section_key: string }> | null | undefined) {
  const raw: Partial<Record<AdminPermissionKey, { canEdit: boolean; canView: boolean }>> = {};
  for (const row of rows ?? []) {
    if (!ADMIN_PERMISSION_KEYS.includes(row.section_key as AdminPermissionKey)) continue;
    raw[row.section_key as AdminPermissionKey] = {
      canEdit: Boolean(row.can_edit),
      canView: Boolean(row.can_view || row.can_edit),
    };
  }
  return normalizeAccessMap(raw);
}

export async function getAdminAccessForProfile({
  email,
  isSuperadmin,
  profileId,
  supabase,
}: {
  email?: string | null;
  isSuperadmin?: boolean | null;
  profileId: string;
  supabase: SupabaseLike;
}) {
  let superadmin = Boolean(isSuperadmin);
  if (isSuperadmin === undefined) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_superadmin')
      .eq('id', profileId)
      .maybeSingle();
    superadmin = Boolean(profile?.is_superadmin);
  }

  if (hasSuperadminAccess(email, superadmin)) return ownerAccessMap();

  const { data, error } = await supabase
    .from('admin_permissions')
    .select('section_key,can_view,can_edit')
    .eq('profile_id', profileId);

  if (error) return legacyReadOnlyAccessMap();

  const mapped = mapFromRows(data ?? []);
  const hasAnyRows = (data ?? []).length > 0;
  return enforceOwnerOnlyPermissions(email, hasAnyRows ? mapped : legacyReadOnlyAccessMap(), superadmin);
}

export const getCurrentAdminAccess = cache(async (): Promise<CurrentAdminAccess> => {
  const { adminAccess, centerScope, isOwnerAdmin, user, profile } = await requireAdmin();
  const email = user.email || profile?.email;
  const isSuperadmin = isOwnerAdmin || hasSuperadminAccess(email, profile?.is_superadmin);
  let access = adminAccess;
  if (!access) {
    access = isSuperadmin
      ? ownerAccessMap()
      : await getAdminAccessForProfile({
        email,
        isSuperadmin,
        profileId: profile.id,
        supabase: await createClient(),
      });
  }

  return {
    access,
    centerScope,
    firstAllowedHref: firstAllowedAdminHref(access),
    isOwner: isSuperadmin,
    isSuperadmin,
    profile,
    user,
  };
});

export function adminCanView(access: AdminAccessMap, sectionKey: AdminPermissionKey) {
  return canViewAdminSection(access, sectionKey);
}

export function adminCanEdit(access: AdminAccessMap, sectionKey: AdminPermissionKey) {
  return canEditAdminSection(access, sectionKey);
}

export async function requireAdminSectionView(sectionKey: AdminPermissionKey) {
  const current = await getCurrentAdminAccess();
  if (!adminCanView(current.access, sectionKey)) {
    redirect(`/admin/access-denied?section=${encodeURIComponent(sectionKey)}`);
  }
  return current;
}

export async function requireAdminSectionEdit(sectionKey: AdminPermissionKey, redirectTo?: string) {
  const current = await getCurrentAdminAccess();
  if (!adminCanEdit(current.access, sectionKey)) {
    redirect(redirectTo ?? `/admin/access-denied?section=${encodeURIComponent(sectionKey)}&mode=edit`);
  }
  return current;
}

export async function requireManageAdmins(redirectTo = '/admin/users?error=admin_permission_denied') {
  const current = await getCurrentAdminAccess();
  if (!current.isOwner || !adminCanEdit(current.access, 'manage_admins')) {
    redirect(redirectTo);
  }
  return current;
}

export async function canEditAdminSectionForProfile({
  email,
  isSuperadmin,
  profileId,
  sectionKey,
  supabase,
}: {
  email?: string | null;
  isSuperadmin?: boolean | null;
  profileId: string;
  sectionKey: AdminPermissionKey;
  supabase: SupabaseLike;
}) {
  const access = await getAdminAccessForProfile({ email, isSuperadmin, profileId, supabase });
  return canEditAdminSection(access, sectionKey);
}

export async function canViewAdminSectionForProfile({
  email,
  isSuperadmin,
  profileId,
  sectionKey,
  supabase,
}: {
  email?: string | null;
  isSuperadmin?: boolean | null;
  profileId: string;
  sectionKey: AdminPermissionKey;
  supabase: SupabaseLike;
}) {
  const access = await getAdminAccessForProfile({ email, isSuperadmin, profileId, supabase });
  return canViewAdminSection(access, sectionKey);
}

export function permissionDeniedMessage(sectionKey?: AdminPermissionKey) {
  const label = sectionKey ? ADMIN_SECTION_LABELS[sectionKey] : 'this section';
  return `You do not have permission to edit ${label}.`;
}

export function isOwnerProfile(profile: ProfileLike) {
  return hasSuperadminAccess(profile.email, profile.is_superadmin);
}

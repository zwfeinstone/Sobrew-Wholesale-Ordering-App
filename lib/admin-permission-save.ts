import {
  ADMIN_PERMISSION_KEYS,
  enforceOwnerOnlyPermissions,
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

export function parseAdminPermissionsForm(formData: FormData): AdminAccessMap {
  const raw: Partial<Record<AdminPermissionKey, { canEdit: boolean; canView: boolean }>> = {};

  for (const key of ADMIN_PERMISSION_KEYS) {
    const canEdit = formData.get(`edit_${key}`) === 'on';
    const canView = formData.get(`view_${key}`) === 'on' || canEdit;
    raw[key] = { canEdit, canView };
  }

  return normalizeAccessMap(raw);
}

export function permissionsForProfileEmail(email: string | null | undefined, access: AdminAccessMap, isSuperadmin?: boolean | null) {
  return hasSuperadminAccess(email, isSuperadmin) ? ownerAccessMap() : enforceOwnerOnlyPermissions(email, access, isSuperadmin);
}

export function permissionsToRows(profileId: string, access: AdminAccessMap) {
  return ADMIN_PERMISSION_KEYS.map((key) => ({
    can_edit: access[key].canEdit,
    can_view: access[key].canView,
    profile_id: profileId,
    section_key: key,
    updated_at: new Date().toISOString(),
  }));
}

export function serializePermissionSnapshot(access: AdminAccessMap) {
  return ADMIN_PERMISSION_KEYS.reduce<Record<string, { canEdit: boolean; canView: boolean }>>((snapshot, key) => {
    snapshot[key] = { ...access[key] };
    return snapshot;
  }, {});
}

export async function loadSavedAdminPermissions(supabase: SupabaseLike, profileId: string, email?: string | null, isSuperadmin?: boolean | null) {
  if (hasSuperadminAccess(email, isSuperadmin)) return ownerAccessMap();

  const { data, error } = await supabase
    .from('admin_permissions')
    .select('section_key,can_view,can_edit')
    .eq('profile_id', profileId);

  if (error || !data?.length) return legacyReadOnlyAccessMap();

  const raw: Partial<Record<AdminPermissionKey, { canEdit: boolean; canView: boolean }>> = {};
  for (const row of data ?? []) {
    if (!ADMIN_PERMISSION_KEYS.includes(row.section_key as AdminPermissionKey)) continue;
    raw[row.section_key as AdminPermissionKey] = {
      canEdit: Boolean(row.can_edit),
      canView: Boolean(row.can_view || row.can_edit),
    };
  }

  return permissionsForProfileEmail(email, normalizeAccessMap(raw), isSuperadmin);
}

export async function saveAdminPermissions({
  access,
  email,
  isSuperadmin,
  profileId,
  supabase,
}: {
  access: AdminAccessMap;
  email?: string | null;
  isSuperadmin?: boolean | null;
  profileId: string;
  supabase: SupabaseLike;
}) {
  const normalized = permissionsForProfileEmail(email, access, isSuperadmin);
  const { error } = await supabase
    .from('admin_permissions')
    .upsert(permissionsToRows(profileId, normalized), { onConflict: 'profile_id,section_key' });

  return { access: normalized, error };
}

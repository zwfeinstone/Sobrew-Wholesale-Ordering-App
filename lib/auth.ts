import { cache } from 'react';
import { redirect } from 'next/navigation';
import {
  hasSuperadminAccess,
  isOwnerEmail,
  type AdminAccessMap,
} from '@/lib/admin-permission-definitions';
import { loadSavedAdminPermissions } from '@/lib/admin-permission-save';
import { logAuthProfileIssue } from '@/lib/auth-diagnostics';
import { scheduleUserLastSeen } from '@/lib/last-seen';
import { logServerTiming } from '@/lib/server-performance';
import { createClient } from '@/lib/supabase/server';

export type RequestContextUser = {
  email: string | null;
  id: string;
};

export type RequestContextCenter = {
  id: string;
  is_active: boolean | null;
  name: string | null;
};

export type RequestContextProfile = {
  avatar_url: string | null;
  center: RequestContextCenter | null;
  center_id: string | null;
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
  is_admin: boolean | null;
  is_superadmin: boolean | null;
};

export type RequestContext = {
  adminAccess: AdminAccessMap | null;
  center: RequestContextCenter | null;
  /** null means unrestricted owner access; [] means no assigned centers. */
  centerScope: string[] | null;
  isOwnerAdmin: boolean;
  profile: RequestContextProfile;
  user: RequestContextUser;
};

export function requestUserFromClaims(claims: Record<string, unknown> | null | undefined): RequestContextUser | null {
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null;

  return {
    email: typeof claims.email === 'string' ? claims.email : null,
    id: claims.sub,
  };
}

async function loadAdminCenterScope({
  isOwnerAdmin,
  profileId,
  supabase,
}: {
  isOwnerAdmin: boolean;
  profileId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  if (isOwnerAdmin) return null;

  const { data, error } = await supabase
    .from('admin_center_assignments')
    .select('center_id')
    .eq('profile_id', profileId);

  if (error) {
    logAuthProfileIssue('Protected route admin center scope lookup failed', error, profileId);
    return [];
  }

  return [...new Set(
    (data ?? [])
      .map((row: { center_id: string | null }) => row.center_id)
      .filter((centerId): centerId is string => Boolean(centerId))
  )];
}

/**
 * The single request-local authenticated context used by layouts, pages, and
 * server actions. React cache guarantees repeated requireUser/requireAdmin calls
 * in the same request share identity, profile, permission, and scope lookups.
 */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const requestContextStartedAt = performance.now();
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError) {
    logAuthProfileIssue('Protected route auth claims verification failed', claimsError);
  }

  const user = requestUserFromClaims(claimsData?.claims);
  if (!user) redirect('/login');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,is_admin,is_superadmin,is_active,email,full_name,avatar_url,center_id,centers!profiles_center_id_fkey(id,name,is_active)')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile) {
    logAuthProfileIssue('Protected route profile lookup failed', profileError, user.id);
    await supabase.auth.signOut();
    redirect('/login?error=profile');
  }

  const center = (Array.isArray(profile.centers) ? profile.centers[0] : profile.centers) as RequestContextCenter | null;
  const ownerByEmail = profile.is_admin && isOwnerEmail(user.email || profile.email);
  if (profile.is_active !== true && !ownerByEmail) {
    redirect('/login?inactive=1');
  }
  if (!profile.is_admin && (!profile.center_id || center?.is_active === false)) {
    redirect('/login?inactive=1');
  }

  const normalizedProfile: RequestContextProfile = {
    avatar_url: profile.avatar_url,
    center: center ?? null,
    center_id: profile.center_id,
    email: profile.email,
    full_name: profile.full_name,
    id: profile.id,
    is_active: profile.is_active,
    is_admin: profile.is_admin,
    is_superadmin: profile.is_superadmin,
  };

  scheduleUserLastSeen(supabase, user.id);

  const isOwnerAdmin = Boolean(profile.is_admin) && hasSuperadminAccess(user.email || profile.email, profile.is_superadmin);
  let adminAccess: AdminAccessMap | null = null;
  let centerScope: string[] | null = profile.center_id ? [profile.center_id] : [];

  if (profile.is_admin) {
    [adminAccess, centerScope] = await Promise.all([
      loadSavedAdminPermissions(supabase, profile.id, user.email || profile.email, profile.is_superadmin),
      loadAdminCenterScope({ isOwnerAdmin, profileId: profile.id, supabase }),
    ]);
  }

  const context = {
    adminAccess,
    center: center ?? null,
    centerScope,
    isOwnerAdmin,
    profile: normalizedProfile,
    user,
  };
  logServerTiming('auth_context', requestContextStartedAt, {
    is_admin: Boolean(profile.is_admin),
    is_owner: isOwnerAdmin,
  });
  return context;
});

export async function requireUser() {
  return getRequestContext();
}

export async function requireAdmin() {
  const context = await getRequestContext();
  if (!context.profile.is_admin) redirect('/portal');
  return context;
}

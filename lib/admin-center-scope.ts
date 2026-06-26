import { redirect } from 'next/navigation';
import { getCurrentAdminAccess, type CurrentAdminAccess } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';

type SupabaseLike = {
  from: (table: string) => any;
};

export type AdminCenterScope = string[] | null;

const NO_CENTER_ACCESS_UUID = '00000000-0000-0000-0000-000000000000';

export async function getAssignedCenterIdsForAdmin({
  current,
  profileId,
  supabase,
}: {
  current?: Pick<CurrentAdminAccess, 'isOwner' | 'profile'>;
  profileId?: string;
  supabase: SupabaseLike;
}): Promise<AdminCenterScope> {
  if (current?.isOwner) return null;
  const scopedProfileId = profileId ?? current?.profile?.id;
  if (!scopedProfileId) return [];

  const { data, error } = await supabase
    .from('admin_center_assignments')
    .select('center_id')
    .eq('profile_id', scopedProfileId);

  if (error) {
    console.error('[admin-center-scope] failed to load center assignments', { error, profileId: scopedProfileId });
    return [];
  }

  return [...new Set((data ?? []).map((row: { center_id: string | null }) => row.center_id).filter(Boolean))] as string[];
}

export function scopeCenterRelatedQueryForAdmin(query: any, column: string, centerIds: AdminCenterScope) {
  if (centerIds === null) return query;
  return query.in(column, centerIds.length ? centerIds : [NO_CENTER_ACCESS_UUID]);
}

export function scopeCentersForAdmin(query: any, centerIds: AdminCenterScope) {
  return scopeCenterRelatedQueryForAdmin(query, 'id', centerIds);
}

export async function isSalesRepAdmin({
  profileId,
  supabase,
}: {
  profileId: string;
  supabase: SupabaseLike;
}) {
  const { data, error } = await supabase
    .from('admin_commission_settings')
    .select('is_sales_rep')
    .eq('profile_id', profileId)
    .maybeSingle();

  if (error) {
    console.error('[admin-center-scope] failed to load sales rep status', { error, profileId });
    return false;
  }

  return Boolean(data?.is_sales_rep);
}

export async function getSalesRepCenterIdsForAdmin({
  current,
  profileId,
  supabase,
}: {
  current?: Pick<CurrentAdminAccess, 'isOwner' | 'profile'>;
  profileId?: string;
  supabase: SupabaseLike;
}): Promise<AdminCenterScope> {
  if (current?.isOwner && !profileId) return null;
  const scopedProfileId = profileId ?? current?.profile?.id;
  if (!scopedProfileId) return [];

  const { data, error } = await supabase
    .from('center_sales_assignments')
    .select('center_id')
    .eq('sales_profile_id', scopedProfileId);

  if (error) {
    console.error('[admin-center-scope] failed to load sales rep center assignments', { error, profileId: scopedProfileId });
    return [];
  }

  return [...new Set((data ?? []).map((row: { center_id: string | null }) => row.center_id).filter(Boolean))] as string[];
}

export async function getSalesScopedCenterIdsForAdmin({
  current,
  selectedSalesProfileId,
  supabase,
}: {
  current: Pick<CurrentAdminAccess, 'isOwner' | 'profile'>;
  selectedSalesProfileId?: string;
  supabase: SupabaseLike;
}): Promise<AdminCenterScope> {
  if (current.isOwner) {
    return selectedSalesProfileId
      ? getSalesRepCenterIdsForAdmin({ profileId: selectedSalesProfileId, supabase })
      : null;
  }

  const isSalesRep = await isSalesRepAdmin({ profileId: current.profile.id, supabase });
  if (isSalesRep) {
    return getSalesRepCenterIdsForAdmin({ current, supabase });
  }

  return getAssignedCenterIdsForAdmin({ current, supabase });
}

export async function requireCenterAccess(centerId: string, redirectTo = '/admin/access-denied?section=centers') {
  const current = await getCurrentAdminAccess();
  if (current.isOwner) return current;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('admin_center_assignments')
    .select('center_id')
    .eq('center_id', centerId)
    .eq('profile_id', current.profile.id)
    .maybeSingle();

  if (error || !data) redirect(redirectTo);
  return current;
}

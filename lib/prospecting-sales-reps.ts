import type { createClient } from '@/lib/supabase/server';

export type ProspectingSalesRepProfile = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

const EXCLUDED_PROSPECTING_SALES_REP_PATTERN = /\bbenjamin\b/i;

function profileIdentity(profile: Pick<ProspectingSalesRepProfile, 'email' | 'full_name'>) {
  return [profile.full_name, profile.email].filter(Boolean).join(' ');
}

export function isEligibleProspectingSalesRepProfile(profile: ProspectingSalesRepProfile) {
  return profile.is_active !== false && !EXCLUDED_PROSPECTING_SALES_REP_PATTERN.test(profileIdentity(profile));
}

export function filterProspectingSalesRepProfiles<T extends ProspectingSalesRepProfile>(profiles: T[]) {
  return profiles.filter(isEligibleProspectingSalesRepProfile);
}

export async function loadProspectingSalesReps(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: settings } = await supabase
    .from('admin_commission_settings')
    .select('profile_id')
    .eq('is_sales_rep', true);
  const ids = [...new Set(((settings ?? []) as Array<{ profile_id: string | null }>).map((row) => row.profile_id).filter(Boolean))] as string[];
  if (!ids.length) return [] as ProspectingSalesRepProfile[];
  const { data } = await supabase
    .from('profiles')
    .select('id,email,full_name,is_active')
    .in('id', ids)
    .eq('is_admin', true);
  return filterProspectingSalesRepProfiles((data ?? []) as ProspectingSalesRepProfile[]);
}

export async function isEligibleProspectingSalesRep(supabase: Awaited<ReturnType<typeof createClient>>, profileId: string) {
  const cleanProfileId = profileId.trim();
  if (!cleanProfileId) return false;

  const { data: setting } = await supabase
    .from('admin_commission_settings')
    .select('profile_id,is_sales_rep')
    .eq('profile_id', cleanProfileId)
    .eq('is_sales_rep', true)
    .maybeSingle();
  if (!setting) return false;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,email,full_name,is_active')
    .eq('id', cleanProfileId)
    .eq('is_admin', true)
    .maybeSingle();

  return Boolean(profile && isEligibleProspectingSalesRepProfile(profile as ProspectingSalesRepProfile));
}

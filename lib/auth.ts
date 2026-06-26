import { redirect } from 'next/navigation';
import { isOwnerEmail } from '@/lib/admin-permission-definitions';
import { logAuthProfileIssue } from '@/lib/auth-diagnostics';
import { recordUserLastSeen } from '@/lib/last-seen';
import { createClient } from '@/lib/supabase/server';

export async function requireUser() {
  const supabase = await createClient();
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError) {
    logAuthProfileIssue('Protected route auth user lookup failed', userError);
  }
  if (!data.user) redirect('/login');
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,is_admin,is_active,email,full_name,avatar_url,center_id,centers!profiles_center_id_fkey(id,name,is_active)')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError || !profile) {
    logAuthProfileIssue('Protected route profile lookup failed', profileError, data.user.id);
    await supabase.auth.signOut();
    redirect('/login?error=profile');
  }
  const center = Array.isArray(profile?.centers) ? profile.centers[0] : profile?.centers;
  const isOwnerAdmin = profile.is_admin && isOwnerEmail(data.user.email || profile.email);
  if (profile.is_active !== true && !isOwnerAdmin) {
    redirect('/login?inactive=1');
  }
  if (!profile.is_admin && (!profile.center_id || center?.is_active === false)) {
    redirect('/login?inactive=1');
  }
  await recordUserLastSeen(data.user);
  return { user: data.user, profile: { ...profile, center } };
}

export async function requireAdmin() {
  const { user, profile } = await requireUser();
  if (!profile?.is_admin) redirect('/portal');
  return { user, profile };
}

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id,is_admin,is_active,email,full_name,avatar_url,center_id,centers(id,name,is_active)')
    .eq('id', data.user.id)
    .single();
  const center = Array.isArray(profile?.centers) ? profile.centers[0] : profile?.centers;
  if (!profile?.is_active) {
    redirect('/login?inactive=1');
  }
  if (!profile?.is_admin && (!profile?.center_id || center?.is_active === false)) {
    redirect('/login?inactive=1');
  }
  return { user: data.user, profile: profile ? { ...profile, center } : profile };
}

export async function requireAdmin() {
  const { user, profile } = await requireUser();
  if (!profile?.is_admin) redirect('/portal');
  return { user, profile };
}

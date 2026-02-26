import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id,is_admin,is_active,email,full_name,avatar_url')
    .eq('id', data.user.id)
    .single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    redirect('/login?inactive=1');
  }
  return { user: data.user, profile };
}

export async function requireAdmin() {
  const { user, profile } = await requireUser();
  if (!profile?.is_admin) redirect('/portal');
  return { user, profile };
}

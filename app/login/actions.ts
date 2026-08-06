'use server';

import { redirect } from 'next/navigation';
import { firstAllowedAdminHref, isOwnerEmail } from '@/lib/admin-permission-definitions';
import { loadSavedAdminPermissions } from '@/lib/admin-permission-save';
import { logAuthProfileIssue } from '@/lib/auth-diagnostics';
import { scheduleUserLastSeen } from '@/lib/last-seen';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;
type LoginProfileError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};
type LoginProfile = {
  email: string | null;
  is_active: boolean | null;
  is_admin: boolean | null;
  is_superadmin: boolean | null;
};

const PROFILE_LOOKUP_RETRY_DELAYS_MS = [0, 250, 750];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getLoginProfileWithRetry(supabase: ServerSupabaseClient, userId: string) {
  let lastError: LoginProfileError | null = null;
  for (const delay of PROFILE_LOOKUP_RETRY_DELAYS_MS) {
    if (delay) await sleep(delay);
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('email,is_admin,is_active,is_superadmin')
      .eq('id', userId)
      .maybeSingle();

    if (!error && profile) return { profile, error: null };
    lastError = error;
  }

  return { profile: null, error: lastError };
}

async function getLoginProfileWithAdminFallback({
  email,
  rlsError,
  rlsProfile,
  userId,
}: {
  email: string;
  rlsError: LoginProfileError | null;
  rlsProfile: LoginProfile | null;
  userId: string;
}) {
  if (rlsProfile) return { profile: rlsProfile, error: null };

  const supabaseAdmin = getSupabaseAdmin();
  const adminLookup = await supabaseAdmin
    .from('profiles')
    .select('email,is_admin,is_active,is_superadmin')
    .eq('id', userId)
    .maybeSingle();

  if (adminLookup.data) return { profile: adminLookup.data as LoginProfile, error: null };

  if (isOwnerEmail(email)) {
    const repaired = await supabaseAdmin
      .from('profiles')
      .upsert(
        {
          email,
          id: userId,
          is_active: true,
          is_admin: true,
          is_superadmin: true,
        },
        { onConflict: 'id' }
      )
      .select('email,is_admin,is_active,is_superadmin')
      .single();

    if (!repaired.error && repaired.data) {
      return { profile: repaired.data as LoginProfile, error: null };
    }
    return { profile: null, error: repaired.error ?? adminLookup.error ?? rlsError };
  }

  return { profile: null, error: adminLookup.error ?? rlsError };
}

export async function login(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const supabase = await createClient();
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError || !signInData.user) {
    if (signInError) logAuthProfileIssue('Login auth sign-in failed', signInError);
    redirect('/login?error=1');
  }
  const user = signInData.user;

  const rlsProfileResult = await getLoginProfileWithRetry(supabase, user.id);
  const { profile, error: profileError } = await getLoginProfileWithAdminFallback({
    email,
    rlsError: rlsProfileResult.error,
    rlsProfile: rlsProfileResult.profile,
    userId: user.id,
  });

  if (profileError || !profile) {
    logAuthProfileIssue('Login profile lookup failed', profileError, user.id);
    await supabase.auth.signOut();
    redirect('/login?error=profile');
  }

  const supabaseAdmin = getSupabaseAdmin();
  const { error: emailSyncError } = await supabaseAdmin.from('profiles').update({ email }).eq('id', user.id);
  if (emailSyncError) {
    logAuthProfileIssue('Login profile email sync failed', emailSyncError, user.id);
  }

  if (profile.is_active !== true && !isOwnerEmail(email)) {
    await supabase.auth.signOut();
    redirect('/login?inactive=1');
  }
  scheduleUserLastSeen(supabase, user.id);
  if (profile.is_admin === true) {
    const profileEmail = user.email || profile.email || email;
    const access = await loadSavedAdminPermissions(supabaseAdmin, user.id, profileEmail, profile.is_superadmin);
    redirect(firstAllowedAdminHref(access));
  }
  redirect('/portal');
}

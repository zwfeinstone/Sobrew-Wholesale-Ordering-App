import { redirect } from 'next/navigation';
import Image from 'next/image';
import LoginSubmitButton from '@/components/login-submit-button';
import { isOwnerEmail } from '@/lib/admin-permission-definitions';
import { logAuthProfileIssue } from '@/lib/auth-diagnostics';
import { recordUserLastSeen } from '@/lib/last-seen';
import { supabaseAdmin } from '@/lib/supabase/admin';
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
      .select('email,is_admin,is_active')
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

  const adminLookup = await supabaseAdmin
    .from('profiles')
    .select('email,is_admin,is_active')
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
        },
        { onConflict: 'id' }
      )
      .select('email,is_admin,is_active')
      .single();

    if (!repaired.error && repaired.data) {
      return { profile: repaired.data as LoginProfile, error: null };
    }
    return { profile: null, error: repaired.error ?? adminLookup.error ?? rlsError };
  }

  return { profile: null, error: adminLookup.error ?? rlsError };
}

async function login(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) redirect('/login?error=1');
  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) {
    logAuthProfileIssue('Login auth user lookup failed', userError);
    redirect('/login?error=1');
  }

  const rlsProfileResult = await getLoginProfileWithRetry(supabase, data.user.id);
  const { profile, error: profileError } = await getLoginProfileWithAdminFallback({
    email,
    rlsError: rlsProfileResult.error,
    rlsProfile: rlsProfileResult.profile,
    userId: data.user.id,
  });

  if (profileError || !profile) {
    logAuthProfileIssue('Login profile lookup failed', profileError, data.user.id);
    await supabase.auth.signOut();
    redirect('/login?error=profile');
  }

  const { error: emailSyncError } = await supabaseAdmin.from('profiles').update({ email }).eq('id', data.user.id);
  if (emailSyncError) {
    logAuthProfileIssue('Login profile email sync failed', emailSyncError, data.user.id);
  }

  if (profile.is_active !== true && !isOwnerEmail(email)) {
    await supabase.auth.signOut();
    redirect('/login?inactive=1');
  }
  await recordUserLastSeen(data.user);
  redirect(profile.is_admin === true ? '/admin' : '/portal');
}

export default function LoginPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const loginError = typeof searchParams.error === 'string' ? searchParams.error : '';
  const credentialsError = loginError === '1';
  const profileError = loginError === 'profile';
  const inactive = typeof searchParams.inactive === 'string';

  return (
    <main className="flex min-h-screen items-center px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200/70 bg-white/90 shadow-[0_18px_45px_rgba(42,31,23,0.08)] backdrop-blur md:grid-cols-[1fr_0.9fr]">
        <section className="flex min-h-[24rem] flex-col justify-between gap-10 px-6 py-8 sm:px-8 lg:px-10 lg:py-12">
          <div className="space-y-8">
            <div className="flex items-center gap-4">
              <div className="brand-mark h-16 w-16">
                <Image src="/sobrew-logo.png" alt="Sobrew logo" fill sizes="64px" className="object-contain" priority />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Purpose In Every Pour</p>
                <p className="mt-1 text-sm text-slate-500">Sobrew Wholesale</p>
              </div>
            </div>
            <div className="max-w-xl space-y-4">
              <h1 className="text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-4xl">Welcome to Sobrew Wholesale</h1>
              <p className="text-base leading-7 text-slate-600">
                More than coffee, every order helps someone take a step toward recovery. A portion of every purchase directly supports the recovery community.
              </p>
            </div>
          </div>

          <p className="max-w-md border-t border-slate-200 pt-5 text-sm leading-6 text-slate-500">
            Wholesale ordering with a direct community impact built into every purchase.
          </p>
        </section>

        <section className="border-t border-slate-200/80 bg-slate-50/70 px-6 py-8 sm:px-8 md:border-l md:border-t-0 lg:px-10 lg:py-12">
          <form action={login} className="mx-auto flex h-full w-full max-w-sm flex-col justify-center space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-800">Sign In</p>
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Welcome back</h2>
              <p className="text-sm leading-6 text-slate-500">Use your wholesale portal credentials to access orders, cart, and recurring shipments.</p>
            </div>
            {credentialsError ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">We couldn&apos;t sign you in with those credentials.</p> : null}
            {profileError ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">We couldn&apos;t load your account profile. Please try again in a moment or contact Sobrew if it keeps happening.</p> : null}
            {inactive ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">Your account is inactive. Please contact Sobrew for access.</p> : null}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="login-email">Email address</label>
                <input id="login-email" className="input bg-white" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700" htmlFor="login-password">Password</label>
                <input id="login-password" className="input bg-white" name="password" type="password" autoComplete="current-password" required placeholder="Enter your password" />
              </div>
            </div>
            <LoginSubmitButton />
          </form>
        </section>
      </div>
    </main>
  );
}

import { redirect } from 'next/navigation';
import Image from 'next/image';
import LoginSubmitButton from '@/components/login-submit-button';
import { logAuthProfileIssue } from '@/lib/auth-diagnostics';
import { createClient } from '@/lib/supabase/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;
type LoginProfileError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
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
      .select('is_admin,is_active')
      .eq('id', userId)
      .maybeSingle();

    if (!error && profile) return { profile, error: null };
    lastError = error;
  }

  return { profile: null, error: lastError };
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

  const { profile, error: profileError } = await getLoginProfileWithRetry(supabase, data.user.id);

  if (profileError || !profile) {
    logAuthProfileIssue('Login profile lookup failed', profileError, data.user.id);
    await supabase.auth.signOut();
    redirect('/login?error=profile');
  }

  const { error: emailSyncError } = await supabase.from('profiles').update({ email }).eq('id', data.user.id);
  if (emailSyncError) {
    logAuthProfileIssue('Login profile email sync failed', emailSyncError, data.user.id);
  }

  if (profile.is_active !== true) {
    await supabase.auth.signOut();
    redirect('/login?inactive=1');
  }
  redirect(profile.is_admin === true ? '/admin' : '/portal');
}

export default function LoginPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const loginError = typeof searchParams.error === 'string' ? searchParams.error : '';
  const credentialsError = loginError === '1';
  const profileError = loginError === 'profile';
  const inactive = typeof searchParams.inactive === 'string';

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10">
      <div className="grid w-full items-center gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="panel relative self-center overflow-hidden px-8 py-10 lg:px-10">
          <div className="relative max-w-lg space-y-6">
            <div className="flex items-center gap-4">
              <div className="brand-mark h-20 w-20">
                <Image src="/sobrew-logo.png" alt="Sobrew logo" fill sizes="80px" className="object-contain" priority />
              </div>
              <span className="eyebrow">Purpose In Every Pour</span>
            </div>
            <div className="space-y-4">
              <h1 className="page-title">Welcome to Sobrew Wholesale</h1>
              <p className="max-w-md text-base leading-7 text-slate-600">
                More than coffee, every order helps someone take a step toward recovery. A portion of every purchase directly supports the recovery community.
              </p>
            </div>
            <div className="inline-flex max-w-sm items-start gap-3 rounded-[1.5rem] border border-white/60 bg-white/55 px-4 py-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]">
              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-teal-500" />
              <p className="text-sm leading-6 text-slate-600">
                Wholesale ordering with a direct community impact built into every purchase.
              </p>
            </div>
          </div>
        </section>
        <section className="card flex items-center">
          <form action={login} className="w-full space-y-5">
            <div className="space-y-2">
              <span className="eyebrow">Sign In</span>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-950">Welcome back</h2>
              <p className="text-sm text-slate-500">Use your wholesale portal credentials to access orders, cart, and recurring shipments.</p>
            </div>
            {credentialsError ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">We couldn&apos;t sign you in with those credentials.</p> : null}
            {profileError ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">We couldn&apos;t load your account profile. Please try again in a moment or contact Sobrew if it keeps happening.</p> : null}
            {inactive ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">Your account is inactive. Please contact Sobrew for access.</p> : null}
            <div className="space-y-3">
              <label className="sr-only" htmlFor="login-email">Email address</label>
              <input id="login-email" className="input" name="email" type="email" autoComplete="email" required placeholder="Email address" />
              <label className="sr-only" htmlFor="login-password">Password</label>
              <input id="login-password" className="input" name="password" type="password" autoComplete="current-password" required placeholder="Password" />
            </div>
            <LoginSubmitButton />
          </form>
        </section>
      </div>
    </main>
  );
}

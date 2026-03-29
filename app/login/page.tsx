import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

async function login(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect('/login?error=1');
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect('/login?error=1');

  await supabase.from('profiles').upsert({ id: data.user.id, email }, { onConflict: 'id' });
  const { data: profile } = await supabase.from('profiles').select('is_admin,is_active').eq('id', data.user.id).single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    redirect('/login?inactive=1');
  }
  redirect(profile?.is_admin ? '/admin' : '/portal');
}

export default function LoginPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const error = typeof searchParams.error === 'string';
  const inactive = typeof searchParams.inactive === 'string';

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10">
      <div className="grid w-full items-center gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="panel relative self-center overflow-hidden px-8 py-10 lg:px-10">
          <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-gradient-to-b from-teal-100/50 to-amber-100/30 blur-3xl lg:block" />
          <div className="relative max-w-lg space-y-6">
            <span className="eyebrow">Purpose In Every Pour</span>
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
            {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">We couldn&apos;t sign you in with those credentials.</p> : null}
            {inactive ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">Your account is inactive. Please contact Sobrew for access.</p> : null}
            <div className="space-y-3">
              <input className="input" name="email" type="email" required placeholder="Email address" />
              <input className="input" name="password" type="password" required placeholder="Password" />
            </div>
            <button className="btn-primary w-full">Sign in</button>
          </form>
        </section>
      </div>
    </main>
  );
}

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
      <div className="grid w-full gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="panel relative overflow-hidden">
          <div className="absolute inset-y-0 right-0 hidden w-1/3 bg-gradient-to-b from-teal-100/50 to-amber-100/30 blur-3xl lg:block" />
          <div className="relative max-w-xl space-y-6">
            <span className="eyebrow">Sobrew Wholesale</span>
            <div className="space-y-3">
              <h1 className="page-title">A cleaner ordering flow for every center you support.</h1>
              <p className="page-subtitle">
                Review products, place reorders faster, and keep recurring shipments organized from one polished workspace.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="stat-card">
                <p className="text-sm font-semibold text-slate-950">Streamlined catalog</p>
                <p className="mt-2 text-sm text-slate-500">Quick product selection with clearer order management.</p>
              </div>
              <div className="stat-card">
                <p className="text-sm font-semibold text-slate-950">Recurring visibility</p>
                <p className="mt-2 text-sm text-slate-500">See active schedules and shipment changes at a glance.</p>
              </div>
              <div className="stat-card">
                <p className="text-sm font-semibold text-slate-950">Admin oversight</p>
                <p className="mt-2 text-sm text-slate-500">Track fulfillment updates and user activity with less friction.</p>
              </div>
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

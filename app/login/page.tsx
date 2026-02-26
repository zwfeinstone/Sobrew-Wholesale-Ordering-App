import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

async function login(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '');
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

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <form action={login} className="card w-full space-y-4">
        <h1 className="text-2xl font-semibold">Sobrew Wholesale Login</h1>
        <input className="input" name="email" type="email" required placeholder="Email" />
        <input className="input" name="password" type="password" required placeholder="Password" />
        <button className="btn-primary w-full">Sign in</button>
        <a className="text-sm text-violet-700" href="/bootstrap">Bootstrap first admin</a>
      </form>
    </main>
  );
}

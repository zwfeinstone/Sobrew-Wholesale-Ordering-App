import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { env } from '@/lib/env';

async function bootstrap(formData: FormData) {
  'use server';
  const token = String(formData.get('token') ?? '');
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  if (token !== env.bootstrapToken) redirect('/bootstrap?error=token');

  const supabase = await createClient();
  const { data: settings } = await supabase.from('app_settings').select('id,bootstrap_completed').single();
  if (settings?.bootstrap_completed) redirect('/login?bootstrap=done');

  const existing = await supabaseAdmin.auth.admin.listUsers();
  let userId = existing.data.users.find((u) => u.email === email)?.id;

  if (!userId) {
    const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) redirect('/bootstrap?error=create');
    userId = created.data.user.id;
  } else {
    const updated = await supabaseAdmin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (updated.error) redirect('/bootstrap?error=update');
  }

  await supabaseAdmin.from('profiles').upsert({ id: userId, email, is_admin: true, is_active: true }, { onConflict: 'id' });

  if (settings?.id) {
    await supabaseAdmin.from('app_settings').update({ bootstrap_completed: true }).eq('id', settings.id);
  }

  const signed = await supabase.auth.signInWithPassword({ email, password });
  if (signed.error) redirect('/login?error=1');
  redirect('/admin');
}

export default function BootstrapPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-4">
      <form action={bootstrap} className="card w-full space-y-4">
        <h1 className="text-2xl font-semibold">Bootstrap Sobrew Admin</h1>
        <input className="input" name="email" type="email" required placeholder="Admin Email" />
        <input className="input" name="password" type="password" required placeholder="Admin Password" />
        <input className="input" name="token" type="password" required placeholder="Bootstrap Token" />
        <button className="btn-primary w-full">Create admin</button>
      </form>
    </main>
  );
}

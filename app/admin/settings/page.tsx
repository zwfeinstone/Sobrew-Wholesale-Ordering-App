import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function saveSettings(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const id = String(formData.get('id'));

  const logo = formData.get('logo') as File;
  const hero = formData.get('hero') as File;
  let logo_url;
  let hero_image_url;
  if (logo?.size) {
    const path = `logo-${Date.now()}-${logo.name}`;
    await supabaseAdmin.storage.from('branding').upload(path, logo, { upsert: true });
    logo_url = supabaseAdmin.storage.from('branding').getPublicUrl(path).data.publicUrl;
  }
  if (hero?.size) {
    const path = `hero-${Date.now()}-${hero.name}`;
    await supabaseAdmin.storage.from('branding').upload(path, hero, { upsert: true });
    hero_image_url = supabaseAdmin.storage.from('branding').getPublicUrl(path).data.publicUrl;
  }

  await supabase.from('app_settings').update({
    brand_name: String(formData.get('brand_name') ?? ''),
    accent_color: String(formData.get('accent_color') ?? '#7c3aed'),
    ...(logo_url ? { logo_url } : {}),
    ...(hero_image_url ? { hero_image_url } : {})
  }).eq('id', id);

  redirect('/admin/settings');
}

async function updatePassword(formData: FormData) {
  'use server';

  const supabase = await createClient();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirm_password') ?? '');

  if (password.length < 8) {
    redirect('/admin/settings?password_error=password_length');
  }

  if (password !== confirmPassword) {
    redirect('/admin/settings?password_error=password_mismatch');
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect('/admin/settings?password_error=update_failed');
  }

  redirect('/admin/settings?password_success=password_updated');
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: { password_success?: string; password_error?: string };
}) {
  const supabase = await createClient();
  const { data: settings } = await supabase.from('app_settings').select('*').single();
  if (!settings) return <div>No settings row.</div>;

  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? '';
  const passwordSuccess = searchParams?.password_success;
  const passwordError = searchParams?.password_error;

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Branding</span>
        <h1 className="page-title mt-4">Brand settings</h1>
        <p className="page-subtitle mt-3">Adjust the name, accent color, logo, and hero image used throughout the ordering experience.</p>
      </section>
      <form action={saveSettings} className="card space-y-4">
        <input type="hidden" name="id" value={settings.id} />
        <input className="input" name="brand_name" defaultValue={settings.brand_name ?? 'Sobrew'} />
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Accent color</label>
          <input className="input h-14" name="accent_color" type="color" defaultValue={settings.accent_color ?? '#7c3aed'} />
        </div>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          <span className="block">Logo</span>
          <input className="input" type="file" name="logo" accept="image/*" />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          <span className="block">Hero image</span>
          <input className="input" type="file" name="hero" accept="image/*" />
        </label>
        <button className="btn-primary w-full sm:w-auto">Save</button>
      </form>

      <section className="card space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Admin account</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Change password</h2>
          <p className="mt-2 break-all text-sm text-slate-500">{email}</p>
        </div>

        {passwordSuccess === 'password_updated' ? (
          <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            Your password was updated successfully.
          </div>
        ) : null}

        {passwordError === 'password_length' ? (
          <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Your new password must be at least 8 characters long.
          </div>
        ) : null}

        {passwordError === 'password_mismatch' ? (
          <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Your password confirmation did not match.
          </div>
        ) : null}

        {passwordError === 'update_failed' ? (
          <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            We couldn&apos;t update your password right now. Please try again.
          </div>
        ) : null}

        <form action={updatePassword} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">New password</label>
            <input className="input" name="password" type="password" minLength={8} required placeholder="Enter a new password" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Confirm new password</label>
            <input className="input" name="confirm_password" type="password" minLength={8} required placeholder="Confirm your new password" />
          </div>
          <button className="btn-primary w-full sm:w-auto" type="submit">Save new password</button>
        </form>
      </section>
    </div>
  );
}

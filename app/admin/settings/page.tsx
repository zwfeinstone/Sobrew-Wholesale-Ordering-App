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

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase.from('app_settings').select('*').single();
  if (!settings) return <div>No settings row.</div>;

  return (
    <form action={saveSettings} className="card space-y-3">
      <input type="hidden" name="id" value={settings.id} />
      <h1 className="text-2xl font-semibold">Branding settings</h1>
      <input className="input" name="brand_name" defaultValue={settings.brand_name ?? 'SoBrew'} />
      <input className="input" name="accent_color" type="color" defaultValue={settings.accent_color ?? '#7c3aed'} />
      <label>Logo <input type="file" name="logo" accept="image/*" /></label>
      <label>Hero <input type="file" name="hero" accept="image/*" /></label>
      <button className="btn-primary">Save</button>
    </form>
  );
}

import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { listEasyPostCarrierAccounts, type EasyPostCarrierAccount } from '@/lib/easypost';
import { env } from '@/lib/env';
import { IMAGE_UPLOAD_ACCEPT, ImageUploadError, prepareImageUpload } from '@/lib/image-upload';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function saveSettings(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/settings?error=admin_write_denied', 'settings');

  const supabase = await createClient();
  const id = String(formData.get('id'));

  const logo = formData.get('logo') as File;
  const hero = formData.get('hero') as File;
  let logo_url;
  let hero_image_url;
  if (logo?.size) {
    let prepared;
    try {
      prepared = await prepareImageUpload(logo, { maxBytes: 2 * 1024 * 1024, maxDimension: 2048, maxPixels: 4_000_000 });
    } catch (error) {
      if (error instanceof ImageUploadError) redirect(`/admin/settings?error=${error.code}`);
      throw error;
    }
    const path = `logo/${Date.now()}-${crypto.randomUUID()}.${prepared.extension}`;
    const { error: uploadError } = await supabaseAdmin.storage.from('branding').upload(path, prepared.bytes, {
      cacheControl: '31536000',
      contentType: prepared.contentType,
      upsert: false,
    });
    if (uploadError) redirect('/admin/settings?error=image_upload_failed');
    logo_url = supabaseAdmin.storage.from('branding').getPublicUrl(path).data.publicUrl;
  }
  if (hero?.size) {
    let prepared;
    try {
      prepared = await prepareImageUpload(hero);
    } catch (error) {
      if (error instanceof ImageUploadError) redirect(`/admin/settings?error=${error.code}`);
      throw error;
    }
    const path = `hero/${Date.now()}-${crypto.randomUUID()}.${prepared.extension}`;
    const { error: uploadError } = await supabaseAdmin.storage.from('branding').upload(path, prepared.bytes, {
      cacheControl: '31536000',
      contentType: prepared.contentType,
      upsert: false,
    });
    if (uploadError) redirect('/admin/settings?error=image_upload_failed');
    hero_image_url = supabaseAdmin.storage.from('branding').getPublicUrl(path).data.publicUrl;
  }

  const payload: Record<string, unknown> = {
    brand_name: String(formData.get('brand_name') ?? ''),
    accent_color: String(formData.get('accent_color') ?? '#7c3aed'),
    ...(logo_url ? { logo_url } : {}),
    ...(hero_image_url ? { hero_image_url } : {})
  };

  if (formData.has('shipping_origin_name')) {
    Object.assign(payload, {
      shipping_origin_name: String(formData.get('shipping_origin_name') ?? '').trim() || null,
      shipping_origin_company: String(formData.get('shipping_origin_company') ?? '').trim() || null,
      shipping_origin_address1: String(formData.get('shipping_origin_address1') ?? '').trim() || null,
      shipping_origin_address2: String(formData.get('shipping_origin_address2') ?? '').trim() || null,
      shipping_origin_city: String(formData.get('shipping_origin_city') ?? '').trim() || null,
      shipping_origin_state: String(formData.get('shipping_origin_state') ?? '').trim() || null,
      shipping_origin_zip: String(formData.get('shipping_origin_zip') ?? '').trim() || null,
      shipping_origin_country: String(formData.get('shipping_origin_country') ?? 'US').trim() || 'US',
      shipping_origin_phone: String(formData.get('shipping_origin_phone') ?? '').trim() || null,
      shipping_origin_email: String(formData.get('shipping_origin_email') ?? '').trim() || null,
    });
  }

  await supabase.from('app_settings').update(payload).eq('id', id);

  redirect('/admin/settings');
}

async function updatePassword(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/settings?password_error=admin_write_denied', 'settings');

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

async function testEasyPostConnection() {
  'use server';
  await requireAdminWriteAccess('/admin/settings?easypost_status=admin_write_denied', 'settings');

  if (!env.easypostApiKey) {
    redirect('/admin/settings?easypost_status=missing');
  }

  const result = await listEasyPostCarrierAccounts();
  if (result.error) {
    console.error('[settings] EasyPost connection test failed', { error: result.error });
    redirect('/admin/settings?easypost_status=failed');
  }

  const carrierAccounts = Array.isArray(result.data)
    ? result.data
    : ((result.data?.carrier_accounts ?? []) as EasyPostCarrierAccount[]);
  redirect(`/admin/settings?easypost_status=connected&easypost_count=${carrierAccounts.length}`);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: {
    easypost_count?: string;
    easypost_status?: string;
    error?: string;
    password_error?: string;
    password_success?: string;
  };
}) {
  const current = await requireAdminSectionView('settings');
  const supabase = await createClient();
  const { data: settings } = await supabase.from('app_settings').select('*').single();
  if (!settings) return <div>No settings row.</div>;

  const email = current.user.email || current.profile.email || '';
  const error = searchParams?.error;
  const passwordSuccess = searchParams?.password_success;
  const passwordError = searchParams?.password_error;
  const easyPostConfigured = Boolean(env.easypostApiKey);
  const easyPostStatus = searchParams?.easypost_status;
  const easyPostCount = Number.parseInt(searchParams?.easypost_count ?? '', 10);
  const settingsErrorMessage = error === 'admin_write_denied'
    ? 'Only superadmins can change admin data.'
    : error === 'image_too_large'
      ? 'Image files must be 5 MB or smaller (2 MB for the logo).'
      : error === 'image_dimensions'
        ? 'Image dimensions are too large. Use an image no larger than 4096 × 4096 pixels.'
        : error === 'image_invalid'
          ? 'Use a valid PNG, JPEG, or WebP image.'
          : error === 'image_upload_failed'
            ? 'The image could not be uploaded. Please try again.'
            : '';

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Branding</span>
        <h1 className="page-title mt-4">Brand settings</h1>
        <p className="page-subtitle mt-3">Adjust the name, accent color, logo, and hero image used throughout the ordering experience.</p>
      </section>
      {settingsErrorMessage ? (
        <div className="card text-sm text-red-700" role="alert">{settingsErrorMessage}</div>
      ) : null}
      <form action={saveSettings} className="card space-y-4">
        <input type="hidden" name="id" value={settings.id} />
        <input className="input" name="brand_name" defaultValue={settings.brand_name ?? 'Sobrew'} />
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Accent color</label>
          <input className="input h-14" name="accent_color" type="color" defaultValue={settings.accent_color ?? '#7c3aed'} />
        </div>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          <span className="block">Logo</span>
          <input className="input" type="file" name="logo" accept={IMAGE_UPLOAD_ACCEPT} />
          <span className="block text-xs font-normal text-slate-500">PNG, JPEG, or WebP · up to 2 MB and 2048 × 2048</span>
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          <span className="block">Hero image</span>
          <input className="input" type="file" name="hero" accept={IMAGE_UPLOAD_ACCEPT} />
          <span className="block text-xs font-normal text-slate-500">PNG, JPEG, or WebP · up to 5 MB and 4096 × 4096</span>
        </label>
        <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save" pendingLabel="Saving..." />
      </form>

      <section className="card space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Shipping API</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">EasyPost connection</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">EasyPost labels use the server environment key and the ship-from address below.</p>
          </div>
          <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
            easyPostConfigured
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
              : 'bg-amber-50 text-amber-800 ring-1 ring-amber-100'
          }`}>
            {easyPostConfigured ? 'Configured' : 'Not connected'}
          </span>
        </div>

        {easyPostStatus === 'connected' ? (
          <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            EasyPost connection test passed. {Number.isFinite(easyPostCount) ? easyPostCount : 0} carrier account{easyPostCount === 1 ? '' : 's'} available.
          </div>
        ) : null}
        {easyPostStatus === 'failed' ? (
          <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            EasyPost connection test failed. Check the server API key and try again.
          </div>
        ) : null}
        {easyPostStatus === 'missing' ? (
          <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            EasyPost is not connected. Add EASYPOST_API_KEY in the deployment environment, then restart or redeploy.
          </div>
        ) : null}
        {easyPostStatus === 'admin_write_denied' ? (
          <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            You do not have permission to test EasyPost settings.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <p className="text-sm text-slate-500">
            The API key is not saved in app settings or shown in the browser.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <a className="btn-secondary w-full sm:w-auto" href="https://app.easypost.com/account/api-keys" target="_blank" rel="noreferrer">EasyPost API keys</a>
            <form action={testEasyPostConnection}>
              <PendingSubmitButton
                className="btn-primary w-full sm:w-auto"
                disabled={!easyPostConfigured}
                disabledLabel="Add API key first"
                label="Test connection"
                pendingLabel="Testing..."
              />
            </form>
          </div>
        </div>
      </section>

      <section className="card space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Shipping origin</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">EasyPost ship-from address</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Used for carrier rate lookup and label purchase on order shipments.</p>
        </div>
        <form action={saveSettings} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="id" value={settings.id} />
          <input type="hidden" name="brand_name" value={settings.brand_name ?? 'Sobrew'} />
          <input type="hidden" name="accent_color" value={settings.accent_color ?? '#7c3aed'} />
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Contact name
            <input className="input" name="shipping_origin_name" defaultValue={settings.shipping_origin_name ?? ''} placeholder="Sobrew Shipping" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Company
            <input className="input" name="shipping_origin_company" defaultValue={settings.shipping_origin_company ?? ''} placeholder="Sobrew" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
            Address 1
            <input className="input" name="shipping_origin_address1" defaultValue={settings.shipping_origin_address1 ?? ''} placeholder="Street address" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700 md:col-span-2">
            Address 2
            <input className="input" name="shipping_origin_address2" defaultValue={settings.shipping_origin_address2 ?? ''} placeholder="Suite, unit, dock, etc." />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            City
            <input className="input" name="shipping_origin_city" defaultValue={settings.shipping_origin_city ?? ''} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            State
            <input className="input" name="shipping_origin_state" defaultValue={settings.shipping_origin_state ?? ''} maxLength={2} placeholder="MO" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            ZIP
            <input className="input" name="shipping_origin_zip" defaultValue={settings.shipping_origin_zip ?? ''} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Country
            <input className="input" name="shipping_origin_country" defaultValue={settings.shipping_origin_country ?? 'US'} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Phone
            <input className="input" name="shipping_origin_phone" defaultValue={settings.shipping_origin_phone ?? ''} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Email
            <input className="input" name="shipping_origin_email" type="email" defaultValue={settings.shipping_origin_email ?? ''} />
          </label>
          <div className="md:col-span-2">
            <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save shipping origin" pendingLabel="Saving..." />
          </div>
        </form>
      </section>

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

        {passwordError === 'admin_write_denied' ? (
          <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Only superadmins can change admin data.
          </div>
        ) : null}

        <form action={updatePassword} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">New password</label>
            <input className="input" name="password" type="password" minLength={8} required placeholder="Enter a new password" autoComplete="new-password" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Confirm new password</label>
            <input className="input" name="confirm_password" type="password" minLength={8} required placeholder="Confirm your new password" autoComplete="new-password" />
          </div>
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save new password" pendingLabel="Saving..." />
        </form>
      </section>
    </div>
  );
}

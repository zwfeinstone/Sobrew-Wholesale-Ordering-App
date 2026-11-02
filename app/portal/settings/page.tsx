import { redirect } from 'next/navigation';
import Link from 'next/link';
import PendingSubmitButton from '@/components/pending-submit-button';
import PortalLocationForm from '@/components/portal-location-form';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { addPortalLocation, updatePortalLocation } from './location-actions';

async function updatePassword(formData: FormData) {
  'use server';

  await requireUser();
  const supabase = await createClient();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirm_password') ?? '');

  if (password.length < 8) {
    redirect('/portal/settings?error=password_length');
  }

  if (password !== confirmPassword) {
    redirect('/portal/settings?error=password_mismatch');
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect('/portal/settings?error=update_failed');
  }

  redirect('/portal/settings?success=password_updated');
}

export default async function PortalSettingsPage(
  props: {
    searchParams?: Promise<{ success?: string; error?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const { profile } = await requireUser();
  const canManageLocations = profile.is_admin === false && profile.is_active === true && profile.center?.is_active === true && Boolean(profile.center_id);
  const supabase = await createClient();
  const locationsResult = canManageLocations
    ? await supabase.from('center_locations').select('id,name,address1,address2,city,state,zip')
      .eq('center_id', profile.center_id!).eq('is_active', true).order('name', { ascending: true })
    : { data: [], error: null };

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Account Settings</span>
        <h1 className="page-title mt-4">Your account</h1>
        <p className="page-subtitle mt-3">Manage your delivery locations and portal password.</p>
      </section>

      {canManageLocations ? <section id="delivery-locations" className="card space-y-5" aria-labelledby="delivery-locations-heading">
        <div>
          <h2 id="delivery-locations-heading" className="text-xl font-semibold text-slate-950">Delivery locations</h2>
          <p className="mt-2 text-sm text-slate-600">Add a location or update its address for new orders and future recurring deliveries to that location. These locations are shared with everyone on your company account.</p>
          <p className="mt-2 text-sm text-slate-600">Already-placed orders keep their original address. Contact Sobrew if an open order needs a different delivery address.</p>
        </div>
        {locationsResult.error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          We couldn&apos;t load your locations. <Link className="underline" href="/portal/settings">Reload your account</Link> to try again.
        </div> : <>
          {locationsResult.data?.length ? <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {locationsResult.data.map((location) => <article key={location.id} className="min-w-0 rounded-2xl border border-slate-200 p-4 sm:p-5">
              <h3 className="break-words font-semibold text-slate-950">{location.name}</h3>
              <address className="mt-2 break-words text-sm not-italic leading-6 text-slate-600">
                <p>{location.address1}</p>
                {location.address2 ? <p>{location.address2}</p> : null}
                <p>{location.city}, {location.state} {location.zip}</p>
              </address>
              <details className="mt-4">
                <summary className="cursor-pointer font-medium text-slate-950">Edit address for {location.name}</summary>
                <div className="mt-4"><PortalLocationForm action={updatePortalLocation} location={location} /></div>
              </details>
            </article>)}
          </div> : <p className="text-sm text-slate-600">You don&apos;t have a saved delivery location yet. Add your first address below.</p>}
          <details className="rounded-2xl border border-slate-200 p-4 sm:p-5" open={!locationsResult.data?.length}>
            <summary className="cursor-pointer font-semibold text-slate-950">Add a delivery location</summary>
            <div className="mt-4 max-w-xl"><PortalLocationForm action={addPortalLocation} /></div>
          </details>
          <Link className="inline-flex text-sm font-medium text-slate-950 underline" href="/portal/checkout">Return to checkout</Link>
        </>}
      </section> : null}

      {searchParams?.success === 'password_updated' ? (
        <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700" role="status">
          Your password was updated successfully.
        </div>
      ) : null}

      {searchParams?.error === 'password_length' ? (
        <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">
          Your new password must be at least 8 characters long.
        </div>
      ) : null}

      {searchParams?.error === 'password_mismatch' ? (
        <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">
          Your password confirmation did not match.
        </div>
      ) : null}

      {searchParams?.error === 'update_failed' ? (
        <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">
          We couldn&apos;t update your password right now. Please try again.
        </div>
      ) : null}

      <section className="card space-y-5">
        <div>
          <h2 className="mb-4 text-xl font-semibold text-slate-950">Update your password</h2>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Signed in as</p>
          <p className="mt-2 break-all text-lg font-semibold text-slate-950">{profile?.email}</p>
        </div>

        <form action={updatePassword} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="settings-password">New password</label>
            <input id="settings-password" className="input" name="password" type="password" minLength={8} required placeholder="Enter a new password" autoComplete="new-password" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="settings-confirm-password">Confirm new password</label>
            <input id="settings-confirm-password" className="input" name="confirm_password" type="password" minLength={8} required placeholder="Confirm your new password" autoComplete="new-password" />
          </div>
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save new password" pendingLabel="Saving..." />
        </form>
      </section>
    </div>
  );
}

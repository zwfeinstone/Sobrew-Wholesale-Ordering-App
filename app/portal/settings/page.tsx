import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

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

export default async function PortalSettingsPage({
  searchParams,
}: {
  searchParams?: { success?: string; error?: string };
}) {
  const { profile } = await requireUser();

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Account Settings</span>
        <h1 className="page-title mt-4">Update your password</h1>
        <p className="page-subtitle mt-3">Keep your portal access secure by choosing a strong password you do not use anywhere else.</p>
      </section>

      {searchParams?.success === 'password_updated' ? (
        <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          Your password was updated successfully.
        </div>
      ) : null}

      {searchParams?.error === 'password_length' ? (
        <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Your new password must be at least 8 characters long.
        </div>
      ) : null}

      {searchParams?.error === 'password_mismatch' ? (
        <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Your password confirmation did not match.
        </div>
      ) : null}

      {searchParams?.error === 'update_failed' ? (
        <div className="rounded-[1.5rem] border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          We couldn&apos;t update your password right now. Please try again.
        </div>
      ) : null}

      <section className="card space-y-5">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Signed in as</p>
          <p className="mt-2 text-lg font-semibold text-slate-950">{profile?.email}</p>
        </div>

        <form action={updatePassword} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">New password</label>
            <input className="input" name="password" type="password" minLength={8} required placeholder="Enter a new password" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Confirm new password</label>
            <input className="input" name="confirm_password" type="password" minLength={8} required placeholder="Confirm your new password" />
          </div>
          <button className="btn-primary" type="submit">Save new password</button>
        </form>
      </section>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import PasswordRecoveryShell from '@/components/password-recovery-shell';
import PendingSubmitButton from '@/components/pending-submit-button';
import { getRecoveryState, isRecoveryToken } from '@/lib/password-recovery';
import { updateRecoveredPassword, verifyRecoveryLink } from './actions';

export const metadata: Metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const errorMessages = new Map([
  ['password_length', 'Choose a password with at least 8 characters.'],
  ['password_too_long', 'Choose a shorter password. Use up to 72 English letters, numbers, or symbols; some other characters use more space.'],
  ['password_mismatch', 'Your passwords don’t match. Enter the same new password in both fields.'],
  ['same_password', 'Choose a password that is different from your current password.'],
  ['weak_password', 'Choose a stronger password. Try a longer password with a mix of letters, numbers, and symbols.'],
  ['update_failed', 'We couldn’t update your password. Please try again.'],
  ['update_unconfirmed', 'We couldn’t confirm the password change. Try signing in with your new password. If that doesn’t work, request a new reset link.'],
  ['recovery_unavailable', 'We couldn’t reach the password reset service. Please try again.'],
]);

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === 'string' ? params.token_hash : '';
  const hasToken = params.token_hash !== undefined;
  const validToken = isRecoveryToken(tokenHash);
  const invalidLink = params.error === 'invalid_link' || (hasToken && !validToken);
  if (validToken && !invalidLink) redirect(`/auth/recovery?token_hash=${encodeURIComponent(tokenHash)}`);
  const unconfirmed = params.error === 'update_unconfirmed';
  const state = invalidLink || unconfirmed ? { status: 'invalid' as const } : await getRecoveryState();
  const confirmLink = state.status === 'pending';
  const ready = state.status === 'ready';
  const unavailable = state.status === 'unavailable';
  const error = typeof params.error === 'string' ? errorMessages.get(params.error) : undefined;

  return (
    <PasswordRecoveryShell
      title={unconfirmed ? 'Check your password change' : confirmLink ? 'Reset your password' : ready ? 'Choose a new password' : unavailable ? 'Password reset unavailable' : 'Request a new reset link'}
      description={unconfirmed ? 'Try signing in to check whether your password was saved.' : confirmLink ? 'Continue to choose a new password for your portal account.' : ready ? 'Use at least 8 characters for your new password.' : unavailable ? 'Please try again in a moment.' : 'Reset links expire and can only be used once.'}
    >
      {unconfirmed ? (
        <>
          <p className="login-alert is-error" role="alert">{error}</p>
          <Link className="btn-primary w-full text-center" href="/login">Try signing in</Link>
          <Link className="text-center text-sm font-semibold text-teal-800 underline" href="/forgot-password">Request a new reset link</Link>
        </>
      ) : confirmLink ? (
        <form action={verifyRecoveryLink} className="space-y-5">
          <input type="hidden" name="flow_id" value={state.flowId} />
          {error ? <p className="login-alert is-error" role="alert">{error}</p> : null}
          <PendingSubmitButton className="btn-primary w-full" label="Continue to reset password" pendingLabel="Opening reset link…" />
        </form>
      ) : ready ? (
        <form action={updateRecoveredPassword} className="space-y-5">
          <input type="hidden" name="flow_id" value={state.flowId} />
          {state.user.email ? <p className="break-words text-sm text-slate-600">Resetting password for <strong>{state.user.email}</strong>.</p> : null}
          {error ? <p id="reset-password-error" className="login-alert is-error" role="alert">{error}</p> : null}
          <div className="login-fields">
            <div>
              <label htmlFor="reset-password">New password</label>
              <input id="reset-password" className="input bg-white" name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" aria-describedby={error ? 'reset-password-error' : undefined} />
            </div>
            <div>
              <label htmlFor="reset-confirm-password">Confirm new password</label>
              <input id="reset-confirm-password" className="input bg-white" name="confirm_password" type="password" autoComplete="new-password" minLength={8} required placeholder="Enter your new password again" aria-invalid={params.error === 'password_mismatch' ? true : undefined} aria-describedby={error ? 'reset-password-error' : undefined} />
            </div>
          </div>
          <PendingSubmitButton className="btn-primary w-full" label="Save new password" pendingLabel="Saving new password…" />
        </form>
      ) : unavailable ? (
        <>
          <p className="login-alert is-error" role="alert">We couldn’t reach the password reset service. Please try again.</p>
          <Link className="btn-primary w-full text-center" href="/reset-password">Try again</Link>
        </>
      ) : (
        <>
          <p className="login-alert is-error" role="alert">This reset link is invalid or has expired. Request a new link to reset your password.</p>
          <Link className="btn-primary w-full text-center" href="/forgot-password">Request a new reset link</Link>
        </>
      )}
    </PasswordRecoveryShell>
  );
}

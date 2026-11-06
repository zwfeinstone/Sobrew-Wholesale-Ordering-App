import type { Metadata } from 'next';
import Link from 'next/link';
import PasswordRecoveryShell from '@/components/password-recovery-shell';
import PendingSubmitButton from '@/components/pending-submit-button';
import { requestPasswordReset } from './actions';

export const metadata: Metadata = {
  title: 'Forgot your password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

const errorMessages = new Map([
  ['email', 'Enter a valid email address.'],
  ['unavailable', 'We couldn’t confirm your reset request. Check your inbox, or try again in a few minutes.'],
  ['rate_limit', 'Please wait a few minutes before requesting another reset link.'],
]);

export default async function ForgotPasswordPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? errorMessages.get(params.error) : undefined;
  const sent = params.sent === '1';

  return (
    <PasswordRecoveryShell
      title={sent ? 'Check your inbox' : 'Forgot your password?'}
      description={sent ? 'Follow the link in your email to choose a new password.' : 'Enter the email address you use for the portal, and we’ll send you a reset link.'}
    >
      {sent ? (
        <>
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm leading-6 text-emerald-900" role="status">If an account exists for that email, you’ll receive a password reset link. Check your inbox and spam folder.</p>
          <Link className="btn-secondary w-full text-center" href="/forgot-password">Try another email</Link>
        </>
      ) : (
        <form action={requestPasswordReset} className="space-y-5">
          {error ? <p id="recovery-error" className="login-alert is-error" role="alert">{error}</p> : null}
          <div className="login-fields">
            <div>
              <label htmlFor="recovery-email">Email address</label>
              <input id="recovery-email" className="input bg-white" name="email" type="email" autoComplete="email" required placeholder="you@example.com" aria-invalid={params.error === 'email' ? true : undefined} aria-describedby={error ? 'recovery-error' : undefined} />
            </div>
          </div>
          <PendingSubmitButton className="btn-primary w-full" label="Send reset link" pendingLabel="Sending reset link…" />
        </form>
      )}
    </PasswordRecoveryShell>
  );
}

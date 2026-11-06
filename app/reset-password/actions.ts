'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import {
  clearPendingRecoveryToken, clearRecoverySession, getPendingRecovery,
  hasPkceRecoveryProof, isDefinitiveRecoveryError, matchesRecoveryFlow,
  recoverySessionCookie, verifiedRecoveryState,
} from '@/lib/password-recovery';
import { withRecoveryClient } from '@/lib/supabase/recovery-client';

export async function verifyRecoveryLink(formData: FormData) {
  let outcome: 'verified' | 'invalid' | 'unavailable' = 'unavailable';
  try {
    const pending = await getPendingRecovery();
    if (!pending || !matchesRecoveryFlow(formData.get('flow_id'), pending.flowId)) outcome = 'invalid';
    else {
      const cookieStore = await cookies();
      const verifiers = pending.kind === 'pkce' ? cookieStore.getAll().filter(({ name }) => /^sb-.*-code-verifier(?:\.\d+)?$/.test(name)) : [];
      try {
        const result = await withRecoveryClient((supabase) => pending.kind === 'token'
          ? supabase.auth.verifyOtp({ token_hash: pending.token, type: 'recovery' })
          : supabase.auth.exchangeCodeForSession(pending.code));
        const { data, error } = result;
        // Local proof/cookie writes happen only after the bounded operation
        // resolves. A late provider response after timeout cannot mint a marker.
        if (error) {
          if (isDefinitiveRecoveryError(error)) {
            await clearPendingRecoveryToken();
            outcome = 'invalid';
          }
        } else if (pending.kind === 'pkce' && (!('redirectType' in data) || data.redirectType !== 'recovery' || !hasPkceRecoveryProof(data.session))) {
          await clearPendingRecoveryToken();
          outcome = 'invalid';
        } else if (data.user && data.session) {
          const marker = recoverySessionCookie(data.session, data.user, pending.flowId);
          cookieStore.set(marker.name, marker.value, marker.options);
          await clearPendingRecoveryToken();
          outcome = 'verified';
        }
      } finally {
        // The SDK removes PKCE verifiers even after a network error. Retain the
        // initiating browser's proof so a transient failure can be retried.
        if (outcome === 'unavailable') {
          for (const verifier of verifiers) cookieStore.set(verifier.name, verifier.value, {
            path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60,
          });
        }
      }
    }
  } catch { outcome = 'unavailable'; }
  // A stale tab must never clear the newer tab's token or verified marker.
  redirect(outcome === 'verified' ? '/reset-password'
    : `/reset-password?error=${outcome === 'invalid' ? 'invalid_link' : 'recovery_unavailable'}`);
}

export async function updateRecoveredPassword(formData: FormData) {
  // Preserve exactly what the customer enters, including surrounding spaces.
  const password = formData.get('password');
  const confirmation = formData.get('confirm_password');
  if (typeof password !== 'string' || typeof confirmation !== 'string') redirect('/reset-password?error=password_length');
  if (Array.from(password).length < 8) redirect('/reset-password?error=password_length');
  if (Buffer.byteLength(password, 'utf8') > 72) redirect('/reset-password?error=password_too_long');
  if (password !== confirmation) redirect('/reset-password?error=password_mismatch');

  let failure: string | null = null;
  let saved = false;
  let attemptedUpdate = false;
  try {
    failure = await withRecoveryClient(async (supabase) => {
      const state = await verifiedRecoveryState(supabase);
      if (state.status === 'unavailable') return 'recovery_unavailable';
      if (state.status !== 'ready' || !matchesRecoveryFlow(formData.get('flow_id'), state.flowId)) return 'invalid_link';
      // Only the user AND session established for this rendered recovery flow
      // can save. Signing into another account/tab invalidates the old form.
      attemptedUpdate = true;
      const result = await supabase.auth.updateUser({ password });
      if (result.error || !result.data.user) {
        const code = result.error?.code;
        const uncertain = result.error?.name === 'AuthRetryableFetchError'
          || (result.error?.status ?? 0) >= 500 || result.error?.status === 408;
        return code === 'same_password' || code === 'weak_password' ? code
          : isDefinitiveRecoveryError(result.error) ? 'invalid_link'
            : uncertain ? 'update_unconfirmed' : 'update_failed';
      }
      saved = true;
      // The password is already saved. A later sign-out timeout must not report
      // a failed update or encourage the customer to repeat the password change.
      try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* Already saved. */ }
      return null;
    });
  } catch {
    failure = attemptedUpdate ? 'update_unconfirmed' : 'recovery_unavailable';
  }
  if (!saved) redirect(`/reset-password?error=${failure ?? 'update_failed'}`);

  await clearPendingRecoveryToken();
  await clearRecoverySession();
  redirect('/login?success=password_reset');
}

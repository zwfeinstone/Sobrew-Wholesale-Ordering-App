'use server';

import { redirect } from 'next/navigation';
import { clearPendingRecoveryToken, getPendingRecoveryToken } from '@/lib/password-recovery';
import { createClient } from '@/lib/supabase/server';

export async function verifyRecoveryLink(_formData: FormData) {
  const token = await getPendingRecoveryToken();
  if (!token) redirect('/reset-password?error=invalid_link');

  let verified = false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'recovery' });
    verified = !error && Boolean(data.user && data.session);
  } catch {
    verified = false;
  }
  await clearPendingRecoveryToken();
  redirect(verified ? '/reset-password' : '/reset-password?error=invalid_link');
}

export async function updateRecoveredPassword(formData: FormData) {
  // Preserve exactly what the customer enters, including surrounding spaces.
  const password = String(formData.get('password') ?? '');
  const confirmation = String(formData.get('confirm_password') ?? '');
  if (password.length < 8) redirect('/reset-password?error=password_length');
  if (password !== confirmation) redirect('/reset-password?error=password_mismatch');

  const supabase = await createClient();
  let failure: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      failure = 'invalid_link';
    } else {
      // The verified session determines the user. No submitted email or ID can
      // select another account, and no admin credential is used for this update.
      const result = await supabase.auth.updateUser({ password });
      if (result.error || !result.data.user) {
        const code = result.error?.code;
        failure = code === 'same_password' || code === 'weak_password' ? code : 'update_failed';
      }
    }
  } catch {
    failure = 'update_failed';
  }
  if (failure) redirect(`/reset-password?error=${failure}`);

  await clearPendingRecoveryToken();
  // The password has already changed. A sign-out transport error must not tell
  // the customer to repeat a successful password update.
  try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* Already saved. */ }
  redirect('/login?success=password_reset');
}

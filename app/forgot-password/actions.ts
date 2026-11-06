'use server';

import { redirect } from 'next/navigation';
import { recoveryRedirectUrl } from '@/lib/password-recovery';
import { createClient } from '@/lib/supabase/server';

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    redirect('/forgot-password?error=email');
  }

  let failure = false;
  try {
    const redirectTo = recoveryRedirectUrl();
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) {
      // Per-address cooldowns can reveal whether an account exists. Preserve
      // the same public result for an unknown address and a throttled request.
      failure = !['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code ?? '');
    }
  } catch {
    failure = true;
  }
  // Supabase returns the same successful result for an unknown email address.
  // Never expose an account lookup or include submitted emails in redirects/logs.
  redirect(failure ? '/forgot-password?error=unavailable' : '/forgot-password?sent=1');
}

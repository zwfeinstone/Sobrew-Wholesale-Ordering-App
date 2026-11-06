import 'server-only';

import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const RECOVERY_COOKIE = 'sobrew-password-recovery';
export const RECOVERY_COOKIE_PATH = '/reset-password';

export function isRecoveryToken(value: unknown): value is string {
  return typeof value === 'string' && /^(?:pkce_)?[a-f0-9]{40,128}$/i.test(value);
}

export function recoveryRedirectUrl() {
  // Use configured application identity, never the request Host or a form URL.
  const site = new URL(env.siteUrl);
  const local = site.hostname === 'localhost' || site.hostname === '127.0.0.1';
  if (site.username || site.password || site.search || site.hash || site.pathname !== '/'
    || (site.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local && site.protocol === 'http:'))
    || (process.env.NODE_ENV === 'production' && local)) {
    throw new Error('Password recovery requires a trusted application URL.');
  }
  return new URL('/auth/recovery', site.origin).toString();
}

export async function getPendingRecoveryToken(): Promise<string | null> {
  const value = (await cookies()).get(RECOVERY_COOKIE)?.value;
  return isRecoveryToken(value) ? value : null;
}

export async function clearPendingRecoveryToken() {
  (await cookies()).set(RECOVERY_COOKIE, '', {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: RECOVERY_COOKIE_PATH, maxAge: 0,
  });
}

export async function getRecoveryUser(): Promise<{ id: string; email?: string } | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    return !error && data.user ? { id: data.user.id, email: data.user.email } : null;
  } catch {
    return null;
  }
}

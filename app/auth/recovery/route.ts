import { NextRequest, NextResponse } from 'next/server';
import { isRecoveryToken, RECOVERY_COOKIE, RECOVERY_COOKIE_PATH } from '@/lib/password-recovery';
import { createRouteClient } from '@/lib/supabase/route';

export const dynamic = 'force-dynamic';

function recoveryResponse(request: NextRequest, invalid = false) {
  const response = NextResponse.redirect(new URL(`/reset-password${invalid ? '?error=invalid_link' : ''}`, request.url), 303);
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token_hash');
  const code = request.nextUrl.searchParams.get('code');
  const type = request.nextUrl.searchParams.get('type');
  const invalid = request.nextUrl.searchParams.has('error') || (type !== null && type !== 'recovery');
  const response = recoveryResponse(request);

  if (!invalid && isRecoveryToken(token)) {
    // Remove the bearer token from the visible URL before rendering any page.
    // Do not consume it on GET: email security scanners can open links first.
    response.cookies.set(RECOVERY_COOKIE, token, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      path: RECOVERY_COOKIE_PATH, maxAge: 60 * 60,
    });
    return response;
  }

  // Compatibility with Supabase's default ConfirmationURL/PKCE email template.
  if (!invalid && !token && code && code.length <= 2048) {
    try {
      const supabase = createRouteClient(request, response);
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error && data.user && data.session) {
        response.cookies.set(RECOVERY_COOKIE, '', { path: RECOVERY_COOKIE_PATH, maxAge: 0 });
        return response;
      }
    } catch { /* Show an actionable expired-link message without logging tokens. */ }
  }

  const failure = recoveryResponse(request, true);
  failure.cookies.set(RECOVERY_COOKIE, '', { path: RECOVERY_COOKIE_PATH, maxAge: 0 });
  return failure;
}

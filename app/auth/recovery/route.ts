import { NextRequest, NextResponse } from 'next/server';
import { isRecoveryToken, pendingRecoveryCode, RECOVERY_COOKIE, RECOVERY_COOKIE_PATH, RECOVERY_SESSION_COOKIE } from '@/lib/password-recovery';

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
  const pending = !invalid && isRecoveryToken(token) ? token
    : !invalid && !request.nextUrl.searchParams.has('token_hash') && code ? pendingRecoveryCode(code) : null;

  if (pending) {
    // Remove the bearer token from the visible URL before rendering any page.
    // Do not consume it on GET: email security scanners can open links first.
    response.cookies.set(RECOVERY_COOKIE, pending, {
      httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
      path: RECOVERY_COOKIE_PATH, maxAge: 60 * 60,
    });
    response.cookies.set(RECOVERY_SESSION_COOKIE, '', { path: RECOVERY_COOKIE_PATH, maxAge: 0 });
    return response;
  }

  const failure = recoveryResponse(request, true);
  failure.cookies.set(RECOVERY_COOKIE, '', { path: RECOVERY_COOKIE_PATH, maxAge: 0 });
  failure.cookies.set(RECOVERY_SESSION_COOKIE, '', { path: RECOVERY_COOKIE_PATH, maxAge: 0 });
  return failure;
}

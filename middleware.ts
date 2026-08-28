import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { isAuthSessionMissing, logAuthProfileIssue } from './lib/auth-diagnostics';
import {
  AuthDeadlineExceededError,
  createAuthDeadline,
  type AuthNetworkPhase,
} from './lib/supabase/auth-deadline';
import { resilientSupabaseFetch } from './lib/supabase/resilient-jwks-fetch';
import { getVerifiedClaims } from './lib/supabase/verified-claims';

type CookieToSet = { name: string; value: string; options: CookieOptions };
type AuthErrorLike = {
  code?: string;
  name?: string;
  status?: number;
};

export const AUTH_VERIFICATION_TIMEOUT_MS = 4_000;
const AUTH_RETRY_AFTER_SECONDS = 5;

function applyPrivateNoStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  return response;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function isNextClientRequest(request: NextRequest) {
  return (
    request.headers.get('rsc') === '1' ||
    request.headers.has('next-action') ||
    request.headers.get('accept')?.includes('text/x-component') === true
  );
}

function authUnavailableResponse(request: NextRequest, reference: string, elapsedMs: number) {
  const retryTarget = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  // Next's client router expects Flight data, not a standalone HTML document.
  // Redirect those requests to a public recovery page; full document requests
  // receive the semantically correct 503 page directly.
  if (isNextClientRequest(request)) {
    const unavailableUrl = new URL('/auth-unavailable', request.url);
    unavailableUrl.searchParams.set('next', retryTarget);
    unavailableUrl.searchParams.set('ref', reference);
    const redirectStatus = request.method === 'GET' || request.method === 'HEAD' ? 307 : 303;
    const redirectResponse = NextResponse.redirect(unavailableUrl, redirectStatus);
    redirectResponse.headers.set('Retry-After', String(AUTH_RETRY_AFTER_SECONDS));
    redirectResponse.headers.set('Server-Timing', `auth;dur=${Math.max(0, Math.round(elapsedMs))}`);
    redirectResponse.headers.set('X-Robots-Tag', 'noindex, nofollow');
    redirectResponse.headers.set('X-SoBrew-Auth-Reference', reference);
    return applyPrivateNoStore(redirectResponse);
  }

  const retryPath = escapeHtml(retryTarget);
  const safeReference = escapeHtml(reference);
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>Sign-in temporarily unavailable | SoBrew</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; color: #17212b; background: #f6f7f4; }
      main { width: min(100%, 520px); padding: 38px; border: 1px solid #dfe3dc; border-radius: 20px; background: #fff; box-shadow: 0 18px 50px rgba(23, 33, 43, .08); }
      .brand { margin-bottom: 28px; color: #186b52; font-size: 18px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 0 0 14px; font-size: clamp(28px, 7vw, 38px); line-height: 1.08; letter-spacing: -.03em; }
      p { margin: 0; color: #53606b; font-size: 17px; line-height: 1.6; }
      a { display: inline-flex; margin-top: 26px; padding: 13px 20px; border-radius: 10px; color: #fff; background: #186b52; font-weight: 750; text-decoration: none; }
      a:focus-visible { outline: 3px solid #9bcfbe; outline-offset: 3px; }
      .reference { margin-top: 24px; color: #7a858e; font-size: 13px; }
    </style>
  </head>
  <body>
    <main role="alert">
      <div class="brand">SoBrew</div>
      <h1>We couldn't verify your sign-in just now.</h1>
      <p>Our sign-in service took too long to respond. Your request did not continue past sign-in verification, so it is safe to try again.</p>
      <a href="${retryPath}">Try again</a>
      <p class="reference">If this keeps happening, share reference ${safeReference} with SoBrew support.</p>
    </main>
  </body>
</html>`;

  return new NextResponse(body, {
    status: 503,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Language': 'en',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': String(AUTH_RETRY_AFTER_SECONDS),
      'Server-Timing': `auth;dur=${Math.max(0, Math.round(elapsedMs))}`,
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-SoBrew-Auth-Reference': reference,
    },
  });
}

function authReference() {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
}

function authErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') return {};
  const authError = error as AuthErrorLike;
  return {
    errorCode: authError.code,
    errorName: authError.name,
    errorStatus: authError.status,
  };
}

function isTransientAuthError(error: unknown) {
  if (isAuthRetryableFetchError(error)) return true;
  if (!error || typeof error !== 'object') return false;

  const { name } = error as AuthErrorLike;
  return name === 'AbortError' || name === 'TimeoutError' || name === 'AuthRetryableFetchError';
}

function logAuthUnavailable({
  elapsedMs,
  error,
  phase,
  reason,
  reference,
  request,
  upstreamStatus,
}: {
  elapsedMs: number;
  error?: unknown;
  phase: AuthNetworkPhase;
  reason: 'deadline' | 'transient_error' | 'unexpected_error';
  reference: string;
  request: NextRequest;
  upstreamStatus: number | null;
}) {
  console.error('Middleware auth verification unavailable', {
    event: 'middleware_auth_unavailable',
    reference,
    reason,
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    phase,
    upstreamStatus: upstreamStatus ?? undefined,
    pathname: request.nextUrl.pathname,
    vercelRequestId: request.headers.get('x-vercel-id') ?? undefined,
    ...authErrorDetails(error),
  });
}

export async function middleware(request: NextRequest) {
  const startedAt = performance.now();
  let response = NextResponse.next({ request: { headers: request.headers } });
  const authDeadline = createAuthDeadline(AUTH_VERIFICATION_TIMEOUT_MS, resilientSupabaseFetch);

  const redirectWithRefreshedCookies = (url: URL) => {
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return applyPrivateNoStore(redirectResponse);
  };

  const unavailableWithRefreshedCookies = (error: unknown, reason: 'deadline' | 'transient_error' | 'unexpected_error') => {
    const reference = authReference();
    const elapsedMs = performance.now() - startedAt;
    const { phase, upstreamStatus } = authDeadline.diagnostics();
    logAuthUnavailable({ elapsedMs, error, phase, reason, reference, request, upstreamStatus });

    const unavailableResponse = authUnavailableResponse(request, reference, elapsedMs);
    response.cookies.getAll().forEach((cookie) => unavailableResponse.cookies.set(cookie));
    return unavailableResponse;
  };

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { fetch: authDeadline.fetch },
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: CookieToSet[]) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({ request: { headers: request.headers } });
            cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          },
        },
      }
    );

    const { data: claimsData, error: claimsError } = await authDeadline.run(
      getVerifiedClaims(supabase.auth, process.env.NEXT_PUBLIC_SUPABASE_URL!)
    );
    const userId = typeof claimsData?.claims.sub === 'string' ? claimsData.claims.sub : null;

    const isProtected = request.nextUrl.pathname.startsWith('/portal') || request.nextUrl.pathname.startsWith('/admin');
    if (isProtected && claimsError) {
      if (isTransientAuthError(claimsError)) {
        return unavailableWithRefreshedCookies(claimsError, 'transient_error');
      }
      if (!isAuthSessionMissing(claimsError)) {
        logAuthProfileIssue('Middleware auth claims verification failed', claimsError);
      }
      return redirectWithRefreshedCookies(new URL('/login', request.url));
    }

    if (isProtected && !userId) {
      return redirectWithRefreshedCookies(new URL('/login', request.url));
    }

    return applyPrivateNoStore(response);
  } catch (error) {
    const reason = error instanceof AuthDeadlineExceededError || authDeadline.didTimeout() ? 'deadline' : 'unexpected_error';
    return unavailableWithRefreshedCookies(error, reason);
  } finally {
    authDeadline.dispose();
  }
}

export const config = { matcher: ['/portal/:path*', '/admin/:path*'] };

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { hasSuperadminAccess } from './lib/admin-permission-definitions';
import { isAuthSessionMissing, logAuthProfileIssue } from './lib/auth-diagnostics';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  const redirectWithRefreshedCookies = (url: URL) => {
    const redirectResponse = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  };

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims.sub === 'string' ? claimsData.claims.sub : null;
  const userEmail = typeof claimsData?.claims.email === 'string' ? claimsData.claims.email : null;

  const isProtected = request.nextUrl.pathname.startsWith('/portal') || request.nextUrl.pathname.startsWith('/admin');
  if (isProtected && claimsError) {
    if (!isAuthSessionMissing(claimsError)) {
      logAuthProfileIssue('Middleware auth claims verification failed', claimsError);
    }
    return redirectWithRefreshedCookies(new URL('/login', request.url));
  }

  if (isProtected && !userId) {
    return redirectWithRefreshedCookies(new URL('/login', request.url));
  }

  if (userId && request.nextUrl.pathname.startsWith('/admin')) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id,email,is_admin,is_superadmin,is_active')
      .eq('id', userId)
      .maybeSingle();
    if (profileError || !profile) {
      logAuthProfileIssue('Middleware profile lookup failed', profileError, userId);
      await supabase.auth.signOut();
      return redirectWithRefreshedCookies(new URL('/login?error=profile', request.url));
    }

    const ownerAdmin = hasSuperadminAccess(userEmail || profile.email, profile.is_superadmin);
    if (profile.is_active !== true && !ownerAdmin) {
      await supabase.auth.signOut();
      return redirectWithRefreshedCookies(new URL('/login?inactive=1', request.url));
    }

    if (!profile.is_admin) {
      return redirectWithRefreshedCookies(new URL('/portal', request.url));
    }

  }

  return response;
}

export const config = { matcher: ['/portal/:path*', '/admin/:path*'] };

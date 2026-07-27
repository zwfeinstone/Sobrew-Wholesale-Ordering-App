import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
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

  return response;
}

export const config = { matcher: ['/portal/:path*', '/admin/:path*'] };

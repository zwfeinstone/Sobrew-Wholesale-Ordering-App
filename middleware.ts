import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value;
        },
        set(name, value, options) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const isProtected = request.nextUrl.pathname.startsWith('/portal') || request.nextUrl.pathname.startsWith('/admin');
  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (user && request.nextUrl.pathname.startsWith('/admin')) {
    const { data: profile } = await supabase.from('profiles').select('is_admin,is_active').eq('id', user.id).single();
    if (!profile?.is_active) {
      return NextResponse.redirect(new URL('/login?inactive=1', request.url));
    }
    if (!profile?.is_admin) {
      return NextResponse.redirect(new URL('/portal', request.url));
    }
  }

  return response;
}

export const config = { matcher: ['/portal/:path*', '/admin/:path*'] };

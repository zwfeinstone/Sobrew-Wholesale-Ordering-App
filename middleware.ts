import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import {
  adminSectionForPath,
  canViewAdminSection,
  enforceOwnerOnlyPermissions,
  hasSuperadminAccess,
  legacyReadOnlyAccessMap,
  normalizeAccessMap,
  type AdminPermissionKey,
} from './lib/admin-permission-definitions';
import { isAuthSessionMissing, logAuthProfileIssue } from './lib/auth-diagnostics';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        }
      }
    }
  );

  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  const isProtected = request.nextUrl.pathname.startsWith('/portal') || request.nextUrl.pathname.startsWith('/admin');
  if (isProtected && userError) {
    if (!isAuthSessionMissing(userError)) {
      logAuthProfileIssue('Middleware auth user lookup failed', userError);
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (user && request.nextUrl.pathname.startsWith('/admin')) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id,email,is_admin,is_superadmin,is_active')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || !profile) {
      logAuthProfileIssue('Middleware profile lookup failed', profileError, user.id);
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?error=profile', request.url));
    }

    const ownerAdmin = hasSuperadminAccess(user.email || profile.email, profile.is_superadmin);
    if (profile.is_active !== true && !ownerAdmin) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL('/login?inactive=1', request.url));
    }

    if (!profile.is_admin) {
      return NextResponse.redirect(new URL('/portal', request.url));
    }

    const sectionKey = adminSectionForPath(request.nextUrl.pathname);
    if (sectionKey && !ownerAdmin) {
      const { data: permissionRows, error: permissionsError } = await supabase
        .from('admin_permissions')
        .select('section_key,can_view,can_edit')
        .eq('profile_id', profile.id);

      const rawAccess = permissionsError || !(permissionRows ?? []).length
        ? legacyReadOnlyAccessMap()
        : normalizeAccessMap(
            Object.fromEntries(
              (permissionRows ?? []).map((row) => [
                row.section_key as AdminPermissionKey,
                { canEdit: Boolean(row.can_edit), canView: Boolean(row.can_view || row.can_edit) },
              ])
            ) as Partial<Record<AdminPermissionKey, { canEdit: boolean; canView: boolean }>>
          );
      const raw = enforceOwnerOnlyPermissions(user.email || profile.email, rawAccess);

      if (!canViewAdminSection(raw, sectionKey)) {
        const deniedUrl = new URL('/admin/access-denied', request.url);
        deniedUrl.searchParams.set('section', sectionKey);
        deniedUrl.searchParams.set('from', request.nextUrl.pathname);
        return NextResponse.redirect(deniedUrl);
      }
    }
  }

  return response;
}

export const config = { matcher: ['/portal/:path*', '/admin/:path*'] };

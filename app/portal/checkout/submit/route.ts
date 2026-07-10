import { NextRequest, NextResponse } from 'next/server';
import { requestUserFromClaims } from '@/lib/auth';
import { logAuthProfileIssue } from '@/lib/auth-diagnostics';
import { scheduleUserLastSeen } from '@/lib/last-seen';
import { elapsedMilliseconds, logServerTiming, serverTimingHeader } from '@/lib/server-performance';
import { createRouteClient } from '@/lib/supabase/route';
import { submitPortalOrderWithContext } from '../submit-order';

export async function POST(request: NextRequest) {
  const requestStartedAt = performance.now();
  let authDurationMs = 0;
  const formData = await request.formData();
  const response = NextResponse.next();
  const supabase = createRouteClient(request, response);
  const redirectWithRefreshedCookies = (path: string) => {
    const redirectResponse = NextResponse.redirect(new URL(path, request.url), 303);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    const totalDurationMs = elapsedMilliseconds(requestStartedAt);
    redirectResponse.headers.set('Server-Timing', serverTimingHeader([
      { name: 'auth', durationMs: authDurationMs },
      { name: 'checkout', durationMs: Math.max(0, totalDurationMs - authDurationMs) },
    ]));
    logServerTiming('portal_checkout', requestStartedAt);
    return redirectResponse;
  };

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError) {
    logAuthProfileIssue('Checkout submit auth claims verification failed', claimsError);
  }
  const user = requestUserFromClaims(claimsData?.claims);

  if (!user) {
    authDurationMs = elapsedMilliseconds(requestStartedAt);
    return redirectWithRefreshedCookies('/login');
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id,is_admin,is_active,email,full_name,avatar_url,center_id,centers!profiles_center_id_fkey(id,name,is_active)')
    .eq('id', user.id)
    .maybeSingle();
  authDurationMs = elapsedMilliseconds(requestStartedAt);
  if (profileError || !profile) {
    logAuthProfileIssue('Checkout submit profile lookup failed', profileError, user.id);
    return redirectWithRefreshedCookies('/login?error=profile');
  }
  const center = Array.isArray(profile.centers) ? profile.centers[0] : profile.centers;

  if (profile.is_active !== true || (!profile.is_admin && (!profile.center_id || center?.is_active === false))) {
    return redirectWithRefreshedCookies('/login?inactive=1');
  }

  scheduleUserLastSeen(supabase, user.id);

  const result = await submitPortalOrderWithContext({
    formData,
    user,
    profile: { ...profile, center },
    supabase,
  });

  if (result.type === 'invalid_cart') {
    return redirectWithRefreshedCookies('/portal/checkout?toast=invalid_cart');
  }

  if (result.type === 'checkout_error') {
    return redirectWithRefreshedCookies('/portal/checkout?toast=checkout_error');
  }

  if (result.type === 'location_required') {
    return redirectWithRefreshedCookies('/portal/checkout?toast=location_required');
  }

  return redirectWithRefreshedCookies(result.location);
}

import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase/route';
import { submitPortalOrderWithContext } from '../submit-order';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const response = NextResponse.next();
  const supabase = createRouteClient(request, response);
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id,is_admin,is_active,email,full_name,avatar_url,center_id,centers(id,name,is_active)')
    .eq('id', data.user.id)
    .single();
  const center = Array.isArray(profile?.centers) ? profile.centers[0] : profile?.centers;

  if (!profile?.is_active || (!profile?.is_admin && (!profile?.center_id || center?.is_active === false))) {
    return NextResponse.redirect(new URL('/login?inactive=1', request.url), 303);
  }

  const result = await submitPortalOrderWithContext({
    formData,
    user: data.user,
    profile: profile ? { ...profile, center } : profile,
    supabase,
  });

  if (result.type === 'invalid_cart') {
    return NextResponse.redirect(new URL('/portal/checkout?toast=invalid_cart', request.url), 303);
  }

  if (result.type === 'checkout_error') {
    return NextResponse.redirect(new URL('/portal/checkout?toast=checkout_error', request.url), 303);
  }

  return NextResponse.redirect(new URL(result.location, request.url), 303);
}

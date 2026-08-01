import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { buildQuickBooksAuthorizationUrl } from '@/lib/quickbooks';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  await requireAdminSectionEdit('invoicing', '/admin/invoicing?toast=admin_write_denied');

  try {
    const state = randomBytes(24).toString('hex');
    cookies().set('quickbooks_oauth_state', state, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return NextResponse.redirect(buildQuickBooksAuthorizationUrl(state));
  } catch (error) {
    console.error('[quickbooks] connect failed', error);
    return NextResponse.redirect(new URL('/admin/invoicing?toast=quickbooks_config_error', request.url));
  }
}

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { exchangeQuickBooksAuthorizationCode } from '@/lib/quickbooks';

export const runtime = 'nodejs';

function adminInvoicingUrl(request: NextRequest, toast: string) {
  return new URL(`/admin/invoicing?toast=${encodeURIComponent(toast)}`, request.url);
}

export async function GET(request: NextRequest) {
  const current = await requireAdminSectionEdit('invoicing', '/admin/invoicing?toast=admin_write_denied');
  const params = request.nextUrl.searchParams;
  const code = params.get('code') ?? '';
  const realmId = params.get('realmId') ?? '';
  const state = params.get('state') ?? '';
  const expectedState = cookies().get('quickbooks_oauth_state')?.value ?? '';
  cookies().delete('quickbooks_oauth_state');

  if (!code || !realmId || !state || state !== expectedState) {
    return NextResponse.redirect(adminInvoicingUrl(request, 'quickbooks_connect_error'));
  }

  try {
    await exchangeQuickBooksAuthorizationCode({
      code,
      connectedBy: current.profile.id,
      realmId,
    });
    return NextResponse.redirect(adminInvoicingUrl(request, 'quickbooks_connected'));
  } catch (error) {
    console.error('[quickbooks] callback failed', error);
    return NextResponse.redirect(adminInvoicingUrl(request, 'quickbooks_connect_error'));
  }
}

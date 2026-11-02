import { isRedirectError } from 'next/dist/client/components/redirect-error';
import type { NextRequest } from 'next/server';
import { preloadAdminReport } from '@/lib/admin-report-preload';

const response = (status: number) => new Response(null, {
  status,
  headers: { 'Cache-Control': 'private, no-store' },
});

export async function GET(request: NextRequest) {
  try {
    const result = await preloadAdminReport(request.nextUrl.searchParams.get('href') ?? '');
    return response(result === 'forbidden' ? 403 : 204);
  } catch (error) {
    // Do not follow an auth redirect and accidentally preload a login document.
    // This optional request never returns report records or changes navigation.
    return response(isRedirectError(error) ? 403 : 503);
  }
}

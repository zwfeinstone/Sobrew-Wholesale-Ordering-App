import { NextResponse, type NextRequest } from 'next/server';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { loadShopifyAccountingRows, shopifyAccountingCsv, shopifyAccountingPeriod } from '@/lib/shopify-accounting';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const current = await requireAdminSectionView('accounting');
  let period;
  try {
    period = shopifyAccountingPeriod(request.nextUrl.searchParams.get('start'), request.nextUrl.searchParams.get('end'));
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : 'Invalid dates.', { status: 400 });
  }
  const result = await loadShopifyAccountingRows(await createClient(), period, current.centerScope);
  if (result.error) return new NextResponse('Unable to load the complete Shopify reconciliation. Please try again.', { status: 500 });
  return new NextResponse(shopifyAccountingCsv(result.data), { headers: {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="sobrew-shopify-reconciliation-${period.start}-to-${period.end}.csv"`,
  } });
}

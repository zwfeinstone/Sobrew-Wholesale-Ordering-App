import { NextResponse } from 'next/server';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { getQuickBooksInvoiceEmailPreviewForOrder } from '@/lib/quickbooks';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const access = await requireAdminSectionView('invoicing');
  const orderId = new URL(request.url).searchParams.get('orderId')?.trim();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json({ error: 'Choose an order to preview recipients.' }, { status: 400, headers });
  }

  if (access.centerScope !== null) {
    const { data: order, error } = await getSupabaseAdmin()
      .from('orders')
      .select('center_id')
      .eq('id', orderId)
      .single();
    if (error || !order?.center_id || !access.centerScope.includes(order.center_id)) {
      return NextResponse.json({ error: 'This order is unavailable.' }, { status: 404, headers });
    }
  }

  try {
    const recipients = await getQuickBooksInvoiceEmailPreviewForOrder(orderId);
    return NextResponse.json({ cc: recipients.cc, to: recipients.to }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to preview recipients.' }, { status: 400, headers });
  }
}

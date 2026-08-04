import { NextResponse } from 'next/server';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  type CreatedQuickBooksInvoice,
  createQuickBooksInvoiceForOrder,
  getQuickBooksInvoicePdf,
  QuickBooksConfigurationError,
} from '@/lib/quickbooks';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const INVOICING_TIME_ZONE = 'America/Chicago';
const QUICKBOOKS_INVOICING_START = { day: 1, month: 8, year: 2026 };
const PROSPECTING_SAMPLE_ORDER_KIND = 'prospecting_sample';

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function numericValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    month: Number(byType.month),
    second: Number(byType.second),
    year: Number(byType.year),
  };
}

function timeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = timeZoneParts(date, timeZone);
  const utcFromLocalParts = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utcFromLocalParts - date.getTime();
}

function localDateStartIso({ day, month, year }: { day: number; month: number; year: number }, timeZone = INVOICING_TIME_ZONE) {
  const localMidnightAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const firstGuess = new Date(localMidnightAsUtc);
  const offset = timeZoneOffsetMs(firstGuess, timeZone);
  return new Date(localMidnightAsUtc - offset).toISOString();
}

function quickBooksInvoicingStartIso(timeZone = INVOICING_TIME_ZONE) {
  return localDateStartIso(QUICKBOOKS_INVOICING_START, timeZone);
}

function invoiceableLineItemCount(order: any) {
  return (order.order_items ?? []).filter((item: any) => numericValue(item.line_total_cents) > 0).length;
}

function missingOrderProductMappings(order: any) {
  return (order.order_items ?? []).filter((item: any) => !cleanText(relatedOne(item.products)?.quickbooks_item_id));
}

function missingOrderCustomerMapping(order: any) {
  return !cleanText(relatedOne(order.centers)?.quickbooks_customer_id);
}

function invoicingRedirect(request: Request, toast: string, view?: string) {
  const url = new URL('/admin/invoicing', request.url);
  if (view === 'sent') url.searchParams.set('view', 'sent');
  url.searchParams.set('toast', toast);
  return NextResponse.redirect(url);
}

function downloadResponse(pdf: Buffer, invoiceNumber: string) {
  const filename = `Sobrew-Invoice-${cleanText(invoiceNumber).replace(/[^A-Za-z0-9._-]+/g, '-') || 'invoice'}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'application/pdf',
    },
  });
}

export async function POST(request: Request) {
  await requireAdminWriteAccess('/admin/invoicing?toast=admin_write_denied', 'invoicing');

  const formData = await request.formData();
  const orderId = cleanText(formData.get('order_id'));
  const returnView = cleanText(formData.get('view'));
  if (!orderId) return invoicingRedirect(request, 'invoice_download_failed', returnView);

  const supabase = getSupabaseAdmin();
  const { data: order, error: readError } = await supabase
    .from('orders')
    .select('id,order_kind,status,archived_at,created_at,quickbooks_invoice_id,quickbooks_invoice_doc_number,quickbooks_invoice_url,invoice_status,centers(quickbooks_customer_id),order_items(line_total_cents,product_name_snapshot,products(name,quickbooks_item_id))')
    .eq('id', orderId)
    .single();

  if (readError || !order) return invoicingRedirect(request, 'invoice_download_failed', returnView);

  if ((order as any).quickbooks_invoice_id) {
    try {
      const pdf = await getQuickBooksInvoicePdf(String((order as any).quickbooks_invoice_id));
      return downloadResponse(pdf, cleanText((order as any).quickbooks_invoice_doc_number) || String((order as any).quickbooks_invoice_id));
    } catch (error) {
      console.error('[invoicing] existing invoice PDF download failed', { error, orderId });
      return invoicingRedirect(request, error instanceof QuickBooksConfigurationError ? 'quickbooks_config_error' : 'invoice_download_failed', returnView);
    }
  }

  const startIso = quickBooksInvoicingStartIso();
  if ((order as any).order_kind === PROSPECTING_SAMPLE_ORDER_KIND || (order as any).archived_at || (order as any).status !== 'Shipped' || !(order as any).created_at || new Date((order as any).created_at) < new Date(startIso)) {
    return invoicingRedirect(request, 'invoice_not_ready', returnView);
  }
  if (invoiceableLineItemCount(order) === 0) {
    await supabase
      .from('orders')
      .update({
        invoice_error: 'This order has no invoiceable line items.',
        invoice_status: 'invoice_error',
      })
      .eq('id', orderId);
    return invoicingRedirect(request, 'invoice_no_line_items', returnView);
  }
  if (missingOrderCustomerMapping(order) || missingOrderProductMappings(order).length) {
    return invoicingRedirect(request, 'invoice_mapping_required', returnView);
  }

  const claimResult = await supabase
    .from('orders')
    .update({ invoice_error: null, invoice_status: 'invoicing' })
    .eq('id', orderId)
    .eq('status', 'Shipped')
    .neq('order_kind', PROSPECTING_SAMPLE_ORDER_KIND)
    .is('archived_at', null)
    .is('quickbooks_invoice_id', null)
    .in('invoice_status', ['not_invoiced', 'invoice_error'])
    .select('id')
    .single();

  if (claimResult.error || !claimResult.data) return invoicingRedirect(request, 'invoice_already_created', returnView);

  let createdInvoice: CreatedQuickBooksInvoice | null = null;
  try {
    const invoice = await createQuickBooksInvoiceForOrder(orderId, { sendQuickBooksEmail: false });
    createdInvoice = invoice;
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        invoice_error: invoice.emailError,
        invoice_status: invoice.emailError ? 'invoice_error' : 'invoiced',
        invoiced_at: new Date().toISOString(),
        quickbooks_invoice_doc_number: invoice.docNumber,
        quickbooks_invoice_email_sent_at: null,
        quickbooks_invoice_email_to: invoice.emailTo,
        quickbooks_invoice_id: invoice.id,
        quickbooks_invoice_url: invoice.url,
      })
      .eq('id', orderId);
    if (updateError) throw updateError;

    const pdf = await getQuickBooksInvoicePdf(invoice.id);
    return downloadResponse(pdf, invoice.docNumber || invoice.id);
  } catch (error) {
    const message = error instanceof QuickBooksConfigurationError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Unable to create and download that QuickBooks invoice.';
    console.error('[invoicing] invoice PDF download failed', { error, orderId });
    const failureUpdate: Record<string, unknown> = {
      invoice_error: message,
      invoice_status: 'invoice_error',
      quickbooks_invoice_email_sent_at: null,
    };
    if (createdInvoice) {
      failureUpdate.quickbooks_invoice_doc_number = createdInvoice.docNumber;
      failureUpdate.quickbooks_invoice_email_to = createdInvoice.emailTo;
      failureUpdate.quickbooks_invoice_id = createdInvoice.id;
      failureUpdate.quickbooks_invoice_url = createdInvoice.url;
    }
    await supabase
      .from('orders')
      .update(failureUpdate)
      .eq('id', orderId);
    return invoicingRedirect(request, error instanceof QuickBooksConfigurationError ? 'quickbooks_config_error' : 'invoice_download_failed', returnView);
  }
}

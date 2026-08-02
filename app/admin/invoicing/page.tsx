import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import { QuickBooksProductResetForm } from '@/components/quickbooks-product-reset-form';
import StatusToast from '@/components/status-toast';
import { adminCanEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  buildQuickBooksCustomerMatches,
  buildQuickBooksReceivablesSummary,
  clearPortalCenterQuickBooksCustomer,
  createQuickBooksCustomerFromPortalCenter,
  createQuickBooksInvoiceForOrder,
  disconnectQuickBooksConnection,
  getQuickBooksActiveCustomers,
  getQuickBooksActiveItems,
  getQuickBooksCompanyInfo,
  getQuickBooksConnectionStatus,
  getQuickBooksCustomerSummary,
  getQuickBooksInvoiceReceivables,
  getQuickBooksInvoicePdf,
  getQuickBooksProductSummary,
  getQuickBooksSalesTaxSettings,
  linkPortalCenterToQuickBooksCustomer,
  QuickBooksConfigurationError,
  type QuickBooksCustomerRecord,
  resetQuickBooksProductsFromPortal,
  saveQuickBooksSalesTaxSettings,
  shouldCollectQuickBooksSalesTax,
} from '@/lib/quickbooks';
import { sendInvoicePdfEmail } from '@/lib/email';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const INVOICING_TIME_ZONE = 'America/Chicago';
const INVOICING_VIEWS = [
  { id: 'queue', label: 'Ready to Invoice' },
  { id: 'accounts-receivable', label: 'Accounts Receivable' },
  { id: 'sent', label: 'Archived Invoices' },
  { id: 'products', label: 'Products' },
  { id: 'customers', label: 'Customers' },
  { id: 'sales-tax', label: 'Sales Tax' },
] as const;

const US_STATE_OPTIONS = [
  ['AL', 'Alabama'],
  ['AK', 'Alaska'],
  ['AZ', 'Arizona'],
  ['AR', 'Arkansas'],
  ['CA', 'California'],
  ['CO', 'Colorado'],
  ['CT', 'Connecticut'],
  ['DE', 'Delaware'],
  ['DC', 'District of Columbia'],
  ['FL', 'Florida'],
  ['GA', 'Georgia'],
  ['HI', 'Hawaii'],
  ['ID', 'Idaho'],
  ['IL', 'Illinois'],
  ['IN', 'Indiana'],
  ['IA', 'Iowa'],
  ['KS', 'Kansas'],
  ['KY', 'Kentucky'],
  ['LA', 'Louisiana'],
  ['ME', 'Maine'],
  ['MD', 'Maryland'],
  ['MA', 'Massachusetts'],
  ['MI', 'Michigan'],
  ['MN', 'Minnesota'],
  ['MS', 'Mississippi'],
  ['MO', 'Missouri'],
  ['MT', 'Montana'],
  ['NE', 'Nebraska'],
  ['NV', 'Nevada'],
  ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'],
  ['NY', 'New York'],
  ['NC', 'North Carolina'],
  ['ND', 'North Dakota'],
  ['OH', 'Ohio'],
  ['OK', 'Oklahoma'],
  ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'],
  ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'],
  ['SD', 'South Dakota'],
  ['TN', 'Tennessee'],
  ['TX', 'Texas'],
  ['UT', 'Utah'],
  ['VT', 'Vermont'],
  ['VA', 'Virginia'],
  ['WA', 'Washington'],
  ['WV', 'West Virginia'],
  ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'],
] as const;

type SearchParams = Record<string, string | string[] | undefined>;
type InvoicingView = (typeof INVOICING_VIEWS)[number]['id'];

type InvoiceQueueCenter = {
  customer_tax_status?: string | null;
  name: string | null;
  quickbooks_customer_id?: string | null;
  quickbooks_display_name?: string | null;
};

type InvoiceQueueOrder = {
  centers?: InvoiceQueueCenter | InvoiceQueueCenter[] | null;
  created_at: string | null;
  id: string;
  invoice_error: string | null;
  invoice_status: string | null;
  invoiced_at?: string | null;
  order_items?: Array<{
    line_total_cents: number | string | null;
    product_name_snapshot: string | null;
    products?: {
      name: string | null;
      quickbooks_item_id?: string | null;
      sku: string | null;
    } | Array<{
      name: string | null;
      quickbooks_item_id?: string | null;
      sku: string | null;
    }> | null;
    qty: number | string | null;
  }> | null;
  profiles?: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
  quickbooks_invoice_doc_number?: string | null;
  quickbooks_invoice_email_sent_at?: string | null;
  quickbooks_invoice_email_to?: string | null;
  quickbooks_invoice_id?: string | null;
  quickbooks_invoice_url?: string | null;
  shipped_at: string | null;
  shipping_company?: string | null;
  shipping_name: string | null;
  shipping_state: string | null;
  subtotal_cents: number | string | null;
};

type ProductSyncRow = {
  active: boolean | null;
  category: string | null;
  description: string | null;
  id: string;
  name: string;
  quickbooks_item_id: string | null;
  quickbooks_item_name: string | null;
  quickbooks_item_type: string | null;
  quickbooks_sync_error: string | null;
  quickbooks_sync_status: string | null;
  quickbooks_synced_at: string | null;
  sku: string | null;
};

type QuickBooksResetStatusRow = {
  quickbooks_product_reset_error: string | null;
  quickbooks_product_reset_error_at: string | null;
  quickbooks_product_reset_last_result: Record<string, unknown> | null;
};

type CustomerSyncRow = {
  billing_address1: string | null;
  billing_city: string | null;
  billing_email: string | null;
  billing_state: string | null;
  billing_zip: string | null;
  created_at: string | null;
  id: string;
  is_active: boolean | null;
  legal_name: string | null;
  name: string;
  quickbooks_company_name: string | null;
  quickbooks_customer_id: string | null;
  quickbooks_display_name: string | null;
  quickbooks_fully_qualified_name: string | null;
  quickbooks_mapping_note: string | null;
  quickbooks_sync_error: string | null;
  quickbooks_sync_status: string | null;
  quickbooks_synced_at: string | null;
};

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
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

function todayStartIso(timeZone = INVOICING_TIME_ZONE) {
  const now = new Date();
  const parts = timeZoneParts(now, timeZone);
  const localMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  const firstGuess = new Date(localMidnightAsUtc - timeZoneOffsetMs(now, timeZone));
  const offset = timeZoneOffsetMs(firstGuess, timeZone);
  return new Date(localMidnightAsUtc - offset).toISOString();
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: INVOICING_TIME_ZONE,
  });
}

function formatDateOnly(value: string | null | undefined) {
  if (!value) return 'Unknown';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return formatTimestamp(value);
  return `${Number(match[2])}/${Number(match[3])}/${match[1].slice(2)}`;
}

function customerLabel(order: InvoiceQueueOrder) {
  return cleanText(relatedOne(order.centers)?.name)
    || cleanText(order.shipping_company)
    || cleanText(order.shipping_name)
    || cleanText(relatedOne(order.profiles)?.full_name)
    || cleanText(relatedOne(order.profiles)?.email)
    || 'Unknown customer';
}

function productLabel(item: NonNullable<InvoiceQueueOrder['order_items']>[number]) {
  return cleanText(relatedOne(item.products)?.name) || cleanText(item.product_name_snapshot) || 'Product';
}

function quickBooksCustomerLabel(customer: QuickBooksCustomerRecord | null | undefined) {
  if (!customer) return 'No suggestion';
  return customer.companyName && customer.companyName !== customer.displayName
    ? `${customer.displayName} (${customer.companyName})`
    : customer.displayName;
}

function quickBooksCustomerAddressLabel(customer: QuickBooksCustomerRecord | null | undefined) {
  if (!customer) return '';
  return [
    customer.billAddress.line1,
    customer.billAddress.line2,
    customer.billAddress.city,
    customer.billAddress.state,
    customer.billAddress.postalCode,
  ].map(cleanText).filter(Boolean).join(', ');
}

function centerBillingAddressLabel(center: CustomerSyncRow) {
  return [
    center.billing_address1,
    center.billing_city,
    center.billing_state,
    center.billing_zip,
  ].map(cleanText).filter(Boolean).join(', ');
}

function missingOrderProductMappings(order: InvoiceQueueOrder) {
  return (order.order_items ?? [])
    .filter((item) => !cleanText(relatedOne(item.products)?.quickbooks_item_id))
    .map(productLabel);
}

function missingOrderCustomerMapping(order: InvoiceQueueOrder) {
  return !cleanText(relatedOne(order.centers)?.quickbooks_customer_id);
}

function invoiceableLineItemCount(order: InvoiceQueueOrder) {
  return (order.order_items ?? []).filter((item) => numericValue(item.line_total_cents) > 0).length;
}

function orderIsReadyToInvoice(order: InvoiceQueueOrder) {
  return order.invoice_status !== 'invoicing'
    && !missingOrderCustomerMapping(order)
    && missingOrderProductMappings(order).length === 0
    && invoiceableLineItemCount(order) > 0;
}

function invoicingHref(toast?: string) {
  if (!toast) return '/admin/invoicing';
  return `/admin/invoicing?${new URLSearchParams({ toast }).toString()}`;
}

function productsInvoicingHref(toast: string, error?: string) {
  const params = new URLSearchParams({ toast, view: 'products' });
  if (error) params.set('error', error.slice(0, 500));
  return `/admin/invoicing?${params.toString()}`;
}

function customerRowAnchor(centerId: string) {
  return centerId ? `#qb-center-${encodeURIComponent(centerId)}` : '';
}

function customersInvoicingHref(toast: string, error?: string, centerId?: string) {
  const params = new URLSearchParams({ toast, view: 'customers' });
  if (error) params.set('error', error.slice(0, 500));
  return `/admin/invoicing?${params.toString()}${centerId ? customerRowAnchor(centerId) : ''}`;
}

function invoicingViewParam(value: string | string[] | undefined): InvoicingView {
  return INVOICING_VIEWS.some((view) => view.id === value) ? value as InvoicingView : 'queue';
}

function invoicingViewHref(view: InvoicingView) {
  if (view === 'queue') return '/admin/invoicing';
  return `/admin/invoicing?${new URLSearchParams({ view }).toString()}`;
}

function invoiceNumberLabel(order: InvoiceQueueOrder) {
  return cleanText(order.quickbooks_invoice_doc_number) || cleanText(order.quickbooks_invoice_id) || 'Missing invoice number';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function toastMessage(toast: string) {
  const messages: Record<string, { message: string; tone: 'error' | 'success' }> = {
    admin_write_denied: { message: 'You do not have permission to invoice orders.', tone: 'error' },
    invoice_already_created: { message: 'That order already has a QuickBooks invoice.', tone: 'success' },
    invoice_created: { message: 'QuickBooks invoice created.', tone: 'success' },
    invoice_email_failed: { message: 'QuickBooks invoice was created, but the email was not sent. Fix the billing email or QuickBooks email settings and retry.', tone: 'error' },
    invoice_failed: { message: 'Unable to create that QuickBooks invoice.', tone: 'error' },
    invoice_mapping_required: { message: 'Map the QuickBooks customer and every product before invoicing.', tone: 'error' },
    invoice_no_line_items: { message: 'This order has no invoiceable line items.', tone: 'error' },
    invoice_not_ready: { message: 'Only shipped orders from today or later can be invoiced here.', tone: 'error' },
    invoice_download_failed: { message: 'Unable to download that QuickBooks invoice PDF.', tone: 'error' },
    invoice_pdf_failed: { message: 'QuickBooks invoice was created, but the PDF email was not sent. Check the billing email and email settings, then retry.', tone: 'error' },
    invoice_pdf_sent: { message: 'QuickBooks invoice created and PDF emailed.', tone: 'success' },
    invoice_resend_failed: { message: 'Unable to resend that QuickBooks invoice.', tone: 'error' },
    invoice_resend_pdf_failed: { message: 'Unable to resend that invoice PDF.', tone: 'error' },
    invoice_resent: { message: 'QuickBooks invoice resent.', tone: 'success' },
    invoice_pdf_resent: { message: 'Invoice PDF resent.', tone: 'success' },
    product_reset_confirm_required: { message: 'Confirm the live QuickBooks product reset before running it.', tone: 'error' },
    product_reset_failed: { message: 'Unable to reset QuickBooks products.', tone: 'error' },
    product_reset_saved: { message: 'QuickBooks products reset from portal products.', tone: 'success' },
    product_reset_with_errors: { message: 'QuickBooks product reset finished, but some portal products need review.', tone: 'error' },
    customer_mapping_cleared: { message: 'QuickBooks customer mapping cleared.', tone: 'success' },
    customer_created: { message: 'QuickBooks customer created and linked.', tone: 'success' },
    customer_create_failed: { message: 'Unable to create that QuickBooks customer.', tone: 'error' },
    customer_mapping_failed: { message: 'Unable to save that QuickBooks customer mapping.', tone: 'error' },
    customer_mapping_saved: { message: 'QuickBooks customer mapping saved.', tone: 'success' },
    customer_mapping_selection_required: { message: 'Choose a QuickBooks customer to link.', tone: 'error' },
    quickbooks_config_error: { message: 'Add QuickBooks configuration before connecting.', tone: 'error' },
    quickbooks_connect_error: { message: 'Unable to connect QuickBooks.', tone: 'error' },
    quickbooks_connected: { message: 'QuickBooks connected.', tone: 'success' },
    quickbooks_disconnected: { message: 'QuickBooks disconnected. Reconnect the correct company before syncing products.', tone: 'success' },
    quickbooks_not_connected: { message: 'Connect QuickBooks before creating invoices.', tone: 'error' },
    sales_tax_settings_failed: { message: 'Unable to save QuickBooks sales tax settings.', tone: 'error' },
    sales_tax_settings_saved: { message: 'QuickBooks sales tax settings saved.', tone: 'success' },
  };
  return messages[toast] ?? null;
}

async function updateQuickBooksSalesTaxSettings(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/invoicing?view=sales-tax&toast=admin_write_denied', 'invoicing');
  const selectedStates = formData.getAll('sales_tax_state').map(String);
  try {
    await saveQuickBooksSalesTaxSettings(selectedStates);
  } catch (error) {
    console.error('[invoicing] sales tax settings failed', error);
    redirect('/admin/invoicing?view=sales-tax&toast=sales_tax_settings_failed');
  }
  redirect('/admin/invoicing?view=sales-tax&toast=sales_tax_settings_saved');
}

async function disconnectQuickBooks(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(invoicingHref('admin_write_denied'), 'invoicing');
  const rawView = String(formData.get('view') ?? '').trim();
  const view = rawView === 'accounts-receivable' || rawView === 'sent' || rawView === 'products' || rawView === 'customers' || rawView === 'sales-tax' ? rawView : 'queue';
  await disconnectQuickBooksConnection();
  redirect(`${invoicingViewHref(view)}${view === 'queue' ? '?' : '&'}toast=quickbooks_disconnected`);
}

async function linkQuickBooksCustomer(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/invoicing?view=customers&toast=admin_write_denied', 'invoicing');
  const centerId = String(formData.get('center_id') ?? '').trim();
  const customerId = String(formData.get('quickbooks_customer_id') ?? '').trim();
  const mappingNote = String(formData.get('quickbooks_mapping_note') ?? '').trim();
  if (!centerId || !customerId) redirect(customersInvoicingHref('customer_mapping_selection_required', undefined, centerId));

  try {
    await linkPortalCenterToQuickBooksCustomer({ centerId, customerId, mappingNote });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save QuickBooks customer mapping.';
    console.error('[invoicing] customer mapping failed', { centerId, customerId, error });
    redirect(customersInvoicingHref('customer_mapping_failed', message, centerId));
  }
  redirect(customersInvoicingHref('customer_mapping_saved', undefined, centerId));
}

async function createQuickBooksCustomer(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/invoicing?view=customers&toast=admin_write_denied', 'invoicing');
  const centerId = String(formData.get('center_id') ?? '').trim();
  if (!centerId) redirect(customersInvoicingHref('customer_mapping_selection_required'));

  try {
    await createQuickBooksCustomerFromPortalCenter(centerId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create QuickBooks customer.';
    console.error('[invoicing] create QuickBooks customer failed', { centerId, error });
    redirect(customersInvoicingHref('customer_create_failed', message, centerId));
  }
  redirect(customersInvoicingHref('customer_created', undefined, centerId));
}

async function clearQuickBooksCustomerMapping(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/invoicing?view=customers&toast=admin_write_denied', 'invoicing');
  const centerId = String(formData.get('center_id') ?? '').trim();
  if (!centerId) redirect(customersInvoicingHref('customer_mapping_selection_required'));

  try {
    await clearPortalCenterQuickBooksCustomer(centerId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to clear QuickBooks customer mapping.';
    console.error('[invoicing] clear customer mapping failed', { centerId, error });
    redirect(customersInvoicingHref('customer_mapping_failed', message, centerId));
  }
  redirect(customersInvoicingHref('customer_mapping_cleared', undefined, centerId));
}

async function resetQuickBooksProducts(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/invoicing?view=products&toast=admin_write_denied', 'invoicing');
  if (formData.get('confirm_product_reset') !== 'on') {
    redirect('/admin/invoicing?view=products&toast=product_reset_confirm_required');
  }

  const supabase = getSupabaseAdmin();
  const { data: products, error } = await supabase
    .from('products')
    .select('id,name,sku,description,active')
    .order('name', { ascending: true });
  if (error) {
    console.error('[invoicing] product load failed', error);
    redirect('/admin/invoicing?view=products&toast=product_reset_failed');
  }

  let toast: 'product_reset_saved' | 'product_reset_with_errors' = 'product_reset_saved';
  try {
    const result = await resetQuickBooksProductsFromPortal(products ?? []);
    await supabase
      .from('app_settings')
      .update({
        quickbooks_product_reset_error: null,
        quickbooks_product_reset_error_at: null,
        quickbooks_product_reset_last_result: {
          archiveErrorCount: result.archiveErrorCount,
          archiveErrors: result.archiveErrors,
          createdCount: result.createdCount,
          inactivatedCount: result.inactivatedCount,
          productErrorCount: result.productErrorCount,
          ranAt: new Date().toISOString(),
        },
      })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    toast = result.archiveErrorCount || result.productErrorCount ? 'product_reset_with_errors' : 'product_reset_saved';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reset QuickBooks products.';
    console.error('[invoicing] product reset failed', error);
    await supabase
      .from('app_settings')
      .update({
        quickbooks_product_reset_error: message,
        quickbooks_product_reset_error_at: new Date().toISOString(),
        quickbooks_product_reset_last_result: null,
      })
      .neq('id', '00000000-0000-0000-0000-000000000000');
    redirect(productsInvoicingHref('product_reset_failed', message));
  }
  redirect(`/admin/invoicing?view=products&toast=${toast}`);
}

async function invoiceOrder(formData: FormData) {
  'use server';
  const orderId = String(formData.get('order_id') ?? '').trim();
  const delivery = String(formData.get('delivery') ?? '').trim() === 'pdf' ? 'pdf' : 'quickbooks';
  await requireAdminWriteAccess(invoicingHref('admin_write_denied'), 'invoicing');
  if (!orderId) redirect(invoicingHref('invoice_not_ready'));

  const supabase = getSupabaseAdmin();
  const startIso = todayStartIso();
  const { data: order } = await supabase
    .from('orders')
    .select('id,status,archived_at,created_at,quickbooks_invoice_id,invoice_status,centers(quickbooks_customer_id),order_items(line_total_cents,product_name_snapshot,products(name,quickbooks_item_id))')
    .eq('id', orderId)
    .single();

  if (!order || order.archived_at || order.status !== 'Shipped' || !order.created_at || new Date(order.created_at) < new Date(startIso)) {
    redirect(invoicingHref('invoice_not_ready'));
  }
  if (order.quickbooks_invoice_id && order.invoice_status !== 'invoice_error') redirect(invoicingHref('invoice_already_created'));
  if (invoiceableLineItemCount(order as any) === 0) {
    await supabase
      .from('orders')
      .update({
        invoice_error: 'This order has no invoiceable line items.',
        invoice_status: 'invoice_error',
      })
      .eq('id', orderId);
    redirect(invoicingHref('invoice_no_line_items'));
  }
  const missingCustomerMapping = !cleanText(relatedOne((order as any).centers)?.quickbooks_customer_id);
  const missingProductMappings = ((order as any).order_items ?? [])
    .filter((item: any) => !cleanText(relatedOne(item.products)?.quickbooks_item_id));
  if (missingCustomerMapping || missingProductMappings.length) {
    redirect(invoicingHref('invoice_mapping_required'));
  }

  const claimQuery = supabase
    .from('orders')
    .update({ invoice_error: null, invoice_status: 'invoicing' })
    .eq('id', orderId)
    .eq('status', 'Shipped')
    .is('archived_at', null)
    .in('invoice_status', ['not_invoiced', 'invoice_error']);
  const claimResult = order.quickbooks_invoice_id
    ? await claimQuery.eq('quickbooks_invoice_id', order.quickbooks_invoice_id).select('id').single()
    : await claimQuery.is('quickbooks_invoice_id', null).select('id').single();

  if (claimResult.error || !claimResult.data) redirect(invoicingHref('invoice_already_created'));

  let successToast: 'invoice_created' | 'invoice_email_failed' | 'invoice_pdf_failed' | 'invoice_pdf_sent' = delivery === 'pdf' ? 'invoice_pdf_sent' : 'invoice_created';
  try {
    const invoice = await createQuickBooksInvoiceForOrder(orderId, { sendQuickBooksEmail: delivery !== 'pdf' });
    let emailError = invoice.emailError;
    let emailSentAt = invoice.emailSentAt;

    if (delivery === 'pdf' && !emailError) {
      if (!invoice.emailTo) {
        emailError = 'Add a billing email before sending the invoice PDF.';
      } else {
        const pdf = await getQuickBooksInvoicePdf(invoice.id);
        const emailResult = await sendInvoicePdfEmail({
          customerName: invoice.customerName,
          invoiceNumber: invoice.docNumber || invoice.id,
          orderId,
          pdf,
          to: invoice.emailTo,
        });
        if (emailResult.ok) {
          emailSentAt = new Date().toISOString();
        } else {
          emailError = errorMessage(emailResult.error, 'QuickBooks invoice was created, but the PDF email could not be sent.');
        }
      }
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        invoice_error: emailError,
        invoice_status: emailError ? 'invoice_error' : 'invoiced',
        invoiced_at: new Date().toISOString(),
        quickbooks_invoice_email_sent_at: emailSentAt,
        quickbooks_invoice_email_to: invoice.emailTo,
        quickbooks_invoice_doc_number: invoice.docNumber,
        quickbooks_invoice_id: invoice.id,
        quickbooks_invoice_url: invoice.url,
      })
      .eq('id', orderId);
    if (updateError) throw updateError;
    if (emailError) successToast = delivery === 'pdf' ? 'invoice_pdf_failed' : 'invoice_email_failed';
  } catch (error) {
    const message = error instanceof QuickBooksConfigurationError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Unable to create QuickBooks invoice.';
    console.error('[invoicing] invoice failed', { error, orderId });
    await supabase
      .from('orders')
      .update({
        invoice_error: message,
        invoice_status: 'invoice_error',
      })
      .eq('id', orderId);
    redirect(invoicingHref(error instanceof QuickBooksConfigurationError ? 'quickbooks_config_error' : 'invoice_failed'));
  }
  redirect(invoicingHref(successToast));
}

async function resendQuickBooksInvoice(formData: FormData) {
  'use server';
  const orderId = String(formData.get('order_id') ?? '').trim();
  await requireAdminWriteAccess('/admin/invoicing?view=sent&toast=admin_write_denied', 'invoicing');
  if (!orderId) redirect('/admin/invoicing?view=sent&toast=invoice_resend_failed');

  const supabase = getSupabaseAdmin();
  const { data: order, error: readError } = await supabase
    .from('orders')
    .select('id,quickbooks_invoice_id,invoice_status')
    .eq('id', orderId)
    .single();
  if (readError || !order?.quickbooks_invoice_id) redirect('/admin/invoicing?view=sent&toast=invoice_resend_failed');

  let toast: 'invoice_resent' | 'invoice_resend_failed' = 'invoice_resent';
  try {
    const invoice = await createQuickBooksInvoiceForOrder(orderId, { sendQuickBooksEmail: true });
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        invoice_error: invoice.emailError,
        invoice_status: 'invoiced',
        quickbooks_invoice_email_sent_at: invoice.emailSentAt,
        quickbooks_invoice_email_to: invoice.emailTo,
        quickbooks_invoice_doc_number: invoice.docNumber,
        quickbooks_invoice_id: invoice.id,
        quickbooks_invoice_url: invoice.url,
      })
      .eq('id', orderId);
    if (updateError) throw updateError;
    if (invoice.emailError) toast = 'invoice_resend_failed';
  } catch (error) {
    const message = errorMessage(error, 'Unable to resend that QuickBooks invoice.');
    console.error('[invoicing] QuickBooks invoice resend failed', { error, orderId });
    await supabase
      .from('orders')
      .update({
        invoice_error: message,
        invoice_status: 'invoiced',
      })
      .eq('id', orderId);
    toast = 'invoice_resend_failed';
  }
  redirect(`/admin/invoicing?view=sent&toast=${toast}`);
}

async function resendInvoicePdf(formData: FormData) {
  'use server';
  const orderId = String(formData.get('order_id') ?? '').trim();
  await requireAdminWriteAccess('/admin/invoicing?view=sent&toast=admin_write_denied', 'invoicing');
  if (!orderId) redirect('/admin/invoicing?view=sent&toast=invoice_resend_pdf_failed');

  const supabase = getSupabaseAdmin();
  const { data: order, error: readError } = await supabase
    .from('orders')
    .select('id,quickbooks_invoice_id,quickbooks_invoice_doc_number,quickbooks_invoice_email_to,profiles(email,full_name),centers(name,billing_email)')
    .eq('id', orderId)
    .single();
  if (readError || !order?.quickbooks_invoice_id) redirect('/admin/invoicing?view=sent&toast=invoice_resend_pdf_failed');

  const emailTo = cleanText((order as any).quickbooks_invoice_email_to)
    || cleanText(relatedOne((order as any).centers)?.billing_email)
    || cleanText(relatedOne((order as any).profiles)?.email);
  if (!emailTo) {
    await supabase
      .from('orders')
      .update({
        invoice_error: 'Add a billing email before resending the invoice PDF.',
        invoice_status: 'invoiced',
      })
      .eq('id', orderId);
    redirect('/admin/invoicing?view=sent&toast=invoice_resend_pdf_failed');
  }

  let toast: 'invoice_pdf_resent' | 'invoice_resend_pdf_failed' = 'invoice_pdf_resent';
  try {
    const pdf = await getQuickBooksInvoicePdf(String((order as any).quickbooks_invoice_id));
    const invoiceNumber = cleanText((order as any).quickbooks_invoice_doc_number) || String((order as any).quickbooks_invoice_id);
    const emailResult = await sendInvoicePdfEmail({
      customerName: cleanText(relatedOne((order as any).centers)?.name) || cleanText(relatedOne((order as any).profiles)?.full_name) || 'there',
      invoiceNumber,
      orderId,
      pdf,
      to: emailTo,
    });
    if (!emailResult.ok) throw emailResult.error;

    const { error: updateError } = await supabase
      .from('orders')
      .update({
        invoice_error: null,
        invoice_status: 'invoiced',
        quickbooks_invoice_email_sent_at: new Date().toISOString(),
        quickbooks_invoice_email_to: emailTo,
      })
      .eq('id', orderId);
    if (updateError) throw updateError;
  } catch (error) {
    const message = errorMessage(error, 'Unable to resend that invoice PDF.');
    console.error('[invoicing] invoice PDF resend failed', { error, orderId });
    await supabase
      .from('orders')
      .update({
        invoice_error: message,
        invoice_status: 'invoiced',
      })
      .eq('id', orderId);
    toast = 'invoice_resend_pdf_failed';
  }
  redirect(`/admin/invoicing?view=sent&toast=${toast}`);
}

export default async function AdminInvoicingPage({ searchParams }: { searchParams?: SearchParams }) {
  const current = await requireAdminSectionView('invoicing');
  const canInvoice = adminCanEdit(current.access, 'invoicing');
  const activeView = invoicingViewParam(searchParams?.view);
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const errorDetail = typeof searchParams?.error === 'string' ? searchParams.error : '';
  const selectedToast = toastMessage(toast);
  const startIso = todayStartIso();
  const supabase = await createClient();
  const [quickBooksStatus, quickBooksCompanyInfo, quickBooksProductSummary, quickBooksItemsResult, quickBooksCustomerSummary, quickBooksCustomersResult, salesTaxSettings, ordersResult, sentInvoicesResult, receivableOrdersResult, productsResult, centersResult, resetStatusResult] = await Promise.all([
    getQuickBooksConnectionStatus(),
    activeView === 'accounts-receivable' || activeView === 'sent' || activeView === 'products' || activeView === 'customers' ? getQuickBooksCompanyInfo() : Promise.resolve({ companyName: null, email: null, error: null, legalName: null, realmId: null }),
    activeView === 'products' ? getQuickBooksProductSummary() : Promise.resolve({ activeItemCount: null, error: null }),
    activeView === 'products' ? getQuickBooksActiveItems() : Promise.resolve({ error: null, items: [], truncated: false }),
    activeView === 'customers' ? getQuickBooksCustomerSummary() : Promise.resolve({ activeCustomerCount: null, error: null }),
    activeView === 'customers' ? getQuickBooksActiveCustomers() : Promise.resolve({ customers: [], error: null, truncated: false }),
    getQuickBooksSalesTaxSettings(),
    supabase
      .from('orders')
      .select('id,created_at,shipped_at,subtotal_cents,shipping_company,shipping_name,shipping_state,invoice_status,invoice_error,invoiced_at,quickbooks_invoice_id,quickbooks_invoice_doc_number,quickbooks_invoice_url,quickbooks_invoice_email_to,quickbooks_invoice_email_sent_at,profiles(email,full_name),centers(name,customer_tax_status,quickbooks_customer_id,quickbooks_display_name),order_items(qty,line_total_cents,product_name_snapshot,products(name,sku,quickbooks_item_id))')
      .eq('status', 'Shipped')
      .is('archived_at', null)
      .or('quickbooks_invoice_id.is.null,invoice_status.eq.invoice_error')
      .gte('created_at', startIso)
      .order('shipped_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('orders')
      .select('id,created_at,shipped_at,subtotal_cents,shipping_company,shipping_name,shipping_state,invoice_status,invoice_error,invoiced_at,quickbooks_invoice_id,quickbooks_invoice_doc_number,quickbooks_invoice_url,quickbooks_invoice_email_to,quickbooks_invoice_email_sent_at,profiles(email,full_name),centers(name,customer_tax_status,quickbooks_customer_id,quickbooks_display_name),order_items(qty,line_total_cents,product_name_snapshot,products(name,sku,quickbooks_item_id))')
      .eq('invoice_status', 'invoiced')
      .not('quickbooks_invoice_id', 'is', null)
      .order('quickbooks_invoice_email_sent_at', { ascending: false, nullsFirst: false })
      .order('invoiced_at', { ascending: false, nullsFirst: false })
      .limit(100),
    activeView === 'accounts-receivable'
      ? supabase
          .from('orders')
          .select('id,created_at,shipped_at,subtotal_cents,shipping_company,shipping_name,shipping_state,invoice_status,invoice_error,invoiced_at,quickbooks_invoice_id,quickbooks_invoice_doc_number,quickbooks_invoice_url,quickbooks_invoice_email_to,quickbooks_invoice_email_sent_at,profiles(email,full_name),centers(name,customer_tax_status,quickbooks_customer_id,quickbooks_display_name),order_items(qty,line_total_cents,product_name_snapshot,products(name,sku,quickbooks_item_id))')
          .not('quickbooks_invoice_id', 'is', null)
          .order('invoiced_at', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    activeView === 'products'
      ? supabase
          .from('products')
          .select('id,name,sku,description,category,active,quickbooks_item_id,quickbooks_item_name,quickbooks_item_type,quickbooks_sync_status,quickbooks_synced_at,quickbooks_sync_error')
          .order('active', { ascending: false })
          .order('name', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    activeView === 'customers'
      ? supabase
          .from('centers')
          .select('id,name,is_active,created_at,quickbooks_customer_id,quickbooks_display_name,quickbooks_company_name,quickbooks_fully_qualified_name,legal_name,billing_email,billing_address1,billing_city,billing_state,billing_zip,quickbooks_sync_status,quickbooks_synced_at,quickbooks_sync_error,quickbooks_mapping_note')
          .order('is_active', { ascending: false })
          .order('name', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    activeView === 'products'
      ? supabase
          .from('app_settings')
          .select('quickbooks_product_reset_error,quickbooks_product_reset_error_at,quickbooks_product_reset_last_result')
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const orders = (ordersResult.data ?? []) as InvoiceQueueOrder[];
  const sentInvoices = (sentInvoicesResult.data ?? []) as InvoiceQueueOrder[];
  const receivableOrders = (receivableOrdersResult.data ?? []) as InvoiceQueueOrder[];
  const receivablesResult = activeView === 'accounts-receivable' && quickBooksStatus.connected
    ? await getQuickBooksInvoiceReceivables(receivableOrders.map((order) => order.quickbooks_invoice_id ?? ''))
    : { error: null, invoices: [], missingIds: [] };
  const receivableByInvoiceId = new Map(receivablesResult.invoices.map((invoice) => [invoice.id, invoice]));
  const receivableRows = receivableOrders
    .map((order) => {
      const invoiceId = cleanText(order.quickbooks_invoice_id);
      const receivable = invoiceId ? receivableByInvoiceId.get(invoiceId) ?? null : null;
      return { order, receivable };
    })
    .filter((row) => row.receivable)
    .sort((left, right) => {
      const leftReceivable = left.receivable;
      const rightReceivable = right.receivable;
      if (!leftReceivable || !rightReceivable) return 0;
      const group = (timing: string) => timing === 'overdue' ? 0 : timing === 'not_due_yet' || timing === 'due_today' || timing === 'unknown' ? 1 : 2;
      const groupDelta = group(leftReceivable.timing) - group(rightReceivable.timing);
      if (groupDelta) return groupDelta;
      return (leftReceivable.timingDays ?? 9999) - (rightReceivable.timingDays ?? 9999);
    });
  const receivablesSummary = buildQuickBooksReceivablesSummary(receivablesResult.invoices);
  const unpaidBarTotal = receivablesSummary.unpaidCents || 1;
  const overduePercent = Math.min(100, Math.round((receivablesSummary.overdueCents / unpaidBarTotal) * 100));
  const notDuePercent = receivablesSummary.unpaidCents > 0 ? Math.min(100, Math.max(0, 100 - overduePercent)) : 0;
  const paidPercent = receivablesSummary.paidCents > 0 ? 100 : 0;
  const products = (productsResult.data ?? []) as ProductSyncRow[];
  const centers = (centersResult.data ?? []) as CustomerSyncRow[];
  const quickBooksItems = quickBooksItemsResult.items;
  const quickBooksCustomers = quickBooksCustomersResult.customers;
  const resetStatus = resetStatusResult.data as QuickBooksResetStatusRow | null;
  const readyOrders = orders.filter(orderIsReadyToInvoice);
  const needsMappingOrders = orders.filter((order) => order.invoice_status !== 'invoicing' && !orderIsReadyToInvoice(order));
  const totalReadyCents = readyOrders.reduce((sum, order) => sum + Math.max(0, numericValue(order.subtotal_cents)), 0);
  const sentInvoiceTotalCents = sentInvoices.reduce((sum, order) => sum + Math.max(0, numericValue(order.subtotal_cents)), 0);
  const waitingCount = orders.filter((order) => order.invoice_status === 'invoicing').length;
  const activeProducts = products.filter((product) => product.active !== false);
  const mappedProducts = activeProducts.filter((product) => Boolean(product.quickbooks_item_id));
  const unmappedProducts = activeProducts.filter((product) => !product.quickbooks_item_id && product.quickbooks_sync_status !== 'ignored');
  const ignoredProducts = activeProducts.filter((product) => product.quickbooks_sync_status === 'ignored');
  const productErrorCount = activeProducts.filter((product) => product.quickbooks_sync_status === 'sync_error').length;
  const activeCenters = centers.filter((center) => center.is_active !== false);
  const mappedCenters = activeCenters.filter((center) => Boolean(center.quickbooks_customer_id));
  const unmappedCenters = activeCenters.filter((center) => !center.quickbooks_customer_id && center.quickbooks_sync_status !== 'ignored');
  const customerMatches = buildQuickBooksCustomerMatches(activeCenters, quickBooksCustomers);
  const customerMatchByCenterId = new Map(customerMatches.map((match) => [match.centerId, match]));
  const customerById = new Map(quickBooksCustomers.map((customer) => [customer.id, customer]));
  const customerErrorCount = activeCenters.filter((center) => center.quickbooks_sync_status === 'sync_error').length;
  const productResetDisabledReasons = [
    !canInvoice ? 'Your admin account needs edit access for Invoicing.' : '',
    !quickBooksStatus.connected ? 'QuickBooks is not connected.' : '',
    quickBooksStatus.missingConfig.length ? `Missing ${quickBooksStatus.missingConfig.join(', ')}.` : '',
    quickBooksProductSummary.error ? quickBooksProductSummary.error : '',
    quickBooksItemsResult.error ? quickBooksItemsResult.error : '',
    !activeProducts.length ? 'There are no active portal products to sync.' : '',
  ].filter(Boolean);

  return (
    <section className="space-y-6">
      {selectedToast ? <StatusToast message={selectedToast.message} tone={selectedToast.tone} /> : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <span className="eyebrow">Finance</span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Invoicing</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">Shipped orders from today forward appear here until QuickBooks has an invoice.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link className="btn-secondary text-center" href="/admin/orders">Orders</Link>
          {quickBooksStatus.connected ? (
            <form action={disconnectQuickBooks} className="contents">
              <input type="hidden" name="view" value={activeView} />
              <PendingSubmitButton className="btn-secondary text-center" label="Disconnect QuickBooks" pendingLabel="Disconnecting..." />
            </form>
          ) : (
            <a className="btn-primary text-center" href="/api/admin/quickbooks/connect">Connect QuickBooks</a>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ready</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{readyOrders.length}</p>
          <p className="mt-1 text-sm text-slate-500">{usd(totalReadyCents)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Needs mapping</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{needsMappingOrders.length}</p>
          <p className="mt-1 text-sm text-slate-500">Customer or product links missing.</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">QuickBooks</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{quickBooksStatus.environment === 'production' ? 'Live' : 'Sandbox'}</p>
          <p className="mt-1 text-sm text-slate-500">{quickBooksCompanyInfo.companyName ?? quickBooksStatus.realmId ?? 'Not connected'}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Archived</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{sentInvoices.length}</p>
          <p className="mt-1 text-sm text-slate-500">{usd(sentInvoiceTotalCents)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Working</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{waitingCount}</p>
          <p className="mt-1 text-sm text-slate-500">Invoice requests in progress.</p>
        </div>
      </div>

      {quickBooksStatus.missingConfig.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          Missing {quickBooksStatus.missingConfig.join(', ')}.
        </div>
      ) : null}

      <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6" aria-label="Invoicing views">
        {INVOICING_VIEWS.map((view) => (
          <Link
            key={view.id}
            className={`rounded-lg border px-3 py-2 text-center text-sm font-semibold ${activeView === view.id ? 'border-teal-200 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/70 text-slate-700'}`}
            href={invoicingViewHref(view.id)}
          >
            {view.label}
          </Link>
        ))}
      </nav>

      {activeView === 'accounts-receivable' ? (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="stat-card">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unpaid</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">{usd(receivablesSummary.unpaidCents)}</p>
                  <p className="mt-1 text-sm text-slate-500">Open QuickBooks balances on Sobrew invoices.</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-lg font-semibold text-rose-700">{usd(receivablesSummary.overdueCents)}</p>
                  <p className="text-sm text-slate-500">Overdue</p>
                  <p className="mt-2 text-lg font-semibold text-slate-950">{usd(receivablesSummary.notDueYetCents)}</p>
                  <p className="text-sm text-slate-500">Not due yet</p>
                </div>
              </div>
              <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-slate-200">
                <div className="bg-rose-500" style={{ width: `${overduePercent}%` }} />
                <div className="bg-slate-400" style={{ width: `${notDuePercent}%` }} />
              </div>
            </div>

            <div className="stat-card">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Paid</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">{usd(receivablesSummary.paidCents)}</p>
                  <p className="mt-1 text-sm text-slate-500">Paid Sobrew-created invoices in this view.</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-lg font-semibold text-emerald-700">{receivablesResult.invoices.filter((invoice) => invoice.status === 'paid').length}</p>
                  <p className="text-sm text-slate-500">Paid invoices</p>
                </div>
              </div>
              <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-slate-200">
                <div className="bg-emerald-500" style={{ width: `${paidPercent}%` }} />
              </div>
            </div>
          </div>

          {receivableOrdersResult.error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
              Unable to load local Sobrew invoices: {receivableOrdersResult.error.message}
            </div>
          ) : null}
          {receivablesResult.error ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {receivablesResult.error}
            </div>
          ) : null}
          {receivablesResult.missingIds.length ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {receivablesResult.missingIds.length} local invoice {receivablesResult.missingIds.length === 1 ? 'ID was' : 'IDs were'} not found in QuickBooks.
            </div>
          ) : null}
          {quickBooksStatus.connected ? (
            <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-950">Connected QuickBooks company</p>
              <p className="mt-1">
                {quickBooksCompanyInfo.companyName || 'Unknown company'}
                {quickBooksCompanyInfo.legalName && quickBooksCompanyInfo.legalName !== quickBooksCompanyInfo.companyName ? ` - ${quickBooksCompanyInfo.legalName}` : ''}
              </p>
              <p className="mt-1 break-all text-xs text-slate-500">Company ID {quickBooksCompanyInfo.realmId ?? quickBooksStatus.realmId}</p>
              {quickBooksCompanyInfo.error ? <p className="mt-2 text-sm font-medium text-amber-800">{quickBooksCompanyInfo.error}</p> : null}
            </div>
          ) : null}

          <div className="card space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">Accounts receivable</h2>
                <p className="mt-1 text-sm text-slate-500">Live QuickBooks balances for invoices created from Sobrew orders.</p>
              </div>
              <Link className="btn-secondary text-center" href="/admin/invoicing?view=accounts-receivable">Refresh balances</Link>
            </div>

            {quickBooksStatus.connected ? (
              receivableRows.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-[76rem] text-left text-sm">
                    <thead className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">No.</th>
                        <th className="px-3 py-2">Customer</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="w-44 px-3 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {receivableRows.map((row) => {
                        const receivable = row.receivable;
                        if (!receivable) return null;
                        const isPaid = receivable.status === 'paid';
                        const statusTone = isPaid
                          ? 'bg-emerald-100 text-emerald-800'
                          : receivable.timing === 'overdue'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800';
                        return (
                          <tr key={row.order.id} className="align-top">
                            <td className="px-3 py-3 text-slate-600">{formatDateOnly(receivable.txnDate ?? row.order.invoiced_at ?? row.order.created_at)}</td>
                            <td className="px-3 py-3">
                              <p className="font-mono text-sm font-semibold text-slate-950">{receivable.docNumber || invoiceNumberLabel(row.order)}</p>
                              <p className="mt-1 break-all font-mono text-xs text-slate-500">QB {receivable.id}</p>
                            </td>
                            <td className="px-3 py-3">
                              <p className="font-semibold text-slate-950">{receivable.customerName || customerLabel(row.order)}</p>
                              <p className="mt-1 text-xs text-slate-500">Order {row.order.id.slice(0, 8)}</p>
                            </td>
                            <td className="px-3 py-3 text-right">
                              <p className="font-semibold text-slate-950">{usd(receivable.amountCents)}</p>
                              {!isPaid ? <p className="mt-1 text-xs text-slate-500">{usd(receivable.balanceCents)} open</p> : null}
                            </td>
                            <td className="px-3 py-3">
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone}`}>
                                {receivable.statusLabel}
                              </span>
                              <p className="mt-1 text-xs text-slate-500">
                                {isPaid ? 'Paid in QuickBooks' : receivable.dueDate ? `Due ${formatDateOnly(receivable.dueDate)}` : 'No due date in QuickBooks'}
                              </p>
                            </td>
                            <td className="w-44 px-3 py-3">
                              <div className="flex w-full flex-col gap-2 sm:items-end">
                                <Link className="btn-secondary w-full whitespace-nowrap text-center text-xs" href={`/admin/orders/${row.order.id}`}>Order</Link>
                                {row.order.quickbooks_invoice_url ? (
                                  <a className="btn-secondary w-full whitespace-nowrap text-center text-xs" href={row.order.quickbooks_invoice_url} target="_blank" rel="noreferrer">QuickBooks</a>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-slate-500">No Sobrew-created QuickBooks invoices were found for accounts receivable.</p>
              )
            ) : (
              <p className="text-sm text-slate-500">Connect QuickBooks to pull live invoice balances.</p>
            )}
          </div>
        </div>
      ) : activeView === 'sent' ? (
        <div className="card space-y-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">Invoice archive</h2>
            <p className="mt-1 text-sm text-slate-500">Latest QuickBooks invoices created from the portal.</p>
          </div>

          {sentInvoices.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-[76rem] text-left text-sm">
                <thead className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Order</th>
                    <th className="px-3 py-2">Shipped</th>
                    <th className="px-3 py-2">Lines</th>
                    <th className="w-44 px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sentInvoices.map((order) => (
                    <tr key={order.id} className="align-top">
                      <td className="px-3 py-3">
                        <p className="font-mono text-sm font-semibold text-slate-950">{invoiceNumberLabel(order)}</p>
                        <p className="mt-1 break-all font-mono text-xs text-slate-500">QB {order.quickbooks_invoice_id}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-slate-950">{customerLabel(order)}</p>
                        <p className="mt-1 text-xs text-slate-500">{relatedOne(order.centers)?.quickbooks_display_name || 'Mapped QuickBooks customer'}</p>
                      </td>
                      <td className="px-3 py-3 font-semibold text-slate-950">{usd(Math.round(numericValue(order.subtotal_cents)))}</td>
                      <td className="px-3 py-3 text-slate-600">{formatTimestamp(order.quickbooks_invoice_email_sent_at ?? order.invoiced_at ?? null)}</td>
                      <td className="max-w-[14rem] break-all px-3 py-3 text-slate-600">{order.quickbooks_invoice_email_to || relatedOne(order.profiles)?.email || '—'}</td>
                      <td className="px-3 py-3 text-slate-600">{formatTimestamp(order.created_at)}</td>
                      <td className="px-3 py-3 text-slate-600">{formatTimestamp(order.shipped_at)}</td>
                      <td className="px-3 py-3 text-slate-600">{(order.order_items ?? []).length}</td>
                      <td className="w-44 px-3 py-3">
                        <div className="flex w-full flex-col gap-2 sm:items-end">
                          <Link className="btn-secondary w-full whitespace-nowrap text-center text-xs" href={`/admin/orders/${order.id}`}>Order</Link>
                          {order.quickbooks_invoice_url ? (
                            <a className="btn-secondary w-full whitespace-nowrap text-center text-xs" href={order.quickbooks_invoice_url} target="_blank" rel="noreferrer">QuickBooks</a>
                          ) : null}
                          <form action="/api/admin/quickbooks/invoices/download" method="post" className="w-full">
                            <input type="hidden" name="order_id" value={order.id} />
                            <input type="hidden" name="view" value="sent" />
                            <button
                              className="btn-secondary w-full whitespace-nowrap text-center text-xs disabled:opacity-60"
                              disabled={!canInvoice || !quickBooksStatus.connected}
                              type="submit"
                            >
                              Download PDF
                            </button>
                          </form>
                          <form action={resendQuickBooksInvoice} className="w-full">
                            <input type="hidden" name="order_id" value={order.id} />
                            <PendingSubmitButton
                              className="btn-secondary w-full whitespace-nowrap text-center text-xs"
                              disabled={!canInvoice || !quickBooksStatus.connected}
                              disabledLabel="Resend invoice"
                              label="Resend invoice"
                              pendingLabel="Resending..."
                            />
                          </form>
                          <form action={resendInvoicePdf} className="w-full">
                            <input type="hidden" name="order_id" value={order.id} />
                            <PendingSubmitButton
                              className="btn-secondary w-full whitespace-nowrap text-center text-xs"
                              disabled={!canInvoice || !quickBooksStatus.connected}
                              disabledLabel="Resend PDF"
                              label="Resend PDF"
                              pendingLabel="Sending PDF..."
                            />
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No QuickBooks invoices are archived yet.</p>
          )}
        </div>
      ) : activeView === 'sales-tax' ? (
        <div className="card space-y-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">Sales tax collection states</h2>
            <p className="mt-1 text-sm text-slate-500">For-profit centers shipping to these states will have QuickBooks invoice lines marked taxable. Tennessee is selected for in-state sales; add other states when Sobrew reaches nexus there.</p>
          </div>
          <form action={updateQuickBooksSalesTaxSettings} className="space-y-5">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {US_STATE_OPTIONS.map(([code, label]) => (
                <label key={code} className="flex min-h-[3rem] items-center gap-3 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" name="sales_tax_state" value={code} defaultChecked={salesTaxSettings.states.includes(code)} />
                  <span>{code} - {label}</span>
                </label>
              ))}
            </div>
            <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save Sales Tax States" pendingLabel="Saving..." />
          </form>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Mark each center&apos;s tax profile on the center detail page. Unknown and tax-exempt centers are sent to QuickBooks as non-taxable.
          </div>
        </div>
      ) : activeView === 'customers' ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Portal centers</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{activeCenters.length}</p>
              <p className="mt-1 text-sm text-slate-500">{centers.length - activeCenters.length} inactive</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Mapped</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{mappedCenters.length}</p>
              <p className="mt-1 text-sm text-slate-500">QuickBooks customers linked</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unmapped</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{unmappedCenters.length}</p>
              <p className="mt-1 text-sm text-slate-500">{customerErrorCount} errors</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">QuickBooks customers</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{quickBooksCustomerSummary.activeCustomerCount === null ? '—' : quickBooksCustomerSummary.activeCustomerCount}</p>
              <p className="mt-1 text-sm text-slate-500">{quickBooksStatus.connected ? quickBooksCustomerSummary.error ? 'Unavailable' : 'Active in QuickBooks' : 'Not connected'}</p>
            </div>
          </div>

          {errorDetail ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
              {errorDetail}
            </div>
          ) : null}
          {quickBooksCustomerSummary.error && quickBooksStatus.connected ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {quickBooksCustomerSummary.error}
            </div>
          ) : null}
          {quickBooksCustomersResult.error && quickBooksStatus.connected ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {quickBooksCustomersResult.error}
            </div>
          ) : null}
          {quickBooksCustomersResult.truncated ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              Showing the first {quickBooksCustomers.length} active QuickBooks customers. Use search later if the customer is beyond this pull.
            </div>
          ) : null}
          {quickBooksStatus.connected ? (
            <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-950">Connected QuickBooks company</p>
              <p className="mt-1">
                {quickBooksCompanyInfo.companyName || 'Unknown company'}
                {quickBooksCompanyInfo.legalName && quickBooksCompanyInfo.legalName !== quickBooksCompanyInfo.companyName ? ` - ${quickBooksCompanyInfo.legalName}` : ''}
              </p>
              <p className="mt-1 break-all text-xs text-slate-500">Company ID {quickBooksCompanyInfo.realmId ?? quickBooksStatus.realmId}</p>
              {quickBooksCompanyInfo.error ? <p className="mt-2 text-sm font-medium text-amber-800">{quickBooksCompanyInfo.error}</p> : null}
            </div>
          ) : null}

          <div className="card space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">Customer mapping</h2>
                <p className="mt-1 text-sm text-slate-500">Portal center names stay the same. QuickBooks enriches legal name, billing email, and billing address once a match is approved.</p>
              </div>
              <Link className="btn-secondary text-center" href="/admin/invoicing?view=customers">Refresh customers</Link>
            </div>

            {quickBooksStatus.connected ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Portal center</th>
                      <th className="px-3 py-2">Current QuickBooks link</th>
                      <th className="px-3 py-2">Suggested match</th>
                      <th className="px-3 py-2">Manual link</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {centers.map((center) => {
                      const mappedCustomer = center.quickbooks_customer_id ? customerById.get(center.quickbooks_customer_id) ?? null : null;
                      const suggestion = customerMatchByCenterId.get(center.id);
                      const suggestedCustomer = suggestion?.customer ?? null;
                      const isMapped = Boolean(center.quickbooks_customer_id);
                      return (
                        <tr key={center.id} id={`qb-center-${center.id}`} className="scroll-mt-24 align-top">
                          <td className="min-w-[220px] px-3 py-3">
                            <p className="font-semibold text-slate-950">{center.name}</p>
                            {center.legal_name && center.legal_name !== center.name ? <p className="mt-1 text-xs text-slate-500">Legal: {center.legal_name}</p> : null}
                            {center.billing_email ? <p className="mt-1 break-all text-xs text-slate-500">{center.billing_email}</p> : null}
                            {centerBillingAddressLabel(center) ? <p className="mt-1 text-xs text-slate-500">{centerBillingAddressLabel(center)}</p> : null}
                            <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${center.is_active === false ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-800'}`}>
                              {center.is_active === false ? 'Inactive' : 'Active'}
                            </span>
                          </td>
                          <td className="min-w-[220px] px-3 py-3">
                            {isMapped ? (
                              <div>
                                <p className="font-semibold text-slate-950">{center.quickbooks_display_name || mappedCustomer?.displayName || center.quickbooks_customer_id}</p>
                                {center.quickbooks_company_name && center.quickbooks_company_name !== center.quickbooks_display_name ? <p className="mt-1 text-xs text-slate-500">{center.quickbooks_company_name}</p> : null}
                                <p className="mt-1 break-all font-mono text-xs text-slate-500">{center.quickbooks_customer_id}</p>
                                {center.quickbooks_synced_at ? <p className="mt-1 text-xs text-slate-500">Synced {formatTimestamp(center.quickbooks_synced_at)}</p> : null}
                              </div>
                            ) : (
                              <span className="text-slate-500">Not mapped</span>
                            )}
                          </td>
                          <td className="min-w-[260px] px-3 py-3">
                            {suggestedCustomer ? (
                              <div className="space-y-2">
                                <div>
                                  <p className="font-semibold text-slate-950">{quickBooksCustomerLabel(suggestedCustomer)}</p>
                                  {quickBooksCustomerAddressLabel(suggestedCustomer) ? <p className="mt-1 text-xs text-slate-500">{quickBooksCustomerAddressLabel(suggestedCustomer)}</p> : null}
                                  <p className="mt-1 text-xs text-slate-500">Score {suggestion?.score ?? 0} · {(suggestion?.reasons ?? []).join(', ')}</p>
                                </div>
                                {!isMapped ? (
                                  <form action={linkQuickBooksCustomer} className="space-y-2">
                                    <input type="hidden" name="center_id" value={center.id} />
                                    <input type="hidden" name="quickbooks_customer_id" value={suggestedCustomer.id} />
                                    <input type="hidden" name="quickbooks_mapping_note" value={`Approved suggested match: ${(suggestion?.reasons ?? []).join(', ')}`} />
                                    <PendingSubmitButton
                                      className="btn-primary w-full"
                                      disabled={!canInvoice}
                                      label="Approve match"
                                      pendingLabel="Saving..."
                                    />
                                  </form>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-slate-500">No strong suggestion</span>
                            )}
                          </td>
                          <td className="min-w-[280px] px-3 py-3">
                            <form action={linkQuickBooksCustomer} className="space-y-2">
                              <input type="hidden" name="center_id" value={center.id} />
                              <select className="input h-11" name="quickbooks_customer_id" defaultValue={center.quickbooks_customer_id ?? suggestedCustomer?.id ?? ''}>
                                <option value="">Choose QuickBooks customer</option>
                                {quickBooksCustomers.map((customer) => (
                                  <option key={customer.id} value={customer.id}>
                                    {quickBooksCustomerLabel(customer)}
                                  </option>
                                ))}
                              </select>
                              <input className="input h-11" name="quickbooks_mapping_note" placeholder="Mapping note" defaultValue={center.quickbooks_mapping_note ?? ''} />
                              <PendingSubmitButton
                                className="btn-secondary w-full"
                                disabled={!canInvoice || !quickBooksCustomers.length}
                                label="Save manual link"
                                pendingLabel="Saving..."
                              />
                            </form>
                          </td>
                          <td className="min-w-[150px] px-3 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${center.quickbooks_sync_status === 'sync_error' ? 'bg-rose-100 text-rose-800' : isMapped ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                              {(center.quickbooks_sync_status ?? 'unmapped').replaceAll('_', ' ')}
                            </span>
                            {center.quickbooks_sync_error ? <p className="mt-2 text-xs font-medium text-rose-700">{center.quickbooks_sync_error}</p> : null}
                            {!isMapped ? (
                              <form action={createQuickBooksCustomer} className="mt-3">
                                <input type="hidden" name="center_id" value={center.id} />
                                <PendingSubmitButton
                                  className="btn-primary w-full"
                                  disabled={!canInvoice || !quickBooksStatus.connected}
                                  label="Create in QuickBooks"
                                  pendingLabel="Creating..."
                                />
                              </form>
                            ) : (
                              <form action={clearQuickBooksCustomerMapping} className="mt-3">
                                <input type="hidden" name="center_id" value={center.id} />
                                <PendingSubmitButton
                                  className="rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
                                  disabled={!canInvoice}
                                  label="Clear link"
                                  pendingLabel="Clearing..."
                                />
                              </form>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Connect QuickBooks to pull customers and approve mappings.</p>
            )}

            {quickBooksStatus.connected && !centers.length ? <p className="text-sm text-slate-500">No portal centers found.</p> : null}
            {quickBooksStatus.connected && !quickBooksCustomers.length && !quickBooksCustomersResult.error ? <p className="text-sm text-slate-500">No active QuickBooks customers found.</p> : null}
          </div>
        </div>
      ) : activeView === 'products' ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Portal products</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{activeProducts.length}</p>
              <p className="mt-1 text-sm text-slate-500">{products.length - activeProducts.length} inactive</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Mapped</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{mappedProducts.length}</p>
              <p className="mt-1 text-sm text-slate-500">{ignoredProducts.length} ignored</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unmapped</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{unmappedProducts.length}</p>
              <p className="mt-1 text-sm text-slate-500">{productErrorCount} errors</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">QuickBooks items</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{quickBooksProductSummary.activeItemCount === null ? '—' : quickBooksProductSummary.activeItemCount}</p>
              <p className="mt-1 text-sm text-slate-500">{quickBooksStatus.connected ? quickBooksProductSummary.error ? 'Unavailable' : 'Active in QuickBooks' : 'Not connected'}</p>
            </div>
          </div>

          {quickBooksProductSummary.error && quickBooksStatus.connected ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {quickBooksProductSummary.error}
            </div>
          ) : null}
          {errorDetail ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
              {errorDetail}
            </div>
          ) : null}
          {resetStatus?.quickbooks_product_reset_error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-900">
              <p>Last reset error{resetStatus.quickbooks_product_reset_error_at ? ` (${formatTimestamp(resetStatus.quickbooks_product_reset_error_at)})` : ''}:</p>
              <p className="mt-1">{resetStatus.quickbooks_product_reset_error}</p>
            </div>
          ) : null}
          {resetStatus?.quickbooks_product_reset_last_result ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
              Last reset: {String(resetStatus.quickbooks_product_reset_last_result.inactivatedCount ?? 0)} QuickBooks items inactivated, {String(resetStatus.quickbooks_product_reset_last_result.createdCount ?? 0)} portal products created, {String(resetStatus.quickbooks_product_reset_last_result.archiveErrorCount ?? 0)} archive errors, {String(resetStatus.quickbooks_product_reset_last_result.productErrorCount ?? 0)} product errors.
              {Array.isArray(resetStatus.quickbooks_product_reset_last_result.archiveErrors) && resetStatus.quickbooks_product_reset_last_result.archiveErrors.length ? (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {resetStatus.quickbooks_product_reset_last_result.archiveErrors.map((error, index) => (
                    <li key={`${index}-${String(error).slice(0, 40)}`}>{String(error)}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {quickBooksItemsResult.error && quickBooksStatus.connected ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
              {quickBooksItemsResult.error}
            </div>
          ) : null}
          {quickBooksStatus.connected ? (
            <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">
              <p className="font-semibold text-slate-950">Connected QuickBooks company</p>
              <p className="mt-1">
                {quickBooksCompanyInfo.companyName || 'Unknown company'}
                {quickBooksCompanyInfo.legalName && quickBooksCompanyInfo.legalName !== quickBooksCompanyInfo.companyName ? ` - ${quickBooksCompanyInfo.legalName}` : ''}
              </p>
              <p className="mt-1 break-all text-xs text-slate-500">Company ID {quickBooksCompanyInfo.realmId ?? quickBooksStatus.realmId}</p>
              {quickBooksCompanyInfo.error ? <p className="mt-2 text-sm font-medium text-amber-800">{quickBooksCompanyInfo.error}</p> : null}
              <p className="mt-2 text-sm text-slate-500">If this is not your Sobrew QuickBooks company, disconnect and reconnect the correct company before previewing the product reset.</p>
            </div>
          ) : null}

          <div className="card space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">Product sync</h2>
                <p className="mt-1 text-sm text-slate-500">This reset archives active QuickBooks products and creates new QuickBooks items from active portal products.</p>
              </div>
              <Link className="btn-secondary text-center" href="/admin/invoicing?view=products">Refresh preview</Link>
            </div>

            <QuickBooksProductResetForm
              action={resetQuickBooksProducts}
              activeProductCount={activeProducts.length}
              disabledReason={productResetDisabledReasons.join(' ')}
              environment={quickBooksStatus.environment}
            />

            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">SKU</th>
                    <th className="px-3 py-2">Portal</th>
                    <th className="px-3 py-2">QuickBooks</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {products.map((product) => {
                    const mapped = Boolean(product.quickbooks_item_id);
                    const status = product.quickbooks_sync_status ?? 'unmapped';
                    return (
                      <tr key={product.id} className="align-top">
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-950">{product.name}</p>
                          {product.category ? <p className="mt-1 text-xs text-slate-500">{product.category}</p> : null}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-600">{product.sku || '—'}</td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${product.active === false ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-800'}`}>
                            {product.active === false ? 'Inactive' : 'Active'}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {mapped ? (
                            <div>
                              <p className="font-semibold text-slate-950">{product.quickbooks_item_name || product.name}</p>
                              <p className="mt-1 break-all text-xs text-slate-500">{product.quickbooks_item_id}</p>
                            </div>
                          ) : (
                            <span className="text-slate-500">Not mapped</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'sync_error' ? 'bg-rose-100 text-rose-800' : mapped ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                            {status.replaceAll('_', ' ')}
                          </span>
                          {product.quickbooks_sync_error ? <p className="mt-2 text-xs font-medium text-rose-700">{product.quickbooks_sync_error}</p> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!products.length ? <p className="text-sm text-slate-500">No portal products found.</p> : null}
          </div>

          <div className="card space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">Existing QuickBooks products</h2>
                <p className="mt-1 text-sm text-slate-500">Active QuickBooks items pulled from the connected company.</p>
              </div>
              {quickBooksItemsResult.truncated ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Showing first {quickBooksItems.length}</span>
              ) : null}
            </div>

            {quickBooksStatus.connected ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                      <th className="px-3 py-2">QuickBooks item</th>
                      <th className="px-3 py-2">SKU</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {quickBooksItems.map((item) => (
                      <tr key={item.id} className="align-top">
                        <td className="px-3 py-3">
                          <p className="font-semibold text-slate-950">{item.name}</p>
                          {item.fullyQualifiedName && item.fullyQualifiedName !== item.name ? (
                            <p className="mt-1 text-xs text-slate-500">{item.fullyQualifiedName}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-slate-600">{item.sku || '—'}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{item.type || 'Item'}</span>
                        </td>
                        <td className="px-3 py-3 break-all font-mono text-xs text-slate-500">{item.id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Connect QuickBooks to pull existing products.</p>
            )}

            {quickBooksStatus.connected && !quickBooksItems.length && !quickBooksItemsResult.error ? (
              <p className="text-sm text-slate-500">No active QuickBooks products found.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
        {orders.map((order) => {
          const isBusy = order.invoice_status === 'invoicing';
          const hasError = order.invoice_status === 'invoice_error';
          const missingMappedProducts = missingOrderProductMappings(order);
          const isTaxable = shouldCollectQuickBooksSalesTax(order, salesTaxSettings.states);
          const center = relatedOne(order.centers);
          const missingCustomerMapping = missingOrderCustomerMapping(order);
          const mappingBlocked = missingCustomerMapping || missingMappedProducts.length > 0;
          const noInvoiceableItems = invoiceableLineItemCount(order) === 0;
          const readyToInvoice = orderIsReadyToInvoice(order);
          const taxStatus = center?.customer_tax_status === 'for_profit'
            ? 'For-profit'
            : center?.customer_tax_status === 'tax_exempt'
              ? 'Tax-exempt'
              : 'Tax profile unknown';
          return (
            <article key={order.id} className="card space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-xl font-semibold tracking-tight text-slate-950">{customerLabel(order)}</h2>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hasError ? 'bg-rose-100 text-rose-800' : isBusy ? 'bg-slate-100 text-slate-700' : mappingBlocked || noInvoiceableItems ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {hasError ? 'Invoice error' : isBusy ? 'Invoicing' : noInvoiceableItems ? 'No invoiceable items' : mappingBlocked ? 'Needs mapping' : 'Ready to invoice'}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isTaxable ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'}`}>
                      {isTaxable ? 'Taxable in QuickBooks' : 'Non-taxable in QuickBooks'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">Shipped {formatTimestamp(order.shipped_at)} · Ordered {formatTimestamp(order.created_at)}</p>
                  <p className="mt-1 text-sm text-slate-500">{taxStatus} · Ship-to state {order.shipping_state || 'missing'}</p>
                  <p className="mt-1 break-all text-sm text-slate-500">Order {order.id}</p>
                  {order.quickbooks_invoice_id ? (
                    <p className="mt-1 text-sm text-slate-500">
                      QuickBooks invoice <span className="font-mono font-semibold text-slate-700">{invoiceNumberLabel(order)}</span>
                    </p>
                  ) : null}
                </div>
                <div className="text-left lg:text-right">
                  <p className="text-2xl font-semibold text-slate-950">{usd(Math.round(numericValue(order.subtotal_cents)))}</p>
                  <p className="mt-1 text-sm text-slate-500">{(order.order_items ?? []).length} line items</p>
                </div>
              </div>

              <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
                {(order.order_items ?? []).slice(0, 6).map((item, index) => (
                  <div key={`${order.id}-${index}`} className="rounded-xl border border-slate-200 bg-white/65 px-3 py-2">
                    <p className="font-semibold text-slate-950">{productLabel(item)}</p>
                    <p className="mt-1">Qty {numericValue(item.qty).toLocaleString()} · {usd(Math.round(numericValue(item.line_total_cents)))}</p>
                  </div>
                ))}
              </div>

              {order.invoice_error ? <p className="text-sm font-medium text-rose-700">{order.invoice_error}</p> : null}
              {missingMappedProducts.length ? (
                <p className="text-sm font-medium text-amber-700">
                  Needs QuickBooks product mapping: {[...new Set(missingMappedProducts)].join(', ')}
                </p>
              ) : null}
              {missingCustomerMapping ? (
                <p className="text-sm font-medium text-amber-700">
                  Needs QuickBooks customer mapping for {customerLabel(order)}.
                </p>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Link className="btn-secondary text-center" href={`/admin/orders/${order.id}`}>Open order</Link>
                {missingCustomerMapping ? <Link className="btn-secondary text-center" href="/admin/invoicing?view=customers">Map customer</Link> : null}
                {missingMappedProducts.length ? <Link className="btn-secondary text-center" href="/admin/invoicing?view=products">Map products</Link> : null}
                <form action={invoiceOrder}>
                  <input type="hidden" name="order_id" value={order.id} />
                  <PendingSubmitButton
                    className="btn-primary w-full sm:w-auto"
                    disabled={!canInvoice || !readyToInvoice || !quickBooksStatus.connected || Boolean(quickBooksStatus.missingConfig.length)}
                    disabledLabel={isBusy ? 'Invoicing...' : noInvoiceableItems ? 'No invoiceable items' : mappingBlocked ? 'Needs mapping' : 'Create & send invoice'}
                    label="Create & send invoice"
                    pendingLabel="Invoicing..."
                  />
                </form>
                <form action={invoiceOrder}>
                  <input type="hidden" name="order_id" value={order.id} />
                  <input type="hidden" name="delivery" value="pdf" />
                  <PendingSubmitButton
                    className="btn-secondary w-full sm:w-auto"
                    disabled={!canInvoice || !readyToInvoice || !quickBooksStatus.connected || Boolean(quickBooksStatus.missingConfig.length)}
                    disabledLabel={isBusy ? 'Invoicing...' : noInvoiceableItems ? 'No invoiceable items' : mappingBlocked ? 'Needs mapping' : 'Send PDF'}
                    label="Create & send PDF"
                    pendingLabel="Sending PDF..."
                  />
                </form>
                <form action="/api/admin/quickbooks/invoices/download" method="post">
                  <input type="hidden" name="order_id" value={order.id} />
                  <button
                    className="btn-secondary w-full sm:w-auto disabled:opacity-60"
                    disabled={!canInvoice || !readyToInvoice || !quickBooksStatus.connected || Boolean(quickBooksStatus.missingConfig.length)}
                    type="submit"
                  >
                    Create & download PDF
                  </button>
                </form>
              </div>
            </article>
          );
        })}
          </div>

          {!orders.length ? (
            <div className="card text-sm text-slate-600">
              No shipped orders are ready to invoice today.
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

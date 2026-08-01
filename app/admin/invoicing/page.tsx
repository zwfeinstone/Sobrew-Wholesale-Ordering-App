import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import { QuickBooksProductResetForm } from '@/components/quickbooks-product-reset-form';
import StatusToast from '@/components/status-toast';
import { adminCanEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  createQuickBooksInvoiceForOrder,
  disconnectQuickBooksConnection,
  getQuickBooksActiveItems,
  getQuickBooksCompanyInfo,
  getQuickBooksConnectionStatus,
  getQuickBooksProductSummary,
  getQuickBooksSalesTaxSettings,
  QuickBooksConfigurationError,
  resetQuickBooksProductsFromPortal,
  saveQuickBooksSalesTaxSettings,
  shouldCollectQuickBooksSalesTax,
} from '@/lib/quickbooks';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const INVOICING_TIME_ZONE = 'America/Chicago';
const INVOICING_VIEWS = [
  { id: 'queue', label: 'Ready to Invoice' },
  { id: 'products', label: 'Products' },
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

type InvoiceQueueOrder = {
  centers?: { customer_tax_status?: string | null; name: string | null } | { customer_tax_status?: string | null; name: string | null }[] | null;
  created_at: string | null;
  id: string;
  invoice_error: string | null;
  invoice_status: string | null;
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

function invoicingHref(toast?: string) {
  if (!toast) return '/admin/invoicing';
  return `/admin/invoicing?${new URLSearchParams({ toast }).toString()}`;
}

function invoicingViewParam(value: string | string[] | undefined): InvoicingView {
  return INVOICING_VIEWS.some((view) => view.id === value) ? value as InvoicingView : 'queue';
}

function invoicingViewHref(view: InvoicingView) {
  if (view === 'queue') return '/admin/invoicing';
  return `/admin/invoicing?${new URLSearchParams({ view }).toString()}`;
}

function toastMessage(toast: string) {
  const messages: Record<string, { message: string; tone: 'error' | 'success' }> = {
    admin_write_denied: { message: 'You do not have permission to invoice orders.', tone: 'error' },
    invoice_already_created: { message: 'That order already has a QuickBooks invoice.', tone: 'success' },
    invoice_created: { message: 'QuickBooks invoice created.', tone: 'success' },
    invoice_failed: { message: 'Unable to create that QuickBooks invoice.', tone: 'error' },
    invoice_not_ready: { message: 'Only shipped orders from today or later can be invoiced here.', tone: 'error' },
    product_reset_confirm_required: { message: 'Confirm the live QuickBooks product reset before running it.', tone: 'error' },
    product_reset_failed: { message: 'Unable to reset QuickBooks products.', tone: 'error' },
    product_reset_saved: { message: 'QuickBooks products reset from portal products.', tone: 'success' },
    product_reset_with_errors: { message: 'QuickBooks product reset finished, but some portal products need review.', tone: 'error' },
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
  const view = String(formData.get('view') ?? '').trim() === 'products' ? 'products' : 'queue';
  await disconnectQuickBooksConnection();
  redirect(`${invoicingViewHref(view)}${view === 'queue' ? '?' : '&'}toast=quickbooks_disconnected`);
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
    toast = result.productErrorCount ? 'product_reset_with_errors' : 'product_reset_saved';
  } catch (error) {
    console.error('[invoicing] product reset failed', error);
    redirect('/admin/invoicing?view=products&toast=product_reset_failed');
  }
  redirect(`/admin/invoicing?view=products&toast=${toast}`);
}

async function invoiceOrder(formData: FormData) {
  'use server';
  const orderId = String(formData.get('order_id') ?? '').trim();
  await requireAdminWriteAccess(invoicingHref('admin_write_denied'), 'invoicing');
  if (!orderId) redirect(invoicingHref('invoice_not_ready'));

  const supabase = getSupabaseAdmin();
  const startIso = todayStartIso();
  const { data: order } = await supabase
    .from('orders')
    .select('id,status,archived_at,created_at,quickbooks_invoice_id,invoice_status')
    .eq('id', orderId)
    .single();

  if (!order || order.archived_at || order.status !== 'Shipped' || !order.created_at || new Date(order.created_at) < new Date(startIso)) {
    redirect(invoicingHref('invoice_not_ready'));
  }
  if (order.quickbooks_invoice_id) redirect(invoicingHref('invoice_already_created'));

  const claimResult = await supabase
    .from('orders')
    .update({ invoice_error: null, invoice_status: 'invoicing' })
    .eq('id', orderId)
    .eq('status', 'Shipped')
    .is('archived_at', null)
    .is('quickbooks_invoice_id', null)
    .in('invoice_status', ['not_invoiced', 'invoice_error'])
    .select('id')
    .single();

  if (claimResult.error || !claimResult.data) redirect(invoicingHref('invoice_already_created'));

  try {
    const invoice = await createQuickBooksInvoiceForOrder(orderId);
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        invoice_error: null,
        invoice_status: 'invoiced',
        invoiced_at: new Date().toISOString(),
        quickbooks_invoice_doc_number: invoice.docNumber,
        quickbooks_invoice_id: invoice.id,
        quickbooks_invoice_url: invoice.url,
      })
      .eq('id', orderId);
    if (updateError) throw updateError;
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
  redirect(invoicingHref('invoice_created'));
}

export default async function AdminInvoicingPage({ searchParams }: { searchParams?: SearchParams }) {
  const current = await requireAdminSectionView('invoicing');
  const canInvoice = adminCanEdit(current.access, 'invoicing');
  const activeView = invoicingViewParam(searchParams?.view);
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const selectedToast = toastMessage(toast);
  const startIso = todayStartIso();
  const supabase = await createClient();
  const [quickBooksStatus, quickBooksCompanyInfo, quickBooksProductSummary, quickBooksItemsResult, salesTaxSettings, ordersResult, productsResult] = await Promise.all([
    getQuickBooksConnectionStatus(),
    activeView === 'products' ? getQuickBooksCompanyInfo() : Promise.resolve({ companyName: null, email: null, error: null, legalName: null, realmId: null }),
    activeView === 'products' ? getQuickBooksProductSummary() : Promise.resolve({ activeItemCount: null, error: null }),
    activeView === 'products' ? getQuickBooksActiveItems() : Promise.resolve({ error: null, items: [], truncated: false }),
    getQuickBooksSalesTaxSettings(),
    supabase
      .from('orders')
      .select('id,created_at,shipped_at,subtotal_cents,shipping_company,shipping_name,shipping_state,invoice_status,invoice_error,profiles(email,full_name),centers(name,customer_tax_status),order_items(qty,line_total_cents,product_name_snapshot,products(name,sku,quickbooks_item_id))')
      .eq('status', 'Shipped')
      .is('archived_at', null)
      .is('quickbooks_invoice_id', null)
      .gte('created_at', startIso)
      .order('shipped_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    activeView === 'products'
      ? supabase
          .from('products')
          .select('id,name,sku,description,category,active,quickbooks_item_id,quickbooks_item_name,quickbooks_item_type,quickbooks_sync_status,quickbooks_synced_at,quickbooks_sync_error')
          .order('active', { ascending: false })
          .order('name', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const orders = (ordersResult.data ?? []) as InvoiceQueueOrder[];
  const products = (productsResult.data ?? []) as ProductSyncRow[];
  const quickBooksItems = quickBooksItemsResult.items;
  const readyOrders = orders.filter((order) => order.invoice_status !== 'invoicing');
  const totalReadyCents = readyOrders.reduce((sum, order) => sum + Math.max(0, numericValue(order.subtotal_cents)), 0);
  const waitingCount = orders.filter((order) => order.invoice_status === 'invoicing').length;
  const activeProducts = products.filter((product) => product.active !== false);
  const mappedProducts = activeProducts.filter((product) => Boolean(product.quickbooks_item_id));
  const unmappedProducts = activeProducts.filter((product) => !product.quickbooks_item_id && product.quickbooks_sync_status !== 'ignored');
  const ignoredProducts = activeProducts.filter((product) => product.quickbooks_sync_status === 'ignored');
  const productErrorCount = activeProducts.filter((product) => product.quickbooks_sync_status === 'sync_error').length;
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

      <div className="grid gap-4 md:grid-cols-3">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ready</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{readyOrders.length}</p>
          <p className="mt-1 text-sm text-slate-500">{usd(totalReadyCents)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">QuickBooks</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{quickBooksStatus.environment === 'production' ? 'Live' : 'Sandbox'}</p>
          <p className="mt-1 text-sm text-slate-500">{quickBooksCompanyInfo.companyName ?? quickBooksStatus.realmId ?? 'Not connected'}</p>
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

      <nav className="grid gap-2 sm:grid-cols-3" aria-label="Invoicing views">
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

      {activeView === 'sales-tax' ? (
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
          const missingMappedProducts = (order.order_items ?? [])
            .filter((item) => !cleanText(relatedOne(item.products)?.quickbooks_item_id))
            .map(productLabel);
          const isTaxable = shouldCollectQuickBooksSalesTax(order, salesTaxSettings.states);
          const center = relatedOne(order.centers);
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
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${hasError ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                      {hasError ? 'Invoice error' : isBusy ? 'Invoicing' : 'Ready to invoice'}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isTaxable ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'}`}>
                      {isTaxable ? 'Taxable in QuickBooks' : 'Non-taxable in QuickBooks'}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">Shipped {formatTimestamp(order.shipped_at)} · Ordered {formatTimestamp(order.created_at)}</p>
                  <p className="mt-1 text-sm text-slate-500">{taxStatus} · Ship-to state {order.shipping_state || 'missing'}</p>
                  <p className="mt-1 break-all text-sm text-slate-500">Order {order.id}</p>
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

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Link className="btn-secondary text-center" href={`/admin/orders/${order.id}`}>Open order</Link>
                <form action={invoiceOrder}>
                  <input type="hidden" name="order_id" value={order.id} />
                  <PendingSubmitButton
                    className="btn-primary w-full sm:w-auto"
                    disabled={!canInvoice || isBusy || !quickBooksStatus.connected || Boolean(quickBooksStatus.missingConfig.length) || Boolean(missingMappedProducts.length)}
                    disabledLabel={isBusy ? 'Invoicing...' : missingMappedProducts.length ? 'Needs mapping' : 'Invoice'}
                    label="Invoice"
                    pendingLabel="Invoicing..."
                  />
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

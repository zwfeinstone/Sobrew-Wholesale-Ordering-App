import 'server-only';

import { env } from '@/lib/env';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const QUICKBOOKS_CONNECTION_ID = 'default';
const QUICKBOOKS_ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';
const DEFAULT_QUICKBOOKS_SALES_TAX_STATES = ['TN'];
const QUICKBOOKS_LINE_TAXABLE_CODE = 'TAX';
const QUICKBOOKS_LINE_NON_TAXABLE_CODE = 'NON';
const QUICKBOOKS_TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

type QuickBooksEnvironment = 'production' | 'sandbox';
type CustomerTaxStatus = 'unknown' | 'for_profit' | 'tax_exempt';

type QuickBooksConnection = {
  access_token: string;
  access_token_expires_at: string;
  environment: QuickBooksEnvironment | string;
  realm_id: string;
  refresh_token: string;
};

type QuickBooksTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  x_refresh_token_expires_in?: number;
};

type QuickBooksRef = {
  name?: string;
  value: string;
};

type QuickBooksOrderItem = {
  line_total_cents: number | string;
  product_name_snapshot: string | null;
  products?: { name: string | null; sku: string | null } | { name: string | null; sku: string | null }[] | null;
  qty: number | string;
  unit_price_cents: number | string;
};

type QuickBooksInvoiceCenter = {
  customer_tax_status?: CustomerTaxStatus | string | null;
  name: string | null;
};

type QuickBooksSalesTaxOrder = {
  centers?: QuickBooksInvoiceCenter | QuickBooksInvoiceCenter[] | null;
  shipping_state: string | null;
};

type QuickBooksInvoiceOrder = {
  centers?: QuickBooksInvoiceCenter | QuickBooksInvoiceCenter[] | null;
  created_at: string | null;
  id: string;
  notes: string | null;
  order_items?: QuickBooksOrderItem[] | null;
  profiles?: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_company?: string | null;
  shipping_name: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
};

export type QuickBooksConnectionStatus = {
  connected: boolean;
  environment: QuickBooksEnvironment;
  missingConfig: string[];
  realmId: string | null;
};

export type QuickBooksCompanyInfo = {
  companyName: string | null;
  email: string | null;
  error: string | null;
  legalName: string | null;
  realmId: string | null;
};

export type CreatedQuickBooksInvoice = {
  docNumber: string | null;
  id: string;
  url: string | null;
};

export type QuickBooksProductSummary = {
  activeItemCount: number | null;
  error: string | null;
};

export type QuickBooksCatalogItem = {
  active: boolean;
  fullyQualifiedName: string | null;
  id: string;
  name: string;
  sku: string | null;
  syncToken: string | null;
  type: string | null;
};

export type QuickBooksCatalogItemsResult = {
  error: string | null;
  items: QuickBooksCatalogItem[];
  truncated: boolean;
};

export type QuickBooksSalesTaxSettings = {
  states: string[];
};

export class QuickBooksConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuickBooksConfigurationError';
  }
}

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

function amountFromCents(value: number | string | null | undefined) {
  return Number((numericValue(value) / 100).toFixed(2));
}

function normalizeStateCode(value: unknown) {
  return cleanText(value).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
}

function normalizeSalesTaxStates(states: unknown) {
  const values = Array.isArray(states) ? states : DEFAULT_QUICKBOOKS_SALES_TAX_STATES;
  const normalized = values
    .map(normalizeStateCode)
    .filter((state) => /^[A-Z]{2}$/.test(state));
  return [...new Set(normalized)].sort();
}

export function shouldCollectQuickBooksSalesTax(order: QuickBooksSalesTaxOrder, taxableStates: string[]) {
  const center = relatedOne(order.centers);
  if (center?.customer_tax_status !== 'for_profit') return false;
  const shippingState = normalizeStateCode(order.shipping_state);
  return Boolean(shippingState && normalizeSalesTaxStates(taxableStates).includes(shippingState));
}

function getQuickBooksEnvironment(): QuickBooksEnvironment {
  return env.quickBooksEnvironment === 'production' ? 'production' : 'sandbox';
}

function quickBooksApiBaseUrl(environment: QuickBooksEnvironment) {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function quickBooksAppInvoiceUrl(environment: QuickBooksEnvironment, invoiceId: string) {
  const host = environment === 'production' ? 'app.qbo.intuit.com' : 'app.sandbox.qbo.intuit.com';
  return `https://${host}/app/invoice?txnId=${encodeURIComponent(invoiceId)}`;
}

function configuredRedirectUri() {
  return env.quickBooksRedirectUri || `${env.siteUrl.replace(/\/$/, '')}/api/admin/quickbooks/callback`;
}

function getOAuthConfig() {
  const missingConfig: string[] = [];
  if (!env.quickBooksClientId) missingConfig.push('QUICKBOOKS_CLIENT_ID');
  if (!env.quickBooksClientSecret) missingConfig.push('QUICKBOOKS_CLIENT_SECRET');
  return {
    clientId: env.quickBooksClientId,
    clientSecret: env.quickBooksClientSecret,
    environment: getQuickBooksEnvironment(),
    missingConfig,
    redirectUri: configuredRedirectUri(),
  };
}

function requireOAuthConfig() {
  const config = getOAuthConfig();
  if (config.missingConfig.length) {
    throw new QuickBooksConfigurationError(`Missing QuickBooks config: ${config.missingConfig.join(', ')}`);
  }
  return config;
}

function basicAuth(clientId: string, clientSecret: string) {
  return Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
}

function tokenExpiry(secondsFromNow: number | undefined) {
  return new Date(Date.now() + Math.max(0, Number(secondsFromNow ?? 0)) * 1000).toISOString();
}

async function parseJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function quickBooksErrorMessage(payload: any, fallback: string, intuitTid?: string | null) {
  const faultError = payload?.Fault?.Error?.[0];
  const message = cleanText(faultError?.Message) || cleanText(faultError?.Detail) || cleanText(payload?.error_description) || cleanText(payload?.error) || fallback;
  return intuitTid ? `${message} (QuickBooks request ${intuitTid})` : message;
}

async function tokenRequest(body: URLSearchParams) {
  const config = requireOAuthConfig();
  const response = await fetch(QUICKBOOKS_TOKEN_ENDPOINT, {
    body,
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${basicAuth(config.clientId, config.clientSecret)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    method: 'POST',
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(quickBooksErrorMessage(payload, 'QuickBooks authorization failed.', response.headers.get('intuit_tid')));
  }
  return payload as QuickBooksTokenResponse;
}

export function buildQuickBooksAuthorizationUrl(state: string) {
  const config = requireOAuthConfig();
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: QUICKBOOKS_ACCOUNTING_SCOPE,
    state,
  });
  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

export async function exchangeQuickBooksAuthorizationCode({
  code,
  connectedBy,
  realmId,
}: {
  code: string;
  connectedBy: string;
  realmId: string;
}) {
  const config = requireOAuthConfig();
  const token = await tokenRequest(new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: config.redirectUri,
  }));

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('quickbooks_connections').upsert({
    access_token: token.access_token,
    access_token_expires_at: tokenExpiry(token.expires_in),
    connected_at: new Date().toISOString(),
    connected_by: connectedBy,
    environment: config.environment,
    id: QUICKBOOKS_CONNECTION_ID,
    realm_id: realmId,
    refresh_token: token.refresh_token,
    refresh_token_expires_at: token.x_refresh_token_expires_in ? tokenExpiry(token.x_refresh_token_expires_in) : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(`Unable to save QuickBooks connection: ${error.message}`);
}

async function getStoredConnection(): Promise<QuickBooksConnection | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('quickbooks_connections')
    .select('realm_id,environment,access_token,refresh_token,access_token_expires_at')
    .eq('id', QUICKBOOKS_CONNECTION_ID)
    .maybeSingle();
  if (error) throw new Error(`Unable to read QuickBooks connection: ${error.message}`);
  return data as QuickBooksConnection | null;
}

async function refreshConnection(connection: QuickBooksConnection) {
  const token = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: connection.refresh_token,
  }));
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('quickbooks_connections')
    .update({
      access_token: token.access_token,
      access_token_expires_at: tokenExpiry(token.expires_in),
      refresh_token: token.refresh_token,
      refresh_token_expires_at: token.x_refresh_token_expires_in ? tokenExpiry(token.x_refresh_token_expires_in) : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', QUICKBOOKS_CONNECTION_ID);
  if (error) throw new Error(`Unable to refresh QuickBooks connection: ${error.message}`);
  return {
    ...connection,
    access_token: token.access_token,
    access_token_expires_at: tokenExpiry(token.expires_in),
    refresh_token: token.refresh_token,
  };
}

async function getAuthorizedConnection() {
  requireOAuthConfig();
  const connection = await getStoredConnection();
  if (!connection) throw new QuickBooksConfigurationError('QuickBooks is not connected.');
  const expiresAt = new Date(connection.access_token_expires_at).getTime();
  if (Number.isFinite(expiresAt) && expiresAt > Date.now() + 2 * 60 * 1000) return connection;
  return refreshConnection(connection);
}

async function quickBooksRequest(connection: QuickBooksConnection, path: string, init: RequestInit = {}) {
  const environment = connection.environment === 'production' ? 'production' : 'sandbox';
  const separator = path.includes('?') ? '&' : '?';
  const url = `${quickBooksApiBaseUrl(environment)}/v3/company/${encodeURIComponent(connection.realm_id)}${path}${separator}minorversion=${encodeURIComponent(env.quickBooksMinorVersion)}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${connection.access_token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(quickBooksErrorMessage(payload, 'QuickBooks request failed.', response.headers.get('intuit_tid')));
  }
  return payload;
}

function escapeQueryString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function quickBooksQuery(connection: QuickBooksConnection, query: string) {
  return quickBooksRequest(connection, `/query?query=${encodeURIComponent(query)}`);
}

function quickBooksQueryItems(payload: any) {
  const items = payload?.QueryResponse?.Item;
  return Array.isArray(items) ? items : [];
}

function normalizeQuickBooksCatalogItem(item: any): QuickBooksCatalogItem | null {
  const id = cleanText(item?.Id);
  if (!id) return null;
  return {
    active: item?.Active !== false,
    fullyQualifiedName: cleanText(item?.FullyQualifiedName) || null,
    id,
    name: cleanText(item?.Name) || `Item ${id}`,
    sku: cleanText(item?.Sku) || null,
    syncToken: cleanText(item?.SyncToken) || null,
    type: cleanText(item?.Type) || null,
  };
}

function customerNameForOrder(order: QuickBooksInvoiceOrder) {
  return cleanText(relatedOne(order.centers)?.name)
    || cleanText(order.shipping_company)
    || cleanText(order.shipping_name)
    || cleanText(relatedOne(order.profiles)?.full_name)
    || cleanText(relatedOne(order.profiles)?.email)
    || `Sobrew order ${order.id.slice(0, 8)}`;
}

function productNameForItem(item: QuickBooksOrderItem) {
  return cleanText(relatedOne(item.products)?.name) || cleanText(item.product_name_snapshot) || 'Sobrew product';
}

function orderLineDescription(item: QuickBooksOrderItem) {
  const product = relatedOne(item.products);
  const sku = cleanText(product?.sku);
  return sku ? `${productNameForItem(item)} (${sku})` : productNameForItem(item);
}

function addressForOrder(order: QuickBooksInvoiceOrder) {
  const line1 = cleanText(order.shipping_address1);
  const city = cleanText(order.shipping_city);
  const countrySubDivisionCode = cleanText(order.shipping_state);
  const postalCode = cleanText(order.shipping_zip);
  if (!line1 && !city && !countrySubDivisionCode && !postalCode) return undefined;
  return {
    City: city || undefined,
    CountrySubDivisionCode: countrySubDivisionCode || undefined,
    Line1: line1 || undefined,
    Line2: cleanText(order.shipping_address2) || undefined,
    PostalCode: postalCode || undefined,
  };
}

async function findOrCreateCustomer(connection: QuickBooksConnection, order: QuickBooksInvoiceOrder): Promise<QuickBooksRef> {
  const displayName = customerNameForOrder(order);
  const query = `SELECT * FROM Customer WHERE DisplayName = '${escapeQueryString(displayName)}'`;
  const existing = await quickBooksQuery(connection, query);
  const customer = existing?.QueryResponse?.Customer?.[0];
  if (customer?.Id) return { name: customer.DisplayName ?? displayName, value: String(customer.Id) };

  const profile = relatedOne(order.profiles);
  const email = cleanText(profile?.email);
  const address = addressForOrder(order);
  const payload = {
    BillAddr: address,
    CompanyName: displayName,
    DisplayName: displayName,
    PrimaryEmailAddr: email ? { Address: email } : undefined,
    ShipAddr: address,
  };
  const created = await quickBooksRequest(connection, '/customer', {
    body: JSON.stringify(payload),
    method: 'POST',
  });
  const createdCustomer = created?.Customer;
  if (!createdCustomer?.Id) throw new Error('QuickBooks did not return a customer ID.');
  return { name: createdCustomer.DisplayName ?? displayName, value: String(createdCustomer.Id) };
}

async function resolveInvoiceItem(connection: QuickBooksConnection): Promise<QuickBooksRef> {
  if (env.quickBooksDefaultItemId) {
    return {
      name: env.quickBooksDefaultItemName || undefined,
      value: env.quickBooksDefaultItemId,
    };
  }
  if (env.quickBooksDefaultItemName) {
    const query = `SELECT * FROM Item WHERE Name = '${escapeQueryString(env.quickBooksDefaultItemName)}'`;
    const existing = await quickBooksQuery(connection, query);
    const item = existing?.QueryResponse?.Item?.[0];
    if (item?.Id) return { name: item.Name ?? env.quickBooksDefaultItemName, value: String(item.Id) };
  }
  throw new QuickBooksConfigurationError('Set QUICKBOOKS_DEFAULT_ITEM_ID or QUICKBOOKS_DEFAULT_ITEM_NAME before creating QuickBooks invoices.');
}

export function buildQuickBooksInvoicePayload(
  order: QuickBooksInvoiceOrder,
  customerRef: QuickBooksRef,
  itemRef: QuickBooksRef,
  options: { taxableStates?: string[] } = {}
) {
  const shouldCollectSalesTax = shouldCollectQuickBooksSalesTax(order, options.taxableStates ?? DEFAULT_QUICKBOOKS_SALES_TAX_STATES);
  const lineTaxCode = shouldCollectSalesTax ? QUICKBOOKS_LINE_TAXABLE_CODE : QUICKBOOKS_LINE_NON_TAXABLE_CODE;
  const lineItems = (order.order_items ?? []).map((item) => {
    const qty = Math.max(0, numericValue(item.qty));
    const unitPrice = amountFromCents(item.unit_price_cents);
    const amount = amountFromCents(item.line_total_cents);
    return {
      Amount: amount,
      Description: orderLineDescription(item),
      DetailType: 'SalesItemLineDetail',
      SalesItemLineDetail: {
        ItemRef: itemRef,
        Qty: qty,
        TaxCodeRef: { value: lineTaxCode },
        UnitPrice: unitPrice,
      },
    };
  }).filter((line) => line.Amount > 0);
  if (!lineItems.length) throw new Error('This order has no invoiceable line items.');

  const profile = relatedOne(order.profiles);
  const email = cleanText(profile?.email);
  const shippingAddress = addressForOrder(order);
  const privateNoteParts = [`Sobrew order ${order.id}`];
  const orderNotes = cleanText(order.notes);
  if (orderNotes) privateNoteParts.push(orderNotes);

  return {
    BillEmail: email ? { Address: email } : undefined,
    CustomerMemo: {
      value: `Invoice for Sobrew order ${order.id.slice(0, 8)}.`,
    },
    CustomerRef: customerRef,
    Line: lineItems,
    PrivateNote: privateNoteParts.join('\n'),
    ShipAddr: shippingAddress,
  };
}

export async function getQuickBooksSalesTaxSettings(): Promise<QuickBooksSalesTaxSettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('app_settings')
    .select('quickbooks_sales_tax_states')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Unable to read QuickBooks sales tax settings: ${error.message}`);
  return {
    states: normalizeSalesTaxStates((data as { quickbooks_sales_tax_states?: string[] | null } | null)?.quickbooks_sales_tax_states),
  };
}

export async function saveQuickBooksSalesTaxSettings(states: string[]): Promise<QuickBooksSalesTaxSettings> {
  const supabase = getSupabaseAdmin();
  const normalizedStates = normalizeSalesTaxStates(states);
  const { data: existing, error: readError } = await supabase
    .from('app_settings')
    .select('id')
    .limit(1)
    .maybeSingle();
  if (readError) throw new Error(`Unable to read app settings: ${readError.message}`);

  const result = existing?.id
    ? await supabase.from('app_settings').update({
        quickbooks_sales_tax_states: normalizedStates,
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id)
    : await supabase.from('app_settings').insert({
        brand_name: 'Sobrew',
        quickbooks_sales_tax_states: normalizedStates,
        updated_at: new Date().toISOString(),
      });

  if (result.error) throw new Error(`Unable to save QuickBooks sales tax settings: ${result.error.message}`);
  return { states: normalizedStates };
}

export async function createQuickBooksInvoiceForOrder(orderId: string): Promise<CreatedQuickBooksInvoice> {
  const supabase = getSupabaseAdmin();
  const { data: order, error } = await supabase
    .from('orders')
    .select('id,status,archived_at,created_at,notes,quickbooks_invoice_id,shipping_company,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip,profiles(email,full_name),centers(name,customer_tax_status),order_items(qty,unit_price_cents,line_total_cents,product_name_snapshot,products(name,sku))')
    .eq('id', orderId)
    .single();
  if (error || !order) throw new Error(error?.message || 'Order not found.');
  if ((order as any).archived_at) throw new Error('Archived orders cannot be invoiced.');
  if ((order as any).status !== 'Shipped') throw new Error('Only shipped orders can be invoiced.');
  if ((order as any).quickbooks_invoice_id) throw new Error('This order has already been invoiced.');

  const connection = await getAuthorizedConnection();
  const salesTaxSettings = await getQuickBooksSalesTaxSettings();
  const customerRef = await findOrCreateCustomer(connection, order as QuickBooksInvoiceOrder);
  const itemRef = await resolveInvoiceItem(connection);
  const invoicePayload = buildQuickBooksInvoicePayload(order as QuickBooksInvoiceOrder, customerRef, itemRef, { taxableStates: salesTaxSettings.states });
  const created = await quickBooksRequest(connection, '/invoice', {
    body: JSON.stringify(invoicePayload),
    method: 'POST',
  });
  const invoice = created?.Invoice;
  if (!invoice?.Id) throw new Error('QuickBooks did not return an invoice ID.');
  const environment = connection.environment === 'production' ? 'production' : 'sandbox';
  return {
    docNumber: invoice.DocNumber ? String(invoice.DocNumber) : null,
    id: String(invoice.Id),
    url: quickBooksAppInvoiceUrl(environment, String(invoice.Id)),
  };
}

export async function getQuickBooksConnectionStatus(): Promise<QuickBooksConnectionStatus> {
  const config = getOAuthConfig();
  const connection = await getStoredConnection().catch(() => null);
  return {
    connected: Boolean(connection?.realm_id),
    environment: config.environment,
    missingConfig: config.missingConfig,
    realmId: connection?.realm_id ?? null,
  };
}

export async function getQuickBooksCompanyInfo(): Promise<QuickBooksCompanyInfo> {
  try {
    const connection = await getAuthorizedConnection();
    const result = await quickBooksRequest(connection, `/companyinfo/${encodeURIComponent(connection.realm_id)}`);
    const company = result?.CompanyInfo;
    return {
      companyName: cleanText(company?.CompanyName) || null,
      email: cleanText(company?.Email?.Address) || null,
      error: null,
      legalName: cleanText(company?.LegalName) || null,
      realmId: connection.realm_id,
    };
  } catch (error) {
    return {
      companyName: null,
      email: null,
      error: error instanceof Error ? error.message : 'Unable to read QuickBooks company info.',
      legalName: null,
      realmId: null,
    };
  }
}

export async function disconnectQuickBooksConnection() {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('quickbooks_connections')
    .delete()
    .eq('id', QUICKBOOKS_CONNECTION_ID);
  if (error) throw new Error(`Unable to disconnect QuickBooks: ${error.message}`);
}

export async function getQuickBooksProductSummary(): Promise<QuickBooksProductSummary> {
  try {
    const connection = await getAuthorizedConnection();
    const result = await quickBooksQuery(connection, 'SELECT COUNT(*) FROM Item WHERE Active = true');
    const totalCount = Number(result?.QueryResponse?.totalCount ?? result?.QueryResponse?.TotalCount);
    return {
      activeItemCount: Number.isFinite(totalCount) ? totalCount : null,
      error: null,
    };
  } catch (error) {
    return {
      activeItemCount: null,
      error: error instanceof Error ? error.message : 'Unable to read QuickBooks products.',
    };
  }
}

export async function getQuickBooksActiveItems(limit = 500): Promise<QuickBooksCatalogItemsResult> {
  try {
    const connection = await getAuthorizedConnection();
    const items: QuickBooksCatalogItem[] = [];
    let startPosition = 1;

    while (items.length < limit) {
      const pageSize = Math.min(100, limit - items.length);
      const result = await quickBooksQuery(
        connection,
        `SELECT * FROM Item WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
      );
      const pageItems = quickBooksQueryItems(result)
        .map(normalizeQuickBooksCatalogItem)
        .filter((item): item is QuickBooksCatalogItem => Boolean(item));
      items.push(...pageItems);
      if (pageItems.length < pageSize) {
        return { error: null, items, truncated: false };
      }
      startPosition += pageSize;
    }

    return { error: null, items, truncated: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to pull QuickBooks products.',
      items: [],
      truncated: false,
    };
  }
}

import 'server-only';

import { env } from '@/lib/env';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const QUICKBOOKS_CONNECTION_ID = 'default';
const QUICKBOOKS_ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';
const QUICKBOOKS_PAYMENT_SCOPE = 'com.intuit.quickbooks.payment';
const QUICKBOOKS_OAUTH_SCOPE = `${QUICKBOOKS_ACCOUNTING_SCOPE} ${QUICKBOOKS_PAYMENT_SCOPE}`;
const DEFAULT_QUICKBOOKS_SALES_TAX_STATES = ['TN'];
const QUICKBOOKS_LINE_TAXABLE_CODE = 'TAX';
const QUICKBOOKS_LINE_NON_TAXABLE_CODE = 'NON';
const QUICKBOOKS_TOKEN_ENDPOINT = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QUICKBOOKS_BUSINESS_TIME_ZONE = 'America/Chicago';
const QUICKBOOKS_DEFAULT_SHIP_VIA = 'UPS';
const QUICKBOOKS_DEFAULT_TRACKING_NOTE = 'See shipped order email';
const QUICKBOOKS_SAVED_PAYMENT_LOOKUP_BATCH_SIZE = 4;

type QuickBooksEnvironment = 'production' | 'sandbox';
type CustomerTaxStatus = 'unknown' | 'for_profit' | 'tax_exempt';

type QuickBooksConnection = {
  access_token: string;
  access_token_expires_at: string;
  environment: QuickBooksEnvironment | string;
  realm_id: string;
  refresh_token: string;
  scope?: string | null;
};

type QuickBooksTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
  x_refresh_token_expires_in?: number;
};

type QuickBooksRef = {
  name?: string;
  value: string;
};

type QuickBooksOrderItem = {
  line_total_cents: number | string;
  product_name_snapshot: string | null;
  product_id?: string | null;
  products?: {
    name: string | null;
    quickbooks_item_id?: string | null;
    quickbooks_item_name?: string | null;
    sku: string | null;
  } | Array<{
    name: string | null;
    quickbooks_item_id?: string | null;
    quickbooks_item_name?: string | null;
    sku: string | null;
  }> | null;
  qty: number | string;
  unit_price_cents: number | string;
};

type QuickBooksInvoiceCenter = {
  billing_email?: string | null;
  customer_tax_status?: CustomerTaxStatus | string | null;
  id?: string | null;
  quickbooks_customer_id?: string | null;
  quickbooks_display_name?: string | null;
  quickbooks_payment_method_brand?: string | null;
  quickbooks_payment_method_exp_month?: string | null;
  quickbooks_payment_method_exp_year?: string | null;
  quickbooks_payment_method_id?: string | null;
  quickbooks_payment_method_last4?: string | null;
  quickbooks_payment_method_type?: string | null;
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
  quickbooks_invoice_id?: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_company?: string | null;
  shipping_name: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  subtotal_cents?: number | string | null;
};

type QuickBooksInvoiceRecord = {
  DocNumber?: string | null;
  Id?: string | number | null;
  SyncToken?: string | number | null;
};

export type QuickBooksConnectionStatus = {
  connected: boolean;
  environment: QuickBooksEnvironment;
  grantedScopes: string[];
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
  amountCents: number;
  customerName: string;
  docNumber: string | null;
  emailCc: string | null;
  emailError: string | null;
  emailRecipients: string | null;
  emailSentAt: string | null;
  emailTo: string | null;
  id: string;
  url: string | null;
};

export type QuickBooksInvoicePdf = {
  content: Buffer;
  filename: string;
};

export type QuickBooksSavedPaymentMethodType = 'card' | 'bank_account' | 'echeck';

export type QuickBooksSavedPaymentMethod = {
  brand?: string | null;
  expMonth?: string | null;
  expYear?: string | null;
  id: string;
  label: string;
  last4?: string | null;
  type: QuickBooksSavedPaymentMethodType;
};

export type QuickBooksSavedPaymentMethodLookup = {
  customerId: string;
  error: string | null;
  method: QuickBooksSavedPaymentMethod | null;
  methodCount: number;
};

export type QuickBooksInvoiceEmailRecipients = {
  all: string[];
  cc: string[];
  display: string | null;
  to: string[];
};

export type CreatedQuickBooksPaidInvoice = CreatedQuickBooksInvoice & {
  paymentChargeId: string;
  paymentChargeStatus: string;
  paymentId: string;
  paymentMethodLabel: string;
  paymentMethodType: QuickBooksSavedPaymentMethodType;
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

export type QuickBooksCustomerSummary = {
  activeCustomerCount: number | null;
  error: string | null;
};

export type QuickBooksCustomerAddress = {
  city: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  state: string | null;
};

export type QuickBooksCustomerRecord = {
  active: boolean;
  billAddress: QuickBooksCustomerAddress;
  companyName: string | null;
  displayName: string;
  email: string | null;
  fullyQualifiedName: string | null;
  id: string;
  phone: string | null;
  syncToken: string | null;
};

export type QuickBooksCustomersResult = {
  customers: QuickBooksCustomerRecord[];
  error: string | null;
  truncated: boolean;
};

export type QuickBooksInvoiceReceivableStatus = 'paid' | 'unpaid';

export type QuickBooksInvoiceReceivableTiming = 'paid' | 'overdue' | 'due_today' | 'not_due_yet' | 'unknown';

export type QuickBooksInvoiceReceivable = {
  amountCents: number;
  balanceCents: number;
  customerName: string | null;
  docNumber: string | null;
  dueDate: string | null;
  id: string;
  paidAmountCents: number;
  status: QuickBooksInvoiceReceivableStatus;
  statusLabel: string;
  timing: QuickBooksInvoiceReceivableTiming;
  timingDays: number | null;
  txnDate: string | null;
};

export type QuickBooksInvoiceReceivablesResult = {
  error: string | null;
  invoices: QuickBooksInvoiceReceivable[];
  missingIds: string[];
};

export type QuickBooksReceivablesSummary = {
  notDueYetCents: number;
  overdueCents: number;
  paidCents: number;
  unpaidCents: number;
};

export type QuickBooksPortalCenter = {
  billing_address1?: string | null;
  billing_address2?: string | null;
  billing_city?: string | null;
  billing_email?: string | null;
  billing_phone?: string | null;
  billing_state?: string | null;
  billing_zip?: string | null;
  id: string;
  is_active: boolean | null;
  legal_name?: string | null;
  name: string | null;
  quickbooks_company_name?: string | null;
  quickbooks_customer_id?: string | null;
  quickbooks_display_name?: string | null;
};

type QuickBooksCenterLocation = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  is_active: boolean | null;
  name: string | null;
  state: string | null;
  zip: string | null;
};

type QuickBooksPortalCenterWithLocations = QuickBooksPortalCenter & {
  center_locations?: QuickBooksCenterLocation[] | null;
};

export type QuickBooksCustomerMatch = {
  centerId: string;
  customer: QuickBooksCustomerRecord | null;
  reasons: string[];
  score: number;
};

export type QuickBooksPortalProduct = {
  active: boolean | null;
  description: string | null;
  id: string;
  name: string | null;
  quickbooks_item_id?: string | null;
  sku: string | null;
};

export type QuickBooksProductResetResult = {
  archiveErrorCount: number;
  archiveErrors: string[];
  createdCount: number;
  inactivatedCount: number;
  productErrorCount: number;
};

export type QuickBooksProductCreateResult = {
  createdCount: number;
  productErrorCount: number;
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

function amountStringFromCents(value: number | string | null | undefined) {
  return amountFromCents(value).toFixed(2);
}

function centsFromAmount(value: number | string | null | undefined) {
  const parsed = numericValue(value);
  return Math.round(parsed * 100);
}

function invoiceableTotalCents(order: Pick<QuickBooksInvoiceOrder, 'order_items' | 'subtotal_cents'>) {
  const lineTotal = (order.order_items ?? [])
    .reduce((sum, item) => sum + Math.max(0, numericValue(item.line_total_cents)), 0);
  return Math.round(lineTotal || Math.max(0, numericValue(order.subtotal_cents)));
}

function normalizePaymentMethodLast4(value: unknown) {
  return cleanText(value).replace(/\D/g, '').slice(-4);
}

export function normalizeQuickBooksSavedPaymentMethodType(value: unknown): QuickBooksSavedPaymentMethodType | null {
  const normalized = cleanText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'card' || normalized === 'credit_card' || normalized === 'debit_card') return 'card';
  if (normalized === 'bank' || normalized === 'bank_account' || normalized === 'checking' || normalized === 'ach') return 'bank_account';
  if (normalized === 'echeck' || normalized === 'e_check') return 'echeck';
  return null;
}

export function quickBooksSavedPaymentMethodLabel(method: Partial<QuickBooksInvoiceCenter> | null | undefined) {
  const type = normalizeQuickBooksSavedPaymentMethodType(method?.quickbooks_payment_method_type);
  const brand = cleanText(method?.quickbooks_payment_method_brand);
  const last4 = normalizePaymentMethodLast4(method?.quickbooks_payment_method_last4);
  const fallback = type === 'card' ? 'Saved card' : type === 'bank_account' ? 'Saved bank account' : type === 'echeck' ? 'Saved eCheck' : 'Saved payment method';
  if (brand && last4) return `${brand} ending ${last4}`;
  if (last4) return `${fallback} ending ${last4}`;
  if (brand) return brand;
  return fallback;
}

function savedPaymentMethodForOrder(order: QuickBooksInvoiceOrder): QuickBooksSavedPaymentMethod {
  const center = relatedOne(order.centers);
  const id = cleanText(center?.quickbooks_payment_method_id);
  const type = normalizeQuickBooksSavedPaymentMethodType(center?.quickbooks_payment_method_type);
  if (!id || !type) throw new QuickBooksConfigurationError('Add a saved QuickBooks payment method to this customer before charging automatically.');
  return {
    brand: cleanText(center?.quickbooks_payment_method_brand) || null,
    expMonth: cleanText(center?.quickbooks_payment_method_exp_month) || null,
    expYear: cleanText(center?.quickbooks_payment_method_exp_year) || null,
    id,
    label: quickBooksSavedPaymentMethodLabel(center),
    last4: normalizePaymentMethodLast4(center?.quickbooks_payment_method_last4) || null,
    type,
  };
}

function cachedSavedPaymentMethodForOrder(order: QuickBooksInvoiceOrder): QuickBooksSavedPaymentMethod | null {
  try {
    return savedPaymentMethodForOrder(order);
  } catch {
    return null;
  }
}

function paymentPayloadArray(payload: any, keys: string[]) {
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
  }
  if (Array.isArray(payload)) return payload;
  return [];
}

function paymentEntityIsActive(entity: any) {
  const status = cleanText(entity?.status ?? entity?.Status).toUpperCase();
  return !status || status === 'ACTIVE' || status === 'VALID';
}

function maskedLast4(...values: unknown[]) {
  for (const value of values) {
    const last4 = normalizePaymentMethodLast4(value);
    if (last4) return last4;
  }
  return null;
}

function normalizeStoredCard(card: any): QuickBooksSavedPaymentMethod | null {
  const id = cleanText(card?.id ?? card?.Id);
  if (!id || !paymentEntityIsActive(card)) return null;
  const brand = cleanText(card?.cardType ?? card?.cardBrand ?? card?.brand ?? card?.type ?? card?.Type) || null;
  const last4 = maskedLast4(card?.last4, card?.number, card?.Number, card?.maskedNumber);
  const method = {
    quickbooks_payment_method_brand: brand,
    quickbooks_payment_method_last4: last4,
    quickbooks_payment_method_type: 'card',
  };
  return {
    brand,
    expMonth: cleanText(card?.expMonth ?? card?.ExpMonth) || null,
    expYear: cleanText(card?.expYear ?? card?.ExpYear) || null,
    id,
    label: quickBooksSavedPaymentMethodLabel(method),
    last4,
    type: 'card',
  };
}

function normalizeStoredBankAccount(account: any): QuickBooksSavedPaymentMethod | null {
  const id = cleanText(account?.id ?? account?.Id);
  if (!id || !paymentEntityIsActive(account)) return null;
  const brand = cleanText(account?.bankName ?? account?.name ?? account?.Name ?? account?.accountType ?? account?.AccountType) || null;
  const last4 = maskedLast4(account?.last4, account?.accountNumber, account?.AccountNumber, account?.maskedAccountNumber);
  const method = {
    quickbooks_payment_method_brand: brand,
    quickbooks_payment_method_last4: last4,
    quickbooks_payment_method_type: 'bank_account',
  };
  return {
    brand,
    id,
    label: quickBooksSavedPaymentMethodLabel(method),
    last4,
    type: 'bank_account',
  };
}

async function readQuickBooksSavedPaymentCollection(
  connection: QuickBooksConnection,
  customerId: string,
  resource: 'cards' | 'bank-accounts'
) {
  const payload = await quickBooksPaymentsCustomerRequest(
    connection,
    `/customers/${encodeURIComponent(customerId)}/${resource}`
  );
  return resource === 'cards'
    ? paymentPayloadArray(payload, ['cards', 'Cards', 'card', 'Card']).map(normalizeStoredCard).filter((method): method is QuickBooksSavedPaymentMethod => Boolean(method))
    : paymentPayloadArray(payload, ['bankAccounts', 'bankaccounts', 'bank_accounts', 'BankAccounts', 'bankAccount', 'BankAccount']).map(normalizeStoredBankAccount).filter((method): method is QuickBooksSavedPaymentMethod => Boolean(method));
}

async function getQuickBooksSavedPaymentMethodsForCustomer(connection: QuickBooksConnection, customerId: string) {
  const errors: string[] = [];
  const [cards, bankAccounts] = await Promise.all([
    readQuickBooksSavedPaymentCollection(connection, customerId, 'cards').catch((error) => {
      errors.push(errorMessageForSavedPaymentRead('cards', error));
      return [] as QuickBooksSavedPaymentMethod[];
    }),
    readQuickBooksSavedPaymentCollection(connection, customerId, 'bank-accounts').catch((error) => {
      errors.push(errorMessageForSavedPaymentRead('bank accounts', error));
      return [] as QuickBooksSavedPaymentMethod[];
    }),
  ]);
  return { errors, methods: [...cards, ...bankAccounts] };
}

function errorMessageForSavedPaymentRead(resource: string, error: unknown) {
  return `${resource}: ${error instanceof Error ? error.message : 'unavailable'}`;
}

function errorMessageForSavedPaymentLookup(error: unknown) {
  return error instanceof Error ? error.message : 'Saved payment lookup unavailable.';
}

export async function getQuickBooksSavedPaymentMethodLookups(
  customerIds: Array<string | null | undefined>
): Promise<QuickBooksSavedPaymentMethodLookup[]> {
  const uniqueCustomerIds = [...new Set(customerIds.map(cleanText).filter(Boolean))];
  if (!uniqueCustomerIds.length) return [];

  let connection: QuickBooksConnection;
  try {
    connection = await getAuthorizedConnection();
  } catch (error) {
    const message = errorMessageForSavedPaymentLookup(error);
    return uniqueCustomerIds.map((customerId) => ({
      customerId,
      error: message,
      method: null,
      methodCount: 0,
    }));
  }

  const lookups: QuickBooksSavedPaymentMethodLookup[] = [];
  for (let index = 0; index < uniqueCustomerIds.length; index += QUICKBOOKS_SAVED_PAYMENT_LOOKUP_BATCH_SIZE) {
    const batch = uniqueCustomerIds.slice(index, index + QUICKBOOKS_SAVED_PAYMENT_LOOKUP_BATCH_SIZE);
    const batchLookups = await Promise.all(batch.map(async (customerId): Promise<QuickBooksSavedPaymentMethodLookup> => {
      try {
        const result = await getQuickBooksSavedPaymentMethodsForCustomer(connection, customerId);
        const method = result.methods[0] ?? null;
        return {
          customerId,
          error: method || !result.errors.length ? null : result.errors.join(' '),
          method,
          methodCount: result.methods.length,
        };
      } catch (error) {
        return {
          customerId,
          error: errorMessageForSavedPaymentLookup(error),
          method: null,
          methodCount: 0,
        };
      }
    }));
    lookups.push(...batchLookups);
  }

  return lookups;
}

async function cacheQuickBooksSavedPaymentMethodForOrder(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  order: QuickBooksInvoiceOrder,
  method: QuickBooksSavedPaymentMethod
) {
  const centerId = cleanText(relatedOne(order.centers)?.id);
  if (!centerId) return;
  await supabase
    .from('centers')
    .update({
      quickbooks_payment_method_brand: method.brand ?? null,
      quickbooks_payment_method_exp_month: method.type === 'card' ? method.expMonth ?? null : null,
      quickbooks_payment_method_exp_year: method.type === 'card' ? method.expYear ?? null : null,
      quickbooks_payment_method_id: method.id,
      quickbooks_payment_method_last4: method.last4 ?? null,
      quickbooks_payment_method_type: method.type,
      quickbooks_payment_method_updated_at: new Date().toISOString(),
    })
    .eq('id', centerId);
}

async function resolveSavedPaymentMethodForOrder(
  connection: QuickBooksConnection,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  order: QuickBooksInvoiceOrder,
  customerRef: QuickBooksRef
): Promise<QuickBooksSavedPaymentMethod> {
  const cachedMethod = cachedSavedPaymentMethodForOrder(order);
  if (cachedMethod) return cachedMethod;

  const result = await getQuickBooksSavedPaymentMethodsForCustomer(connection, customerRef.value);
  const method = result.methods[0];
  if (!method) {
    const detail = result.errors.length ? ` ${result.errors.join(' ')}` : '';
    throw new QuickBooksConfigurationError(`No saved QuickBooks payment method was found for this customer.${detail}`);
  }
  await cacheQuickBooksSavedPaymentMethodForOrder(supabase, order, method);
  return method;
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

function quickBooksDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: QUICKBOOKS_BUSINESS_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
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

function quickBooksPaymentsApiBaseUrl(environment: QuickBooksEnvironment) {
  return environment === 'production'
    ? 'https://api.intuit.com/quickbooks/v4/payments'
    : 'https://sandbox.api.intuit.com/quickbooks/v4/payments';
}

function quickBooksPaymentsCustomerApiBaseUrl(environment: QuickBooksEnvironment) {
  return environment === 'production'
    ? 'https://api.intuit.com/quickbooks/v4'
    : 'https://sandbox.api.intuit.com/quickbooks/v4';
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
  const faultMessage = cleanText(faultError?.Message);
  const faultDetail = cleanText(faultError?.Detail);
  const message = faultMessage && faultDetail && faultDetail !== faultMessage
    ? `${faultMessage}: ${faultDetail}`
    : faultMessage || faultDetail || cleanText(payload?.error_description) || cleanText(payload?.error) || fallback;
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
    scope: QUICKBOOKS_OAUTH_SCOPE,
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
    scope: cleanText(token.scope) || QUICKBOOKS_OAUTH_SCOPE,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(`Unable to save QuickBooks connection: ${error.message}`);
}

async function getStoredConnection(): Promise<QuickBooksConnection | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('quickbooks_connections')
    .select('realm_id,environment,access_token,refresh_token,access_token_expires_at,scope')
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
      scope: cleanText(token.scope) || connection.scope || QUICKBOOKS_OAUTH_SCOPE,
      updated_at: new Date().toISOString(),
    })
    .eq('id', QUICKBOOKS_CONNECTION_ID);
  if (error) throw new Error(`Unable to refresh QuickBooks connection: ${error.message}`);
  return {
    ...connection,
    access_token: token.access_token,
    access_token_expires_at: tokenExpiry(token.expires_in),
    refresh_token: token.refresh_token,
    scope: cleanText(token.scope) || connection.scope || QUICKBOOKS_OAUTH_SCOPE,
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

async function quickBooksBinaryRequest(connection: QuickBooksConnection, path: string, init: RequestInit = {}) {
  const environment = connection.environment === 'production' ? 'production' : 'sandbox';
  const separator = path.includes('?') ? '&' : '?';
  const url = `${quickBooksApiBaseUrl(environment)}/v3/company/${encodeURIComponent(connection.realm_id)}${path}${separator}minorversion=${encodeURIComponent(env.quickBooksMinorVersion)}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/pdf',
      Authorization: `Bearer ${connection.access_token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = await parseJsonResponse(response);
    throw new Error(quickBooksErrorMessage(payload, 'QuickBooks request failed.', response.headers.get('intuit_tid')));
  }
  return Buffer.from(await response.arrayBuffer());
}

async function quickBooksPaymentsRequest(connection: QuickBooksConnection, path: string, init: RequestInit = {}) {
  const environment = connection.environment === 'production' ? 'production' : 'sandbox';
  const url = `${quickBooksPaymentsApiBaseUrl(environment)}${path}`;
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
    throw new Error(quickBooksErrorMessage(payload, 'QuickBooks Payments request failed.', response.headers.get('intuit_tid')));
  }
  return payload;
}

async function quickBooksPaymentsCustomerRequest(connection: QuickBooksConnection, path: string, init: RequestInit = {}) {
  const environment = connection.environment === 'production' ? 'production' : 'sandbox';
  const url = `${quickBooksPaymentsCustomerApiBaseUrl(environment)}${path}`;
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
    throw new Error(quickBooksErrorMessage(payload, 'QuickBooks Payments customer request failed.', response.headers.get('intuit_tid')));
  }
  return payload;
}

function escapeQueryString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function quickBooksQuery(connection: QuickBooksConnection, query: string) {
  return quickBooksRequest(connection, `/query?query=${encodeURIComponent(query)}`);
}

async function readQuickBooksCustomer(connection: QuickBooksConnection, customerId: string) {
  const payload = await quickBooksRequest(connection, `/customer/${encodeURIComponent(customerId)}`);
  return payload?.Customer ?? null;
}

async function tryReadQuickBooksCustomer(connection: QuickBooksConnection, customerId: string) {
  try {
    return await readQuickBooksCustomer(connection, customerId);
  } catch (error) {
    console.error('[quickbooks] unable to read customer email defaults', { customerId, error });
    return null;
  }
}

function quickBooksQueryItems(payload: any) {
  const items = payload?.QueryResponse?.Item;
  return Array.isArray(items) ? items : [];
}

function quickBooksQueryCustomers(payload: any) {
  const customers = payload?.QueryResponse?.Customer;
  return Array.isArray(customers) ? customers : [];
}

function quickBooksQueryInvoices(payload: any) {
  const invoices = payload?.QueryResponse?.Invoice;
  return Array.isArray(invoices) ? invoices : [];
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

function normalizeQuickBooksAddress(address: any): QuickBooksCustomerAddress {
  return {
    city: cleanText(address?.City) || null,
    line1: cleanText(address?.Line1) || null,
    line2: cleanText(address?.Line2) || null,
    postalCode: cleanText(address?.PostalCode) || null,
    state: cleanText(address?.CountrySubDivisionCode) || null,
  };
}

function normalizeQuickBooksCustomer(customer: any): QuickBooksCustomerRecord | null {
  const id = cleanText(customer?.Id);
  if (!id) return null;
  return {
    active: customer?.Active !== false,
    billAddress: normalizeQuickBooksAddress(customer?.BillAddr),
    companyName: cleanText(customer?.CompanyName) || null,
    displayName: cleanText(customer?.DisplayName) || cleanText(customer?.FullyQualifiedName) || `Customer ${id}`,
    email: cleanText(customer?.PrimaryEmailAddr?.Address) || null,
    fullyQualifiedName: cleanText(customer?.FullyQualifiedName) || null,
    id,
    phone: cleanText(customer?.PrimaryPhone?.FreeFormNumber) || null,
    syncToken: cleanText(customer?.SyncToken) || null,
  };
}

export function normalizeCustomerMatchText(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bdba\b/g, ' ')
    .replace(/\b(the|inc|incorporated|llc|l\.l\.c|ltd|co|company|corp|corporation|pllc|lp|llp)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dateOnlyUtcMs(value: string | null | undefined) {
  const text = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return Date.UTC(year, month - 1, day);
}

function daysBetweenDateOnly(left: string, right: string) {
  const leftMs = dateOnlyUtcMs(left);
  const rightMs = dateOnlyUtcMs(right);
  if (leftMs === null || rightMs === null) return null;
  return Math.round((leftMs - rightMs) / 86_400_000);
}

export function normalizeQuickBooksInvoiceReceivable(invoice: any, today = quickBooksDate()): QuickBooksInvoiceReceivable | null {
  const id = cleanText(invoice?.Id);
  if (!id) return null;

  const amountCents = Math.max(0, centsFromAmount(invoice?.TotalAmt));
  const balanceCents = Math.max(0, centsFromAmount(invoice?.Balance));
  const paidAmountCents = Math.max(0, amountCents - balanceCents);
  const dueDate = cleanText(invoice?.DueDate) || null;
  const txnDate = cleanText(invoice?.TxnDate) || null;
  const status: QuickBooksInvoiceReceivableStatus = balanceCents <= 0 ? 'paid' : 'unpaid';
  let timing: QuickBooksInvoiceReceivableTiming = status === 'paid' ? 'paid' : 'unknown';
  let timingDays: number | null = null;
  let statusLabel = 'Paid';

  if (status === 'unpaid') {
    const daysUntilDue = dueDate ? daysBetweenDateOnly(dueDate, today) : null;
    if (daysUntilDue === null) {
      statusLabel = 'Unpaid';
    } else if (daysUntilDue < 0) {
      timing = 'overdue';
      timingDays = Math.abs(daysUntilDue);
      statusLabel = `Overdue ${timingDays} ${timingDays === 1 ? 'day' : 'days'}`;
    } else if (daysUntilDue === 0) {
      timing = 'due_today';
      timingDays = 0;
      statusLabel = 'Due today';
    } else {
      timing = 'not_due_yet';
      timingDays = daysUntilDue;
      statusLabel = `Due in ${timingDays} ${timingDays === 1 ? 'day' : 'days'}`;
    }
  }

  return {
    amountCents,
    balanceCents,
    customerName: cleanText(invoice?.CustomerRef?.name) || null,
    docNumber: cleanText(invoice?.DocNumber) || null,
    dueDate,
    id,
    paidAmountCents,
    status,
    statusLabel,
    timing,
    timingDays,
    txnDate,
  };
}

export function buildQuickBooksReceivablesSummary(invoices: QuickBooksInvoiceReceivable[]): QuickBooksReceivablesSummary {
  return invoices.reduce<QuickBooksReceivablesSummary>((summary, invoice) => {
    if (invoice.status === 'paid') {
      summary.paidCents += invoice.amountCents;
      return summary;
    }

    summary.unpaidCents += invoice.balanceCents;
    if (invoice.timing === 'overdue') {
      summary.overdueCents += invoice.balanceCents;
    } else {
      summary.notDueYetCents += invoice.balanceCents;
    }
    return summary;
  }, {
    notDueYetCents: 0,
    overdueCents: 0,
    paidCents: 0,
    unpaidCents: 0,
  });
}

function tokenSet(value: string) {
  return new Set(normalizeCustomerMatchText(value).split(' ').filter((token) => token.length > 1));
}

function sharedDistinctiveTokens(left: string, right: string) {
  const genericTokens = new Set(['health', 'behavioral', 'recovery', 'center', 'services', 'service', 'group', 'clinic']);
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  return [...leftTokens].filter((token) => token.length > 3 && !genericTokens.has(token) && rightTokens.has(token));
}

function tokenOverlapScore(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function zipPrefix(value: string | null | undefined) {
  return cleanText(value).replace(/\D/g, '').slice(0, 5);
}

export function scoreQuickBooksCustomerMatch(center: QuickBooksPortalCenter, customer: QuickBooksCustomerRecord) {
  const reasons: string[] = [];
  let score = 0;
  const centerName = cleanText(center.name);
  const centerLegalName = cleanText(center.legal_name);
  const customerNames = [
    customer.displayName,
    customer.companyName,
    customer.fullyQualifiedName,
  ].map(cleanText).filter(Boolean);

  const exactName = customerNames.some((name) => normalizeCustomerMatchText(name) === normalizeCustomerMatchText(centerName));
  if (exactName && centerName) {
    score += 80;
    reasons.push('same normalized name');
  }

  if (centerLegalName && customerNames.some((name) => normalizeCustomerMatchText(name) === normalizeCustomerMatchText(centerLegalName))) {
    score += 85;
    reasons.push('legal name match');
  }

  const bestNameOverlap = Math.max(0, ...customerNames.map((name) => tokenOverlapScore(centerName, name)));
  if (!exactName && bestNameOverlap >= 0.5) {
    score += Math.round(bestNameOverlap * 55);
    reasons.push('similar name');
  }

  if (!exactName && bestNameOverlap < 0.5 && customerNames.some((name) => sharedDistinctiveTokens(centerName, name).length > 0)) {
    score += 25;
    reasons.push('shared distinctive name');
  }

  const centerEmail = cleanText(center.billing_email).toLowerCase();
  if (centerEmail && centerEmail === cleanText(customer.email).toLowerCase()) {
    score += 55;
    reasons.push('billing email match');
  }

  const centerZip = zipPrefix(center.billing_zip);
  const customerZip = zipPrefix(customer.billAddress.postalCode);
  if (centerZip && centerZip === customerZip) {
    score += 20;
    reasons.push('ZIP match');
  }

  const centerState = cleanText(center.billing_state).toUpperCase();
  const customerState = cleanText(customer.billAddress.state).toUpperCase();
  if (centerState && centerState === customerState) {
    score += 10;
    reasons.push('state match');
  }

  return { reasons, score };
}

export function buildQuickBooksCustomerMatches(centers: QuickBooksPortalCenter[], customers: QuickBooksCustomerRecord[]) {
  return centers.map((center): QuickBooksCustomerMatch => {
    if (center.quickbooks_customer_id) {
      const mappedCustomer = customers.find((customer) => customer.id === center.quickbooks_customer_id) ?? null;
      return {
        centerId: center.id,
        customer: mappedCustomer,
        reasons: mappedCustomer ? ['already linked'] : ['linked customer was not found in this QuickBooks pull'],
        score: mappedCustomer ? 100 : 0,
      };
    }

    const ranked = customers
      .map((customer) => ({ customer, ...scoreQuickBooksCustomerMatch(center, customer) }))
      .filter((match) => match.score >= 45)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    return {
      centerId: center.id,
      customer: best?.customer ?? null,
      reasons: best?.reasons ?? [],
      score: best?.score ?? 0,
    };
  });
}

function quickBooksItemName(value: unknown) {
  return cleanText(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100)
    || 'Sobrew Product';
}

function archivedQuickBooksItemName(item: QuickBooksCatalogItem, archivedAt: Date) {
  const date = archivedAt.toISOString().slice(0, 10).replaceAll('-', '');
  const suffix = item.id.slice(-8);
  return quickBooksItemName(`Archived ${date} ${suffix} ${item.name}`);
}

function quickBooksItemType() {
  const normalized = cleanText(env.quickBooksProductItemType);
  return ['Service', 'NonInventory'].includes(normalized) ? normalized : 'Service';
}

function quickBooksLineItemRef(item: QuickBooksOrderItem): QuickBooksRef {
  const product = relatedOne(item.products);
  const quickBooksItemId = cleanText(product?.quickbooks_item_id);
  if (quickBooksItemId) {
    return {
      name: cleanText(product?.quickbooks_item_name) || productNameForItem(item),
      value: quickBooksItemId,
    };
  }
  throw new Error(`Map ${productNameForItem(item)} to QuickBooks before invoicing.`);
}

async function resolveProductIncomeAccount(connection: QuickBooksConnection): Promise<QuickBooksRef> {
  if (env.quickBooksIncomeAccountId) {
    return {
      name: env.quickBooksIncomeAccountName || undefined,
      value: env.quickBooksIncomeAccountId,
    };
  }

  const preferredName = cleanText(env.quickBooksIncomeAccountName);
  if (preferredName) {
    const preferredResult = await quickBooksQuery(
      connection,
      `SELECT * FROM Account WHERE Name = '${escapeQueryString(preferredName)}' AND Active = true`
    );
    const preferredAccount = preferredResult?.QueryResponse?.Account?.[0];
    if (preferredAccount?.Id) {
      return {
        name: cleanText(preferredAccount.Name) || preferredName,
        value: String(preferredAccount.Id),
      };
    }
  }

  const result = await quickBooksQuery(connection, "SELECT * FROM Account WHERE AccountType = 'Income' AND Active = true MAXRESULTS 100");
  const accounts = Array.isArray(result?.QueryResponse?.Account) ? result.QueryResponse.Account : [];
  const account = accounts.find((row: any) => /sales|income/i.test(cleanText(row?.Name))) ?? accounts[0];
  if (!account?.Id) {
    throw new QuickBooksConfigurationError('Set QUICKBOOKS_INCOME_ACCOUNT_ID before syncing products. No active QuickBooks income account was found.');
  }
  return {
    name: cleanText(account.Name) || undefined,
    value: String(account.Id),
  };
}

function buildQuickBooksProductPayload(product: QuickBooksPortalProduct, incomeAccountRef: QuickBooksRef) {
  const name = quickBooksItemName(product.name);
  const description = cleanText(product.description);
  const sku = cleanText(product.sku);
  return {
    Active: true,
    Description: description || undefined,
    IncomeAccountRef: incomeAccountRef,
    Name: name,
    Sku: sku || undefined,
    Type: quickBooksItemType(),
    UnitPrice: 0,
  };
}

async function archiveQuickBooksItem(connection: QuickBooksConnection, item: QuickBooksCatalogItem, archivedAt: Date) {
  if (!item.syncToken) throw new Error(`QuickBooks item ${item.name} is missing a sync token.`);
  const updated = await quickBooksRequest(connection, '/item?operation=update', {
    body: JSON.stringify({
      Active: false,
      Id: item.id,
      Name: archivedQuickBooksItemName(item, archivedAt),
      SyncToken: item.syncToken,
      sparse: true,
    }),
    method: 'POST',
  });
  if (!updated?.Item?.Id) throw new Error(`QuickBooks did not archive ${item.name}.`);
}

async function createQuickBooksProductItem(connection: QuickBooksConnection, product: QuickBooksPortalProduct, incomeAccountRef: QuickBooksRef) {
  const created = await quickBooksRequest(connection, '/item', {
    body: JSON.stringify(buildQuickBooksProductPayload(product, incomeAccountRef)),
    method: 'POST',
  });
  const item = created?.Item;
  if (!item?.Id) throw new Error(`QuickBooks did not return an item ID for ${product.name ?? product.id}.`);
  return {
    id: String(item.Id),
    name: cleanText(item.Name) || quickBooksItemName(product.name),
    type: cleanText(item.Type) || quickBooksItemType(),
  };
}

export async function createMissingQuickBooksProductsFromPortal(products: QuickBooksPortalProduct[]): Promise<QuickBooksProductCreateResult> {
  const activeUnmappedProducts = products
    .filter((product) => product.active !== false && !cleanText(product.quickbooks_item_id))
    .map((product) => ({
      ...product,
      name: quickBooksItemName(product.name),
    }));

  if (!activeUnmappedProducts.length) {
    return { createdCount: 0, productErrorCount: 0 };
  }

  const connection = await getAuthorizedConnection();
  const incomeAccountRef = await resolveProductIncomeAccount(connection);
  const supabase = getSupabaseAdmin();
  const syncedAt = new Date().toISOString();
  let createdCount = 0;
  let productErrorCount = 0;

  for (const product of activeUnmappedProducts) {
    try {
      const item = await createQuickBooksProductItem(connection, product, incomeAccountRef);
      const { error } = await supabase
        .from('products')
        .update({
          quickbooks_item_id: item.id,
          quickbooks_item_name: item.name,
          quickbooks_item_type: item.type,
          quickbooks_sync_error: null,
          quickbooks_sync_status: 'created',
          quickbooks_synced_at: syncedAt,
        })
        .eq('id', product.id);
      if (error) throw error;
      createdCount += 1;
    } catch (error) {
      productErrorCount += 1;
      await supabase
        .from('products')
        .update({
          quickbooks_item_id: null,
          quickbooks_item_name: null,
          quickbooks_item_type: null,
          quickbooks_sync_error: error instanceof Error ? error.message : 'Unable to create QuickBooks item.',
          quickbooks_sync_status: 'sync_error',
          quickbooks_synced_at: syncedAt,
        })
        .eq('id', product.id);
    }
  }

  return { createdCount, productErrorCount };
}

function customerNameForOrder(order: QuickBooksInvoiceOrder) {
  return cleanText(relatedOne(order.centers)?.name)
    || cleanText(order.shipping_company)
    || cleanText(order.shipping_name)
    || cleanText(relatedOne(order.profiles)?.full_name)
    || cleanText(relatedOne(order.profiles)?.email)
    || `Sobrew order ${order.id.slice(0, 8)}`;
}

function invoiceEmailForOrder(order: QuickBooksInvoiceOrder) {
  const center = relatedOne(order.centers);
  const profile = relatedOne(order.profiles);
  return cleanText(center?.billing_email) || cleanText(profile?.email);
}

function splitEmailAddresses(value: unknown) {
  return cleanText(value)
    .split(/[,;\n]+/)
    .map((address) => address.trim())
    .filter(Boolean);
}

function emailAddressesFromValue(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string' || typeof value === 'number') return splitEmailAddresses(value);
  if (Array.isArray(value)) return value.flatMap(emailAddressesFromValue);
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return [
      ...emailAddressesFromValue(objectValue.Address),
      ...emailAddressesFromValue(objectValue.address),
      ...emailAddressesFromValue(objectValue.EmailAddress),
      ...emailAddressesFromValue(objectValue.emailAddress),
      ...emailAddressesFromValue(objectValue.Email),
      ...emailAddressesFromValue(objectValue.email),
      ...emailAddressesFromValue(objectValue.Value),
      ...emailAddressesFromValue(objectValue.value),
    ];
  }
  return [];
}

function uniqueEmailAddresses(addresses: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const address of addresses.map(cleanText).filter(Boolean)) {
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(address);
  }
  return unique;
}

function emailAddressString(addresses: string[]) {
  return uniqueEmailAddresses(addresses).join(', ');
}

function emailAddressPayload(addresses: string[]) {
  const address = emailAddressString(addresses);
  return address ? { Address: address } : undefined;
}

function quickBooksCustomerCcEmails(customer: unknown) {
  const record = customer && typeof customer === 'object' ? customer as Record<string, unknown> : {};
  const directCcEmails = [
    record.BillEmailCc,
    record.BillEmailCC,
    record.CcEmailAddr,
    record.CCEmailAddr,
    record.CcEmailAddress,
    record.CCEmailAddress,
    record.Cc,
    record.CC,
    (record.EmailDeliveryInfo as Record<string, unknown> | undefined)?.DeliveryAddressCc,
    (record.DeliveryInfo as Record<string, unknown> | undefined)?.DeliveryAddressCc,
  ].flatMap(emailAddressesFromValue);
  const contactInfo = Array.isArray(record.OtherContactInfo) ? record.OtherContactInfo : [];
  const contactCcEmails = contactInfo.flatMap((contact) => {
    const contactRecord = contact && typeof contact === 'object' ? contact as Record<string, unknown> : {};
    const label = [
      contactRecord.Name,
      contactRecord.Type,
      contactRecord.ContactType,
      contactRecord.Label,
    ].map(cleanText).join(' ').toLowerCase();
    return label.includes('cc') ? emailAddressesFromValue(contact) : [];
  });
  return uniqueEmailAddresses([...directCcEmails, ...contactCcEmails]);
}

export function buildQuickBooksInvoiceEmailRecipients(
  order: QuickBooksInvoiceOrder,
  quickBooksCustomer?: unknown
): QuickBooksInvoiceEmailRecipients {
  const quickBooksCustomerRecord = quickBooksCustomer && typeof quickBooksCustomer === 'object'
    ? quickBooksCustomer as Record<string, unknown>
    : {};
  const quickBooksPrimaryEmails = uniqueEmailAddresses([
    ...emailAddressesFromValue(quickBooksCustomerRecord.PrimaryEmailAddr),
    ...emailAddressesFromValue(quickBooksCustomerRecord.BillEmail),
  ]);
  const portalFallbackEmails = splitEmailAddresses(invoiceEmailForOrder(order));
  const to = quickBooksPrimaryEmails.length ? quickBooksPrimaryEmails.slice(0, 1) : portalFallbackEmails;
  const cc = uniqueEmailAddresses([
    ...quickBooksPrimaryEmails.slice(1),
    ...quickBooksCustomerCcEmails(quickBooksCustomerRecord),
  ]
    .filter((address) => !to.some((toAddress) => toAddress.toLowerCase() === address.toLowerCase())));
  const all = uniqueEmailAddresses([...to, ...cc]);
  return {
    all,
    cc,
    display: all.length ? emailAddressString(all) : null,
    to,
  };
}

function quickBooksCustomerRefFromCenter(order: QuickBooksInvoiceOrder): QuickBooksRef {
  const center = relatedOne(order.centers);
  const quickBooksCustomerId = cleanText(center?.quickbooks_customer_id);
  if (!quickBooksCustomerId) {
    throw new QuickBooksConfigurationError('Map this portal center to a QuickBooks customer before invoicing.');
  }
  return {
    name: cleanText(center?.quickbooks_display_name) || customerNameForOrder(order),
    value: quickBooksCustomerId,
  };
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

function centerUpdateFromQuickBooksCustomer(customer: QuickBooksCustomerRecord) {
  return {
    billing_address1: customer.billAddress.line1,
    billing_address2: customer.billAddress.line2,
    billing_city: customer.billAddress.city,
    billing_email: customer.email,
    billing_phone: customer.phone,
    billing_state: customer.billAddress.state,
    billing_zip: customer.billAddress.postalCode,
    legal_name: customer.companyName || customer.displayName,
    quickbooks_company_name: customer.companyName,
    quickbooks_customer_id: customer.id,
    quickbooks_display_name: customer.displayName,
    quickbooks_fully_qualified_name: customer.fullyQualifiedName,
    quickbooks_sync_error: null,
    quickbooks_sync_status: 'matched',
    quickbooks_synced_at: new Date().toISOString(),
  };
}

function quickBooksAddressPayload(address: QuickBooksCustomerAddress | undefined) {
  if (!address) return undefined;
  const line1 = cleanText(address.line1);
  const city = cleanText(address.city);
  const state = cleanText(address.state);
  const postalCode = cleanText(address.postalCode);
  if (!line1 && !city && !state && !postalCode) return undefined;
  return {
    City: city || undefined,
    CountrySubDivisionCode: state || undefined,
    Line1: line1 || undefined,
    Line2: cleanText(address.line2) || undefined,
    PostalCode: postalCode || undefined,
  };
}

function billingAddressFromPortalCenter(center: QuickBooksPortalCenterWithLocations): QuickBooksCustomerAddress | undefined {
  const billingAddress: QuickBooksCustomerAddress = {
    city: cleanText(center.billing_city) || null,
    line1: cleanText(center.billing_address1) || null,
    line2: cleanText(center.billing_address2) || null,
    postalCode: cleanText(center.billing_zip) || null,
    state: cleanText(center.billing_state) || null,
  };
  if (quickBooksAddressPayload(billingAddress)) return billingAddress;

  const fallbackLocation = (center.center_locations ?? []).find((location) => location.is_active !== false) ?? center.center_locations?.[0];
  if (!fallbackLocation) return undefined;
  return {
    city: cleanText(fallbackLocation.city) || null,
    line1: cleanText(fallbackLocation.address1) || null,
    line2: cleanText(fallbackLocation.address2) || null,
    postalCode: cleanText(fallbackLocation.zip) || null,
    state: cleanText(fallbackLocation.state) || null,
  };
}

export function buildQuickBooksCustomerPayloadFromCenter(center: QuickBooksPortalCenterWithLocations) {
  const displayName = cleanText(center.name) || `Portal center ${center.id.slice(0, 8)}`;
  const companyName = cleanText(center.legal_name) || displayName;
  const email = cleanText(center.billing_email);
  const phone = cleanText(center.billing_phone);
  const address = quickBooksAddressPayload(billingAddressFromPortalCenter(center));
  return {
    BillAddr: address,
    CompanyName: companyName,
    DisplayName: displayName,
    PrimaryEmailAddr: email ? { Address: email } : undefined,
    PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
    ShipAddr: address,
  };
}

export function buildQuickBooksInvoicePayload(
  order: QuickBooksInvoiceOrder,
  customerRef: QuickBooksRef,
  options: { docNumber?: string; emailRecipients?: QuickBooksInvoiceEmailRecipients; invoiceDate?: Date; taxableStates?: string[] } = {}
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
        ItemRef: quickBooksLineItemRef(item),
        Qty: qty,
        TaxCodeRef: { value: lineTaxCode },
        UnitPrice: unitPrice,
      },
    };
  }).filter((line) => line.Amount > 0);
  if (!lineItems.length) throw new Error('This order has no invoiceable line items.');

  const emailRecipients = options.emailRecipients ?? buildQuickBooksInvoiceEmailRecipients(order);
  const shippingAddress = addressForOrder(order);
  const privateNoteParts = [`Sobrew order ${order.id}`];
  const orderNotes = cleanText(order.notes);
  if (orderNotes) privateNoteParts.push(orderNotes);

  return {
    BillEmail: emailAddressPayload(emailRecipients.to),
    BillEmailCc: emailAddressPayload(emailRecipients.cc),
    CustomerMemo: {
      value: `Invoice for Sobrew order ${order.id.slice(0, 8)}.`,
    },
    CustomerRef: customerRef,
    DocNumber: options.docNumber ? cleanText(options.docNumber) : undefined,
    Line: lineItems,
    PrivateNote: privateNoteParts.join('\n'),
    ShipAddr: shippingAddress,
    ShipDate: quickBooksDate(options.invoiceDate),
    ShipMethodRef: { value: QUICKBOOKS_DEFAULT_SHIP_VIA },
    TrackingNum: QUICKBOOKS_DEFAULT_TRACKING_NOTE,
  };
}

export function buildQuickBooksSavedPaymentChargePayload(
  method: QuickBooksSavedPaymentMethod,
  amountCents: number,
  description: string
) {
  const amount = amountStringFromCents(amountCents);
  if (method.type === 'card') {
    return {
      path: '/charges',
      payload: {
        amount,
        capture: true,
        cardOnFile: method.id,
        context: {
          isEcommerce: true,
          mobile: false,
        },
        currency: 'USD',
        description,
      },
    };
  }

  return {
    path: '/echecks',
    payload: {
      amount,
      bankAccountOnFile: method.id,
      context: {
        deviceInfo: {
          id: 'sobrew-portal',
          type: 'server',
        },
        isEcommerce: true,
        mobile: false,
      },
      description,
      paymentMode: 'WEB',
    },
  };
}

export function buildQuickBooksInvoicePaymentPayload({
  amountCents,
  chargeId,
  chargeStatus,
  customerRef,
  invoiceId,
  invoiceNumber,
  paymentMethodLabel,
}: {
  amountCents: number;
  chargeId: string;
  chargeStatus: string;
  customerRef: QuickBooksRef;
  invoiceId: string;
  invoiceNumber: string | null;
  paymentMethodLabel: string;
}) {
  const amount = amountFromCents(amountCents);
  return {
    CustomerRef: customerRef,
    Line: [
      {
        Amount: amount,
        LinkedTxn: [
          {
            TxnId: invoiceId,
            TxnType: 'Invoice',
          },
        ],
      },
    ],
    PaymentRefNum: chargeId,
    PrivateNote: [
      `Sobrew payment ${chargeId}`,
      invoiceNumber ? `Invoice ${invoiceNumber}` : null,
      `QuickBooks Payments status ${chargeStatus || 'unknown'}`,
      paymentMethodLabel,
    ].filter(Boolean).join('\n'),
    TotalAmt: amount,
    TxnDate: quickBooksDate(),
  };
}

async function getQuickBooksInvoice(connection: QuickBooksConnection, invoiceId: string): Promise<QuickBooksInvoiceRecord | null> {
  const result = await quickBooksRequest(connection, `/invoice/${encodeURIComponent(invoiceId)}`);
  return result?.Invoice ?? null;
}

async function updateQuickBooksInvoiceDocNumber(
  connection: QuickBooksConnection,
  invoice: QuickBooksInvoiceRecord,
  docNumber: string
) {
  const invoiceId = cleanText(invoice.Id);
  const syncToken = cleanText(invoice.SyncToken);
  if (!invoiceId || !syncToken) throw new Error('QuickBooks invoice is missing the update token needed to add an invoice number.');
  const result = await quickBooksRequest(connection, '/invoice?operation=update', {
    body: JSON.stringify({
      DocNumber: docNumber,
      Id: invoiceId,
      SyncToken: syncToken,
      sparse: true,
    }),
    method: 'POST',
  });
  return cleanText(result?.Invoice?.DocNumber) || docNumber;
}

async function ensureQuickBooksInvoiceDocNumber(
  connection: QuickBooksConnection,
  invoiceId: string,
  docNumber: string,
  invoice?: QuickBooksInvoiceRecord | null
) {
  const targetDocNumber = cleanText(docNumber);
  if (!targetDocNumber) throw new Error('Assign a portal invoice number before creating the QuickBooks invoice.');
  const existingDocNumber = cleanText(invoice?.DocNumber);
  if (existingDocNumber === targetDocNumber) return existingDocNumber;

  const loadedInvoice = invoice?.SyncToken ? invoice : await getQuickBooksInvoice(connection, invoiceId);
  const loadedDocNumber = cleanText(loadedInvoice?.DocNumber);
  if (loadedDocNumber === targetDocNumber) return loadedDocNumber;

  return updateQuickBooksInvoiceDocNumber(connection, loadedInvoice ?? { Id: invoiceId }, targetDocNumber);
}

async function tryEnsureQuickBooksInvoiceDocNumber(
  connection: QuickBooksConnection,
  invoiceId: string,
  docNumber: string,
  invoice?: QuickBooksInvoiceRecord | null
) {
  try {
    return {
      docNumber: await ensureQuickBooksInvoiceDocNumber(connection, invoiceId, docNumber, invoice),
      error: null,
    };
  } catch (error) {
    return {
      docNumber: null,
      error: error instanceof Error ? error.message : 'QuickBooks invoice was created, but no invoice number could be assigned.',
    };
  }
}

async function assignQuickBooksInvoiceDocNumber(orderId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('assign_quickbooks_invoice_doc_number', { order_id: orderId });
  if (error) throw new Error(`Unable to assign QuickBooks invoice number: ${error.message}`);
  const docNumber = cleanText(data);
  if (!docNumber) throw new Error('Unable to assign QuickBooks invoice number.');
  return docNumber;
}

async function readQuickBooksInvoice(connection: QuickBooksConnection, invoiceId: string) {
  const payload = await quickBooksRequest(connection, `/invoice/${encodeURIComponent(invoiceId)}`);
  return payload?.Invoice ?? null;
}

async function updateQuickBooksInvoiceEmailRecipients(
  connection: QuickBooksConnection,
  invoiceId: string,
  recipients: QuickBooksInvoiceEmailRecipients,
  existingInvoice?: QuickBooksInvoiceRecord | null
) {
  if (!recipients.to.length && !recipients.cc.length) return;
  const invoice = cleanText(existingInvoice?.Id) && cleanText(existingInvoice?.SyncToken)
    ? existingInvoice
    : await readQuickBooksInvoice(connection, invoiceId);
  const id = cleanText(invoice?.Id);
  const syncToken = cleanText(invoice?.SyncToken);
  if (!id || !syncToken) throw new Error('QuickBooks invoice is missing the update token needed to add email recipients.');
  await quickBooksRequest(connection, '/invoice?operation=update', {
    body: JSON.stringify({
      BillEmail: emailAddressPayload(recipients.to),
      BillEmailCc: emailAddressPayload(recipients.cc),
      Id: id,
      SyncToken: syncToken,
      sparse: true,
    }),
    method: 'POST',
  });
}

async function sendQuickBooksInvoiceEmail(connection: QuickBooksConnection, invoiceId: string, recipients: QuickBooksInvoiceEmailRecipients) {
  const sendTo = emailAddressString(recipients.to);
  if (!sendTo) throw new Error('Add a primary billing email before sending the QuickBooks invoice.');
  await quickBooksRequest(connection, `/invoice/${encodeURIComponent(invoiceId)}/send?sendTo=${encodeURIComponent(sendTo)}`, {
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    method: 'POST',
  });
  return new Date().toISOString();
}

async function trySendQuickBooksInvoiceEmail(
  connection: QuickBooksConnection,
  invoiceId: string,
  recipients: QuickBooksInvoiceEmailRecipients,
  options: { updateInvoice?: QuickBooksInvoiceRecord | true } = {}
) {
  try {
    if (options.updateInvoice) {
      await updateQuickBooksInvoiceEmailRecipients(
        connection,
        invoiceId,
        recipients,
        options.updateInvoice === true ? null : options.updateInvoice
      );
    }
    return {
      emailError: null,
      emailSentAt: await sendQuickBooksInvoiceEmail(connection, invoiceId, recipients),
    };
  } catch (error) {
    return {
      emailError: error instanceof Error ? error.message : 'QuickBooks invoice was created, but the email could not be sent.',
      emailSentAt: null,
    };
  }
}

async function downloadQuickBooksInvoicePdf(connection: QuickBooksConnection, invoiceId: string) {
  return quickBooksBinaryRequest(connection, `/invoice/${encodeURIComponent(invoiceId)}/pdf`);
}

export async function getQuickBooksInvoicePdf(invoiceId: string): Promise<Buffer> {
  const cleanInvoiceId = cleanText(invoiceId);
  if (!cleanInvoiceId) throw new Error('Create the QuickBooks invoice before downloading its PDF.');
  const connection = await getAuthorizedConnection();
  return downloadQuickBooksInvoicePdf(connection, cleanInvoiceId);
}

export async function getQuickBooksInvoicePdfForOrder(orderId: string): Promise<QuickBooksInvoicePdf> {
  const supabase = getSupabaseAdmin();
  const { data: order, error } = await supabase
    .from('orders')
    .select('id,quickbooks_invoice_id,quickbooks_invoice_doc_number')
    .eq('id', orderId)
    .single();
  if (error || !order) throw new Error(error?.message || 'Order not found.');
  const invoiceId = cleanText((order as any).quickbooks_invoice_id);
  if (!invoiceId) throw new Error('Create the QuickBooks invoice before downloading its PDF.');
  const content = await getQuickBooksInvoicePdf(invoiceId);
  const invoiceNumber = cleanText((order as any).quickbooks_invoice_doc_number) || invoiceId;
  return {
    content,
    filename: `Sobrew-Invoice-${invoiceNumber}.pdf`,
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

export async function createQuickBooksInvoiceForOrder(
  orderId: string,
  options: { sendQuickBooksEmail?: boolean } = {}
): Promise<CreatedQuickBooksInvoice> {
  const sendQuickBooksEmailOption = options.sendQuickBooksEmail ?? true;
  const supabase = getSupabaseAdmin();
  const { data: order, error } = await supabase
    .from('orders')
    .select('id,status,archived_at,created_at,notes,subtotal_cents,quickbooks_invoice_id,quickbooks_invoice_doc_number,quickbooks_invoice_url,shipping_company,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip,profiles(email,full_name),centers(name,billing_email,customer_tax_status,quickbooks_customer_id,quickbooks_display_name),order_items(qty,unit_price_cents,line_total_cents,product_id,product_name_snapshot,products(name,sku,quickbooks_item_id,quickbooks_item_name))')
    .eq('id', orderId)
    .single();
  if (error || !order) throw new Error(error?.message || 'Order not found.');
  if ((order as any).archived_at) throw new Error('Archived orders cannot be invoiced.');
  if ((order as any).status !== 'Shipped') throw new Error('Only shipped orders can be invoiced.');

  const connection = await getAuthorizedConnection();
  const environment = connection.environment === 'production' ? 'production' : 'sandbox';
  const customerName = customerNameForOrder(order as QuickBooksInvoiceOrder);
  const customerRef = quickBooksCustomerRefFromCenter(order as QuickBooksInvoiceOrder);
  const quickBooksCustomer = await tryReadQuickBooksCustomer(connection, customerRef.value);
  const emailRecipients = buildQuickBooksInvoiceEmailRecipients(order as QuickBooksInvoiceOrder, quickBooksCustomer);
  const emailTo = emailAddressString(emailRecipients.to) || null;
  const emailCc = emailAddressString(emailRecipients.cc) || null;
  const amountCents = invoiceableTotalCents(order as QuickBooksInvoiceOrder);
  if ((order as any).quickbooks_invoice_id) {
    const portalDocNumber = await assignQuickBooksInvoiceDocNumber(orderId);
    const docNumberResult = await tryEnsureQuickBooksInvoiceDocNumber(
      connection,
      String((order as any).quickbooks_invoice_id),
      portalDocNumber
    );
    if (!docNumberResult.docNumber) {
      return {
        amountCents,
        customerName,
        docNumber: null,
        emailCc,
        emailError: `QuickBooks invoice was not emailed because no invoice number could be assigned. ${docNumberResult.error}`,
        emailRecipients: emailRecipients.display,
        emailSentAt: null,
        emailTo,
        id: String((order as any).quickbooks_invoice_id),
        url: cleanText((order as any).quickbooks_invoice_url) || quickBooksAppInvoiceUrl(environment, String((order as any).quickbooks_invoice_id)),
      };
    }
    const emailResult = sendQuickBooksEmailOption
      ? await trySendQuickBooksInvoiceEmail(connection, String((order as any).quickbooks_invoice_id), emailRecipients, { updateInvoice: true })
      : { emailError: null, emailSentAt: null };
    return {
      amountCents,
      customerName,
      docNumber: docNumberResult.docNumber,
      emailCc,
      emailError: emailResult.emailError,
      emailRecipients: emailRecipients.display,
      emailSentAt: emailResult.emailSentAt,
      emailTo,
      id: String((order as any).quickbooks_invoice_id),
      url: cleanText((order as any).quickbooks_invoice_url) || quickBooksAppInvoiceUrl(environment, String((order as any).quickbooks_invoice_id)),
    };
  }

  const salesTaxSettings = await getQuickBooksSalesTaxSettings();
  const missingMappedItems = ((order as any).order_items ?? [])
    .filter((item: QuickBooksOrderItem) => !cleanText(relatedOne(item.products)?.quickbooks_item_id))
    .map((item: QuickBooksOrderItem) => productNameForItem(item));
  if (missingMappedItems.length) {
    throw new Error(`Map these products to QuickBooks before invoicing: ${[...new Set(missingMappedItems)].join(', ')}`);
  }
  if (!((order as any).order_items ?? []).some((item: QuickBooksOrderItem) => amountFromCents(item.line_total_cents) > 0)) {
    throw new Error('This order has no invoiceable line items.');
  }
  const portalDocNumber = await assignQuickBooksInvoiceDocNumber(orderId);
  const invoicePayload = buildQuickBooksInvoicePayload(order as QuickBooksInvoiceOrder, customerRef, { docNumber: portalDocNumber, emailRecipients, taxableStates: salesTaxSettings.states });
  const created = await quickBooksRequest(connection, '/invoice', {
    body: JSON.stringify(invoicePayload),
    method: 'POST',
  });
  const invoice = created?.Invoice;
  if (!invoice?.Id) throw new Error('QuickBooks did not return an invoice ID.');
  const docNumberResult = await tryEnsureQuickBooksInvoiceDocNumber(connection, String(invoice.Id), portalDocNumber, invoice);
  if (!docNumberResult.docNumber) {
    return {
      amountCents,
      customerName,
      docNumber: null,
      emailCc,
      emailError: `QuickBooks invoice was created, but it was not emailed because no invoice number could be assigned. ${docNumberResult.error}`,
      emailRecipients: emailRecipients.display,
      emailSentAt: null,
      emailTo,
      id: String(invoice.Id),
      url: quickBooksAppInvoiceUrl(environment, String(invoice.Id)),
    };
  }
  const emailResult = sendQuickBooksEmailOption
    ? await trySendQuickBooksInvoiceEmail(connection, String(invoice.Id), emailRecipients)
    : { emailError: null, emailSentAt: null };
  return {
    amountCents,
    customerName,
    docNumber: docNumberResult.docNumber,
    emailCc,
    emailError: emailResult.emailError,
    emailRecipients: emailRecipients.display,
    emailSentAt: emailResult.emailSentAt,
    emailTo,
    id: String(invoice.Id),
    url: quickBooksAppInvoiceUrl(environment, String(invoice.Id)),
  };
}

function paymentChargeRequestId(orderId: string, invoiceId: string, paymentMethodId: string) {
  return `sobrew-${orderId}-${invoiceId}-${paymentMethodId}`
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(0, 50);
}

function paymentChargeWasDeclined(status: string) {
  return ['CANCELLED', 'DECLINED', 'FAILED', 'REFUNDED', 'VOIDED'].includes(status.toUpperCase());
}

async function createQuickBooksPaymentCharge(
  connection: QuickBooksConnection,
  orderId: string,
  invoiceId: string,
  method: QuickBooksSavedPaymentMethod,
  amountCents: number,
  description: string
) {
  const request = buildQuickBooksSavedPaymentChargePayload(method, amountCents, description);
  const charge = await quickBooksPaymentsRequest(connection, request.path, {
    body: JSON.stringify(request.payload),
    headers: {
      'Request-Id': paymentChargeRequestId(orderId, invoiceId, method.id),
    },
    method: 'POST',
  });
  const chargeId = cleanText(charge?.id);
  const chargeStatus = cleanText(charge?.status) || 'UNKNOWN';
  if (!chargeId) throw new Error('QuickBooks Payments did not return a payment transaction ID.');
  if (paymentChargeWasDeclined(chargeStatus)) {
    throw new Error(`QuickBooks Payments did not accept the payment: ${chargeStatus}.`);
  }
  return { charge, chargeId, chargeStatus };
}

export async function createQuickBooksPaidInvoiceForOrder(orderId: string): Promise<CreatedQuickBooksPaidInvoice> {
  const cleanOrderId = cleanText(orderId);
  if (!cleanOrderId) throw new Error('Order is required.');

  const supabase = getSupabaseAdmin();
  const { data: order, error } = await supabase
    .from('orders')
    .select('id,status,archived_at,created_at,notes,subtotal_cents,quickbooks_payment_charge_id,quickbooks_payment_id,quickbooks_payment_status,shipping_company,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip,profiles(email,full_name),centers(id,name,billing_email,customer_tax_status,quickbooks_customer_id,quickbooks_display_name,quickbooks_payment_method_brand,quickbooks_payment_method_exp_month,quickbooks_payment_method_exp_year,quickbooks_payment_method_id,quickbooks_payment_method_last4,quickbooks_payment_method_type),order_items(qty,unit_price_cents,line_total_cents,product_id,product_name_snapshot,products(name,sku,quickbooks_item_id,quickbooks_item_name))')
    .eq('id', cleanOrderId)
    .single();
  if (error || !order) throw new Error(error?.message || 'Order not found.');
  if ((order as any).archived_at) throw new Error('Archived orders cannot be invoiced.');
  if ((order as any).status !== 'Shipped') throw new Error('Only shipped orders can be invoiced.');
  if (cleanText((order as any).quickbooks_payment_id)) {
    throw new Error('This order already has a recorded QuickBooks payment.');
  }

  const connection = await getAuthorizedConnection();
  const customerRef = quickBooksCustomerRefFromCenter(order as QuickBooksInvoiceOrder);
  const method = await resolveSavedPaymentMethodForOrder(connection, supabase, order as QuickBooksInvoiceOrder, customerRef);
  const invoice = await createQuickBooksInvoiceForOrder(cleanOrderId, { sendQuickBooksEmail: false });
  const description = `Sobrew invoice ${invoice.docNumber || invoice.id}`;
  const invoiceAuditUpdate = await supabase
    .from('orders')
    .update({
      quickbooks_invoice_doc_number: invoice.docNumber,
      quickbooks_invoice_email_to: invoice.emailRecipients ?? invoice.emailTo,
      quickbooks_invoice_id: invoice.id,
      quickbooks_invoice_url: invoice.url,
    })
    .eq('id', cleanOrderId);
  if (invoiceAuditUpdate.error) {
    throw new Error(`Unable to save QuickBooks invoice details before payment: ${invoiceAuditUpdate.error.message}`);
  }
  let paymentChargeId = cleanText((order as any).quickbooks_payment_charge_id);
  let paymentChargeStatus = cleanText((order as any).quickbooks_payment_status);
  if (!paymentChargeId) {
    const chargeResult = await createQuickBooksPaymentCharge(
      connection,
      cleanOrderId,
      invoice.id,
      method,
      invoice.amountCents,
      description
    );
    paymentChargeId = chargeResult.chargeId;
    paymentChargeStatus = chargeResult.chargeStatus;
    const chargeAuditUpdate = await supabase
      .from('orders')
      .update({
        quickbooks_invoice_doc_number: invoice.docNumber,
        quickbooks_invoice_email_to: invoice.emailRecipients ?? invoice.emailTo,
        quickbooks_invoice_id: invoice.id,
        quickbooks_invoice_url: invoice.url,
        quickbooks_payment_charge_id: paymentChargeId,
        quickbooks_payment_charged_at: new Date().toISOString(),
        quickbooks_payment_method_label: method.label,
        quickbooks_payment_method_type: method.type,
        quickbooks_payment_status: paymentChargeStatus,
      })
      .eq('id', cleanOrderId);
    if (chargeAuditUpdate.error) {
      throw new Error(`Unable to save QuickBooks payment charge details: ${chargeAuditUpdate.error.message}`);
    }
  }

  const paymentPayload = buildQuickBooksInvoicePaymentPayload({
    amountCents: invoice.amountCents,
    chargeId: paymentChargeId,
    chargeStatus: paymentChargeStatus,
    customerRef,
    invoiceId: invoice.id,
    invoiceNumber: invoice.docNumber,
    paymentMethodLabel: method.label,
  });
  const paymentResult = await quickBooksRequest(connection, '/payment', {
    body: JSON.stringify(paymentPayload),
    method: 'POST',
  });
  const paymentId = cleanText(paymentResult?.Payment?.Id);
  if (!paymentId) throw new Error('QuickBooks did not return a payment ID.');

  return {
    ...invoice,
    paymentChargeId,
    paymentChargeStatus,
    paymentId,
    paymentMethodLabel: method.label,
    paymentMethodType: method.type,
  };
}

export async function getQuickBooksConnectionStatus(): Promise<QuickBooksConnectionStatus> {
  const config = getOAuthConfig();
  const connection = await getStoredConnection().catch(() => null);
  const connectionEnvironment = connection?.environment === 'production' ? 'production' : connection?.environment === 'sandbox' ? 'sandbox' : null;
  return {
    connected: Boolean(connection?.realm_id),
    environment: connectionEnvironment ?? config.environment,
    grantedScopes: cleanText(connection?.scope).split(/\s+/).filter(Boolean),
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

export async function getQuickBooksCustomerSummary(): Promise<QuickBooksCustomerSummary> {
  try {
    const connection = await getAuthorizedConnection();
    const result = await quickBooksQuery(connection, 'SELECT COUNT(*) FROM Customer WHERE Active = true');
    const totalCount = Number(result?.QueryResponse?.totalCount ?? result?.QueryResponse?.TotalCount);
    return {
      activeCustomerCount: Number.isFinite(totalCount) ? totalCount : null,
      error: null,
    };
  } catch (error) {
    return {
      activeCustomerCount: null,
      error: error instanceof Error ? error.message : 'Unable to read QuickBooks customers.',
    };
  }
}

export async function getQuickBooksInvoiceReceivables(invoiceIds: string[]): Promise<QuickBooksInvoiceReceivablesResult> {
  const uniqueIds = [...new Set(invoiceIds.map(cleanText).filter(Boolean))];
  if (!uniqueIds.length) return { error: null, invoices: [], missingIds: [] };

  try {
    const connection = await getAuthorizedConnection();
    const invoices: QuickBooksInvoiceReceivable[] = [];
    const foundIds = new Set<string>();
    const today = quickBooksDate();

    for (let index = 0; index < uniqueIds.length; index += 30) {
      const chunk = uniqueIds.slice(index, index + 30);
      const idList = chunk.map((id) => `'${escapeQueryString(id)}'`).join(',');
      const result = await quickBooksQuery(connection, `SELECT * FROM Invoice WHERE Id IN (${idList}) MAXRESULTS ${chunk.length}`);
      for (const invoice of quickBooksQueryInvoices(result)) {
        const receivable = normalizeQuickBooksInvoiceReceivable(invoice, today);
        if (receivable) {
          foundIds.add(receivable.id);
          invoices.push(receivable);
        }
      }
    }

    return {
      error: null,
      invoices,
      missingIds: uniqueIds.filter((id) => !foundIds.has(id)),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to pull QuickBooks invoice balances.',
      invoices: [],
      missingIds: [],
    };
  }
}

export async function getQuickBooksActiveCustomers(limit = 1000): Promise<QuickBooksCustomersResult> {
  try {
    const connection = await getAuthorizedConnection();
    const customers: QuickBooksCustomerRecord[] = [];
    let startPosition = 1;

    while (customers.length < limit) {
      const pageSize = Math.min(100, limit - customers.length);
      const result = await quickBooksQuery(
        connection,
        `SELECT * FROM Customer WHERE Active = true STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
      );
      const pageCustomers = quickBooksQueryCustomers(result)
        .map(normalizeQuickBooksCustomer)
        .filter((customer): customer is QuickBooksCustomerRecord => Boolean(customer));
      customers.push(...pageCustomers);
      if (pageCustomers.length < pageSize) {
        return { customers, error: null, truncated: false };
      }
      startPosition += pageSize;
    }

    return { customers, error: null, truncated: true };
  } catch (error) {
    return {
      customers: [],
      error: error instanceof Error ? error.message : 'Unable to pull QuickBooks customers.',
      truncated: false,
    };
  }
}

export async function linkPortalCenterToQuickBooksCustomer({
  centerId,
  customerId,
  mappingNote,
}: {
  centerId: string;
  customerId: string;
  mappingNote?: string | null;
}) {
  const connection = await getAuthorizedConnection();
  const result = await quickBooksQuery(connection, `SELECT * FROM Customer WHERE Id = '${escapeQueryString(customerId)}'`);
  const customer = quickBooksQueryCustomers(result)
    .map(normalizeQuickBooksCustomer)
    .find((row): row is QuickBooksCustomerRecord => Boolean(row));
  if (!customer) throw new Error('That QuickBooks customer was not found.');

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('centers')
    .update({
      ...centerUpdateFromQuickBooksCustomer(customer),
      quickbooks_mapping_note: cleanText(mappingNote) || null,
    })
    .eq('id', centerId);
  if (error) throw new Error(`Unable to save QuickBooks customer mapping: ${error.message}`);
  return customer;
}

export async function createQuickBooksCustomerFromPortalCenter(centerId: string) {
  const connection = await getAuthorizedConnection();
  const supabase = getSupabaseAdmin();
  const { data: center, error: centerError } = await supabase
    .from('centers')
    .select('id,name,is_active,legal_name,billing_email,billing_phone,billing_address1,billing_address2,billing_city,billing_state,billing_zip,quickbooks_customer_id,center_locations(name,address1,address2,city,state,zip,is_active)')
    .eq('id', centerId)
    .single();
  if (centerError || !center) throw new Error(centerError?.message || 'Portal center not found.');
  if ((center as QuickBooksPortalCenterWithLocations).quickbooks_customer_id) {
    throw new Error('This center is already mapped to QuickBooks.');
  }

  const payload = buildQuickBooksCustomerPayloadFromCenter(center as QuickBooksPortalCenterWithLocations);
  const created = await quickBooksRequest(connection, '/customer', {
    body: JSON.stringify(payload),
    method: 'POST',
  });
  const customer = normalizeQuickBooksCustomer(created?.Customer);
  if (!customer) throw new Error('QuickBooks did not return a customer ID.');

  const { error: updateError } = await supabase
    .from('centers')
    .update({
      ...centerUpdateFromQuickBooksCustomer(customer),
      quickbooks_mapping_note: 'Created from portal center',
    })
    .eq('id', centerId);
  if (updateError) throw new Error(`QuickBooks customer was created, but the portal mapping could not be saved: ${updateError.message}`);
  return customer;
}

export async function clearPortalCenterQuickBooksCustomer(centerId: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from('centers')
    .update({
      billing_address1: null,
      billing_address2: null,
      billing_city: null,
      billing_email: null,
      billing_phone: null,
      billing_state: null,
      billing_zip: null,
      legal_name: null,
      quickbooks_company_name: null,
      quickbooks_customer_id: null,
      quickbooks_display_name: null,
      quickbooks_fully_qualified_name: null,
      quickbooks_mapping_note: null,
      quickbooks_sync_error: null,
      quickbooks_sync_status: 'unmapped',
      quickbooks_synced_at: null,
    })
    .eq('id', centerId);
  if (error) throw new Error(`Unable to clear QuickBooks customer mapping: ${error.message}`);
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

export async function resetQuickBooksProductsFromPortal(products: QuickBooksPortalProduct[]): Promise<QuickBooksProductResetResult> {
  const activePortalProducts = products
    .filter((product) => product.active !== false)
    .map((product) => ({
      ...product,
      name: quickBooksItemName(product.name),
    }));
  if (!activePortalProducts.length) {
    throw new Error('No active portal products were found to sync.');
  }

  const connection = await getAuthorizedConnection();
  const incomeAccountRef = await resolveProductIncomeAccount(connection);
  const supabase = getSupabaseAdmin();
  const archivedAt = new Date();
  const existingItemsResult = await getQuickBooksActiveItems(5000);
  if (existingItemsResult.error) throw new Error(existingItemsResult.error);
  if (existingItemsResult.truncated) {
    throw new Error('QuickBooks has more than 5,000 active items. Narrow the cleanup before running the product reset.');
  }

  const itemsToArchive = existingItemsResult.items.filter((item) => item.type !== 'Category');
  const archiveErrors: string[] = [];
  let inactivatedCount = 0;
  for (const item of itemsToArchive) {
    try {
      await archiveQuickBooksItem(connection, item, archivedAt);
      inactivatedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown QuickBooks archive error.';
      archiveErrors.push(`Unable to inactivate QuickBooks item "${item.name}" (${item.id}): ${message}`);
    }
  }

  await supabase
    .from('products')
    .update({
      quickbooks_item_id: null,
      quickbooks_item_name: null,
      quickbooks_item_type: null,
      quickbooks_sync_error: null,
      quickbooks_sync_status: 'unmapped',
      quickbooks_synced_at: null,
    })
    .not('quickbooks_item_id', 'is', null);

  let createdCount = 0;
  let productErrorCount = 0;
  const syncedAt = new Date().toISOString();
  for (const product of activePortalProducts) {
    try {
      const item = await createQuickBooksProductItem(connection, product, incomeAccountRef);
      const { error } = await supabase
        .from('products')
        .update({
          quickbooks_item_id: item.id,
          quickbooks_item_name: item.name,
          quickbooks_item_type: item.type,
          quickbooks_sync_error: null,
          quickbooks_sync_status: 'created',
          quickbooks_synced_at: syncedAt,
        })
        .eq('id', product.id);
      if (error) throw error;
      createdCount += 1;
    } catch (error) {
      productErrorCount += 1;
      await supabase
        .from('products')
        .update({
          quickbooks_item_id: null,
          quickbooks_item_name: null,
          quickbooks_item_type: null,
          quickbooks_sync_error: error instanceof Error ? error.message : 'Unable to create QuickBooks item.',
          quickbooks_sync_status: 'sync_error',
          quickbooks_synced_at: syncedAt,
        })
        .eq('id', product.id);
    }
  }

  await supabase
    .from('products')
    .update({
      quickbooks_item_id: null,
      quickbooks_item_name: null,
      quickbooks_item_type: null,
      quickbooks_sync_error: null,
      quickbooks_sync_status: 'ignored',
      quickbooks_synced_at: syncedAt,
    })
    .eq('active', false);

  return {
    archiveErrorCount: archiveErrors.length,
    archiveErrors: archiveErrors.slice(0, 10),
    createdCount,
    inactivatedCount,
    productErrorCount,
  };
}

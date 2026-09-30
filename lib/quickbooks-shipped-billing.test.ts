import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  order: {} as Record<string, any>,
  center: {} as Record<string, any>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  failClaim: false,
  failCompletion: false,
}));

vi.mock('@/lib/env', () => ({ env: {
  quickBooksClientId: 'test-client', quickBooksClientSecret: 'test-secret',
  quickBooksEnvironment: 'sandbox', quickBooksMinorVersion: '75', siteUrl: 'https://example.com',
} }));

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  rpc: async () => ({ data: 'SO-1001', error: null }),
  from(table: string) {
    const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
    let values: Record<string, unknown> | null = null;
    let selected = false;
    let executed: { data: unknown; error: { message: string } | null; count?: number } | null = null;
    const result = () => {
      if (executed) return executed;
      let row: Record<string, unknown> | null;
      if (table === 'orders') row = database.order;
      else if (table === 'centers') row = database.center;
      else if (table === 'app_settings') row = { quickbooks_sales_tax_states: [] };
      else if (table === 'quickbooks_connections') row = {
        id: 'default', access_token: 'test-token', access_token_expires_at: '2099-01-01T00:00:00Z',
        environment: 'sandbox', realm_id: 'test-realm', refresh_token: 'test-refresh',
        scope: 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment',
      };
      else throw new Error(`Unexpected database table ${table}`);
      if (values && values.invoice_status === 'invoicing' && database.failClaim) {
        return executed = { data: null, error: { message: 'Billing claim unavailable' } };
      }
      if (values && values.invoice_status === 'invoiced' && database.failCompletion) {
        return executed = { data: null, error: { message: 'Billing completion unavailable' } };
      }
      if (!predicates.every((predicate) => predicate(row))) return executed = { data: null, error: null, count: 0 };
      if (values) {
        database.updates.push({ table, values: structuredClone(values) });
        Object.assign(row, values);
        if (table === 'centers') database.order.centers = structuredClone(database.center);
      }
      return executed = { data: !values || selected ? structuredClone(row) : null, error: null, count: 1 };
    };
    return {
      select() { selected = true; return this; },
      eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return this; },
      neq(key: string, value: unknown) { predicates.push((row) => row[key] !== value); return this; },
      is(key: string, value: unknown) { predicates.push((row) => (row[key] ?? null) === value); return this; },
      in(key: string, allowed: unknown[]) { predicates.push((row) => allowed.includes(row[key])); return this; },
      order() { return this; },
      limit() { return this; },
      update(next: Record<string, unknown>) { values = next; selected = false; return this; },
      single: async () => result(),
      maybeSingle: async () => result(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
  },
}) }));

import { fulfillShippedOrderBilling } from './quickbooks';

type RequestRecord = { url: URL; body: Record<string, any> | null; method: string; headers: Headers };
type FixtureOptions = {
  chargeStatus?: string;
  chargeTransportError?: boolean;
  chargeHttpError?: { status: number; errors?: unknown };
  failPayment?: boolean;
  failSend?: boolean;
  failMethodLookup?: boolean;
  liveCard?: boolean;
};

function quickBooksFixture(options: FixtureOptions = {}) {
  const requests: RequestRecord[] = [];
  let invoice: Record<string, any> = {
    Id: 'invoice-1', SyncToken: '0', DocNumber: 'SO-1001', CustomerRef: { value: 'customer-1' },
    TotalAmt: 26.40, Balance: 26.40,
  };
  let charge: Record<string, unknown> | null = null;
  const failure = (message: string) => Response.json({ Fault: { Error: [{ Message: message }] } }, { status: 503 });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = init.method ?? 'GET';
    requests.push({ url, body, method, headers: new Headers(init.headers) });
    if (url.pathname.endsWith('/customers/customer-1/cards')) {
      if (options.failMethodLookup) return failure('Saved payment lookup unavailable');
      return Response.json(options.liveCard ? [{ id: 'live-card', cardType: 'Visa', last4: '4242', status: 'ACTIVE' }] : []);
    }
    if (url.pathname.endsWith('/customers/customer-1/bank-accounts')) {
      if (options.failMethodLookup) return failure('Saved payment lookup unavailable');
      return Response.json([]);
    }
    if (url.pathname.endsWith('/customer/customer-1')) return Response.json({ Customer: {
      Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' }, BillEmailCc: { Address: 'qb-cc@example.com' },
    } });
    if (url.pathname.endsWith('/invoice/invoice-1/send')) {
      if (options.failSend) return failure('Invoice email unavailable');
      invoice.EmailStatus = 'EmailSent';
      return Response.json({ Invoice: invoice });
    }
    if (url.pathname.endsWith('/invoice/invoice-1')) return Response.json({ Invoice: invoice });
    if (url.pathname.endsWith('/invoice') && method === 'POST') {
      invoice = { ...invoice, ...body, SyncToken: String(Number(invoice.SyncToken) + 1) };
      return Response.json({ Invoice: invoice });
    }
    if (/\/(charges|echecks)$/.test(url.pathname) && method === 'POST') {
      if (options.chargeTransportError) throw new TypeError('Payment connection interrupted');
      if (options.chargeHttpError) return Response.json({ errors: options.chargeHttpError.errors }, { status: options.chargeHttpError.status });
      charge = { id: 'charge-1', status: options.chargeStatus ?? 'CAPTURED', amount: body.amount };
      return Response.json(charge);
    }
    if (/\/(charges|echecks)\/charge-1$/.test(url.pathname) && method === 'GET') return Response.json(charge);
    if (url.pathname.endsWith('/payment') && method === 'POST') {
      if (options.failPayment) return failure('Accounting payment unavailable');
      invoice.Balance = 0;
      return Response.json({ Payment: { Id: 'payment-1' } });
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }));
  return {
    requests,
    invoice: () => invoice,
    charges: () => requests.filter(({ url }) => url.pathname.endsWith('/charges')),
    echecks: () => requests.filter(({ url }) => url.pathname.endsWith('/echecks')),
    payments: () => requests.filter(({ url }) => url.pathname.endsWith('/payment')),
    sends: () => requests.filter(({ url }) => url.pathname.endsWith('/send')),
    creates: () => requests.filter(({ url, body, method }) => method === 'POST' && url.pathname.endsWith('/invoice') && !body?.Id),
  };
}

function removeSavedMethod() {
  database.center.quickbooks_payment_method_id = null;
  database.center.quickbooks_payment_method_type = null;
  database.order.centers = structuredClone(database.center);
}

beforeEach(() => {
  database.updates.length = 0;
  database.failClaim = false;
  database.failCompletion = false;
  database.center = {
    id: 'center-1', name: 'Recovery Center', quickbooks_customer_id: 'customer-1',
    billing_email: 'portal@example.com', billing_email_cc: ['app-cc@example.com'],
    quickbooks_payment_method_id: 'saved-card', quickbooks_payment_method_type: 'card',
    quickbooks_payment_method_brand: 'Visa', quickbooks_payment_method_last4: '4242',
  };
  database.order = {
    id: 'order-1', status: 'Shipped', order_kind: 'wholesale', archived_at: null,
    created_at: '2026-08-01T15:00:00Z', shipped_at: '2026-08-02T15:00:00Z', notes: null,
    invoice_status: 'not_invoiced', invoice_error: null, invoiced_at: null,
    quickbooks_invoice_id: null, quickbooks_invoice_email_sent_at: null,
    quickbooks_payment_charge_id: null, quickbooks_payment_id: null, quickbooks_payment_status: null,
    centers: structuredClone(database.center), profiles: { email: 'buyer@example.com', full_name: 'Buyer' },
    subtotal_cents: 2400, shipping_address1: null, shipping_address2: null, shipping_city: null,
    shipping_name: null, shipping_state: 'VA', shipping_zip: null,
    order_items: [{ qty: 1, unit_price_cents: 2400, line_total_cents: 2400,
      product_name_snapshot: 'Cold Brew', products: { name: 'Cold Brew', sku: 'CB', quickbooks_item_id: 'item-1' } }],
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('automatic billing for shipped orders', () => {
  it.each(['saved-payment', 'declined-payment', 'no-payment'] as const)('uses new customer invoice choices at shipping with %s', async (payment) => {
    database.center.invoice_recipients_configured_at = '2026-09-30T12:00:00Z';
    database.center.name = 'CooperRiis';
    database.center.billing_email = 'invoices@example.com';
    database.center.billing_email_cc = ['finance@example.com'];
    database.order.centers = structuredClone(database.center);
    if (payment === 'no-payment') removeSavedMethod();
    const qbo = quickBooksFixture(payment === 'declined-payment' ? { chargeStatus: 'DECLINED' } : {});

    const result = await fulfillShippedOrderBilling('order-1');

    expect(result.status).toBe(payment === 'saved-payment' ? 'paid' : 'invoiced');
    expect(qbo.invoice().BillEmail).toEqual({ Address: 'invoices@example.com' });
    expect(qbo.invoice().BillEmailCc).toEqual({ Address: 'finance@example.com' });
    expect(qbo.sends()).toHaveLength(1);
    expect(qbo.charges()).toHaveLength(payment === 'no-payment' ? 0 : 1);
    expect(database.order.quickbooks_invoice_email_to).toBe('invoices@example.com, finance@example.com');
  });

  it('charges the cached payment method for the QuickBooks total including tax and records payment', async () => {
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.charges()[0].body).toMatchObject({ amount: '26.40', cardOnFile: 'saved-card' });
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.payments()[0].body).toMatchObject({ TotalAmt: 26.4 });
    expect(qbo.requests.some(({ url }) => /\/(cards|bank-accounts)$/.test(url.pathname))).toBe(false);
    expect(database.order).toMatchObject({
      invoice_status: 'invoiced', invoice_error: null, quickbooks_invoice_id: 'invoice-1',
      quickbooks_payment_charge_id: 'charge-1', quickbooks_payment_id: 'payment-1', quickbooks_payment_status: 'CAPTURED',
    });
    expect(database.order.invoiced_at).toBeTruthy();
  });

  it('uses and caches a live QuickBooks saved method when none is cached', async () => {
    removeSavedMethod();
    const qbo = quickBooksFixture({ liveCard: true });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()[0].body).toMatchObject({ cardOnFile: 'live-card' });
    expect(database.center).toMatchObject({ quickbooks_payment_method_id: 'live-card', quickbooks_payment_method_type: 'card' });
  });

  it('initiates a saved bank-account payment and records its accepted PENDING result', async () => {
    database.center.quickbooks_payment_method_id = 'saved-bank';
    database.center.quickbooks_payment_method_type = 'bank_account';
    database.center.quickbooks_payment_method_brand = 'Checking';
    database.order.centers = structuredClone(database.center);
    const qbo = quickBooksFixture({ chargeStatus: 'PENDING' });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(1);
    expect(qbo.echecks()[0].body).toMatchObject({ amount: '26.40', bankAccountOnFile: 'saved-bank', paymentMode: 'WEB' });
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.payments()[0].body).toMatchObject({ TotalAmt: 26.4 });
    expect(qbo.sends()).toHaveLength(1);
    expect(database.order).toMatchObject({
      invoice_status: 'invoiced', quickbooks_payment_status: 'PENDING',
      quickbooks_payment_method_type: 'bank_account', quickbooks_payment_id: 'payment-1',
    });
  });

  it.each([
    { TotalAmt: 0, Balance: 0 },
    { TotalAmt: undefined },
    { TotalAmt: 'not-an-amount' },
    { Balance: undefined },
    { Balance: 0 },
    { Balance: 12 },
  ])('does not charge an invalid invoice total or changed balance: %j', async (values) => {
    const qbo = quickBooksFixture();
    Object.assign(qbo.invoice(), values);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.any(String) });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.sends()).toHaveLength(0);
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_invoice_id: 'invoice-1' });
    expect(database.order.invoice_error).toBeTruthy();
  });

  it('sends the QuickBooks invoice after a confirmed decline and retains the decline audit', async () => {
    const qbo = quickBooksFixture({ chargeStatus: 'DECLINED' });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.sends()).toHaveLength(1);
    expect(database.order).toMatchObject({
      invoice_status: 'invoiced', quickbooks_invoice_id: 'invoice-1', quickbooks_payment_status: 'DECLINED',
      quickbooks_payment_id: null,
    });
    expect(database.order.quickbooks_invoice_email_sent_at).toBeTruthy();
  });

  it.each([400, 402])('sends the unpaid invoice after an explicit processor decline with HTTP %s', async (status) => {
    const qbo = quickBooksFixture({ chargeHttpError: { status, errors: [{ code: 'card_declined', message: 'Card declined' }] } });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.sends()).toHaveLength(1);
    expect(database.order).toMatchObject({ invoice_status: 'invoiced', quickbooks_payment_status: 'DECLINED', quickbooks_payment_id: null });
  });

  it.each([
    { status: 503, errors: [{ code: 'card_declined', message: 'Card declined' }] },
    { status: 401, errors: [{ code: 'card_declined', message: 'Card declined' }] },
    { status: 400, errors: [{ code: 'invalid_request', message: 'Invalid payment request' }] },
    { status: 400, errors: { code: 'card_declined', message: 'Card declined' } },
  ])('keeps a provider error in the billing queue when it is not a confirmed decline: %j', async (chargeHttpError) => {
    const qbo = quickBooksFixture({ chargeHttpError });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.any(String) });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.sends()).toHaveLength(0);
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_payment_status: 'CHARGE_PENDING' });
    expect(database.order.invoice_error).toBeTruthy();
  });

  it('sends through QuickBooks when the customer has no saved payment information', async () => {
    removeSavedMethod();
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.sends()).toHaveLength(1);
    expect(qbo.invoice()).toMatchObject({
      BillEmail: { Address: 'billing@example.com' }, BillEmailCc: { Address: 'qb-cc@example.com, app-cc@example.com' },
    });
    expect(database.order.quickbooks_invoice_email_sent_at).toBeTruthy();
    expect(database.order.quickbooks_invoice_email_to).toContain('billing@example.com');
  });

  it.each(['paid', 'invoiced'] as const)('does not charge or email again after a completed %s result', async (outcome) => {
    if (outcome === 'invoiced') removeSavedMethod();
    const qbo = quickBooksFixture();
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: outcome });
    const initialCounts = { charges: qbo.charges().length, sends: qbo.sends().length, creates: qbo.creates().length };

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'skipped' });

    expect({ charges: qbo.charges().length, sends: qbo.sends().length, creates: qbo.creates().length }).toEqual(initialCounts);
  });

  it('allows only one concurrent request to claim and bill an order', async () => {
    const qbo = quickBooksFixture();

    const results = await Promise.all([fulfillShippedOrderBilling('order-1'), fulfillShippedOrderBilling('order-1')]);

    expect(results.map(({ status }) => status).sort()).toEqual(['paid', 'skipped']);
    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.creates()).toHaveLength(1);
    expect(database.updates.filter(({ values }) => values.invoice_status === 'invoicing')).toHaveLength(1);
  });

  it.each([
    { status: 'Processing' },
    { archived_at: '2026-08-03T15:00:00Z' },
    { order_kind: 'prospecting_sample' },
    { invoice_status: 'invoicing' },
    { invoice_status: 'invoiced' },
  ])('skips an ineligible order: %j', async (changes) => {
    Object.assign(database.order, changes);
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'skipped' });

    expect(qbo.requests).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });

  it('surfaces a database claim failure without contacting QuickBooks', async () => {
    database.failClaim = true;
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Billing claim unavailable') });

    expect(qbo.requests).toHaveLength(0);
  });

  it('treats an unavailable saved-method lookup as an error instead of sending an unpaid invoice', async () => {
    removeSavedMethod();
    const qbo = quickBooksFixture({ failMethodLookup: true });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.any(String) });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.sends()).toHaveLength(0);
    expect(database.order.invoice_status).toBe('invoice_error');
    expect(database.order.invoice_error).toBeTruthy();
  });

  it.each([
    { chargeTransportError: true },
    { chargeStatus: 'UNKNOWN' },
    { chargeStatus: '' },
  ])('does not email an unpaid invoice when the charge outcome is uncertain: %j', async (options) => {
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.any(String) });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.sends()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(database.order.invoice_status).toBe('invoice_error');
  });

  it('retries invoice email using the existing invoice and saved decline without charging again', async () => {
    const options: FixtureOptions = { chargeStatus: 'DECLINED', failSend: true };
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Invoice email unavailable') });
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_invoice_id: 'invoice-1', quickbooks_payment_status: 'DECLINED' });
    options.failSend = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.sends()).toHaveLength(2);
    expect(qbo.sends()[0].url.searchParams.get('requestid')).toBeTruthy();
    expect(qbo.sends()[1].url.searchParams.get('requestid')).toBe(qbo.sends()[0].url.searchParams.get('requestid'));
    expect(database.order.quickbooks_invoice_email_sent_at).toBeTruthy();
  });

  it('retries delivery after payment without charging or recording payment a second time', async () => {
    const options: FixtureOptions = { failSend: true };
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Invoice email unavailable') });
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_payment_id: 'payment-1' });
    options.failSend = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.sends()).toHaveLength(2);
  });

  it('does not resend a delivered invoice when only the completion audit needs retrying', async () => {
    removeSavedMethod();
    database.failCompletion = true;
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Billing completion unavailable') });
    expect(database.order.quickbooks_invoice_email_sent_at).toBeTruthy();
    database.failCompletion = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.sends()).toHaveLength(1);
    expect(qbo.creates()).toHaveLength(1);
  });

  it.each([false, true])('keeps an uncertain charge in the invoice queue without new payment or unpaid email (method removed: %s)', async (removeMethod) => {
    const options: FixtureOptions = { chargeTransportError: true };
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });
    expect(database.order).toMatchObject({
      quickbooks_payment_status: 'CHARGE_PENDING', quickbooks_payment_method_type: 'card',
      quickbooks_payment_charge_id: null, invoice_status: 'invoice_error',
    });
    options.chargeTransportError = false;
    if (removeMethod) removeSavedMethod();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.any(String) });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.charges()[0].headers.get('Request-Id')).toBeTruthy();
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.sends()).toHaveLength(0);
    expect(qbo.requests.some(({ url }) => /\/(cards|bank-accounts)$/.test(url.pathname))).toBe(false);
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_payment_status: 'CHARGE_PENDING' });
    expect(database.order.invoice_error).toBeTruthy();
  });

  it.each([false, true])('reconciles an accepted charge after recording payment fails (method removed: %s)', async (removeMethod) => {
    const options: FixtureOptions = { failPayment: true };
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Accounting payment unavailable') });
    expect(database.order).toMatchObject({
      invoice_status: 'invoice_error', quickbooks_invoice_id: 'invoice-1',
      quickbooks_payment_charge_id: 'charge-1', quickbooks_payment_status: 'CAPTURED', quickbooks_payment_id: null,
    });
    expect(qbo.sends()).toHaveLength(0);
    options.failPayment = false;
    if (removeMethod) removeSavedMethod();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(2);
    expect(qbo.payments()[0].url.searchParams.get('requestid')).toBeTruthy();
    expect(qbo.payments()[1].url.searchParams.get('requestid')).toBe(qbo.payments()[0].url.searchParams.get('requestid'));
    expect(qbo.requests.filter(({ url }) => url.pathname.endsWith('/charges/charge-1'))).toHaveLength(1);
    expect(qbo.requests.some(({ url }) => /\/(cards|bank-accounts)$/.test(url.pathname))).toBe(false);
    expect(qbo.sends()).toHaveLength(1);
    expect(database.order.quickbooks_payment_id).toBe('payment-1');
  });

  it('requires review if the invoice total changes after a charge was captured', async () => {
    const options: FixtureOptions = { failPayment: true };
    const qbo = quickBooksFixture(options);
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });
    options.failPayment = false;
    qbo.invoice().TotalAmt = 30;
    qbo.invoice().Balance = 30;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.any(String) });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.sends()).toHaveLength(0);
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_payment_charge_id: 'charge-1' });
    expect(database.order.invoice_error).toBeTruthy();
  });
});

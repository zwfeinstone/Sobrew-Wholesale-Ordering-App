import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  order: {} as Record<string, any>,
  center: {} as Record<string, any>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  selections: [] as Array<{ table: string; columns: string }>,
  failClaim: false,
  failCompletion: false,
  failDeliveryAudit: false,
  allocations: [] as Array<Record<string, any>>,
  failAllocationRead: false,
}));

const mailProvider = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('resend', () => ({ Resend: class { emails = { send: mailProvider.send }; } }));

vi.mock('@/lib/env', () => ({ env: {
  quickBooksClientId: 'test-client', quickBooksClientSecret: 'test-secret',
  quickBooksEnvironment: 'sandbox', quickBooksMinorVersion: '75', siteUrl: 'https://example.com',
} }));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {}, getSupabaseAdmin: () => ({
  rpc: async () => ({ data: 'SO-1001', error: null }),
  from(table: string) {
    const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
    let values: Record<string, unknown> | null = null;
    let selected = false;
    let executed: { data: unknown; error: { message: string } | null; count?: number } | null = null;
    const result = () => {
      if (executed) return executed;
      if (table === 'customer_stock_product_allocations') return executed = {
        data: database.allocations.filter((row) => predicates.every((predicate) => predicate(row))),
        error: database.failAllocationRead ? { message: 'Stock allocation unavailable' } : null,
      };
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
      if (values && (values.quickbooks_invoice_email_sent_at || values.quickbooks_receipt_email_sent_at) && database.failDeliveryAudit) {
        return executed = { data: null, error: { message: 'Delivery audit unavailable' } };
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
      select(columns = '*') { database.selections.push({ table, columns }); selected = true; return this; },
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

import { createQuickBooksInvoiceForOrder, createQuickBooksPaidInvoiceForOrder, fulfillShippedOrderBilling, getHeldStockInvoiceAuditForOrder } from './quickbooks';

const INVOICE_PDF = '%PDF-1.4\nQuickBooks invoice fixture\n%%EOF';
type EmailRecord = { payload: Record<string, any>; options?: { idempotencyKey?: string }; invoiceAtDelivery: Record<string, any> };

type RequestRecord = { url: URL; body: Record<string, any> | null; method: string; headers: Headers };
type FixtureOptions = {
  invoiceTotal?: number;
  chargeStatus?: string;
  chargeTransportError?: boolean;
  chargeHttpError?: { status: number; errors?: unknown };
  failPayment?: boolean;
  failSend?: boolean;
  failPdf?: boolean;
  sendReturnsNoId?: boolean;
  sendTransportError?: boolean;
  failMethodLookup?: boolean;
  liveCard?: boolean;
  liveBank?: boolean;
  customerDisplayName?: string;
  customerCompanyName?: string;
};

function quickBooksFixture(options: FixtureOptions = {}) {
  const requests: RequestRecord[] = [];
  const emails: EmailRecord[] = [];
  const acceptedEmails = new Map<string, EmailRecord>();
  let invoice: Record<string, any> = {
    Id: 'invoice-1', SyncToken: '0', DocNumber: 'SO-1001', CustomerRef: { value: 'customer-1' },
    TotalAmt: options.invoiceTotal ?? 26.40, Balance: options.invoiceTotal ?? 26.40,
  };
  let charge: Record<string, unknown> | null = null;
  let recordedPayment: Record<string, any> = {};
  const failure = (message: string) => Response.json({ Fault: { Error: [{ Message: message }] } }, { status: 503 });
  mailProvider.send.mockImplementation(async (payload: Record<string, any>, sendOptions?: { idempotencyKey?: string }) => {
    emails.push({ payload, options: sendOptions, invoiceAtDelivery: structuredClone(invoice) });
    if (options.sendTransportError) throw new TypeError('Email connection interrupted');
    if (options.failSend) return { error: { message: 'Invoice email unavailable' }, data: null };
    if (options.sendReturnsNoId) return { error: null, data: null };
    const deliveryKey = sendOptions?.idempotencyKey ?? `attempt-${emails.length}`;
    if (!acceptedEmails.has(deliveryKey)) acceptedEmails.set(deliveryKey, emails[emails.length - 1]);
    return { error: null, data: { id: 'email-1' } };
  });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = init.method ?? 'GET';
    const request: RequestRecord = { url, body, method, headers: new Headers(init.headers) };
    requests.push(request);
    if (url.pathname.endsWith('/customers/customer-1/cards')) {
      if (options.failMethodLookup) return failure('Saved payment lookup unavailable');
      return Response.json(options.liveCard ? [{ id: 'live-card', cardType: 'Visa', last4: '4242', status: 'ACTIVE' }] : []);
    }
    if (url.pathname.endsWith('/customers/customer-1/bank-accounts')) {
      if (options.failMethodLookup) return failure('Saved payment lookup unavailable');
      return Response.json(options.liveBank ? [{ id: 'live-bank', bankName: 'Checking', last4: '6789', status: 'ACTIVE' }] : []);
    }
    if (url.pathname.endsWith('/customer/customer-1')) {
      return Response.json({ Customer: {
        Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' }, BillEmailCc: { Address: 'qb-cc@example.com' },
        DisplayName: options.customerDisplayName ?? 'Recovery Center',
        CompanyName: options.customerCompanyName ?? 'Recovery Center',
      } });
    }
    if (url.pathname.endsWith('/invoice/invoice-1/send')) {
      if (options.failSend) return failure('Invoice email unavailable');
      invoice.EmailStatus = 'EmailSent';
      return Response.json({ Invoice: invoice });
    }
    if (url.pathname.endsWith('/invoice/invoice-1/pdf')) {
      if (options.failPdf) return failure('Invoice PDF unavailable');
      return new Response(INVOICE_PDF, { headers: { 'Content-Type': 'application/pdf' } });
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
    if (url.pathname.endsWith('/payment/payment-1') && method === 'GET') {
      return Response.json({ Payment: recordedPayment });
    }
    if (url.pathname.endsWith('/payment') && method === 'POST') {
      if (options.failPayment) return failure('Accounting payment unavailable');
      invoice.Balance = 0;
      recordedPayment = { ...structuredClone(body), Id: 'payment-1' };
      return Response.json({ Payment: recordedPayment });
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }));
  return {
    requests,
    invoice: () => invoice,
    recordedPayment: () => recordedPayment,
    charges: () => requests.filter(({ url }) => url.pathname.endsWith('/charges')),
    echecks: () => requests.filter(({ url }) => url.pathname.endsWith('/echecks')),
    payments: () => requests.filter(({ url }) => url.pathname.endsWith('/payment')),
    emails: () => emails,
    acceptedEmails: () => [...acceptedEmails.values()],
    pdfs: () => requests.filter(({ url }) => url.pathname.endsWith('/pdf')),
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
  database.selections.length = 0;
  database.failClaim = false;
  database.failCompletion = false;
  database.failDeliveryAudit = false;
  database.allocations = [];
  database.failAllocationRead = false;
  mailProvider.send.mockReset();
  vi.stubEnv('RESEND_API_KEY', 'test-resend-key');
  database.center = {
    id: 'center-1', name: 'Recovery Center', quickbooks_customer_id: 'customer-1', automatic_invoice_only: false,
    billing_email: 'portal@example.com', billing_email_cc: ['app-cc@example.com'],
    quickbooks_payment_method_id: 'saved-card', quickbooks_payment_method_type: 'card',
    quickbooks_payment_method_brand: 'Visa', quickbooks_payment_method_last4: '4242',
  };
  database.order = {
    id: 'order-1', status: 'Shipped', order_kind: 'wholesale', order_source: 'portal', archived_at: null,
    created_at: '2026-08-01T15:00:00Z', shipped_at: '2026-08-02T15:00:00Z', notes: null,
    invoice_status: 'not_invoiced', invoice_error: null, invoiced_at: null,
    quickbooks_invoice_id: null, quickbooks_invoice_email_sent_at: null,
    quickbooks_receipt_email_sent_at: null, quickbooks_receipt_email_to: null,
    quickbooks_payment_charge_id: null, quickbooks_payment_id: null, quickbooks_payment_status: null,
    centers: structuredClone(database.center), profiles: { email: 'buyer@example.com', full_name: 'Buyer' },
    subtotal_cents: 2400, shipping_address1: null, shipping_address2: null, shipping_city: null,
    shipping_name: null, shipping_state: 'VA', shipping_zip: null,
    order_items: [{ qty: 1, unit_price_cents: 2400, line_total_cents: 2400,
      product_name_snapshot: 'Cold Brew', products: { name: 'Cold Brew', sku: 'CB', quickbooks_item_id: 'item-1' } }],
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  const fetchMock = vi.mocked(fetch);
  expect(fetchMock.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith('/send'))).toHaveLength(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('automatic billing for shipped orders', () => {
  function heldSale() {
    database.order.held_stock_sales = { invoice_only: true, tax_exempt: true };
    database.order.subtotal_cents = 690000;
    database.order.order_items[0] = { ...database.order.order_items[0], product_id: 'custom-bags', qty: 1000, unit_price_cents: 690, line_total_cents: 690000 };
  }

  function heldRelease() {
    database.order.center_id = 'center-1';
    database.order.subtotal_cents = 0;
    database.order.order_items[0] = { ...database.order.order_items[0], product_id: 'custom-bags', qty: 100, unit_price_cents: 0, line_total_cents: 0 };
    database.allocations = [{ center_id: 'center-1', product_id: 'custom-bags', initial_order_id: 'initial-sale' }];
  }

  it('invoices a held-stock sale without charging or changing the customer’s automatic billing setting', async () => {
    heldSale();
    const qbo = quickBooksFixture({ invoiceTotal: 6900 });
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });
    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].payload.subject).toBe('Sobrew Invoice SO-1001');
    expect(qbo.emails()[0].payload.text).not.toMatch(/shipped|tracking|packed/i);
    expect(database.center.automatic_invoice_only).toBe(false);
    expect(qbo.creates()[0].body?.Line[0].SalesItemLineDetail.TaxCodeRef.value).toBe('NON');
    expect(qbo.creates()[0].body).not.toHaveProperty('ShipDate');
    expect(qbo.creates()[0].body).not.toHaveProperty('ShipMethodRef');
    expect(qbo.creates()[0].body).not.toHaveProperty('TrackingNum');
    expect(qbo.creates()[0].body?.CustomerMemo.value).toContain('held at Sobrew for delivery on request');
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'skipped' });
    expect(qbo.emails()).toHaveLength(1);
  });

  it.each([false, true])('blocks a new held-stock payment charge even when automatic=%s', async (automatic) => {
    heldSale();
    const qbo = quickBooksFixture({ invoiceTotal: 6900 });
    await expect(createQuickBooksPaidInvoiceForOrder('order-1', { automatic })).rejects.toThrow('Automatic and manual payment charges are disabled');
    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.creates()).toHaveLength(0);
  });

  it('audits the prepared held-stock invoice without sending or charging', async () => {
    heldSale();
    const qbo = quickBooksFixture({ invoiceTotal: 6900 });
    const prepared = await createQuickBooksInvoiceForOrder('order-1', { prepareEmailRecipients: true, sendQuickBooksEmail: false });
    database.order.quickbooks_invoice_id = prepared.id;
    expect(await getHeldStockInvoiceAuditForOrder('order-1')).toMatchObject({
      id: 'invoice-1', amountCents: 690000, balanceCents: 690000, taxCents: 0,
      shipDate: '', shipMethod: '', tracking: '',
      lines: [{ quantity: 1000, unitPriceCents: 690, amountCents: 690000, taxCode: 'NON' }],
    });
    expect(qbo.emails()).toHaveLength(0);
    expect(qbo.charges()).toHaveLength(0);
  });

  it('does not email an invoice whose provider total differs from the held-stock sale', async () => {
    heldSale();
    const qbo = quickBooksFixture({ invoiceTotal: 7000 });
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('approved tax-exempt order') });
    expect(qbo.emails()).toHaveLength(0);
    expect(qbo.charges()).toHaveLength(0);
    expect(database.order.quickbooks_invoice_id).toBe('invoice-1');
  });

  it('completes a free held-stock release without a provider request, invoice, charge, or billing email', async () => {
    heldRelease();
    const qbo = quickBooksFixture();
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'skipped' });
    expect(database.order.invoice_status).toBe('not_required');
    expect(qbo.requests).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(0);
  });

  it.each([false, true])('skips billing for a shared whole-bean release with ground bags included=%s', async (mixed) => {
    heldRelease();
    const variant = { ...database.order.order_items[0], product_id: 'custom-bags-whole-bean', qty: 50 };
    database.order.order_items = mixed ? [...database.order.order_items, variant] : [variant];
    database.allocations.push({ ...database.allocations[0], product_id: variant.product_id });
    database.allocations.forEach(row => Object.assign(row, { allocation_id: 'shared-batch', inventory_product_id: 'custom-bags' }));
    const qbo = quickBooksFixture();
    await expect(createQuickBooksInvoiceForOrder('order-1')).rejects.toThrow('does not require an invoice or payment');
    await expect(createQuickBooksPaidInvoiceForOrder('order-1')).rejects.toThrow('does not require an invoice or payment');
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'skipped' });
    expect(database.order.invoice_status).toBe('not_required');
    expect(qbo.requests).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(0);
  });

  it('rejects direct invoice creation and manual charging for a held-stock release', async () => {
    heldRelease();
    const qbo = quickBooksFixture();
    await expect(createQuickBooksInvoiceForOrder('order-1')).rejects.toThrow('does not require an invoice or payment');
    await expect(createQuickBooksPaidInvoiceForOrder('order-1')).rejects.toThrow('does not require an invoice or payment');
    expect(qbo.requests).toHaveLength(0);
  });

  it.each(['unallocated', 'wrong-center', 'positive-line'])('does not exempt a %s order from ordinary billing', async (kind) => {
    heldRelease();
    if (kind === 'unallocated') database.allocations = [];
    if (kind === 'wrong-center') database.allocations[0].center_id = 'other-center';
    if (kind === 'positive-line') {
      database.order.subtotal_cents = 2400;
      database.order.order_items.push({ ...database.order.order_items[0], product_id: 'ordinary', unit_price_cents: 2400, line_total_cents: 2400 });
    }
    quickBooksFixture();
    await fulfillShippedOrderBilling('order-1');
    expect(database.order.invoice_status).not.toBe('not_required');
  });

  it('fails closed without provider calls if release ownership cannot be verified', async () => {
    heldRelease();
    database.failAllocationRead = true;
    const qbo = quickBooksFixture();
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Unable to verify customer stock release') });
    expect(qbo.requests).toHaveLength(0);
  });

  it('does not hide existing billing activity when recognizing a held-stock release', async () => {
    heldRelease();
    database.order.quickbooks_invoice_id = 'existing-invoice';
    const qbo = quickBooksFixture();
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('already has billing activity') });
    expect(qbo.requests).toHaveLength(0);
  });

  it('uses the saved invoice-only setting and creator email for the CooperRiis Healing Community customer', async () => {
    Object.assign(database.center, { name: 'CooperRiis Healing Community', automatic_invoice_only: true });
    database.order.centers = structuredClone(database.center);
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].payload).toMatchObject({
      to: ['buyer@example.com'],
      cc: ['qb-cc@example.com', 'app-cc@example.com', 'zach@sobrew.com'],
      subject: 'Sobrew Invoice SO-1001',
    });
  });

  it.each([
    { name: 'Recovery Center', payment: 'saved-payment', to: 'billing@example.com' },
    { name: 'Recovery Center', payment: 'declined-payment', to: 'billing@example.com' },
    { name: 'Recovery Center', payment: 'no-payment', to: 'billing@example.com' },
    { name: 'CooperRiis', payment: 'saved-payment', to: 'buyer@example.com' },
    { name: 'CooperRiis', payment: 'declined-payment', to: 'buyer@example.com' },
    { name: 'CooperRiis', payment: 'no-payment', to: 'buyer@example.com' },
  ])('copies Zach on $name automatic $payment delivery while preserving customer recipients', async ({ name, payment, to }) => {
    database.center.name = name;
    database.order.centers = structuredClone(database.center);
    if (payment === 'no-payment') removeSavedMethod();
    const qbo = quickBooksFixture(payment === 'declined-payment' ? { chargeStatus: 'DECLINED' } : {});
    const paid = payment === 'saved-payment';

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({
      status: paid ? 'paid' : 'invoiced',
    });

    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].invoiceAtDelivery.Balance).toBe(paid ? 0 : 26.4);
    expect(qbo.emails()[0].payload).toMatchObject({
      to: [to],
      cc: ['qb-cc@example.com', 'app-cc@example.com', 'zach@sobrew.com'],
      subject: `Sobrew ${paid ? 'Receipt' : 'Invoice'} SO-1001`,
    });
    expect(database.order.quickbooks_invoice_email_to).toBe(`${to}, qb-cc@example.com, app-cc@example.com, zach@sobrew.com`);
  });

  it.each(['saved-payment', 'declined-payment', 'no-payment'] as const)('uses new customer invoice choices at shipping with %s', async (payment) => {
    database.center.invoice_recipients_configured_at = '2026-09-30T12:00:00Z';
    database.center.name = 'Recovery Center';
    database.center.billing_email = 'invoices@example.com';
    database.center.billing_email_cc = ['finance@example.com'];
    database.order.centers = structuredClone(database.center);
    if (payment === 'no-payment') removeSavedMethod();
    const qbo = quickBooksFixture(payment === 'declined-payment' ? { chargeStatus: 'DECLINED' } : {});

    const result = await fulfillShippedOrderBilling('order-1');

    expect(result.status).toBe(payment === 'saved-payment' ? 'paid' : 'invoiced');
    expect(qbo.invoice().BillEmail).toEqual({ Address: 'invoices@example.com' });
    expect(qbo.invoice().BillEmailCc).toEqual({ Address: 'finance@example.com, zach@sobrew.com' });
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.charges()).toHaveLength(payment === 'no-payment' ? 0 : 1);
    expect(database.order.quickbooks_invoice_email_to).toBe('invoices@example.com, finance@example.com, zach@sobrew.com');
    expect(qbo.emails()[0].invoiceAtDelivery.Balance).toBe(payment === 'saved-payment' ? 0 : 26.4);
    expect(qbo.emails()[0].payload).toMatchObject({
      to: ['invoices@example.com'], cc: ['finance@example.com', 'zach@sobrew.com'],
    });
  });

  it.each(['Recovery Center', 'Arise Cafe', 'CooperRiis'].flatMap((name) =>
    ['cached-card', 'cached-bank', 'live-card', 'live-bank'].map((method) => ({
      name, method, to: name === 'CooperRiis' ? 'buyer@example.com' : 'billing@example.com',
    })),
  ))('only emails the unpaid invoice when $name is marked invoice-only with $method on file', async ({ name, method, to }) => {
    Object.assign(database.center, { name, automatic_invoice_only: true });
    if (method === 'cached-bank') {
      database.center.quickbooks_payment_method_id = 'saved-bank';
      database.center.quickbooks_payment_method_type = 'bank_account';
    }
    database.order.centers = structuredClone(database.center);
    if (method.startsWith('live-')) removeSavedMethod();
    const qbo = quickBooksFixture({ liveCard: method === 'live-card', liveBank: method === 'live-bank', failMethodLookup: true });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.requests.some(({ url }) => /\/(cards|bank-accounts)$/.test(url.pathname))).toBe(false);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].invoiceAtDelivery.Balance).toBe(26.4);
    expect(qbo.emails()[0].payload).toMatchObject({
      to: [to], cc: ['qb-cc@example.com', 'app-cc@example.com', 'zach@sobrew.com'],
      subject: 'Sobrew Invoice SO-1001',
    });
    expect(database.order.quickbooks_payment_charge_id).toBeNull();
    expect(database.order.quickbooks_payment_id).toBeNull();
    expect(database.order.quickbooks_invoice_email_sent_at).toBeTruthy();
    expect(database.selections.some(({ table, columns }) =>
      table === 'orders' && /centers\([^)]*automatic_invoice_only/.test(columns),
    )).toBe(true);
  });

  it.each(['Recovery Center', 'Arise Cafe', 'CooperRiis'])('preserves explicit new-customer recipients for invoice-only %s', async (name) => {
    Object.assign(database.center, {
      name, automatic_invoice_only: true,
      invoice_recipients_configured_at: '2026-09-30T12:00:00Z',
      billing_email: 'invoices@example.com', billing_email_cc: ['finance@example.com'],
    });
    database.order.centers = structuredClone(database.center);
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].invoiceAtDelivery.Balance).toBe(26.4);
    expect(qbo.emails()[0].payload).toMatchObject({
      to: ['invoices@example.com'], cc: ['finance@example.com', 'zach@sobrew.com'],
      subject: 'Sobrew Invoice SO-1001',
    });
  });

  it.each([
    { name: '  ARISE CAFÉ  ', source: 'name' },
    { name: 'Cooper-Riis', source: 'name' },
    { name: 'Arise Café', source: 'quickbooks_display_name' },
    { name: 'COOPER RIIS', source: 'quickbooks_display_name' },
    { name: 'Arise Cafe', source: 'customerDisplayName' },
    { name: 'CooperRiis', source: 'customerDisplayName' },
    { name: 'Arise Cafe', source: 'customerCompanyName' },
    { name: 'CooperRiis', source: 'customerCompanyName' },
  ])('does not override the unchecked setting for $name from $source', async ({ name, source }) => {
    const options: FixtureOptions = {};
    if (source === 'name' || source === 'quickbooks_display_name') database.center[source] = name;
    else options[source as 'customerDisplayName' | 'customerCompanyName'] = name;
    database.order.centers = structuredClone(database.center);
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(1);
  });

  it.each(['Arise Cafe', 'CooperRiis'].flatMap((name) =>
    ['cached-card', 'cached-bank', 'live-card', 'live-bank'].map((method) => ({ name, method })),
  ))('uses the $method for $name while invoice-only is unchecked', async ({ name, method }) => {
    Object.assign(database.center, { name, quickbooks_display_name: name });
    const bankPayment = method.endsWith('bank');
    if (method === 'cached-bank') {
      database.center.quickbooks_payment_method_id = 'saved-bank';
      database.center.quickbooks_payment_method_type = 'bank_account';
    }
    database.order.centers = structuredClone(database.center);
    if (method.startsWith('live-')) removeSavedMethod();
    const qbo = quickBooksFixture({
      customerDisplayName: name, customerCompanyName: name,
      liveCard: method === 'live-card', liveBank: method === 'live-bank',
      chargeStatus: bankPayment ? 'PENDING' : 'CAPTURED',
    });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(bankPayment ? 0 : 1);
    expect(qbo.echecks()).toHaveLength(bankPayment ? 1 : 0);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(1);
  });

  it.each(['Recovery Center', 'Arise Cafe', 'CooperRiis'])('retries invoice-only email for %s without a charge or duplicate invoice', async (name) => {
    Object.assign(database.center, { name, automatic_invoice_only: true });
    database.order.centers = structuredClone(database.center);
    const options: FixtureOptions = { failSend: true };
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Invoice email unavailable') });
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_invoice_id: 'invoice-1', quickbooks_payment_charge_id: null });
    options.failSend = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(2);
    expect(qbo.emails()[1].options?.idempotencyKey).toBe(qbo.emails()[0].options?.idempotencyKey);
    expect(database.order.quickbooks_invoice_email_sent_at).toBeTruthy();
  });

  it.each(['Recovery Center', 'Arise Cafe', 'CooperRiis'])('uses the unchecked setting on retry for %s instead of reapplying a name exception', async (name) => {
    Object.assign(database.center, { name, automatic_invoice_only: true });
    database.order.centers = structuredClone(database.center);
    const options: FixtureOptions = { failSend: true, customerDisplayName: name, customerCompanyName: name };
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Invoice email unavailable') });
    expect(qbo.charges()).toHaveLength(0);
    expect(database.order.quickbooks_payment_status).toBeNull();
    database.center.automatic_invoice_only = false;
    database.order.centers = structuredClone(database.center);
    options.failSend = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(2);
    expect(qbo.emails()[1].invoiceAtDelivery).toMatchObject({ Balance: 0 });
    expect(database.center.automatic_invoice_only).toBe(false);
  });

  it('honors a newly checked invoice-only setting when retrying a failure before payment', async () => {
    removeSavedMethod();
    const options: FixtureOptions = { liveCard: true, failMethodLookup: true };
    const qbo = quickBooksFixture(options);
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });
    expect(qbo.charges()).toHaveLength(0);
    database.center.automatic_invoice_only = true;
    database.order.centers = structuredClone(database.center);
    options.failMethodLookup = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].invoiceAtDelivery).toMatchObject({ Balance: 26.4 });
  });

  it.each(['Recovery Center', 'Arise Cafe', 'CooperRiis'])('leaves explicitly requested manual payment available for invoice-only %s', async (name) => {
    Object.assign(database.center, { name, automatic_invoice_only: true });
    database.order.centers = structuredClone(database.center);
    const qbo = quickBooksFixture({ customerDisplayName: name, customerCompanyName: name });

    await createQuickBooksPaidInvoiceForOrder('order-1');

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(1);
    expect(database.order.quickbooks_payment_id).toBe('payment-1');
  });

  it.each(['Recovery Center', 'Arise Cafe', 'CooperRiis'])('keeps an uncertain prior charge blocked for invoice-only %s', async (name) => {
    const options: FixtureOptions = { chargeTransportError: true };
    const qbo = quickBooksFixture(options);
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });
    expect(database.order.quickbooks_payment_status).toBe('CHARGE_PENDING');
    options.chargeTransportError = false;
    Object.assign(database.center, { name, automatic_invoice_only: true });
    database.order.centers = structuredClone(database.center);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.any(String) });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(0);
    expect(database.order.quickbooks_payment_status).toBe('CHARGE_PENDING');
  });

  it.each(['Recovery Center', 'Arise Cafe', 'CooperRiis'])('reconciles a captured prior charge for invoice-only %s without charging again', async (name) => {
    const options: FixtureOptions = { failPayment: true };
    const qbo = quickBooksFixture(options);
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Accounting payment unavailable') });
    options.failPayment = false;
    Object.assign(database.center, { name, automatic_invoice_only: true });
    database.order.centers = structuredClone(database.center);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.echecks()).toHaveLength(0);
    expect(qbo.requests.filter(({ url }) => url.pathname.endsWith('/charges/charge-1'))).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(2);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].invoiceAtDelivery).toMatchObject({ Balance: 0 });
    expect(database.order.quickbooks_payment_id).toBe('payment-1');
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
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].payload).toMatchObject({
      from: 'Sobrew Wholesale <orders@orders.sobrew.com>', replyTo: 'hello@sobrew.com',
      subject: 'Sobrew Receipt SO-1001',
      to: ['billing@example.com'], cc: ['qb-cc@example.com', 'app-cc@example.com', 'zach@sobrew.com'],
      html: expect.stringContaining('Your Sobrew payment is complete.'),
      text: expect.stringContaining('was charged $26.40.'),
      attachments: expect.arrayContaining([expect.objectContaining({
        content: Buffer.from(INVOICE_PDF), contentType: 'application/pdf', filename: 'Sobrew-Receipt-SO-1001.pdf',
      })]),
    });
    expect(qbo.emails()[0].options?.idempotencyKey).toMatch(/^ship-receipt-[a-f0-9]{36}$/);
    expect(database.order.quickbooks_receipt_email_sent_at).toBeTruthy();
    expect(database.order.quickbooks_receipt_email_to).toBe('billing@example.com, qb-cc@example.com, app-cc@example.com, zach@sobrew.com');
    expect(database.order.quickbooks_invoice_email_sent_at).toBeNull();
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
    expect(qbo.emails()).toHaveLength(1);
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
    expect(qbo.emails()).toHaveLength(0);
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_invoice_id: 'invoice-1' });
    expect(database.order.invoice_error).toBeTruthy();
  });

  it('sends the branded PDF invoice after a confirmed decline and retains the decline audit', async () => {
    const qbo = quickBooksFixture({ chargeStatus: 'DECLINED' });

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(1);
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
    expect(qbo.emails()).toHaveLength(1);
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
    expect(qbo.emails()).toHaveLength(0);
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_payment_status: 'CHARGE_PENDING' });
    expect(database.order.invoice_error).toBeTruthy();
  });

  it('sends the branded PDF template when the customer has no saved payment information', async () => {
    removeSavedMethod();
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'invoiced' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].payload).toMatchObject({
      from: 'Sobrew Wholesale <orders@orders.sobrew.com>', replyTo: 'hello@sobrew.com',
      to: ['billing@example.com'], cc: ['qb-cc@example.com', 'app-cc@example.com', 'zach@sobrew.com'],
      subject: 'Sobrew Invoice SO-1001',
      html: expect.stringContaining('Your Sobrew invoice is attached.'),
      text: expect.stringContaining('Your Sobrew invoice SO-1001 is attached as a PDF.'),
      attachments: expect.arrayContaining([expect.objectContaining({
        content: Buffer.from(INVOICE_PDF), contentType: 'application/pdf', filename: 'Sobrew-Invoice-SO-1001.pdf',
      })]),
    });
    expect(qbo.emails()[0].options?.idempotencyKey).toMatch(/^ship-invoice-[a-f0-9]{36}$/);
    expect(qbo.pdfs()).toHaveLength(1);
    expect(database.order.quickbooks_receipt_email_sent_at).toBeNull();
    expect(database.order.quickbooks_invoice_email_sent_at).toBeTruthy();
    expect(database.order.quickbooks_invoice_email_to).toContain('billing@example.com');
  });

  it.each(['paid', 'invoiced'] as const)('does not charge or email again after a completed %s result', async (outcome) => {
    if (outcome === 'invoiced') removeSavedMethod();
    const qbo = quickBooksFixture();
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: outcome });
    const initialCounts = { charges: qbo.charges().length, sends: qbo.emails().length, creates: qbo.creates().length };

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'skipped' });

    expect({ charges: qbo.charges().length, sends: qbo.emails().length, creates: qbo.creates().length }).toEqual(initialCounts);
  });

  it('allows only one concurrent request to claim and bill an order', async () => {
    const qbo = quickBooksFixture();

    const results = await Promise.all([fulfillShippedOrderBilling('order-1'), fulfillShippedOrderBilling('order-1')]);

    expect(results.map(({ status }) => status).sort()).toEqual(['paid', 'skipped']);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.creates()).toHaveLength(1);
    expect(database.updates.filter(({ values }) => values.invoice_status === 'invoicing')).toHaveLength(1);
  });

  it.each([
    { status: 'Processing' },
    { archived_at: '2026-08-03T15:00:00Z' },
    { order_kind: 'prospecting_sample' },
    { order_source: 'shopify', shopify_order_id: 'gid://shopify/Order/1001' },
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
    expect(qbo.emails()).toHaveLength(0);
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
    expect(qbo.emails()).toHaveLength(0);
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
    expect(qbo.emails()).toHaveLength(2);
    expect(qbo.emails()[0].options?.idempotencyKey).toBeTruthy();
    expect(qbo.emails()[1].options?.idempotencyKey).toBe(qbo.emails()[0].options?.idempotencyKey);
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
    expect(qbo.emails()).toHaveLength(2);
    expect(qbo.emails()[1].options?.idempotencyKey).toBe(qbo.emails()[0].options?.idempotencyKey);
    expect(database.order.quickbooks_receipt_email_sent_at).toBeTruthy();
    expect(database.order.quickbooks_invoice_email_sent_at).toBeNull();
    for (const send of qbo.emails()) {
      expect(send.invoiceAtDelivery.Balance).toBe(0);
      expect(send.payload).toMatchObject({
        subject: 'Sobrew Receipt SO-1001',
        cc: ['qb-cc@example.com', 'app-cc@example.com', 'zach@sobrew.com'],
        text: expect.stringContaining('$26.40'),
      });
    }
  });

  it.each(['paid', 'invoiced'] as const)('does not resend a delivered %s email when only the completion audit needs retrying', async (outcome) => {
    if (outcome === 'invoiced') removeSavedMethod();
    database.failCompletion = true;
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Billing completion unavailable') });
    expect(database.order[outcome === 'paid' ? 'quickbooks_receipt_email_sent_at' : 'quickbooks_invoice_email_sent_at']).toBeTruthy();
    database.failCompletion = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: outcome });

    expect(qbo.emails()).toHaveLength(1);
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
    expect(qbo.emails()).toHaveLength(0);
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
    expect(qbo.emails()).toHaveLength(0);
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
    expect(qbo.emails()).toHaveLength(1);
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
    expect(qbo.emails()).toHaveLength(0);
    expect(database.order).toMatchObject({ invoice_status: 'invoice_error', quickbooks_payment_charge_id: 'charge-1' });
    expect(database.order.invoice_error).toBeTruthy();
  });

  it.each(['paid', 'invoiced'] as const)('keeps failed PDF downloads retryable for %s without a second charge or invoice', async (outcome) => {
    if (outcome === 'invoiced') removeSavedMethod();
    const options: FixtureOptions = { failPdf: true };
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });
    expect(database.order.invoice_status).toBe('invoice_error');
    expect(database.order.quickbooks_invoice_id).toBe('invoice-1');
    expect(qbo.emails()).toHaveLength(0);
    expect(database.order.quickbooks_receipt_email_sent_at).toBeNull();
    expect(database.order.quickbooks_invoice_email_sent_at).toBeNull();
    options.failPdf = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: outcome });

    expect(qbo.charges()).toHaveLength(outcome === 'paid' ? 1 : 0);
    expect(qbo.payments()).toHaveLength(outcome === 'paid' ? 1 : 0);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.pdfs()).toHaveLength(2);
  });

  it.each(['paid', 'invoiced'] as const)('reuses the provider idempotency key after the %s delivery audit fails', async (outcome) => {
    if (outcome === 'invoiced') removeSavedMethod();
    database.failDeliveryAudit = true;
    const qbo = quickBooksFixture();

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error', error: expect.stringContaining('Delivery audit unavailable') });
    expect(database.order.invoice_status).toBe('invoice_error');
    expect(qbo.emails()).toHaveLength(1);
    expect(database.order.quickbooks_receipt_email_sent_at).toBeNull();
    expect(database.order.quickbooks_invoice_email_sent_at).toBeNull();
    database.failDeliveryAudit = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: outcome });

    expect(qbo.charges()).toHaveLength(outcome === 'paid' ? 1 : 0);
    expect(qbo.payments()).toHaveLength(outcome === 'paid' ? 1 : 0);
    expect(qbo.creates()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(2);
    expect(qbo.emails()[0].options?.idempotencyKey).toBeTruthy();
    expect(qbo.emails()[1].options?.idempotencyKey).toBe(qbo.emails()[0].options?.idempotencyKey);
    expect(qbo.acceptedEmails()).toHaveLength(1);
  });

  it.each(['paid', 'invoiced'].flatMap((outcome) =>
    ['sendReturnsNoId', 'sendTransportError'].map((failure) => ({ outcome, failure })),
  ))('does not mark $outcome delivered after $failure', async ({ outcome, failure }) => {
    if (outcome === 'invoiced') removeSavedMethod();
    const options: FixtureOptions = { [failure]: true };
    const qbo = quickBooksFixture(options);

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });

    expect(qbo.emails()).toHaveLength(1);
    expect(database.order.invoice_status).toBe('invoice_error');
    expect(database.order.quickbooks_invoice_email_sent_at).toBeNull();
    expect(database.order.quickbooks_receipt_email_sent_at).toBeNull();
  });

  it('does not send a duplicate receipt after a legacy paid invoice email was already delivered', async () => {
    Object.assign(database.order, {
      invoice_status: 'invoice_error', quickbooks_invoice_id: 'invoice-1',
      quickbooks_payment_id: 'payment-1', quickbooks_payment_charge_id: 'charge-1',
      quickbooks_payment_status: 'CAPTURED', quickbooks_payment_method_type: 'card',
      quickbooks_payment_method_label: 'Visa ending in 4242',
      quickbooks_invoice_email_sent_at: '2026-10-01T12:00:00Z',
    });
    const qbo = quickBooksFixture();
    qbo.invoice().Balance = 0;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(0);
    expect(qbo.payments()).toHaveLength(0);
    expect(qbo.creates()).toHaveLength(0);
    expect(qbo.pdfs()).toHaveLength(0);
    expect(qbo.emails()).toHaveLength(0);
    expect(database.order.quickbooks_invoice_email_sent_at).toBe('2026-10-01T12:00:00Z');
  });


  it('uses the recorded payment amount in a receipt retry even if the invoice total changed', async () => {
    const options: FixtureOptions = { failPdf: true };
    const qbo = quickBooksFixture(options);
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });
    expect(database.order.quickbooks_payment_id).toBe('payment-1');
    expect(qbo.emails()).toHaveLength(0);
    qbo.invoice().TotalAmt = 30;
    qbo.invoice().Balance = 3.6;
    options.failPdf = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'paid' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(1);
    expect(qbo.emails()[0].payload.text).toContain('was charged $26.40.');
    expect(qbo.emails()[0].payload.text).not.toContain('$30.00');
    expect(qbo.requests.filter(({ url }) => url.pathname.endsWith('/payment/payment-1'))).toHaveLength(1);
  });

  it.each([
    { label: 'payment ID', values: { Id: 'other-payment' } },
    { label: 'customer', values: { CustomerRef: { value: 'other-customer' } } },
    { label: 'invoice', values: { Line: [{ Amount: 26.4, LinkedTxn: [{ TxnId: 'other-invoice', TxnType: 'Invoice' }] }] } },
    { label: 'transaction type', values: { Line: [{ Amount: 26.4, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'CreditMemo' }] }] } },
    { label: 'line amount', values: { Line: [{ Amount: 20, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] }] } },
    { label: 'missing total', values: { TotalAmt: undefined } },
    { label: 'invalid total', values: { TotalAmt: 'invalid' } },
    { label: 'zero total', values: { TotalAmt: 0 } },
    { label: 'multiple lines', values: { Line: [
      { Amount: 20, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] },
      { Amount: 6.4, LinkedTxn: [{ TxnId: 'other-invoice', TxnType: 'Invoice' }] },
    ] } },
  ])('requires review before receipt retry when recorded payment has an inconsistent $label', async ({ values }) => {
    const options: FixtureOptions = { failPdf: true };
    const qbo = quickBooksFixture(options);
    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });
    expect(database.order.quickbooks_payment_id).toBe('payment-1');
    Object.assign(qbo.recordedPayment(), values);
    options.failPdf = false;

    expect(await fulfillShippedOrderBilling('order-1')).toMatchObject({ status: 'error' });

    expect(qbo.charges()).toHaveLength(1);
    expect(qbo.payments()).toHaveLength(1);
    expect(qbo.emails()).toHaveLength(0);
    expect(database.order.invoice_status).toBe('invoice_error');
    expect(database.order.quickbooks_receipt_email_sent_at).toBeNull();
  });

});

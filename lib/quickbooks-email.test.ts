import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  center: {} as Record<string, unknown>,
  contacts: [] as Array<{ email: string | null }>,
  contactsError: null as { message: string } | null,
  rpcs: [] as string[],
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock('@/lib/env', () => ({ env: {
  quickBooksClientId: 'test-client', quickBooksClientSecret: 'test-secret',
  quickBooksEnvironment: 'sandbox', quickBooksMinorVersion: '75', siteUrl: 'https://example.com',
} }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  rpc: async (name: string) => {
    database.rpcs.push(name);
    return { data: 'SO-1001', error: null };
  },
  from(table: string) {
    const filters: Record<string, unknown> = {};
    database.queries.push({ table, filters });
    let values: Record<string, unknown> | null = null;
    const result = () => {
      if (values) {
        database.updates.push({ table, values });
        return { data: null, error: null };
      }
      if (table === 'profiles') return { data: database.contacts, error: database.contactsError };
      if (table === 'centers') return { data: database.center, error: null };
      if (table === 'orders') return { data: database.order, error: null };
      if (table === 'app_settings') return { data: { quickbooks_sales_tax_states: [] }, error: null };
      if (table === 'quickbooks_connections') return { data: {
        access_token: 'test-token', access_token_expires_at: '2099-01-01T00:00:00Z',
        environment: 'sandbox', realm_id: 'test-realm', refresh_token: 'test-refresh',
      }, error: null };
      throw new Error(`Unexpected table ${table}`);
    };
    return {
      select() { return this; },
      eq(key: string, value: unknown) { filters[key] = value; return this; },
      is(key: string, value: unknown) { filters[key] = value; return this; },
      order() { return this; },
      limit() { return this; },
      update(next: Record<string, unknown>) { values = next; return this; },
      single: async () => result(),
      maybeSingle: async () => result(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
  },
}) }));

import {
  createQuickBooksCustomerFromPortalCenter,
  createQuickBooksInvoiceForOrder,
  createQuickBooksPaidInvoiceForOrder,
  getQuickBooksInvoiceEmailPreviewForOrder,
  getQuickBooksInvoiceEmailRecipientsForOrder,
} from './quickbooks';

type RequestRecord = { url: URL; body: Record<string, any> | null; method: string };
const billingDefaults = { billing_email_cc: [] as string[], billing_email_cc_reviewed_at: null };

function saveBillingCc(...addresses: string[]) {
  database.order.centers = { ...(database.order.centers as Record<string, unknown>), ...billingDefaults, billing_email_cc: addresses };
}

function quickBooksFixture(options: {
  customer?: Record<string, unknown> | null;
  customers?: Record<string, Record<string, unknown>>;
  invoice?: Record<string, unknown>;
  missingInvoiceCustomer?: boolean;
  fail?: 'customer' | 'invoice-read' | 'invoice-update' | 'invoice-missing';
} = {}) {
  const requests: RequestRecord[] = [];
  let invoice: Record<string, any> = {
    Id: 'invoice-1', SyncToken: '0', DocNumber: 'SO-1001', CustomerRef: { value: 'customer-1' },
    TotalAmt: 24, Balance: 24,
    BillEmail: { Address: 'old@example.com' },
    ...options.invoice,
  };
  if (options.missingInvoiceCustomer) delete invoice.CustomerRef;
  let customer = options.customer === undefined ? {
    Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com, ap@example.com' },
  } : options.customer;
  const failure = () => Response.json({ Fault: { Error: [{ Message: 'Provider unavailable' }] } }, { status: 503 });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = init.method ?? 'GET';
    requests.push({ url, body, method });
    const customerId = url.pathname.match(/\/customer\/([^/]+)$/)?.[1];
    if (customerId) {
      const requestedCustomer = options.customers?.[customerId] ?? (customerId === 'customer-1' ? customer : null);
      return options.fail === 'customer' ? failure() : Response.json({ Customer: requestedCustomer });
    }
    if (url.pathname.endsWith('/customer') && method === 'POST') {
      customer = { ...body, Id: 'customer-1', SyncToken: '0' };
      return Response.json({ Customer: customer });
    }
    if (url.pathname.endsWith('/invoice/invoice-1/send')) return Response.json({ Invoice: { ...invoice, EmailStatus: 'EmailSent' } });
    if (url.pathname.endsWith('/invoice/invoice-1')) {
      if (options.fail === 'invoice-missing') return Response.json({ Invoice: null });
      return options.fail === 'invoice-read' ? failure() : Response.json({ Invoice: invoice });
    }
    if (url.pathname.endsWith('/invoice') && method === 'POST') {
      if (body.Id && options.fail === 'invoice-update') return failure();
      invoice = { ...invoice, ...body, SyncToken: String(Number(invoice.SyncToken) + 1) };
      if (options.missingInvoiceCustomer) delete invoice.CustomerRef;
      // QuickBooks may supply a saved invoice CC even when creation omitted it.
      return Response.json({ Invoice: invoice });
    }
    if (url.pathname.endsWith('/charges') && method === 'POST') return Response.json({ id: 'charge-1', status: 'CAPTURED' });
    if (url.pathname.endsWith('/payment') && method === 'POST') return Response.json({ Payment: { Id: 'payment-1' } });
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }));
  return { requests, invoice: () => invoice, sends: () => requests.filter(({ url }) => url.pathname.endsWith('/send')) };
}

beforeEach(() => {
  database.queries.length = 0;
  database.updates.length = 0;
  database.rpcs.length = 0;
  database.contactsError = null;
  database.contacts = [{ email: 'buyer@example.com' }, { email: 'ap@example.com' }, { email: 'BUYER@example.com' }];
  database.center = { id: 'center-1', name: 'Recovery Center', is_active: true, billing_email: null };
  database.order = {
    id: 'order-1', status: 'Shipped', created_at: '2026-08-01T15:00:00Z', notes: null,
    centers: { ...billingDefaults, name: 'Recovery Center', quickbooks_customer_id: 'customer-1', billing_email: 'portal@example.com' },
    profiles: { email: 'buyer@example.com', full_name: 'Buyer' },
    shipping_address1: null, shipping_address2: null, shipping_city: null,
    shipping_name: null, shipping_state: 'VA', shipping_zip: null,
    order_items: [{ qty: 1, unit_price_cents: 2400, line_total_cents: 2400,
      product_name_snapshot: 'Cold Brew', products: { name: 'Cold Brew', sku: 'CB', quickbooks_item_id: 'item-1' } }],
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('QuickBooks invoice email delivery', () => {
  it.each([
    ['new', true], ['existing', true], ['new', false], ['existing', false],
  ] as const)('persists only explicit To/CC on a %s invoice when QuickBooks email delivery is %s', async (kind, sendQuickBooksEmail) => {
    database.order.centers = {
      ...(database.order.centers as Record<string, unknown>), name: 'CooperRiis',
      invoice_recipients_configured_at: '2026-09-30T12:00:00Z',
      billing_email: 'invoices@example.com', billing_email_cc: [],
    };
    if (kind === 'existing') database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({ invoice: { BillEmailCc: { Address: 'old-cc@example.com' } } });

    const result = await createQuickBooksInvoiceForOrder('order-1', { sendQuickBooksEmail, prepareEmailRecipients: true });

    expect(result).toMatchObject({ emailTo: 'invoices@example.com', emailCc: null, emailError: null });
    expect(qbo.invoice().BillEmail).toEqual({ Address: 'invoices@example.com' });
    expect(qbo.invoice().BillEmailCc).toBeNull();
    expect(qbo.sends()).toHaveLength(sendQuickBooksEmail ? 1 : 0);
  });

  it('uses explicit invoice To and CC for a saved payment receipt and its QuickBooks invoice', async () => {
    database.order.centers = {
      ...(database.order.centers as Record<string, unknown>),
      invoice_recipients_configured_at: '2026-09-30T12:00:00Z',
      billing_email: 'invoices@example.com', billing_email_cc: ['finance@example.com'],
      quickbooks_payment_method_id: 'saved-card', quickbooks_payment_method_type: 'card',
    };
    const qbo = quickBooksFixture({ invoice: { BillEmailCc: { Address: 'old-cc@example.com' } } });

    const result = await createQuickBooksPaidInvoiceForOrder('order-1');

    expect(result).toMatchObject({
      emailTo: 'invoices@example.com', emailCc: 'finance@example.com', emailError: null,
      paymentChargeId: 'charge-1', paymentId: 'payment-1',
    });
    expect(qbo.invoice().BillEmail).toEqual({ Address: 'invoices@example.com' });
    expect(qbo.invoice().BillEmailCc).toEqual({ Address: 'finance@example.com' });
    expect(qbo.sends()).toHaveLength(0);
  });

  it.each([
    ['new', true], ['existing', true], ['new', false], ['existing', false],
  ] as const)('prepares a %s invoice with no CC and no review timestamp when QuickBooks delivery is %s', async (kind, sendQuickBooksEmail) => {
    database.order.centers = {
      name: 'Recovery Center', quickbooks_customer_id: 'customer-1', billing_email: 'portal@example.com',
      billing_email_cc: [], billing_email_cc_reviewed_at: null,
    };
    if (kind === 'existing') database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({
      customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } },
    });

    const result = await createQuickBooksInvoiceForOrder('order-1', {
      sendQuickBooksEmail, ...(sendQuickBooksEmail ? {} : { prepareEmailRecipients: true }),
    });

    expect(result).toMatchObject({ id: 'invoice-1', emailTo: 'billing@example.com', emailCc: null, emailError: null });
    expect(qbo.sends()).toHaveLength(sendQuickBooksEmail ? 1 : 0);
    if (sendQuickBooksEmail) expect(result.emailSentAt).toBeTruthy();
    else expect(result.emailSentAt).toBeNull();
  });

  it('sends with no CC when both optional CC fields are absent', async () => {
    database.order.centers = { name: 'Center', quickbooks_customer_id: 'customer-1' };
    const qbo = quickBooksFixture({ customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } } });

    const result = await createQuickBooksInvoiceForOrder('order-1');

    expect(result).toMatchObject({ emailTo: 'billing@example.com', emailCc: null, emailError: null });
    expect(qbo.sends()).toHaveLength(1);
  });

  it('allows download-only invoice creation with the default empty CC list', async () => {
    database.order.centers = {
      name: 'Recovery Center', quickbooks_customer_id: 'customer-1', billing_email: 'portal@example.com',
      billing_email_cc: [], billing_email_cc_reviewed_at: null,
    };
    const qbo = quickBooksFixture();

    const result = await createQuickBooksInvoiceForOrder('order-1', { sendQuickBooksEmail: false });

    expect(result).toMatchObject({ id: 'invoice-1', emailError: null, emailSentAt: null });
    expect(qbo.sends()).toHaveLength(0);
  });

  it('charges and prepares a receipt with no CC or review timestamp', async () => {
    database.order.centers = {
      name: 'Center', quickbooks_customer_id: 'customer-1', billing_email_cc: [], billing_email_cc_reviewed_at: null,
      quickbooks_payment_method_id: 'saved-card', quickbooks_payment_method_type: 'card',
    };
    const qbo = quickBooksFixture({ customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } } });

    const result = await createQuickBooksPaidInvoiceForOrder('order-1');

    expect(result).toMatchObject({
      emailTo: 'billing@example.com', emailCc: null, emailError: null,
      paymentChargeId: 'charge-1', paymentId: 'payment-1',
    });
    expect(qbo.requests.filter(({ url }) => url.pathname.endsWith('/charges'))).toHaveLength(1);
    expect(qbo.sends()).toHaveLength(0);
  });

  it('saves the created invoice but does not charge when receipt recipients cannot be prepared', async () => {
    database.order.centers = {
      ...(database.order.centers as Record<string, unknown>),
      quickbooks_payment_method_id: 'saved-card', quickbooks_payment_method_type: 'card',
      quickbooks_payment_method_last4: '4242',
    };
    const qbo = quickBooksFixture({ fail: 'invoice-read' });

    await expect(createQuickBooksPaidInvoiceForOrder('order-1')).rejects.toThrow();

    expect(database.updates).toContainEqual({ table: 'orders', values: expect.objectContaining({ quickbooks_invoice_id: 'invoice-1' }) });
    expect(qbo.requests.filter(({ method }) => method === 'POST').every(({ url }) => url.pathname.endsWith('/invoice'))).toBe(true);
    expect(qbo.sends()).toHaveLength(0);
  });

  it.each(['quickbooks', 'portal-pdf', 'paid-receipt'] as const)('rejects invalid saved CC before sending or charging for %s', async (delivery) => {
    saveBillingCc('invalid-email-address');
    database.order.centers = {
      ...(database.order.centers as Record<string, unknown>),
      quickbooks_payment_method_id: 'saved-card', quickbooks_payment_method_type: 'card',
    };
    const qbo = quickBooksFixture();

    const send = delivery === 'paid-receipt'
      ? createQuickBooksPaidInvoiceForOrder('order-1')
      : createQuickBooksInvoiceForOrder('order-1', {
        sendQuickBooksEmail: delivery === 'quickbooks', prepareEmailRecipients: true,
      });
    await expect(send).rejects.toThrow();

    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
    expect(qbo.sends()).toHaveLength(0);
  });

  it.each([
    ['new', true], ['existing', true], ['new', false], ['existing', false],
  ] as const)('does not prepare or email a %s invoice without CustomerRef when QuickBooks delivery is %s', async (kind, sendQuickBooksEmail) => {
    if (kind === 'existing') database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({ missingInvoiceCustomer: true, invoice: { DocNumber: 'OLD-NUMBER' } });

    const result = await createQuickBooksInvoiceForOrder('order-1', {
      sendQuickBooksEmail, prepareEmailRecipients: true,
    });

    expect(result.id).toBe('invoice-1');
    expect(result.emailError).toMatch(/customer mapping/i);
    expect(result.emailSentAt).toBeNull();
    expect(qbo.sends()).toHaveLength(0);
    const mutations = qbo.requests.filter(({ method }) => method !== 'GET');
    expect(mutations).toHaveLength(kind === 'new' ? 1 : 0);
    if (kind === 'new') expect(mutations[0].body).not.toHaveProperty('Id');
    if (kind === 'existing') expect(qbo.invoice().DocNumber).toBe('OLD-NUMBER');
  });

  it('creates and sends with customer email recipients saved in To and CC', async () => {
    const qbo = quickBooksFixture();
    const result = await createQuickBooksInvoiceForOrder('order-1');
    expect(qbo.invoice().BillEmail).toEqual({ Address: 'billing@example.com' });
    expect(qbo.invoice().BillEmailCc).toEqual({ Address: 'ap@example.com' });
    expect(qbo.sends()).toHaveLength(1);
    expect(qbo.sends()[0].url.searchParams.has('sendTo')).toBe(false);
    expect(result).toMatchObject({ emailTo: 'billing@example.com', emailCc: 'ap@example.com',
      emailRecipients: 'billing@example.com, ap@example.com', emailError: null });
    expect(result.emailSentAt).toBeTruthy();
  });

  it.each(['new', 'existing'] as const)('sends a %s CooperRiis invoice only to the ordering login with QuickBooks and app CC', async (kind) => {
    database.order.centers = { ...(database.order.centers as Record<string, unknown>), name: 'CooperRiis' };
    saveBillingCc('app-cc@example.com', 'BUYER@example.com');
    if (kind === 'existing') database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({
      customer: {
        Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' },
        BillEmailCc: { Address: 'qbo-cc@example.com; BUYER@example.com' },
      },
      invoice: kind === 'existing' ? { BillEmailCc: { Address: 'invoice-cc@example.com' } } : undefined,
    });

    const result = await createQuickBooksInvoiceForOrder('order-1');

    expect(result.emailTo).toBe('buyer@example.com');
    expect(result.emailCc).toBe(kind === 'existing'
      ? 'qbo-cc@example.com, invoice-cc@example.com, app-cc@example.com'
      : 'qbo-cc@example.com, app-cc@example.com');
    expect(qbo.invoice().BillEmail).toEqual({ Address: 'buyer@example.com' });
    expect(qbo.sends()).toHaveLength(1);
    expect(result.emailRecipients).not.toContain('billing@example.com');
  });

  it('does not email a CooperRiis invoice when its ordering login has no email', async () => {
    database.order.centers = { ...(database.order.centers as Record<string, unknown>), name: 'CooperRiis' };
    database.order.profiles = null;
    const qbo = quickBooksFixture();

    const result = await createQuickBooksInvoiceForOrder('order-1');

    expect(result.emailTo).toBeNull();
    expect(result.emailError).toMatch(/primary billing email/i);
    expect(qbo.sends()).toHaveLength(0);
  });

  it('does not fall back to app billing or login email when QuickBooks has no invoice recipient', async () => {
    const qbo = quickBooksFixture({ customer: { Id: 'customer-1' }, invoice: { BillEmail: null } });

    const result = await createQuickBooksInvoiceForOrder('order-1');

    expect(result.emailTo).toBeNull();
    expect(result.emailError).toMatch(/primary billing email/i);
    expect(qbo.sends()).toHaveLength(0);
  });

  it('uses saved portal CC when QuickBooks omits customer CC on invoice creation', async () => {
    saveBillingCc('accountant@example.com');
    const qbo = quickBooksFixture({
      customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } },
    });
    const result = await createQuickBooksInvoiceForOrder('order-1');
    expect(result.emailCc).toBe('accountant@example.com');
    expect(qbo.invoice().BillEmailCc).toEqual({ Address: 'accountant@example.com' });
    expect(qbo.sends()).toHaveLength(1);
  });

  it('preserves CC supplied by QuickBooks on creation before adding app CC and sending', async () => {
    saveBillingCc('app-cc@example.com');
    const qbo = quickBooksFixture({
      customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } },
      invoice: { BillEmailCc: { Address: 'qbo-default@example.com' } },
    });

    const result = await createQuickBooksInvoiceForOrder('order-1');

    const creation = qbo.requests.find(({ body, method }) => method === 'POST' && body && !body.Id);
    expect(creation?.body).not.toHaveProperty('BillEmailCc');
    expect(result.emailCc).toBe('qbo-default@example.com, app-cc@example.com');
    expect(qbo.invoice().BillEmailCc).toEqual({ Address: 'qbo-default@example.com, app-cc@example.com' });
    expect(qbo.sends()).toHaveLength(1);
  });

  it('resends with QuickBooks and saved portal CC, preserving BCC and using the latest token', async () => {
    saveBillingCc('accountant@example.com');
    database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({ invoice: {
      DocNumber: 'OLD', BillEmailCc: { Address: 'AP@example.com; qbo-cc@example.com, BILLING@example.com' },
      BillEmailBcc: { Address: 'private@example.com' },
    } });
    const result = await createQuickBooksInvoiceForOrder('order-1');
    const emailUpdate = qbo.requests.find(({ body }) => body?.Id && body?.BillEmail);
    expect(emailUpdate?.body).toMatchObject({ SyncToken: '1', sparse: true,
      BillEmail: { Address: 'billing@example.com' }, BillEmailCc: { Address: 'ap@example.com, qbo-cc@example.com, accountant@example.com' } });
    expect(emailUpdate?.body).not.toHaveProperty('BillEmailBcc');
    expect(qbo.invoice().BillEmailBcc).toEqual({ Address: 'private@example.com' });
    expect(qbo.sends()).toHaveLength(1);
    expect(result.emailRecipients).toBe('billing@example.com, ap@example.com, qbo-cc@example.com, accountant@example.com');
  });

  it('keeps QuickBooks CC when the portal CC list is empty', async () => {
    database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({
      customer: {
        Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' },
        BillEmailCc: { Address: 'customer-cc@example.com' },
      },
      invoice: { BillEmailCc: { Address: 'invoice-cc@example.com' } },
    });

    const result = await createQuickBooksInvoiceForOrder('order-1');

    expect(result.emailCc).toBe('customer-cc@example.com, invoice-cc@example.com');
    expect(result.emailRecipients).toBe('billing@example.com, customer-cc@example.com, invoice-cc@example.com');
    expect(qbo.invoice().BillEmailCc).toEqual({ Address: 'customer-cc@example.com, invoice-cc@example.com' });
    expect(qbo.sends()).toHaveLength(1);
  });

  it('uses the saved QuickBooks invoice email when the customer has no email', async () => {
    database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({ customer: { Id: 'customer-1' }, invoice: {
      BillEmail: { Address: 'invoice@example.com; ap@example.com' },
    } });
    const result = await createQuickBooksInvoiceForOrder('order-1');
    expect(result.emailTo).toBe('invoice@example.com');
    expect(result.emailCc).toBe('ap@example.com');
    expect(qbo.sends()).toHaveLength(1);
  });

  it.each(['customer', 'missing-customer'] as const)('does not create or send when the customer lookup fails: %s', async (failure) => {
    const qbo = quickBooksFixture(failure === 'customer' ? { fail: 'customer' } : { customer: null });
    await expect(createQuickBooksInvoiceForOrder('order-1')).rejects.toThrow();
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
  });

  it.each(['invoice-read', 'invoice-update'] as const)('does not send when recipient preparation fails: %s', async (fail) => {
    database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({ fail });
    const result = await createQuickBooksInvoiceForOrder('order-1');
    expect(result.id).toBe('invoice-1');
    expect(result.emailError).toBeTruthy();
    expect(result.emailSentAt).toBeNull();
    expect(qbo.sends()).toHaveLength(0);
  });

  it('does not send without a primary email', async () => {
    database.order.centers = { ...billingDefaults, name: 'Center', quickbooks_customer_id: 'customer-1' };
    database.order.profiles = null;
    const qbo = quickBooksFixture({ customer: { Id: 'customer-1' }, invoice: { BillEmail: null } });
    const result = await createQuickBooksInvoiceForOrder('order-1');
    expect(result.emailError).toContain('primary billing email');
    expect(qbo.sends()).toHaveLength(0);
  });

  it('keeps email disabled for the paid-invoice flow', async () => {
    const qbo = quickBooksFixture();
    const result = await createQuickBooksInvoiceForOrder('order-1', { sendQuickBooksEmail: false });
    expect(result.id).toBe('invoice-1');
    expect(result.emailSentAt).toBeNull();
    expect(qbo.sends()).toHaveLength(0);
  });

  it.each(['new', 'existing'] as const)('prepares saved portal CC for a %s PDF without sending through QuickBooks', async (kind) => {
    saveBillingCc('accountant@example.com', 'BILLING@example.com');
    if (kind === 'existing') database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({
      customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } },
      invoice: { BillEmailCc: { Address: 'qbo-cc@example.com; BILLING@example.com' } },
    });

    const result = await createQuickBooksInvoiceForOrder('order-1', {
      sendQuickBooksEmail: false,
      prepareEmailRecipients: true,
    });

    expect(result).toMatchObject({
      id: 'invoice-1', emailTo: 'billing@example.com', emailCc: 'qbo-cc@example.com, accountant@example.com',
      emailRecipients: 'billing@example.com, qbo-cc@example.com, accountant@example.com', emailError: null, emailSentAt: null,
    });
    expect(qbo.requests.some(({ url, method }) => method === 'GET' && url.pathname.endsWith('/invoice/invoice-1'))).toBe(true);
    expect(qbo.sends()).toHaveLength(0);
  });

  it.each(['customer', 'missing-customer'] as const)('does not create an invoice when portal PDF recipient lookup fails: %s', async (failure) => {
    const qbo = quickBooksFixture(failure === 'customer' ? { fail: 'customer' } : { customer: null });

    await expect(createQuickBooksInvoiceForOrder('order-1', {
      sendQuickBooksEmail: false,
      prepareEmailRecipients: true,
    })).rejects.toThrow();

    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
  });

  it.each(['new', 'existing'] as const)('retains the %s invoice ID and reports failed PDF recipient preparation', async (kind) => {
    if (kind === 'existing') database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({ fail: 'invoice-read' });

    const result = await createQuickBooksInvoiceForOrder('order-1', {
      sendQuickBooksEmail: false,
      prepareEmailRecipients: true,
    });

    expect(result.id).toBe('invoice-1');
    expect(result.emailError).toBeTruthy();
    expect(result.emailSentAt).toBeNull();
    expect(qbo.sends()).toHaveLength(0);
  });

  it('allows download-only invoice creation when customer recipient lookup is unavailable', async () => {
    const qbo = quickBooksFixture({ fail: 'customer' });

    const result = await createQuickBooksInvoiceForOrder('order-1', { sendQuickBooksEmail: false });

    expect(result).toMatchObject({ id: 'invoice-1', emailError: null, emailSentAt: null });
    expect(qbo.sends()).toHaveLength(0);
  });
});

describe('QuickBooks recipients for an existing invoice PDF', () => {
  beforeEach(() => { database.order.quickbooks_invoice_id = 'invoice-1'; });

  it('loads recipients for resending with no CC and no review timestamp', async () => {
    database.order.centers = {
      name: 'Center', quickbooks_customer_id: 'customer-1', billing_email_cc: [], billing_email_cc_reviewed_at: null,
    };
    const qbo = quickBooksFixture({ customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } } });

    const recipients = await getQuickBooksInvoiceEmailRecipientsForOrder('order-1');

    expect(recipients).toMatchObject({ to: ['billing@example.com'], cc: [] });
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });

  it('reads current customer and saved portal CC without changing or sending the invoice', async () => {
    saveBillingCc('accountant@example.com');
    const qbo = quickBooksFixture({ invoice: {
      DocNumber: 'KEEP-THIS-NUMBER',
      BillEmailCc: { Address: 'qbo-cc@example.com; AP@example.com; BILLING@example.com' },
    } });

    const recipients = await getQuickBooksInvoiceEmailRecipientsForOrder('order-1');

    expect(recipients).toEqual({
      to: ['billing@example.com'], cc: ['ap@example.com', 'qbo-cc@example.com', 'accountant@example.com'],
      all: ['billing@example.com', 'ap@example.com', 'qbo-cc@example.com', 'accountant@example.com'],
      display: 'billing@example.com, ap@example.com, qbo-cc@example.com, accountant@example.com',
    });
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(qbo.requests.some(({ url }) => url.pathname.endsWith('/invoice/invoice-1'))).toBe(true);
    expect(qbo.requests.some(({ url }) => url.pathname.endsWith('/customer/customer-1'))).toBe(true);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
    expect(qbo.invoice().DocNumber).toBe('KEEP-THIS-NUMBER');
  });

  it.each(['missing', 'different'] as const)('rejects existing invoice recipients when the portal customer mapping is %s', async (mapping) => {
    database.order.centers = { ...billingDefaults, name: 'Center', quickbooks_customer_id: mapping === 'different' ? 'customer-1' : null, billing_email_cc: ['saved@example.com'] };
    const qbo = quickBooksFixture({
      invoice: { CustomerRef: { value: 'invoice-customer' }, BillEmailCc: { Address: 'invoice-cc@example.com' } },
      customers: { 'invoice-customer': {
        Id: 'invoice-customer', PrimaryEmailAddr: { Address: 'invoice-customer@example.com' },
        BillEmailCc: { Address: 'customer-cc@example.com' },
      } },
    });

    await expect(getQuickBooksInvoiceEmailRecipientsForOrder('order-1')).rejects.toThrow();

    expect(qbo.requests.some(({ url }) => url.pathname.includes('/customer/'))).toBe(false);
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });

  it('rejects an order without a saved invoice before making QuickBooks requests', async () => {
    database.order.quickbooks_invoice_id = null;
    const qbo = quickBooksFixture();

    await expect(getQuickBooksInvoiceEmailRecipientsForOrder('order-1')).rejects.toThrow();

    expect(qbo.requests).toHaveLength(0);
    expect(database.rpcs).toHaveLength(0);
  });

  it.each(['invoice-read', 'invoice-missing', 'customer'] as const)('rejects unavailable saved recipients instead of falling back after %s', async (fail) => {
    const qbo = quickBooksFixture({ fail });

    await expect(getQuickBooksInvoiceEmailRecipientsForOrder('order-1')).rejects.toThrow();

    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });

  it('rejects an invoice with no primary recipient', async () => {
    database.order.centers = { ...billingDefaults, name: 'Center', quickbooks_customer_id: 'customer-1' };
    database.order.profiles = null;
    const qbo = quickBooksFixture({ customer: { Id: 'customer-1' }, invoice: { BillEmail: null } });

    await expect(getQuickBooksInvoiceEmailRecipientsForOrder('order-1')).rejects.toThrow();

    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
  });
});

describe('QuickBooks invoice email preview', () => {
  it.each(['preview', 'resend'] as const)('loads the new customer explicit recipients for %s without mutations', async (lookup) => {
    database.order.quickbooks_invoice_id = 'invoice-1';
    database.order.centers = {
      ...(database.order.centers as Record<string, unknown>),
      invoice_recipients_configured_at: '2026-09-30T12:00:00Z',
      billing_email: 'invoices@example.com', billing_email_cc: ['finance@example.com'],
    };
    const qbo = quickBooksFixture({ invoice: { BillEmailCc: { Address: 'old-cc@example.com' } } });

    const recipients = await (lookup === 'preview'
      ? getQuickBooksInvoiceEmailPreviewForOrder('order-1')
      : getQuickBooksInvoiceEmailRecipientsForOrder('order-1'));

    expect(recipients).toEqual({
      to: ['invoices@example.com'], cc: ['finance@example.com'],
      all: ['invoices@example.com', 'finance@example.com'], display: 'invoices@example.com, finance@example.com',
    });
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.updates).toHaveLength(0);
  });

  it('previews the CooperRiis ordering login with QuickBooks and app CC without mutations', async () => {
    database.order.centers = { ...(database.order.centers as Record<string, unknown>), name: 'CooperRiis' };
    saveBillingCc('app-cc@example.com');
    const qbo = quickBooksFixture();

    const recipients = await getQuickBooksInvoiceEmailPreviewForOrder('order-1');

    expect(recipients.to).toEqual(['buyer@example.com']);
    expect(recipients.cc).toEqual(['ap@example.com', 'app-cc@example.com']);
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });

  it.each(['preview', 'recipients'] as const)('rejects %s for a saved invoice missing its CustomerRef without any writes', async (lookup) => {
    database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({ missingInvoiceCustomer: true });

    await expect(lookup === 'preview'
      ? getQuickBooksInvoiceEmailPreviewForOrder('order-1')
      : getQuickBooksInvoiceEmailRecipientsForOrder('order-1')).rejects.toThrow(/customer mapping/i);

    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(qbo.requests.some(({ url }) => url.pathname.includes('/customer/'))).toBe(false);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });

  it('previews an uncreated invoice from the current customer and saved CC without mutations', async () => {
    saveBillingCc('saved@example.com', 'AP@example.com', 'BILLING@example.com');
    const qbo = quickBooksFixture();

    const recipients = await getQuickBooksInvoiceEmailPreviewForOrder('order-1');

    expect(recipients).toEqual({
      to: ['billing@example.com'], cc: ['ap@example.com', 'saved@example.com'],
      all: ['billing@example.com', 'ap@example.com', 'saved@example.com'],
      display: 'billing@example.com, ap@example.com, saved@example.com',
    });
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(qbo.requests.some(({ url }) => url.pathname.includes('/invoice'))).toBe(false);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });

  it('previews an existing invoice using its customer and the saved CC list', async () => {
    database.order.quickbooks_invoice_id = 'invoice-1';
    database.order.centers = { ...(database.order.centers as Record<string, unknown>), quickbooks_customer_id: 'invoice-customer' };
    saveBillingCc('saved@example.com');
    const qbo = quickBooksFixture({
      invoice: { CustomerRef: { value: 'invoice-customer' }, BillEmailCc: { Address: 'qbo-cc@example.com' } },
      customers: { 'invoice-customer': { Id: 'invoice-customer', PrimaryEmailAddr: { Address: 'current@example.com' } } },
    });

    const recipients = await getQuickBooksInvoiceEmailPreviewForOrder('order-1');

    expect(recipients.to).toEqual(['current@example.com']);
    expect(recipients.cc).toEqual(['qbo-cc@example.com', 'saved@example.com']);
    expect(qbo.requests.some(({ url }) => url.pathname.endsWith('/invoice/invoice-1'))).toBe(true);
    expect(qbo.requests.some(({ url }) => url.pathname.endsWith('/customer/invoice-customer'))).toBe(true);
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });

  it.each(['new', 'existing'] as const)('previews a %s invoice with no CC and no review timestamp', async (kind) => {
    if (kind === 'existing') database.order.quickbooks_invoice_id = 'invoice-1';
    database.order.centers = {
      name: 'Center', quickbooks_customer_id: 'customer-1', billing_email_cc: [], billing_email_cc_reviewed_at: null,
    };
    const qbo = quickBooksFixture({ customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } } });

    const recipients = await getQuickBooksInvoiceEmailPreviewForOrder('order-1');

    expect(recipients).toMatchObject({ to: ['billing@example.com'], cc: [] });
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
    expect(database.rpcs).toHaveLength(0);
    expect(database.updates).toHaveLength(0);
  });
});

describe('QuickBooks customer email sync', () => {
  it('maps explicit invoice email to the QuickBooks customer without reading login contacts', async () => {
    database.center.invoice_recipients_configured_at = '2026-09-30T12:00:00Z';
    database.center.billing_email = 'invoices@example.com';
    const qbo = quickBooksFixture();

    await createQuickBooksCustomerFromPortalCenter('center-1');

    expect(qbo.requests[0].body?.PrimaryEmailAddr).toEqual({ Address: 'invoices@example.com' });
    expect(database.queries.some(({ table }) => table === 'profiles')).toBe(false);
    expect(database.updates[0].values).not.toHaveProperty('billing_email');
  });

  it('does not read login contacts or create a customer if the explicit invoice email is missing', async () => {
    database.center.invoice_recipients_configured_at = '2026-09-30T12:00:00Z';
    const qbo = quickBooksFixture();

    await expect(createQuickBooksCustomerFromPortalCenter('center-1')).rejects.toThrow();

    expect(database.queries.some(({ table }) => table === 'profiles')).toBe(false);
    expect(qbo.requests).toHaveLength(0);
  });

  it('pushes active customer login emails into the contact email field with email delivery enabled', async () => {
    const qbo = quickBooksFixture();
    await createQuickBooksCustomerFromPortalCenter('center-1');
    expect(database.queries.find(({ table }) => table === 'profiles')?.filters).toEqual({
      center_id: 'center-1', is_admin: false, is_active: true,
    });
    expect(qbo.requests.find(({ method }) => method === 'POST')?.body).toMatchObject({
      PrimaryEmailAddr: { Address: 'buyer@example.com, ap@example.com' }, PreferredDeliveryMethod: 'Email',
    });
    expect(database.updates[0].values).toMatchObject({
      billing_email: 'buyer@example.com, ap@example.com', quickbooks_customer_id: 'customer-1',
    });
  });

  it('uses the billing email when present without adding other logins', async () => {
    database.center.billing_email = 'billing@example.com';
    const qbo = quickBooksFixture();
    await createQuickBooksCustomerFromPortalCenter('center-1');
    expect(database.queries.some(({ table }) => table === 'profiles')).toBe(false);
    expect(qbo.requests[0].body?.PrimaryEmailAddr).toEqual({ Address: 'billing@example.com' });
  });

  it('keeps CooperRiis customer contact sync independent of the invoice creator exception', async () => {
    database.center.name = 'CooperRiis';
    database.center.billing_email = 'billing@example.com';
    const qbo = quickBooksFixture();

    await createQuickBooksCustomerFromPortalCenter('center-1');

    expect(qbo.requests[0].body?.PrimaryEmailAddr).toEqual({ Address: 'billing@example.com' });
    expect(database.queries.some(({ table }) => table === 'profiles')).toBe(false);
  });

  it.each(['no-email', 'lookup-error'] as const)('does not create a customer with missing contact details: %s', async (failure) => {
    database.contacts = [];
    if (failure === 'lookup-error') database.contactsError = { message: 'Contact lookup unavailable' };
    const qbo = quickBooksFixture();
    await expect(createQuickBooksCustomerFromPortalCenter('center-1')).rejects.toThrow(
      failure === 'no-email' ? 'Add a billing email' : 'Contact lookup unavailable'
    );
    expect(qbo.requests).toHaveLength(0);
  });
});

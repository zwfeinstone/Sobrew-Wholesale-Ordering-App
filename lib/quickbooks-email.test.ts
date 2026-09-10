import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  center: {} as Record<string, unknown>,
  contacts: [] as Array<{ email: string | null }>,
  contactsError: null as { message: string } | null,
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock('@/lib/env', () => ({ env: {
  quickBooksClientId: 'test-client', quickBooksClientSecret: 'test-secret',
  quickBooksEnvironment: 'sandbox', quickBooksMinorVersion: '75', siteUrl: 'https://example.com',
} }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  rpc: async () => ({ data: 'SO-1001', error: null }),
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
      order() { return this; },
      limit() { return this; },
      update(next: Record<string, unknown>) { values = next; return this; },
      single: async () => result(),
      maybeSingle: async () => result(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
  },
}) }));

import { createQuickBooksCustomerFromPortalCenter, createQuickBooksInvoiceForOrder } from './quickbooks';

type RequestRecord = { url: URL; body: Record<string, any> | null; method: string };

function quickBooksFixture(options: {
  customer?: Record<string, unknown> | null;
  invoice?: Record<string, unknown>;
  fail?: 'customer' | 'invoice-read' | 'invoice-update';
} = {}) {
  const requests: RequestRecord[] = [];
  let invoice: Record<string, any> = {
    Id: 'invoice-1', SyncToken: '0', DocNumber: 'SO-1001',
    BillEmail: { Address: 'old@example.com' },
    ...options.invoice,
  };
  const customer = options.customer === undefined ? {
    Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com, ap@example.com' },
  } : options.customer;
  const failure = () => Response.json({ Fault: { Error: [{ Message: 'Provider unavailable' }] } }, { status: 503 });
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = init.method ?? 'GET';
    requests.push({ url, body, method });
    if (url.pathname.endsWith('/customer/customer-1')) {
      return options.fail === 'customer' ? failure() : Response.json({ Customer: customer });
    }
    if (url.pathname.endsWith('/customer') && method === 'POST') {
      return Response.json({ Customer: { ...body, Id: 'customer-1', SyncToken: '0' } });
    }
    if (url.pathname.endsWith('/invoice/invoice-1/send')) return Response.json({ Invoice: { ...invoice, EmailStatus: 'EmailSent' } });
    if (url.pathname.endsWith('/invoice/invoice-1')) {
      return options.fail === 'invoice-read' ? failure() : Response.json({ Invoice: invoice });
    }
    if (url.pathname.endsWith('/invoice') && method === 'POST') {
      if (body.Id && options.fail === 'invoice-update') return failure();
      invoice = { ...invoice, ...body, SyncToken: String(Number(invoice.SyncToken) + 1) };
      // QuickBooks may supply a saved invoice CC even when creation omitted it.
      return Response.json({ Invoice: invoice });
    }
    throw new Error(`Unexpected request ${method} ${url.pathname}`);
  }));
  return { requests, invoice: () => invoice, sends: () => requests.filter(({ url }) => url.pathname.endsWith('/send')) };
}

beforeEach(() => {
  database.queries.length = 0;
  database.updates.length = 0;
  database.contactsError = null;
  database.contacts = [{ email: 'buyer@example.com' }, { email: 'ap@example.com' }, { email: 'BUYER@example.com' }];
  database.center = { id: 'center-1', name: 'Recovery Center', is_active: true, billing_email: null };
  database.order = {
    id: 'order-1', status: 'Shipped', created_at: '2026-08-01T15:00:00Z', notes: null,
    centers: { name: 'Recovery Center', quickbooks_customer_id: 'customer-1', billing_email: 'portal@example.com' },
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

  it('retains CC supplied by QuickBooks on invoice creation and records the recipients', async () => {
    const qbo = quickBooksFixture({
      customer: { Id: 'customer-1', PrimaryEmailAddr: { Address: 'billing@example.com' } },
      invoice: { BillEmailCc: { Address: 'accountant@example.com' } },
    });
    const result = await createQuickBooksInvoiceForOrder('order-1');
    expect(result.emailCc).toBe('accountant@example.com');
    expect(qbo.invoice().BillEmailCc).toEqual({ Address: 'accountant@example.com' });
    expect(qbo.sends()).toHaveLength(1);
  });

  it('resends with current customer recipients plus saved invoice CC, preserving BCC and using the latest token', async () => {
    database.order.quickbooks_invoice_id = 'invoice-1';
    const qbo = quickBooksFixture({ invoice: {
      DocNumber: 'OLD', BillEmailCc: { Address: 'AP@example.com; accountant@example.com, BILLING@example.com' },
      BillEmailBcc: { Address: 'private@example.com' },
    } });
    const result = await createQuickBooksInvoiceForOrder('order-1');
    const emailUpdate = qbo.requests.find(({ body }) => body?.Id && body?.BillEmail);
    expect(emailUpdate?.body).toMatchObject({ SyncToken: '1', sparse: true,
      BillEmail: { Address: 'billing@example.com' }, BillEmailCc: { Address: 'ap@example.com, accountant@example.com' } });
    expect(emailUpdate?.body).not.toHaveProperty('BillEmailBcc');
    expect(qbo.invoice().BillEmailBcc).toEqual({ Address: 'private@example.com' });
    expect(qbo.sends()).toHaveLength(1);
    expect(result.emailRecipients).toBe('billing@example.com, ap@example.com, accountant@example.com');
  });

  it('uses the saved invoice email before a portal fallback when the customer has no email', async () => {
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
    database.order.centers = { name: 'Center', quickbooks_customer_id: 'customer-1' };
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
});

describe('QuickBooks customer email sync', () => {
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

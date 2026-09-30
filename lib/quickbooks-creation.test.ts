import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  center: {} as Record<string, any>,
  product: {} as Record<string, any>,
  connected: true,
  failMappingOnce: false,
}));

vi.mock('@/lib/env', () => ({ env: {
  quickBooksClientId: 'test-client', quickBooksClientSecret: 'test-secret',
  quickBooksEnvironment: 'sandbox', quickBooksMinorVersion: '75',
  quickBooksIncomeAccountId: 'income-17', quickBooksProductItemType: 'NonInventory',
  siteUrl: 'https://example.test',
} }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let update: Record<string, unknown> | undefined;
    const result = () => {
      if (table === 'quickbooks_connections') return { data: fixture.connected ? {
        access_token: 'token', access_token_expires_at: '2099-01-01T00:00:00Z',
        refresh_token: 'refresh', realm_id: 'test-realm', environment: 'sandbox',
      } : null, error: null };
      const row = table === 'centers' ? fixture.center : table === 'products' ? fixture.product : null;
      if (!row) throw new Error(`Unexpected table: ${table}`);
      const matches = Object.entries(filters).every(([key, value]) => (row[key] ?? null) === value);
      if (!matches) return { data: null, error: null };
      if (update && (update.quickbooks_customer_id || update.quickbooks_item_id) && fixture.failMappingOnce) {
        fixture.failMappingOnce = false;
        return { data: null, error: { message: 'Mapping save interrupted' } };
      }
      if (update) Object.assign(row, update);
      return { data: { ...row }, error: null };
    };
    return {
      select() { return this; },
      eq(key: string, value: unknown) { filters[key] = value; return this; },
      is(key: string, value: unknown) { filters[key] = value; return this; },
      update(value: Record<string, unknown>) { update = value; return this; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
  },
}) }));

import { clearPortalCenterQuickBooksCustomer, createMissingQuickBooksProductsFromPortal, createQuickBooksCustomerFromPortalCenter, linkPortalCenterToQuickBooksCustomer, type QuickBooksPortalProduct } from './quickbooks';

const centerId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';

function provider({ loseFirstResponse = false, archivedItem = false, inactiveCustomer = false } = {}) {
  const responses = new Map<string, Record<string, unknown>>();
  const requests: Array<{ url: URL; body: Record<string, any> | null; method: string }> = [];
  let createdCount = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = init.method || 'GET';
    requests.push({ url, body, method });
    if (method === 'GET' && url.pathname.endsWith('/query')) {
      return Response.json({ QueryResponse: { Customer: [{
        Id: 'qbo-customer', DisplayName: 'Existing customer', PrimaryEmailAddr: { Address: 'quickbooks@example.test' }, Active: true,
      }] } });
    }
    if (method === 'GET' && url.pathname.endsWith('/customer/qbo-customer')) {
      const created = [...responses.values()].find((response) => response.Customer)?.Customer as Record<string, unknown> | undefined;
      return Response.json({ Customer: { Id: 'qbo-customer', DisplayName: 'Existing customer', ...created, Active: !inactiveCustomer } });
    }
    if (method === 'GET' && url.pathname.endsWith('/item/qbo-item')) {
      return Response.json({ Item: { Id: 'qbo-item', Name: 'Test coffee', Type: 'NonInventory', Active: !archivedItem } });
    }
    if (method !== 'POST') throw new Error(`Unexpected request ${method} ${url.pathname}`);
    const key = url.searchParams.get('requestid');
    if (!key) throw new Error('Creation must supply a stable request ID.');
    if (!responses.has(key)) {
      createdCount += 1;
      const entity = url.pathname.endsWith('/customer') ? 'Customer' : 'Item';
      responses.set(key, { [entity]: { ...body, Id: entity === 'Customer' ? 'qbo-customer' : 'qbo-item', SyncToken: '0' } });
      if (loseFirstResponse) throw new Error('Connection lost after QuickBooks accepted the request');
    }
    return Response.json(responses.get(key));
  }));
  return { requests, createdCount: () => createdCount };
}

beforeEach(() => {
  fixture.connected = true;
  fixture.failMappingOnce = false;
  fixture.center = {
    id: centerId, name: 'Test Customer', is_active: true, billing_email: 'buyer@example.test',
    billing_address1: '105 Test Drive', billing_city: 'Somerville', billing_state: 'TN', billing_zip: '38068',
    quickbooks_customer_id: null,
  };
  fixture.product = { id: productId, name: 'Test coffee', sku: 'TEST-COFFEE', description: '12 oz bag', active: true, quickbooks_item_id: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('QuickBooks creation and mapping', () => {
  it('creates a customer with invoice email, billing/shipping address, and saves its mapping', async () => {
    const qbo = provider();
    expect((await createQuickBooksCustomerFromPortalCenter(centerId)).id).toBe('qbo-customer');
    expect(qbo.requests[0].body).toMatchObject({
      PrimaryEmailAddr: { Address: 'buyer@example.test' }, PreferredDeliveryMethod: 'Email',
      BillAddr: { Line1: '105 Test Drive', City: 'Somerville', CountrySubDivisionCode: 'TN', PostalCode: '38068' },
      ShipAddr: { Line1: '105 Test Drive', City: 'Somerville', CountrySubDivisionCode: 'TN', PostalCode: '38068' },
    });
    expect(fixture.center).toMatchObject({ quickbooks_customer_id: 'qbo-customer', quickbooks_sync_status: 'matched', quickbooks_sync_error: null });
  });

  it.each(['response', 'mapping'] as const)('retries a customer safely after a lost %s without creating another QuickBooks record', async (failure) => {
    fixture.failMappingOnce = failure === 'mapping';
    const qbo = provider({ loseFirstResponse: failure === 'response' });
    await expect(createQuickBooksCustomerFromPortalCenter(centerId)).rejects.toThrow();
    expect(fixture.center).toMatchObject({ quickbooks_customer_id: null, quickbooks_sync_status: 'sync_error' });
    await createQuickBooksCustomerFromPortalCenter(centerId);
    expect(qbo.createdCount()).toBe(1);
    expect(new Set(qbo.requests.filter(({ method }) => method === 'POST').map(({ url }) => url.searchParams.get('requestid'))).size).toBe(1);
    expect(fixture.center).toMatchObject({ quickbooks_customer_id: 'qbo-customer', quickbooks_sync_error: null });
  });

  it('preserves updated explicit invoice recipients when a creation retry returns an older customer email', async () => {
    fixture.center.invoice_recipients_configured_at = '2026-09-30T12:00:00Z';
    fixture.center.billing_email_cc = ['cc@example.test'];
    fixture.failMappingOnce = true;
    const qbo = provider();
    await expect(createQuickBooksCustomerFromPortalCenter(centerId)).rejects.toThrow('mapping');
    fixture.center.billing_email = 'updated-invoices@example.test';

    await createQuickBooksCustomerFromPortalCenter(centerId);

    expect(qbo.createdCount()).toBe(1);
    expect(fixture.center).toMatchObject({
      billing_email: 'updated-invoices@example.test', billing_email_cc: ['cc@example.test'],
      invoice_recipients_configured_at: '2026-09-30T12:00:00Z', quickbooks_customer_id: 'qbo-customer',
    });
  });

  it.each([false, true])('links a customer while preserving explicit recipients only when configured=%s', async (configured) => {
    if (configured) fixture.center.invoice_recipients_configured_at = '2026-09-30T12:00:00Z';
    fixture.center.billing_email_cc = ['cc@example.test'];
    provider();

    await linkPortalCenterToQuickBooksCustomer({ centerId, customerId: 'qbo-customer' });

    expect(fixture.center.billing_email).toBe(configured ? 'buyer@example.test' : 'quickbooks@example.test');
    expect(fixture.center.billing_email_cc).toEqual(['cc@example.test']);
    expect(fixture.center.quickbooks_customer_id).toBe('qbo-customer');
  });

  it.each([false, true])('clears a customer mapping while preserving explicit recipients only when configured=%s', async (configured) => {
    if (configured) fixture.center.invoice_recipients_configured_at = '2026-09-30T12:00:00Z';
    fixture.center.billing_email_cc = ['cc@example.test'];
    fixture.center.quickbooks_customer_id = 'qbo-customer';

    await clearPortalCenterQuickBooksCustomer(centerId);

    expect(fixture.center.billing_email).toBe(configured ? 'buyer@example.test' : null);
    expect(fixture.center.billing_email_cc).toEqual(['cc@example.test']);
    expect(fixture.center.quickbooks_customer_id).toBeNull();
  });

  it('does not create another customer when the customer is already linked', async () => {
    fixture.center.quickbooks_customer_id = 'qbo-customer';
    const qbo = provider();
    expect((await createQuickBooksCustomerFromPortalCenter(centerId)).id).toBe('qbo-customer');
    expect(qbo.createdCount()).toBe(0);
    expect(qbo.requests.every(({ method }) => method === 'GET')).toBe(true);
  });

  it('does not report an already-linked new customer as ready if its explicit invoice email is missing', async () => {
    fixture.center.quickbooks_customer_id = 'qbo-customer';
    fixture.center.invoice_recipients_configured_at = '2026-09-30T12:00:00Z';
    fixture.center.billing_email = null;
    const qbo = provider();

    await expect(createQuickBooksCustomerFromPortalCenter(centerId)).rejects.toThrow();

    expect(qbo.requests).toHaveLength(0);
    expect(fixture.center.quickbooks_customer_id).toBe('qbo-customer');
  });

  it('does not link an inactive customer from a historical creation response', async () => {
    provider({ inactiveCustomer: true });
    await expect(createQuickBooksCustomerFromPortalCenter(centerId)).rejects.toThrow('inactive');
    expect(fixture.center.quickbooks_customer_id).toBeNull();
    expect(fixture.center.quickbooks_sync_status).toBe('sync_error');
  });

  it('does not report an already-linked inactive customer as ready', async () => {
    fixture.center.quickbooks_customer_id = 'qbo-customer';
    const qbo = provider({ inactiveCustomer: true });
    await expect(createQuickBooksCustomerFromPortalCenter(centerId)).rejects.toThrow('inactive');
    expect(qbo.createdCount()).toBe(0);
    expect(fixture.center.quickbooks_customer_id).toBe('qbo-customer');
  });

  it('creates and links the saved product with the configured income account', async () => {
    const qbo = provider();
    const result = await createMissingQuickBooksProductsFromPortal([fixture.product as QuickBooksPortalProduct]);
    expect(result).toEqual({ createdCount: 1, productErrorCount: 0 });
    expect(qbo.requests[0].body).toMatchObject({ Name: 'Test coffee', Sku: 'TEST-COFFEE', Type: 'NonInventory', IncomeAccountRef: { value: 'income-17' } });
    expect(fixture.product).toMatchObject({ quickbooks_item_id: 'qbo-item', quickbooks_sync_status: 'created', quickbooks_sync_error: null });
  });

  it.each(['response', 'mapping'] as const)('retries a product safely after a lost %s without creating another QuickBooks item', async (failure) => {
    fixture.failMappingOnce = failure === 'mapping';
    const qbo = provider({ loseFirstResponse: failure === 'response' });
    const product = { ...fixture.product } as QuickBooksPortalProduct;
    expect(await createMissingQuickBooksProductsFromPortal([product])).toEqual({ createdCount: 0, productErrorCount: 1 });
    expect(fixture.product).toMatchObject({ quickbooks_item_id: null, quickbooks_sync_status: 'sync_error' });
    expect(await createMissingQuickBooksProductsFromPortal([product])).toEqual({ createdCount: 1, productErrorCount: 0 });
    expect(qbo.createdCount()).toBe(1);
    expect(fixture.product).toMatchObject({ quickbooks_item_id: 'qbo-item', quickbooks_sync_error: null });
  });

  it('rechecks the saved product mapping before syncing stale form data', async () => {
    const product = { ...fixture.product } as QuickBooksPortalProduct;
    fixture.product.quickbooks_item_id = 'existing-item';
    const qbo = provider();
    expect(await createMissingQuickBooksProductsFromPortal([product])).toEqual({ createdCount: 1, productErrorCount: 0 });
    expect(qbo.requests).toHaveLength(0);
    expect(fixture.product.quickbooks_item_id).toBe('existing-item');
  });

  it('does not link an archived item from a historical idempotent creation response', async () => {
    const qbo = provider({ archivedItem: true });
    expect(await createMissingQuickBooksProductsFromPortal([fixture.product as QuickBooksPortalProduct]))
      .toEqual({ createdCount: 0, productErrorCount: 1 });
    expect(qbo.createdCount()).toBe(1);
    expect(fixture.product.quickbooks_item_id).toBeNull();
    expect(fixture.product.quickbooks_sync_status).toBe('sync_error');
    expect(fixture.product.quickbooks_sync_error).toContain('archived');
  });

  it('records a recoverable sync error for either entity when QuickBooks is disconnected', async () => {
    fixture.connected = false;
    const qbo = provider();
    await expect(createQuickBooksCustomerFromPortalCenter(centerId)).rejects.toThrow();
    await expect(createMissingQuickBooksProductsFromPortal([fixture.product as QuickBooksPortalProduct])).rejects.toThrow();
    expect(fixture.center.quickbooks_sync_status).toBe('sync_error');
    expect(fixture.product.quickbooks_sync_status).toBe('sync_error');
    expect(qbo.requests).toHaveLength(0);
  });
});

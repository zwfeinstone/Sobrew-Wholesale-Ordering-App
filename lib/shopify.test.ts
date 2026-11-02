import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  order: {} as Record<string, any>,
  updates: [] as Record<string, unknown>[],
  failClaim: false,
  failCompletion: false,
  beforeCompletion: null as null | (() => void),
}));

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  from(table: string) {
    if (table !== 'orders') throw new Error(`Unexpected table: ${table}`);
    const predicates: Array<(row: Record<string, any>) => boolean> = [];
    let values: Record<string, unknown> | null = null;
    let selected = false;
    const result = () => {
      if (values?.shopify_sync_status === 'syncing' && database.failClaim) return { data: null, error: { message: 'Unavailable' } };
      if (values?.shopify_sync_status === 'synced') {
        database.beforeCompletion?.();
        if (database.failCompletion) return { data: null, error: { message: 'Unavailable' } };
      }
      if (!predicates.every((predicate) => predicate(database.order))) return { data: null, error: null };
      if (values) {
        database.updates.push(structuredClone(values));
        Object.assign(database.order, values);
      }
      return { data: !values || selected ? structuredClone(database.order) : null, error: null };
    };
    return {
      select() { selected = true; return this; },
      eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return this; },
      neq(key: string, value: unknown) { predicates.push((row) => row[key] !== value); return this; },
      is(key: string, value: unknown) { predicates.push((row) => (row[key] ?? null) === value); return this; },
      update(next: Record<string, unknown>) { values = next; selected = false; return this; },
      single: async () => result(),
      maybeSingle: async () => result(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
  },
}) }));

import { getShopifyConfig, hasShopifyConfiguration, syncShopifyFulfillment, validateShopifyOrderForShipment, verifyShopifyWebhook } from './shopify';

const ORDER_ID = 'gid://shopify/Order/1001';
const LINE_ID = 'gid://shopify/LineItem/1002';
const FULFILLMENT_ID = 'gid://shopify/Fulfillment/1003';
const connection = <T>(nodes: T[]) => ({ nodes, pageInfo: { hasNextPage: false } });

function fixture() {
  const requests: Array<{ query: string; variables: Record<string, any> }> = [];
  const order = {
    id: ORDER_ID, cancelledAt: null as string | null, displayFinancialStatus: 'PAID',
    shippingAddress: { name: 'Jane Buyer', company: null as string | null, address1: '100 Main St', address2: null as string | null,
      city: 'Chicago', provinceCode: 'IL', province: 'Illinois', zip: '60601', countryCodeV2: 'US' },
    lineItems: connection([{ id: LINE_ID, currentQuantity: 2, unfulfilledQuantity: 2, requiresShipping: true }]),
    fulfillments: [] as Array<{ id: string; status: string; trackingInfo: Array<{ number: string }> }>,
    fulfillmentOrders: connection([{
      id: 'gid://shopify/FulfillmentOrder/1004', status: 'OPEN',
      assignedLocation: { location: { id: 'gid://shopify/Location/1005' } as { id: string } | null },
      supportedActions: [{ action: 'CREATE_FULFILLMENT' }],
    }]),
  };
  const fulfillmentLines = connection([{ id: 'gid://shopify/FulfillmentOrderLineItem/1006', remainingQuantity: 2, lineItem: { id: LINE_ID } }]);
  const fulfilledLines = connection([{ quantity: 2, lineItem: { id: LINE_ID } }]);
  const state = { failCreateResponse: false, createError: '', queryError: '', httpStatus: 200, authStatus: 200, authRequests: 0, accessToken: 'test-token', denyLocationRead: false };
  const fulfillmentLinesById = new Map<string, typeof fulfillmentLines>();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/admin/oauth/access_token')) {
      state.authRequests++;
      expect(url).toBe('https://test-store.myshopify.com/admin/oauth/access_token');
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
      const body = new URLSearchParams(String(init.body));
      expect(body.get('grant_type')).toBe('client_credentials');
      expect(body.get('client_id')).toBe(process.env.SHOPIFY_CLIENT_ID);
      expect(body.get('client_secret')).toBe(process.env.SHOPIFY_CLIENT_SECRET);
      state.accessToken = `oauth-token-${state.authRequests}`;
      return Response.json({ access_token: state.accessToken, expires_in: 86400 }, { status: state.authStatus });
    }
    expect(url).toBe('https://test-store.myshopify.com/admin/api/2026-10/graphql.json');
    expect(new Headers(init.headers).get('X-Shopify-Access-Token')).toBe(state.accessToken);
    const { query, variables } = JSON.parse(String(init.body));
    requests.push({ query, variables });
    if (state.httpStatus !== 200) return Response.json({}, { status: state.httpStatus });
    if (state.queryError) return Response.json({ errors: [{ message: state.queryError }] });
    if (state.denyLocationRead && /assignedLocation\s*\{\s*location\b/.test(query)) {
      return Response.json({ errors: [{ message: 'Access denied for location field. Required access: read_locations access scope.' }] });
    }
    if (query.includes('PortalShopifyOrder')) return Response.json({ data: { order } });
    if (query.includes('PortalFulfillmentOrderLines')) return Response.json({ data: { fulfillmentOrder: {
      lineItems: fulfillmentLinesById.get(variables.id) ?? fulfillmentLines,
      assignedLocation: order.fulfillmentOrders.nodes.find((entry) => entry.id === variables.id)?.assignedLocation,
    } } });
    if (query.includes('PortalFulfilledLines')) return Response.json({ data: { node: { fulfillmentLineItems: fulfilledLines } } });
    if (query.includes('PortalFulfillmentCreate')) {
      if (state.createError) return Response.json({ data: { fulfillmentCreate: { fulfillment: null, userErrors: [{ message: state.createError }] } } });
      order.fulfillments = [{ id: FULFILLMENT_ID, status: 'SUCCESS', trackingInfo: (variables.fulfillment.trackingInfo?.numbers ?? []).map((number: string) => ({ number })) }];
      order.lineItems.nodes[0].unfulfilledQuantity = 0;
      order.fulfillmentOrders.nodes[0].status = 'CLOSED';
      if (state.failCreateResponse) throw new TypeError('Connection interrupted after fulfillment creation');
      return Response.json({ data: { fulfillmentCreate: { fulfillment: { id: FULFILLMENT_ID, status: 'SUCCESS' }, userErrors: [] } } });
    }
    if (query.includes('PortalFulfillmentTrackingUpdate')) {
      order.fulfillments[0].trackingInfo = variables.tracking.numbers.map((number: string) => ({ number }));
      return Response.json({ data: { fulfillmentTrackingInfoUpdate: { fulfillment: { id: FULFILLMENT_ID, status: 'SUCCESS' }, userErrors: [] } } });
    }
    throw new Error(`Unexpected GraphQL request: ${query}`);
  }));
  return { order, fulfillmentLines, fulfillmentLinesById, fulfilledLines, requests, state };
}

beforeEach(() => {
  vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'test-store.myshopify.com');
  vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'test-token');
  vi.stubEnv('SHOPIFY_WEBHOOK_SECRET', 'test-secret');
  vi.stubEnv('SHOPIFY_CLIENT_ID', '');
  vi.stubEnv('SHOPIFY_CLIENT_SECRET', '');
  database.order = {
    id: 'portal-order', status: 'Shipped', archived_at: null, order_source: 'shopify',
    fulfillment_method: 'carrier', shipping_cost_cents: 1234, shipping_tracking_numbers: ['1Z-FIRST', '1Z-SECOND'],
    shipping_name: 'Jane Buyer', shipping_company: null, shipping_address1: '100 Main St', shipping_address2: null,
    shipping_city: 'Chicago', shipping_state: 'IL', shipping_zip: '60601', shipping_country: 'US',
    shopify_shop_domain: 'test-store.myshopify.com', shopify_order_id: ORDER_ID,
    shopify_line_items: [{ line_item_id: LINE_ID, quantity: 2, product_id: 'product-1' }],
    order_items: [{ product_id: 'product-1', qty: 2 }],
    shopify_fulfillment_id: null, shopify_sync_status: 'pending', shopify_sync_started_at: null, shopify_sync_token: null,
  };
  database.updates = [];
  database.failClaim = false;
  database.failCompletion = false;
  database.beforeCompletion = null;
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Shopify webhook authentication and configuration', () => {
  it('authenticates exactly the raw body and rejects modified data, absent and malformed signatures', () => {
    const body = '{"id": 1001, "financial_status": "paid"}';
    const signature = createHmac('sha256', 'test-secret').update(body).digest('base64');
    expect(verifyShopifyWebhook(body, signature)).toBe(true);
    expect(verifyShopifyWebhook(JSON.stringify(JSON.parse(body)), signature)).toBe(false);
    for (const invalid of [null, '', 'garbage', `${signature}extra`, signature.replace(/.$/, '!')]) expect(verifyShopifyWebhook(body, invalid)).toBe(false);
    vi.stubEnv('SHOPIFY_WEBHOOK_SECRET', '');
    expect(verifyShopifyWebhook(body, signature)).toBe(false);
  });

  it('allows inbound authentication without an Admin API token', () => {
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', '');
    expect(verifyShopifyWebhook('{}', createHmac('sha256', 'test-secret').update('{}').digest('base64'))).toBe(true);
  });

  it('uses the app client secret for app-managed webhooks when no dedicated webhook secret is set', () => {
    vi.stubEnv('SHOPIFY_CLIENT_SECRET', 'app-client-secret');
    vi.stubEnv('SHOPIFY_WEBHOOK_SECRET', '');
    expect(verifyShopifyWebhook('{}', createHmac('sha256', 'app-client-secret').update('{}').digest('base64'))).toBe(true);
  });

  it.each(['https://test-store.myshopify.com', 'test-store.myshopify.com/evil', 'test-store.myshopify.com.evil.test', 'localhost', 'user@test-store.myshopify.com'])('rejects unsafe shop domains: %s', (domain) => {
    vi.stubEnv('SHOPIFY_SHOP_DOMAIN', domain);
    expect(getShopifyConfig().shopDomain).toBe('');
  });
});

describe('Shopify shipment validation', () => {
  it('validates and fulfills a single fulfillment order without location permissions', async () => {
    const remote = fixture();
    remote.state.denyLocationRead = true;
    database.order.status = 'New';
    database.order.shopify_sync_status = 'error';
    database.order.shopify_sync_error = 'Access denied for location field';
    expect(await validateShopifyOrderForShipment('portal-order')).toEqual({ ok: true });
    expect(database.order).toMatchObject({ status: 'New', shopify_sync_status: 'pending', shopify_sync_error: null });
    expect(remote.requests.some((request) => request.query.includes('mutation'))).toBe(false);
    database.order.status = 'Shipped';
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.requests.every((request) => !request.query.includes('assignedLocation'))).toBe(true);
    expect(remote.requests.filter((request) => request.query.includes('mutation PortalFulfillmentCreate'))).toHaveLength(1);
  });

  it('checks a paid, unfulfilled order without creating a fulfillment', async () => {
    const remote = fixture();
    database.order.status = 'Processing';
    expect(await validateShopifyOrderForShipment('portal-order')).toEqual({ ok: true });
    expect(remote.requests).toHaveLength(2);
    expect(remote.requests.some((request) => request.query.includes('mutation'))).toBe(false);
  });

  it.each(['canceled', 'refunded', 'changed quantities', 'changed line IDs', 'partial fulfillment', 'held', 'missing permission', 'incomplete pagination', 'changed local product', 'changed local quantity', 'different store'])('blocks %s and persists a visible error', async (scenario) => {
    const remote = fixture();
    database.order.status = 'Processing';
    if (scenario === 'canceled') remote.order.cancelledAt = '2026-10-09T12:00:00Z';
    if (scenario === 'refunded') remote.order.displayFinancialStatus = 'PARTIALLY_REFUNDED';
    if (scenario === 'changed quantities') remote.order.lineItems.nodes[0].currentQuantity = 1;
    if (scenario === 'changed line IDs') remote.order.lineItems.nodes[0].id = 'gid://shopify/LineItem/9999';
    if (scenario === 'partial fulfillment') remote.order.lineItems.nodes[0].unfulfilledQuantity = 1;
    if (scenario === 'held') remote.order.fulfillmentOrders.nodes[0].status = 'ON_HOLD';
    if (scenario === 'missing permission') remote.order.fulfillmentOrders.nodes[0].supportedActions = [];
    if (scenario === 'incomplete pagination') remote.order.lineItems.pageInfo.hasNextPage = true;
    if (scenario === 'changed local product') database.order.order_items[0].product_id = 'other-product';
    if (scenario === 'changed local quantity') database.order.order_items[0].qty = 1;
    if (scenario === 'different store') database.order.shopify_shop_domain = 'other.myshopify.com';
    expect(await validateShopifyOrderForShipment('portal-order')).toMatchObject({ ok: false, error: expect.any(String) });
    expect(database.order.shopify_sync_error).toBeTruthy();
    expect(remote.requests.some((request) => request.query.includes('mutation'))).toBe(false);
  });

  it('rejects fulfillment line mismatches even when the order summary matches', async () => {
    const remote = fixture();
    remote.fulfillmentLines.nodes[0].remainingQuantity = 1;
    expect(await validateShopifyOrderForShipment('portal-order')).toMatchObject({ ok: false, error: expect.stringContaining('fulfillment quantities differ') });
  });

  it.each(['name', 'company', 'address1', 'address2', 'city', 'provinceCode', 'zip', 'countryCodeV2'] as const)('blocks a Shopify shipping %s change before shipment and before a sync mutation', async (field) => {
    const remote = fixture();
    remote.order.shippingAddress[field] = 'changed value';
    database.order.status = 'Processing';
    expect(await validateShopifyOrderForShipment('portal-order')).toMatchObject({ ok: false, error: expect.stringContaining('Shipping address differs') });
    expect(database.order.shopify_sync_error).toContain('Update the portal delivery address');
    database.order.status = 'Shipped';
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error', error: expect.stringContaining('Shipping address differs') });
    expect(remote.requests.some((request) => request.query.includes('mutation'))).toBe(false);
  });

  it('normalizes shipping address case, whitespace, and optional blank fields', async () => {
    fixture();
    database.order.shipping_name = '  JANE   BUYER ';
    database.order.shipping_company = '';
    database.order.shipping_address2 = '  ';
    database.order.shipping_city = 'CHICAGO';
    database.order.shipping_country = 'us';
    expect(await validateShopifyOrderForShipment('portal-order')).toEqual({ ok: true });
  });

  it('rejects multiple shipping locations', async () => {
    const remote = fixture();
    remote.order.fulfillmentOrders.nodes.push({ ...remote.order.fulfillmentOrders.nodes[0], id: 'second-order', assignedLocation: { location: { id: 'second-location' } } });
    expect(await validateShopifyOrderForShipment('portal-order')).toMatchObject({ ok: false, error: expect.stringContaining('split across locations') });
  });

  it('still combines verified fulfillment orders at the same location', async () => {
    const remote = fixture();
    remote.order.fulfillmentOrders.nodes.push({ ...remote.order.fulfillmentOrders.nodes[0], id: 'second-order' });
    remote.fulfillmentLines.nodes[0].remainingQuantity = 1;
    remote.fulfillmentLinesById.set('second-order', connection([{ id: 'second-fulfillment-line', remainingQuantity: 1, lineItem: { id: LINE_ID } }]));
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    const create = remote.requests.find((request) => request.query.includes('mutation PortalFulfillmentCreate'));
    expect(create?.variables.fulfillment.lineItemsByFulfillmentOrder).toHaveLength(2);
    expect(remote.requests.find((request) => request.query.includes('query PortalShopifyOrder'))?.query).not.toContain('assignedLocation');
  });

  it.each(['denied', 'missing'])('blocks multiple fulfillment orders when location access is %s', async (scenario) => {
    const remote = fixture();
    remote.order.fulfillmentOrders.nodes.push({ ...remote.order.fulfillmentOrders.nodes[0], id: 'second-order' });
    if (scenario === 'denied') remote.state.denyLocationRead = true;
    else remote.order.fulfillmentOrders.nodes[0].assignedLocation.location = null;
    expect(await validateShopifyOrderForShipment('portal-order')).toMatchObject({ ok: false });
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error' });
    expect(remote.requests.some((request) => request.query.includes('mutation'))).toBe(false);
  });
});

describe('Shopify fulfillment sync', () => {
  it.each([0, 500])('fulfills local delivery with %s cents shipping and no invented carrier tracking', async (shippingCostCents) => {
    const remote = fixture();
    Object.assign(database.order, { fulfillment_method: 'local_delivery', shipping_cost_cents: shippingCostCents, shipping_tracking_numbers: [] });
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    const create = remote.requests.find((request) => request.query.includes('PortalFulfillmentCreate'));
    expect(create?.variables.fulfillment).toEqual({
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1004', fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/1006', quantity: 2 }] }],
      notifyCustomer: true,
    });
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.requests.filter((request) => request.query.includes('mutation'))).toHaveLength(1);
  });

  it('recovers local delivery after a lost Shopify response without creating another fulfillment', async () => {
    const remote = fixture();
    Object.assign(database.order, { fulfillment_method: 'local_delivery', shipping_cost_cents: 0, shipping_tracking_numbers: [] });
    remote.state.failCreateResponse = true;
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error' });
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.requests.filter((request) => request.query.includes('mutation'))).toHaveLength(1);
  });

  it.each(['negative cost', 'missing cost', 'carrier tracking'])('blocks invalid local delivery with %s', async (scenario) => {
    const remote = fixture();
    Object.assign(database.order, { fulfillment_method: 'local_delivery', shipping_cost_cents: 0, shipping_tracking_numbers: [] });
    if (scenario === 'negative cost') database.order.shipping_cost_cents = -1;
    if (scenario === 'missing cost') database.order.shipping_cost_cents = null;
    if (scenario === 'carrier tracking') database.order.shipping_tracking_numbers = ['1Z-FIRST'];
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error' });
    expect(remote.requests).toHaveLength(0);
  });

  it('does not remove existing Shopify carrier tracking from a local delivery', async () => {
    const remote = fixture();
    Object.assign(database.order, { fulfillment_method: 'local_delivery', shipping_cost_cents: 0, shipping_tracking_numbers: [], shopify_fulfillment_id: FULFILLMENT_ID });
    remote.order.fulfillments = [{ id: FULFILLMENT_ID, status: 'SUCCESS', trackingInfo: [{ number: '1Z-FIRST' }] }];
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error', error: expect.stringContaining('carrier tracking') });
    expect(remote.requests.some((request) => request.query.includes('mutation'))).toBe(false);
  });

  it('uses client credentials without a static token, caches the token, and refreshes before expiration', async () => {
    const remote = fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', '');
    vi.stubEnv('SHOPIFY_CLIENT_ID', 'refresh-test-client');
    vi.stubEnv('SHOPIFY_CLIENT_SECRET', 'refresh-test-secret');
    expect(hasShopifyConfiguration()).toBe(true);
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.state.authRequests).toBe(1);
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.state.authRequests).toBe(1);
    vi.setSystemTime(new Date('2026-10-10T11:59:30Z'));
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.state.authRequests).toBe(2);
    expect(remote.requests.filter((request) => request.query.includes('mutation'))).toHaveLength(1);
  });

  it('persists authentication failures without sending a fulfillment or exposing credentials', async () => {
    const remote = fixture();
    remote.state.authStatus = 401;
    vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', '');
    vi.stubEnv('SHOPIFY_CLIENT_ID', 'failed-test-client');
    vi.stubEnv('SHOPIFY_CLIENT_SECRET', 'failed-test-secret');
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error', error: expect.stringContaining('authentication failed') });
    expect(remote.requests).toHaveLength(0);
    expect(database.order.shopify_sync_error).not.toContain('failed-test-secret');
    expect(database.order.shopify_sync_status).toBe('error');
  });

  it('ships explicit verified line IDs with all tracking numbers, and a repeated sync does not create again', async () => {
    const remote = fixture();
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(database.order.shopify_fulfillment_id).toBe(FULFILLMENT_ID);
    const create = remote.requests.find((request) => request.query.includes('PortalFulfillmentCreate'));
    expect(create?.variables).toEqual({ fulfillment: {
      lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1004', fulfillmentOrderLineItems: [{ id: 'gid://shopify/FulfillmentOrderLineItem/1006', quantity: 2 }] }],
      trackingInfo: { company: 'UPS', numbers: ['1Z-FIRST', '1Z-SECOND'] }, notifyCustomer: true,
    } });
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.requests.filter((request) => request.query.includes('mutation'))).toHaveLength(1);
  });

  it('recovers a successful fulfillment after its HTTP response was lost without duplicate shipping or notifications', async () => {
    const remote = fixture();
    remote.state.failCreateResponse = true;
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error' });
    expect(database.order.shopify_fulfillment_id).toBeNull();
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(database.order.shopify_fulfillment_id).toBe(FULFILLMENT_ID);
    expect(remote.requests.filter((request) => request.query.includes('mutation'))).toHaveLength(1);
  });

  it('allows retry after a shipped order has been archived', async () => {
    fixture();
    database.order.archived_at = '2026-10-09T13:00:00Z';
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
  });

  it('recovers a successful fulfillment after confirmation persistence failed', async () => {
    const remote = fixture();
    database.failCompletion = true;
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error', error: expect.stringContaining('could not be saved') });
    database.failCompletion = false;
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.requests.filter((request) => request.query.includes('mutation'))).toHaveLength(1);
  });

  it('updates corrected tracking on its known fulfillment', async () => {
    const remote = fixture();
    await syncShopifyFulfillment('portal-order');
    database.order.shipping_tracking_numbers = ['1Z-CORRECTED'];
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
    expect(remote.requests.find((request) => request.query.includes('PortalFulfillmentTrackingUpdate'))?.variables).toEqual({ id: FULFILLMENT_ID, tracking: { company: 'UPS', numbers: ['1Z-CORRECTED'] } });
  });

  it.each(['different tracking', 'different quantity', 'different line', 'pending', 'canceled known fulfillment'])('refuses to adopt a fulfillment with %s', async (scenario) => {
    const remote = fixture();
    remote.order.fulfillments = [{ id: FULFILLMENT_ID, status: 'SUCCESS', trackingInfo: [{ number: '1Z-FIRST' }, { number: '1Z-SECOND' }] }];
    if (scenario === 'different tracking') remote.order.fulfillments[0].trackingInfo = [{ number: 'OTHER-TRACKING' }];
    if (scenario === 'different quantity') remote.fulfilledLines.nodes[0].quantity = 1;
    if (scenario === 'different line') remote.fulfilledLines.nodes[0].lineItem.id = 'gid://shopify/LineItem/9999';
    if (scenario === 'pending') remote.order.fulfillments[0].status = 'PENDING';
    if (scenario === 'canceled known fulfillment') {
      database.order.shopify_fulfillment_id = FULFILLMENT_ID;
      remote.order.fulfillments[0].status = 'CANCELLED';
    }
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error' });
    expect(remote.requests.some((request) => request.query.includes('mutation'))).toBe(false);
  });

  it('allows only one concurrent attempt to create a fulfillment', async () => {
    const remote = fixture();
    const results = await Promise.all([syncShopifyFulfillment('portal-order'), syncShopifyFulfillment('portal-order')]);
    expect(results.map((result) => result.status).sort()).toEqual(['busy', 'synced']);
    expect(remote.requests.filter((request) => request.query.includes('PortalFulfillmentCreate'))).toHaveLength(1);
  });

  it('returns busy for a live claim and recovers an expired claim', async () => {
    const remote = fixture();
    database.order.shopify_sync_status = 'syncing';
    database.order.shopify_sync_token = 'old-token';
    database.order.shopify_sync_started_at = new Date().toISOString();
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'busy' });
    expect(remote.requests).toHaveLength(0);
    database.order.shopify_sync_started_at = '2000-01-01T00:00:00Z';
    expect(await syncShopifyFulfillment('portal-order')).toEqual({ status: 'synced' });
  });

  it('does not overwrite a newer attempt when it loses its lease', async () => {
    fixture();
    database.beforeCompletion = () => { database.order.shopify_sync_token = 'new-attempt'; };
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error' });
    expect(database.order.shopify_sync_token).toBe('new-attempt');
    expect(database.order.shopify_sync_status).toBe('syncing');
  });

  it.each(['missing tracking', 'missing cost', 'not shipped', 'claim failure', 'missing token'])('does not contact Shopify with %s', async (scenario) => {
    const remote = fixture();
    if (scenario === 'missing tracking') database.order.shipping_tracking_numbers = [];
    if (scenario === 'missing cost') database.order.shipping_cost_cents = 0;
    if (scenario === 'not shipped') database.order.status = 'Processing';
    if (scenario === 'claim failure') database.failClaim = true;
    if (scenario === 'missing token') vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', '');
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error' });
    expect(remote.requests).toHaveLength(0);
  });

  it.each(['HTTP', 'GraphQL', 'mutation'])('persists %s errors for a manual retry', async (scenario) => {
    const remote = fixture();
    if (scenario === 'HTTP') remote.state.httpStatus = 429;
    if (scenario === 'GraphQL') remote.state.queryError = 'Access denied';
    if (scenario === 'mutation') remote.state.createError = 'Remaining quantity changed';
    expect(await syncShopifyFulfillment('portal-order')).toMatchObject({ status: 'error' });
    expect(database.order.shopify_sync_status).toBe('error');
    expect(database.order.shopify_sync_error).toBeTruthy();
    expect(database.order.shopify_sync_token).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: vi.fn() }));
import { getShopifyConnection, registerShopifyWebhooks, shopifyGraphQL } from './shopify';

const BASE = 'https://portal.example.com';
const subscription = (topic: string, path: string, id = topic) => ({ id, topic, uri: `${BASE}${path}`, format: 'JSON', filter: null as string | null, includeFields: [] as string[] });
const wanted = () => [
  subscription('ORDERS_PAID', '/api/webhooks/shopify/orders'),
  subscription('PRODUCTS_CREATE', '/api/webhooks/shopify/products'),
  subscription('PRODUCTS_UPDATE', '/api/webhooks/shopify/products'),
];

function fixture() {
  const state = {
    scopes: ['read_orders', 'read_products', 'write_merchant_managed_fulfillment_orders'],
    subscriptions: [] as ReturnType<typeof subscription>[],
    requests: [] as Array<{ query: string; variables: Record<string, any> }>,
    mutationError: '',
  };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    state.requests.push(request);
    if (request.query.includes('PortalShopifyConnection')) return Response.json({ data: {
      shop: { name: 'Sobrew', myshopifyDomain: 'a7mxi8-x1.myshopify.com' },
      currentAppInstallation: { accessScopes: state.scopes.map((handle) => ({ handle })) },
    } });
    if (request.query.includes('PortalShopifyWebhooks')) {
      const start = request.variables.after ? Number(request.variables.after) : 0;
      const nodes = state.subscriptions.slice(start, start + 100);
      return Response.json({ data: { webhookSubscriptions: {
        nodes, pageInfo: { hasNextPage: state.subscriptions.length > start + 100, endCursor: String(start + 100) },
      } } });
    }
    const updating = request.query.includes('PortalShopifyWebhookUpdate');
    if (updating || request.query.includes('PortalShopifyWebhookCreate')) {
      const field = updating ? 'webhookSubscriptionUpdate' : 'webhookSubscriptionCreate';
      if (state.mutationError) return Response.json({ data: { [field]: { webhookSubscription: null, userErrors: [{ message: state.mutationError }] } } });
      const input = request.variables.subscription;
      let current = state.subscriptions.find((entry) => entry.id === request.variables.id);
      if (!updating) {
        current = subscription(request.variables.topic, '', `created-${state.subscriptions.length}`);
        state.subscriptions.push(current);
      }
      Object.assign(current!, { ...input, includeFields: input.includeFields ?? [] });
      return Response.json({ data: { [field]: { webhookSubscription: { id: current!.id }, userErrors: [] } } });
    }
    throw new Error('Unexpected Shopify request');
  }));
  return state;
}

beforeEach(() => {
  vi.stubEnv('SHOPIFY_SHOP_DOMAIN', 'a7mxi8-x1.myshopify.com');
  vi.stubEnv('SHOPIFY_ADMIN_ACCESS_TOKEN', 'test-token');
  vi.stubEnv('SHOPIFY_WEBHOOK_SECRET', 'test-secret');
  vi.stubEnv('SHOPIFY_CLIENT_ID', '');
  vi.stubEnv('SHOPIFY_CLIENT_SECRET', '');
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', BASE);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Shopify API throttle handling', () => {
  it.each(['HTTP', 'GraphQL'])('retries a throttled read after %s throttling', async (kind) => {
    vi.useFakeTimers();
    const throttled = kind === 'HTTP'
      ? Response.json({}, { status: 429, headers: { 'Retry-After': '1' } })
      : Response.json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 50, restoreRate: 50 } } } });
    const fetchMock = vi.fn().mockResolvedValueOnce(throttled).mockResolvedValueOnce(Response.json({ data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = shopifyGraphQL('query CatalogRead { shop { name } }');
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after two read retries', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({}, { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = expect(shopifyGraphQL('query CatalogRead { shop { name } }')).rejects.toThrow('HTTP 429');
    await vi.runAllTimersAsync();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each(['HTTP', 'GraphQL'])('never blindly retries a mutation on %s throttling', async (kind) => {
    const fetchMock = vi.fn().mockResolvedValue(kind === 'HTTP'
      ? Response.json({}, { status: 429 })
      : Response.json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(shopifyGraphQL('mutation ShipmentCreate { fulfillmentCreate { fulfillment { id } } }')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Shopify connection permissions', () => {
  it('reports the store and accepts write scopes that imply read access', async () => {
    fixture();
    expect(await getShopifyConnection()).toMatchObject({ shopName: 'Sobrew', shopDomain: 'a7mxi8-x1.myshopify.com', missingScopes: [] });
  });
  it('reports missing product, order, and shipping access precisely', async () => {
    const state = fixture();
    state.scopes = ['read_merchant_managed_fulfillment_orders'];
    expect((await getShopifyConnection()).missingScopes).toEqual(['read_orders', 'read_products', 'write_merchant_managed_fulfillment_orders']);
    await expect(registerShopifyWebhooks(BASE)).rejects.toThrow('Add these Shopify app permissions');
    expect(state.requests.some((request) => request.query.includes('mutation'))).toBe(false);
  });
});

describe('Shopify webhook registration', () => {
  it('rejects a conflicting manual webhook secret before registering app webhooks', async () => {
    const state = fixture();
    vi.stubEnv('SHOPIFY_CLIENT_SECRET', 'different-app-client-secret');
    await expect(registerShopifyWebhooks(BASE)).rejects.toThrow('Remove SHOPIFY_WEBHOOK_SECRET or set it to the same value');
    expect(state.requests).toHaveLength(0);
  });

  it('registers all three required topics with complete JSON payloads and reuses them on repeated setup', async () => {
    const state = fixture();
    expect(await registerShopifyWebhooks(BASE)).toEqual({ registered: 3, existing: 0, updated: 0 });
    expect(state.subscriptions.map(({ topic, uri }) => ({ topic, uri }))).toEqual(wanted().map(({ topic, uri }) => ({ topic, uri })));
    expect(state.requests.filter((request) => request.query.includes('mutation')).map((request) => request.variables.subscription)).toEqual(wanted().map((entry) => ({ uri: entry.uri, format: 'JSON', filter: null, includeFields: null })));
    expect(await registerShopifyWebhooks(BASE)).toEqual({ registered: 0, existing: 3, updated: 0 });
    expect(state.requests.filter((request) => request.query.includes('mutation'))).toHaveLength(3);
  });
  it('finds existing subscriptions on later pages', async () => {
    const state = fixture();
    state.subscriptions = [...Array.from({ length: 100 }, (_, index) => subscription('ORDERS_PAID', `/unrelated/${index}`, `other-${index}`)), ...wanted()];
    expect(await registerShopifyWebhooks(BASE)).toEqual({ registered: 0, existing: 3, updated: 0 });
    expect(state.requests.some((request) => request.query.includes('mutation'))).toBe(false);
    expect(state.requests.filter((request) => request.query.includes('PortalShopifyWebhooks'))).toHaveLength(2);
  });
  it('repairs filtered or partial-payload subscriptions without creating duplicates', async () => {
    const state = fixture();
    state.subscriptions = wanted();
    state.subscriptions[0].includeFields = ['id'];
    state.subscriptions[1].filter = 'vendor:Sobrew';
    expect(await registerShopifyWebhooks(BASE)).toEqual({ registered: 0, existing: 1, updated: 2 });
    expect(state.subscriptions).toHaveLength(3);
    expect(state.subscriptions.every((entry) => !entry.filter && !entry.includeFields.length)).toBe(true);
  });
  it.each(['http://portal.example.com', 'https://other.example.com', 'https://portal.example.com/other', 'https://portal.example.com?other=1', 'https://user:password@portal.example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://portal.local'])('rejects unsafe or unconfigured callback origins: %s', async (url) => {
    const state = fixture();
    if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('[::1]') || url.includes('.local')) vi.stubEnv('NEXT_PUBLIC_SITE_URL', url);
    await expect(registerShopifyWebhooks(url)).rejects.toThrow('public HTTPS portal URL');
    expect(state.requests).toHaveLength(0);
  });
  it('does not claim successful setup when Shopify rejects a subscription', async () => {
    const state = fixture();
    state.mutationError = 'Endpoint is unavailable';
    await expect(registerShopifyWebhooks(BASE)).rejects.toThrow('Endpoint is unavailable');
  });
});

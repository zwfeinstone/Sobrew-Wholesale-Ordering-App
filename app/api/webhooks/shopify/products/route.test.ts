import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verify: vi.fn(), receive: vi.fn(), identity: vi.fn(), parse: vi.fn() }));
vi.mock('@/lib/shopify', () => ({ getShopifyConfig: () => ({ shopDomain: 'a7mxi8-x1.myshopify.com', webhookSecret: 'secret' }), verifyShopifyWebhook: mocks.verify }));
vi.mock('@/lib/shopify-import', () => ({ parseShopifyWebhookPayload: mocks.parse }));
vi.mock('@/lib/shopify-product-webhooks', () => ({ receiveShopifyProduct: mocks.receive, shopifyProductIdentity: mocks.identity }));
import { POST } from './route';

const DELIVERY_ID = 'a75cd5ce-ca70-4a17-8c30-d1b80a63f504';
function request(body = '{"id":123}', headers: Record<string, string> = {}) {
  return new Request('https://portal.example.com/api/webhooks/shopify/products', { method: 'POST', body, headers: {
    'x-shopify-hmac-sha256': 'signature', 'x-shopify-shop-domain': 'a7mxi8-x1.myshopify.com',
    'x-shopify-topic': 'products/create', 'x-shopify-webhook-id': DELIVERY_ID, ...headers,
  } });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockReturnValue(true);
  mocks.parse.mockImplementation((body: string) => JSON.parse(body));
  mocks.receive.mockResolvedValue({ status: 'imported' });
  mocks.identity.mockReturnValue('gid://shopify/Product/123');
});

describe('Shopify product webhooks', () => {
  it('verifies the raw body before parsing or writing anything', async () => {
    mocks.verify.mockReturnValue(false);
    expect((await POST(request('not json'))).status).toBe(401);
    expect(mocks.verify).toHaveBeenCalledWith('not json', 'signature');
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it.each([
    [{ 'x-shopify-shop-domain': 'other.myshopify.com' }, 403],
    [{ 'x-shopify-topic': 'products/delete' }, 400],
    [{ 'x-shopify-webhook-id': '' }, 400],
    [{ 'x-shopify-webhook-id': 'invalid' }, 400],
  ])('rejects unexpected store, topic, or delivery ID', async (headers, status) => {
    expect((await POST(request(undefined, headers))).status).toBe(status);
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it.each(['products/create', 'products/update'])('processes authenticated %s events using the exact-ID parser', async (topic) => {
    const parsed = { id: '9007199254740993' };
    mocks.parse.mockReturnValue(parsed);
    const response = await POST(request('{"id":9007199254740993}', { 'x-shopify-topic': topic }));
    expect(response.status).toBe(200);
    expect(mocks.receive).toHaveBeenCalledWith(parsed, topic, DELIVERY_ID);
  });
  it('rejects malformed product data', async () => {
    expect((await POST(request('invalid json'))).status).toBe(400);
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it('requests Shopify retry for transient failures even when saved for operator review', async () => {
    mocks.receive.mockResolvedValue({ status: 'error', error: 'API unavailable' });
    expect((await POST(request())).status).toBe(500);
  });
  it('requests Shopify retry when durable persistence fails', async () => {
    mocks.receive.mockRejectedValue(new Error('Database unavailable'));
    expect((await POST(request())).status).toBe(500);
  });
});

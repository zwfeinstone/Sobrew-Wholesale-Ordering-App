import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), receive: vi.fn(), identity: vi.fn() }));
vi.mock('@/lib/shopify', () => ({ getShopifyConfig: () => ({ shopDomain: 'sobrew.myshopify.com', webhookSecret: 'secret' }), verifyShopifyWebhook: mocks.verify }));
vi.mock('@/lib/shopify-import', () => ({ receiveShopifyOrder: mocks.receive, shopifyOrderIdentity: mocks.identity, parseShopifyWebhookPayload: JSON.parse }));
import { POST } from './route';

function request(body = '{"id":123}', headers: Record<string, string> = {}) {
  return new Request('https://portal.example.com/api/webhooks/shopify/orders', { method: 'POST', body, headers: {
    'x-shopify-hmac-sha256': 'signature', 'x-shopify-shop-domain': 'sobrew.myshopify.com', 'x-shopify-topic': 'orders/paid', ...headers,
  } });
}
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockReturnValue(true); mocks.receive.mockResolvedValue({ status: 'imported' }); });
describe('Shopify order webhook authentication and persistence', () => {
  it('rejects a bad signature before parsing or touching the database', async () => {
    mocks.verify.mockReturnValue(false);
    expect((await POST(request('not json'))).status).toBe(401);
    expect(mocks.identity).not.toHaveBeenCalled(); expect(mocks.receive).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledWith('not json', 'signature');
  });
  it.each([
    [{ 'x-shopify-shop-domain': 'other.myshopify.com' }, 403], [{ 'x-shopify-topic': 'orders/create' }, 400],
  ])('rejects unrelated store or topic', async (headers, status) => {
    expect((await POST(request(undefined, headers))).status).toBe(status);
    expect(mocks.receive).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON after authentication', async () => {
    expect((await POST(request('not json'))).status).toBe(400); expect(mocks.receive).not.toHaveBeenCalled();
  });
  it('acknowledges durably saved currency/manual-review errors', async () => {
    mocks.receive.mockResolvedValue({ status: 'error', error: 'Only USD orders are supported.', retryable: false });
    const result = await POST(request());
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ received: true, status: 'error' });
  });
  it('requests Shopify redelivery for a saved transient catalog/API failure', async () => {
    mocks.receive.mockResolvedValue({ status: 'error', error: 'Shopify temporarily unavailable', retryable: true });
    const result = await POST(request());
    expect(result.status).toBe(500); expect(await result.json()).toEqual({ received: true, status: 'error' });
  });
  it.each(['imported', 'ignored'])('acknowledges %s deliveries', async status => {
    mocks.receive.mockResolvedValue({ status });
    expect((await POST(request())).status).toBe(200);
  });
  it('requests Shopify delivery retry if persistence failed', async () => {
    mocks.receive.mockRejectedValue(new Error('database unavailable'));
    expect((await POST(request())).status).toBe(500);
  });
});

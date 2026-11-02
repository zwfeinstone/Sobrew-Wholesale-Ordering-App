import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/shopify', () => ({ getShopifyConfig: () => ({ shopDomain: 'sobrew.myshopify.com' }) }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock('@/lib/shopify-catalog', () => ({ ensureShopifyOrderProducts: vi.fn() }));
import { parseShopifyWebhookPayload, prepareShopifyOrder, receiveShopifyOrder, retryShopifyImport, shopifyOrderIdentity } from './shopify-import';
import { getSupabaseAdmin } from './supabase/admin';
import { ensureShopifyOrderProducts } from './shopify-catalog';

const products = [{ id: '11111111-1111-4111-8111-111111111111', sku: 'PORTAL-COFFEE', name: 'Coffee', active: true,
  shopify_shop_domain: 'sobrew.myshopify.com', shopify_product_id: 'gid://shopify/Product/123', shopify_variant_id: 'gid://shopify/ProductVariant/90071992547409932' }];
const order = {
  id: 123, admin_graphql_api_id: 'gid://shopify/Order/90071992547409930', name: '#1001',
  financial_status: 'paid', fulfillment_status: null, currency: 'USD', test: false, cancelled_at: null,
  created_at: '2026-10-09T10:00:00Z', email: 'buyer@example.com', current_subtotal_price: '28.99',
  shipping_address: { name: 'Buyer', company: 'Coffee shop', address1: '1 Main', city: 'Chicago', province_code: 'IL', zip: '60601', country_code: 'US' },
  line_items: [{ id: 456, admin_graphql_api_id: 'gid://shopify/LineItem/90071992547409931', sku: 'COFFEE-1', variant_id: '90071992547409932', product_id: '123', name: 'Shopify Coffee',
    quantity: 3, current_quantity: 3, fulfillable_quantity: 3, requires_shipping: true, price: '10.00', total_discount: '0.00',
    discount_allocations: [{ amount: '1.01' }], fulfillment_status: null }],
};

describe('Shopify paid order normalization', () => {
  it('preserves exact large IDs, discounted cents, buyer snapshots and product mappings', () => {
    const result = prepareShopifyOrder(order, 'sobrew.myshopify.com', products);
    expect(result.order).toMatchObject({ shopify_order_id: order.admin_graphql_api_id, subtotal_cents: 2899,
      shopify_email: order.email, shipping_company: 'Coffee shop', shipping_country: 'US' });
    expect(result.order.shopify_line_items).toEqual([{ line_item_id: order.line_items[0].admin_graphql_api_id, quantity: 3, product_id: products[0].id }]);
    expect(result.items[0]).toMatchObject({ qty: 3, unit_price_cents: 966, line_total_cents: 2899, product_name_snapshot: 'Shopify Coffee' });
    expect(result.order).not.toHaveProperty('user_id');
    expect(result.order).not.toHaveProperty('shipping_cost_cents');
  });
  it('supports a completely discounted item without inventing a charge', () => {
    const result = prepareShopifyOrder({ ...order, current_subtotal_price: '0.00', line_items: [{ ...order.line_items[0], discount_allocations: [{ amount: '30.00' }] }] }, 'sobrew.myshopify.com', products);
    expect(result.items[0]).toMatchObject({ line_total_cents: 0, unit_price_cents: 0 });
  });
  it.each([
    [{ financial_status: 'pending' }, /fully paid/], [{ currency: 'CAD' }, /Only USD/],
    [{ cancelled_at: '2026-10-09' }, /Cancelled/], [{ test: true }, /Test orders/],
    [{ fulfillment_status: 'partial' }, /partially or fully/],
    [{ shipping_address: {} }, /shipping address/], [{ current_subtotal_price: '30.00' }, /do not match/],
  ])('holds unsupported order state %j', (overrides, error) => {
    expect(() => prepareShopifyOrder({ ...order, ...overrides }, 'sobrew.myshopify.com', products)).toThrow(error);
  });
  it.each([
    [{ variant_id: '' }, /variant ID/], [{ variant_id: null }, /variant ID/], [{ fulfillable_quantity: 2 }, /partially fulfilled/],
    [{ current_quantity: 2 }, /Edited/], [{ quantity: 1.5 }, /Edited/], [{ price: '-1.00' }, /valid USD/],
    [{ discount_allocations: [{ amount: '30.01' }] }, /invalid discounted/], [{ requires_shipping: false }, /no shippable/],
  ])('rejects invalid lines %j', (overrides, error) => {
    expect(() => prepareShopifyOrder({ ...order, line_items: [{ ...order.line_items[0], ...overrides }] }, 'sobrew.myshopify.com', products)).toThrow(error);
  });
  it('requires exactly one active Shopify variant match and never guesses from the SKU', () => {
    expect(() => prepareShopifyOrder(order, 'sobrew.myshopify.com', [{ ...products[0], active: false }])).toThrow(/active portal/);
    expect(() => prepareShopifyOrder(order, 'sobrew.myshopify.com', [...products, ...products])).toThrow(/active portal/);
    expect(() => prepareShopifyOrder(order, 'other.myshopify.com', products)).toThrow(/active portal/);
    expect(prepareShopifyOrder({ ...order, line_items: [{ ...order.line_items[0], sku: '' }] }, 'sobrew.myshopify.com', products).items[0].product_id).toBe(products[0].id);
  });
  it('parses large order/product/variant IDs exactly before normalizing the payload', () => {
    expect(parseShopifyWebhookPayload('{"id":90071992547409932,"variant_id":90071992547409933,"product_id":90071992547409934,"quantity":2}'))
      .toEqual({ id: '90071992547409932', variant_id: '90071992547409933', product_id: '90071992547409934', quantity: 2 });
  });
  it('rejects ambiguous numeric identities without an exact GID', () => {
    expect(() => shopifyOrderIdentity({ id: 90071992547409930 })).toThrow(/exact ID/);
    expect(shopifyOrderIdentity({ id: '90071992547409930' }).orderId).toBe(order.admin_graphql_api_id);
  });
});

describe('durable Shopify import retry', () => {
  function adminStub({ productRows = products, status = 'error', updateError = null as null | { message: string }, payload = order as unknown } = {}) {
    const update = vi.fn();
    const condition = vi.fn().mockResolvedValue({ error: updateError });
    const row = { id: 'receipt', shop_domain: 'sobrew.myshopify.com', payload, status, order_id: status === 'imported' ? 'saved-order' : null };
    const from = vi.fn((table: string) => table === 'shopify_order_imports' ? {
      select: () => ({ eq: () => ({ single: async () => ({ data: row, error: null }) }) }),
      update: (values: unknown) => { update(values); return { eq: () => ({ neq: condition }) }; },
    } : { select: () => ({ in: async () => ({ data: productRows, error: null }) }) });
    const rpc = vi.fn(async (name: string) => ({ data: name === 'save_shopify_order_import' ? 'receipt' : 'saved-order', error: null }));
    vi.mocked(getSupabaseAdmin).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof getSupabaseAdmin>);
    vi.mocked(ensureShopifyOrderProducts).mockReset().mockResolvedValue(productRows);
    return { from, rpc, update, condition };
  }
  it('retains mapping failures in a durable retryable receipt', async () => {
    const db = adminStub({ productRows: [] });
    expect(await receiveShopifyOrder(order, 'sobrew.myshopify.com', 'orders/paid')).toMatchObject({ status: 'error', error: expect.stringContaining('variant'), retryable: false });
    expect(db.rpc).toHaveBeenCalledOnce();
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: expect.stringContaining('ProductVariant/90071992547409932') }));
    expect(db.condition).toHaveBeenCalledWith('status', 'imported');
  });
  it('retries with current products and commits header/items together through the RPC', async () => {
    const db = adminStub();
    expect(await retryShopifyImport('receipt')).toEqual({ status: 'imported', orderId: 'saved-order' });
    expect(db.rpc).toHaveBeenCalledWith('import_shopify_order', expect.objectContaining({
      p_order: expect.objectContaining({ import_id: 'receipt', subtotal_cents: 2899 }), p_items: expect.arrayContaining([expect.objectContaining({ product_id: products[0].id })]),
    }));
    expect(db.update).not.toHaveBeenCalled();
  });
  it('does not recreate an already imported receipt', async () => {
    const db = adminStub({ status: 'imported' });
    expect(await retryShopifyImport('receipt')).toEqual({ status: 'imported', orderId: 'saved-order' });
    expect(db.rpc).not.toHaveBeenCalled(); expect(db.from).toHaveBeenCalledTimes(1);
  });
  it('does not acknowledge a failure unless its details were durably saved', async () => {
    adminStub({ productRows: [], updateError: { message: 'database unavailable' } });
    await expect(retryShopifyImport('receipt')).rejects.toThrow(/could not be saved/);
  });
  it('marks catalog API failures for automatic redelivery after saving the error', async () => {
    const db = adminStub();
    vi.mocked(ensureShopifyOrderProducts).mockRejectedValue(new Error('Shopify temporarily unavailable'));
    expect(await retryShopifyImport('receipt')).toEqual({ status: 'error', error: 'Shopify temporarily unavailable', retryable: true });
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: 'Shopify temporarily unavailable' }));
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('marks an atomic database import failure for automatic redelivery', async () => {
    const db = adminStub();
    db.rpc.mockRejectedValue(new Error('Temporary database failure'));
    expect(await retryShopifyImport('receipt')).toEqual({ status: 'error', error: 'Temporary database failure', retryable: true });
  });
  it.each([
    { ...order, currency: 'CAD' },
    { ...order, line_items: [{ ...order.line_items[0], variant_id: null }] },
    { ...order, line_items: [{ ...order.line_items[0], product_id: 'invalid' }] },
  ])('holds permanent identity/currency errors without attempting catalog imports', async payload => {
    const db = adminStub({ payload });
    expect(await retryShopifyImport('receipt')).toMatchObject({ status: 'error', retryable: false });
    expect(ensureShopifyOrderProducts).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('holds permanent totals errors after catalog resolution without automatic redelivery', async () => {
    const db = adminStub({ payload: { ...order, current_subtotal_price: '100.00' } });
    expect(await retryShopifyImport('receipt')).toMatchObject({ status: 'error', retryable: false, error: expect.stringContaining('totals') });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

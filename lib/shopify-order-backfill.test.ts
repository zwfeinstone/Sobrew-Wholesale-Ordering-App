import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/shopify', () => ({ getShopifyConfig: vi.fn(), shopifyGraphQL: vi.fn() }));
vi.mock('@/lib/shopify-import', async importOriginal => ({
  ...await importOriginal<typeof import('./shopify-import')>(), receiveShopifyOrder: vi.fn(),
}));

import { getShopifyConfig, shopifyGraphQL } from './shopify';
import { prepareShopifyOrder, receiveShopifyOrder } from './shopify-import';
import { importShopifyOrdersByNames } from './shopify-order-backfill';

const SHOP = 'a7mxi8-x1.myshopify.com';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = 'gid://shopify/ProductVariant/90071992547409932';
const products = [{ id: PRODUCT_ID, name: 'FD Coffee', sku: 'PORTAL-FD', active: true, shopify_shop_domain: SHOP, shopify_variant_id: VARIANT_ID }];
const money = (amount: string, currencyCode = 'USD') => ({ shopMoney: { amount, currencyCode } });
function order(name = '#1160') {
  return {
    id: 'gid://shopify/Order/90071992547409930', name,
    createdAt: '2026-10-09T10:00:00Z', email: 'buyer@example.com', note: 'Leave at front desk',
    test: false, cancelledAt: null as string | null, currencyCode: 'USD',
    displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED',
    currentSubtotalPriceSet: money('28.99'),
    shippingAddress: { name: 'A Buyer', firstName: 'A', lastName: 'Buyer', company: 'Coffee shop', address1: '1 Main St', address2: 'Unit 2', city: 'Chicago', province: 'Illinois', provinceCode: 'IL', zip: '60601', countryCodeV2: 'US' },
    lineItems: {
      pageInfo: { hasNextPage: false },
      nodes: [{ id: 'gid://shopify/LineItem/90071992547409931', name: 'FD Coffee — Ground', title: 'FD Coffee', sku: null,
        quantity: 3, currentQuantity: 3, unfulfilledQuantity: 3, requiresShipping: true,
        variant: { id: VARIANT_ID }, product: { id: 'gid://shopify/Product/90071992547409933' },
        originalUnitPriceSet: money('10.00'), discountAllocations: [{ allocatedAmountSet: money('1.01') }],
      }],
    },
  };
}
const response = (...nodes: ReturnType<typeof order>[]) => ({ orders: { nodes, pageInfo: { hasNextPage: false } } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getShopifyConfig).mockReturnValue({ shopDomain: SHOP } as ReturnType<typeof getShopifyConfig>);
  vi.mocked(shopifyGraphQL).mockResolvedValue(response(order()));
  vi.mocked(receiveShopifyOrder).mockImplementation(async (payload, shop) => {
    try {
      prepareShopifyOrder(payload, shop, products);
      return { status: 'imported', orderId: 'saved-order' };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : 'Validation failed' };
    }
  });
});

describe('explicit Shopify order backfill', () => {
  it('preserves exact IDs, all discounts, quantities, buyer address, and subtotal through the normal importer', async () => {
    expect(await importShopifyOrdersByNames('#1160')).toEqual([{ name: '#1160', status: 'imported', orderId: 'saved-order', error: undefined }]);
    expect(shopifyGraphQL).toHaveBeenCalledWith(expect.stringMatching(/^query PortalNamedOrderImport/), { query: 'name:"#1160"' });
    expect(receiveShopifyOrder).toHaveBeenCalledWith(expect.objectContaining({
      admin_graphql_api_id: 'gid://shopify/Order/90071992547409930', current_subtotal_price: '28.99',
      email: 'buyer@example.com', note: 'Leave at front desk', financial_status: 'paid', fulfillment_status: null,
      shipping_address: expect.objectContaining({ name: 'A Buyer', address2: 'Unit 2', province_code: 'IL', country_code: 'US' }),
      line_items: [expect.objectContaining({ admin_graphql_api_id: 'gid://shopify/LineItem/90071992547409931',
        variant_id: VARIANT_ID, product_id: 'gid://shopify/Product/90071992547409933',
        quantity: 3, current_quantity: 3, fulfillable_quantity: 3, price: '10.00', discount_allocations: [{ amount: '1.01' }],
      })],
    }), SHOP, 'orders/paid');
    const prepared = prepareShopifyOrder(vi.mocked(receiveShopifyOrder).mock.calls[0][0], SHOP, products);
    expect(prepared.items[0]).toMatchObject({ product_id: PRODUCT_ID, qty: 3, line_total_cents: 2899 });
    expect(prepared.order).not.toHaveProperty('shipping_cost_cents');
    expect(prepared.order).not.toHaveProperty('user_id');
  });

  it('imports only requested exact names and deduplicates comma/newline/space-separated input', async () => {
    vi.mocked(shopifyGraphQL).mockImplementation(async (_query, variables) => response(order(String(variables?.query).slice(6, -1))));
    const results = await importShopifyOrdersByNames(' #1160, #1161\n#1160\t#1162 ');
    expect(results.map(result => result.name)).toEqual(['#1160', '#1161', '#1162']);
    expect(results.every(result => result.status === 'imported')).toBe(true);
    expect(shopifyGraphQL).toHaveBeenCalledTimes(3);
    expect(vi.mocked(shopifyGraphQL).mock.calls.map(call => call[1])).toEqual([{ query: 'name:"#1160"' }, { query: 'name:"#1161"' }, { query: 'name:"#1162"' }]);
  });

  it.each(['', ', \n', '1160', '#1160 #1161abc', '#1160-#1165', '#1160 OR status:open', '#1160;#1161', '#1160/1161', '#'.repeat(2001), Array.from({ length: 11 }, (_, i) => `#${1160 + i}`).join(',')])('rejects the whole invalid request before any calls: %s', async input => {
    await expect(importShopifyOrdersByNames(input)).rejects.toThrow();
    expect(shopifyGraphQL).not.toHaveBeenCalled();
    expect(receiveShopifyOrder).not.toHaveBeenCalled();
  });

  it('requires a configured store before calls', async () => {
    vi.mocked(getShopifyConfig).mockReturnValue({ shopDomain: '' } as ReturnType<typeof getShopifyConfig>);
    await expect(importShopifyOrdersByNames('#1160')).rejects.toThrow(/not configured/);
    expect(shopifyGraphQL).not.toHaveBeenCalled();
  });

  it.each([
    response(), response(order('#11600')), response(order(), order()),
    { orders: { nodes: [order()], pageInfo: { hasNextPage: true } } },
  ])('refuses missing, ambiguous, partial, or nonexact search results', async data => {
    vi.mocked(shopifyGraphQL).mockResolvedValue(data);
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ name: '#1160', status: 'error' }]);
    expect(receiveShopifyOrder).not.toHaveBeenCalled();
  });

  it('ignores a nonexact neighboring result without importing it', async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValue(response(order('#11600'), order()));
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'imported' }]);
    expect(receiveShopifyOrder).toHaveBeenCalledOnce();
    expect(vi.mocked(receiveShopifyOrder).mock.calls[0][0]).toMatchObject({ name: '#1160' });
  });

  it.each(['PARTIALLY_FULFILLED', 'FULFILLED', 'ON_HOLD', 'SCHEDULED', ''])('refuses fulfillment state %s without creating a receipt', async displayFulfillmentStatus => {
    vi.mocked(shopifyGraphQL).mockResolvedValue(response({ ...order(), displayFulfillmentStatus }));
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'error', error: expect.stringContaining('wholly unfulfilled') }]);
    expect(receiveShopifyOrder).not.toHaveBeenCalled();
  });

  it.each(['order', 'subtotal', 'price', 'discount'])('refuses non-USD %s currency without a receipt', async field => {
    const data = order();
    if (field === 'order') data.currencyCode = 'CAD';
    if (field === 'subtotal') data.currentSubtotalPriceSet = money('28.99', 'CAD');
    if (field === 'price') data.lineItems.nodes[0].originalUnitPriceSet = money('10.00', 'CAD');
    if (field === 'discount') data.lineItems.nodes[0].discountAllocations[0].allocatedAmountSet = money('1.01', 'CAD');
    vi.mocked(shopifyGraphQL).mockResolvedValue(response(data));
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'error', error: expect.stringContaining('USD') }]);
    expect(receiveShopifyOrder).not.toHaveBeenCalled();
  });

  it.each(['hasNextPage', 'tooManyNodes'])('refuses truncated/oversize line item connections: %s', async mode => {
    const data = order();
    if (mode === 'hasNextPage') data.lineItems.pageInfo.hasNextPage = true;
    else data.lineItems.nodes = Array.from({ length: 101 }, () => data.lineItems.nodes[0]);
    vi.mocked(shopifyGraphQL).mockResolvedValue(response(data));
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'error', error: expect.stringContaining('100 line items') }]);
    expect(receiveShopifyOrder).not.toHaveBeenCalled();
  });

  it('continues the requested list after independent API and import failures', async () => {
    vi.mocked(shopifyGraphQL).mockRejectedValueOnce(new Error('Temporary Shopify error'))
      .mockResolvedValueOnce(response(order('#1161'))).mockResolvedValueOnce(response(order('#1162')));
    vi.mocked(receiveShopifyOrder).mockResolvedValueOnce({ status: 'error', error: 'Needs review' });
    expect(await importShopifyOrdersByNames('#1160,#1161,#1162')).toMatchObject([
      { name: '#1160', status: 'error', error: 'Temporary Shopify error' },
      { name: '#1161', status: 'error', error: 'Needs review' },
      { name: '#1162', status: 'imported', orderId: 'saved-order' },
    ]);
  });

  it('retains the existing importer outcome and duplicate order ID', async () => {
    vi.mocked(receiveShopifyOrder).mockResolvedValue({ status: 'imported', orderId: 'existing-order' });
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'imported', orderId: 'existing-order' }]);
    vi.mocked(receiveShopifyOrder).mockResolvedValue({ status: 'ignored', error: 'Test orders are not imported.' });
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'ignored', error: 'Test orders are not imported.' }]);
  });

  it.each(['currentQuantity', 'unfulfilledQuantity'])('preserves %s so edited/partially fulfilled lines fail the existing validation', async field => {
    const data = order();
    data.lineItems.nodes[0][field as 'currentQuantity' | 'unfulfilledQuantity'] = 2;
    vi.mocked(shopifyGraphQL).mockResolvedValue(response(data));
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'error', error: expect.stringContaining('Edited') }]);
  });

  it('preserves null shipping address and subtotal discrepancies for existing validation', async () => {
    vi.mocked(shopifyGraphQL).mockResolvedValue({ orders: { nodes: [{ ...order(), shippingAddress: null }], pageInfo: { hasNextPage: false } } });
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'error', error: expect.stringContaining('shipping address') }]);
    vi.mocked(shopifyGraphQL).mockResolvedValue(response({ ...order(), currentSubtotalPriceSet: money('30.00') }));
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'error', error: expect.stringContaining('totals') }]);
  });

  it.each([
    { displayFinancialStatus: 'PENDING' }, { displayFinancialStatus: 'PARTIALLY_PAID' },
    { displayFinancialStatus: 'REFUNDED' }, { displayFinancialStatus: null },
    { test: true }, { test: undefined }, { cancelledAt: '2026-10-09T11:00:00Z' },
  ])('rejects ineligible status before it could occupy the immutable paid receipt: %j', async overrides => {
    vi.mocked(shopifyGraphQL).mockResolvedValue(response({ ...order(), ...overrides } as ReturnType<typeof order>));
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'error' }]);
    expect(receiveShopifyOrder).not.toHaveBeenCalled();
  });

  it('preserves physical shipping flags for existing validation', async () => {
    const data = order();
    data.lineItems.nodes[0].requiresShipping = false;
    vi.mocked(shopifyGraphQL).mockResolvedValue(response(data));
    expect(await importShopifyOrdersByNames('#1160')).toMatchObject([{ status: 'error', error: expect.stringContaining('shippable') }]);
    expect(vi.mocked(receiveShopifyOrder).mock.calls[0][0]).toMatchObject({ line_items: [expect.objectContaining({ requires_shipping: false })] });
  });
});

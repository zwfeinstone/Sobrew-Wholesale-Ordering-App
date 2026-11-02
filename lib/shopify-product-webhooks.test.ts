import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  receipts: [] as Array<Record<string, any>>,
  sync: vi.fn(), failInsert: false, failCompletion: false, failFailure: false,
}));
vi.mock('@/lib/shopify', () => ({ getShopifyConfig: () => ({ shopDomain: 'a7mxi8-x1.myshopify.com' }) }));
vi.mock('@/lib/shopify-catalog', () => ({ syncShopifyProduct: state.sync }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  from(table: string) {
    if (table !== 'shopify_product_imports') throw new Error(`Unexpected table ${table}`);
    let insert: Record<string, unknown> | null = null;
    let update: Record<string, unknown> | null = null;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const result = () => {
      if (insert) {
        if (state.failInsert) return { data: null, error: { message: 'Database unavailable' } };
        const inserted = insert;
        const existing = state.receipts.find((row) => row.shop_domain === inserted.shop_domain && row.webhook_id === inserted.webhook_id);
        if (!existing) state.receipts.push({ ...structuredClone(insert), id: `receipt-${state.receipts.length + 1}` });
        return { data: null, error: null };
      }
      if ((state.failCompletion && update?.status === 'imported') || (state.failFailure && update?.status === 'error')) return { data: null, error: { message: 'Write unavailable' } };
      const row = state.receipts.find((row) => filters.every((filter) => filter(row)));
      if (row && update) Object.assign(row, update);
      return { data: row ? structuredClone(row) : null, error: null };
    };
    return {
      select() { return this; },
      upsert(values: Record<string, unknown>, options: Record<string, unknown>) {
        expect(options).toEqual({ onConflict: 'shop_domain,webhook_id', ignoreDuplicates: true });
        insert = values; return this;
      },
      update(values: Record<string, unknown>) { update = values; return this; },
      eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return this; },
      neq(key: string, value: unknown) { filters.push((row) => row[key] !== value); return this; },
      single: async () => result(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
  },
}) }));

import { receiveShopifyProduct, retryShopifyProductImport, shopifyProductIdentity } from './shopify-product-webhooks';

const DELIVERY_ID = 'a75cd5ce-ca70-4a17-8c30-d1b80a63f504';
const PAYLOAD = { id: '9007199254740993', variants: [{ id: '111' }] };
beforeEach(() => {
  state.receipts = [];
  state.failInsert = false; state.failCompletion = false; state.failFailure = false;
  state.sync.mockReset().mockResolvedValue({ importedCount: 1, updatedCount: 0, productIds: ['portal-product-1'] });
});

describe('Shopify product delivery identity', () => {
  it('preserves exact large IDs and prefers a valid Shopify GID', () => {
    expect(shopifyProductIdentity(PAYLOAD)).toBe('gid://shopify/Product/9007199254740993');
    expect(shopifyProductIdentity({ id: 42, admin_graphql_api_id: 'gid://shopify/Product/9007199254740993' })).toBe('gid://shopify/Product/9007199254740993');
  });
  it.each([null, [], {}, { id: 9007199254740992 }, { id: -1 }, { id: 'not-an-id' }])('rejects invalid or imprecise identifiers', (payload) => {
    expect(() => shopifyProductIdentity(payload)).toThrow();
  });
});

describe('durable Shopify product processing', () => {
  it('stores delivery before syncing and treats successful replays as already processed', async () => {
    state.sync.mockImplementation(async (id: string) => {
      expect(state.receipts[0].status).toBe('pending');
      expect(id).toBe('gid://shopify/Product/9007199254740993');
      return { importedCount: 1, updatedCount: 0, productIds: ['portal-product-1'] };
    });
    expect(await receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID)).toEqual({ status: 'imported' });
    expect(state.receipts[0].status).toBe('imported');
    expect(await receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID)).toEqual({ status: 'imported' });
    expect(state.sync).toHaveBeenCalledTimes(1);
    expect(state.receipts).toHaveLength(1);
  });

  it('processes a new update event for a previously imported product', async () => {
    await receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID);
    const nextDelivery = '12557e5b-34ae-4ac3-b677-ddc13c764492';
    expect(await receiveShopifyProduct(PAYLOAD, 'products/update', nextDelivery)).toEqual({ status: 'imported' });
    expect(state.sync).toHaveBeenCalledTimes(2);
    expect(state.receipts).toHaveLength(2);
  });

  it('saves a readable error and retries the saved product without relying on stale payload variants', async () => {
    state.sync.mockRejectedValueOnce(new Error('Shopify temporarily unavailable'));
    expect(await receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID)).toEqual({ status: 'error', error: 'Shopify temporarily unavailable' });
    expect(state.receipts[0]).toMatchObject({ status: 'error', error: 'Shopify temporarily unavailable' });
    expect(await retryShopifyProductImport('receipt-1')).toEqual({ status: 'imported' });
    expect(state.receipts[0]).toMatchObject({ status: 'imported', error: null });
    expect(state.sync).toHaveBeenLastCalledWith('gid://shopify/Product/9007199254740993');
  });

  it('does not sync before a durable insert succeeds', async () => {
    state.failInsert = true;
    await expect(receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID)).rejects.toThrow('durably save');
    expect(state.sync).not.toHaveBeenCalled();
  });

  it('keeps an uncertain completion retryable after products have been imported', async () => {
    state.failCompletion = true;
    expect(await receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID)).toMatchObject({ status: 'error', error: expect.stringContaining('confirmation could not be saved') });
    state.failCompletion = false;
    expect(await retryShopifyProductImport('receipt-1')).toEqual({ status: 'imported' });
  });

  it('throws if even the error cannot be persisted', async () => {
    state.sync.mockRejectedValueOnce(new Error('Sync failed'));
    state.failFailure = true;
    await expect(receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID)).rejects.toThrow('Could not save the Shopify product import failure');
  });

  it('does not overwrite a successful concurrent delivery with an error', async () => {
    state.sync.mockImplementationOnce(async () => {
      state.receipts[0].status = 'imported';
      throw new Error('Older worker failed');
    });
    await receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID);
    expect(state.receipts[0].status).toBe('imported');
  });

  it('rejects a receipt from a different store before syncing', async () => {
    state.receipts = [{ id: 'receipt-1', shop_domain: 'other.myshopify.com', status: 'error' }];
    await expect(retryShopifyProductImport('receipt-1')).rejects.toThrow('different Shopify store');
    expect(state.sync).not.toHaveBeenCalled();
  });

  it('rejects delivery ID reuse for a different product', async () => {
    await receiveShopifyProduct(PAYLOAD, 'products/create', DELIVERY_ID);
    await expect(receiveShopifyProduct({ id: '222' }, 'products/create', DELIVERY_ID)).rejects.toThrow('reused for a different product event');
    expect(state.sync).toHaveBeenCalledTimes(1);
  });
});

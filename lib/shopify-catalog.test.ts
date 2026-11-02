import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  graphql: vi.fn(),
  rpc: vi.fn(),
  products: [] as Array<Record<string, unknown>>,
  shop: 'a7mxi8-x1.myshopify.com',
}));

vi.mock('@/lib/shopify', () => ({
  getShopifyConfig: () => ({ shopDomain: state.shop }),
  shopifyGraphQL: state.graphql,
}));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  rpc: state.rpc,
  from(table: string) {
    if (table !== 'products') throw new Error(`Catalog sync must not write ${table}.`);
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    return {
      select() { return this; },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return this; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return this; },
      then(resolve: (result: unknown) => unknown) {
        return Promise.resolve({ data: state.products.filter(row => filters.every(filter => filter(row))), error: null }).then(resolve);
      },
    };
  },
}) }));

import { ensureShopifyOrderProducts, syncShopifyCatalog, syncShopifyProduct } from './shopify-catalog';

const productId = 'gid://shopify/Product/1001';
const variantId = 'gid://shopify/ProductVariant/2001';
const connection = <T>(nodes: T[], endCursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: Boolean(endCursor), endCursor } });
function remoteProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: productId, title: 'Coffee', description: 'Fresh coffee', status: 'ACTIVE', updatedAt: '2026-10-09T14:00:00Z',
    variants: connection([{ id: variantId, title: 'Default Title', sku: 'WEB-COFFEE' }]), ...overrides,
  };
}
function mappedProduct(overrides: Record<string, unknown> = {}) {
  return { id: 'portal-1', name: 'Portal coffee', sku: 'OTHER-PORTAL-SKU', active: true,
    shopify_shop_domain: state.shop, shopify_product_id: productId, shopify_variant_id: variantId, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.shop = 'a7mxi8-x1.myshopify.com';
  state.products = [];
  state.graphql.mockResolvedValue({ product: remoteProduct() });
  state.rpc.mockImplementation(async (name: string, { p_variant: variant }: { p_variant: Record<string, unknown> }) => {
    if (name !== 'sync_shopify_product_variant') throw new Error(`Unexpected RPC ${name}`);
    const existing = state.products.find(row => row.shopify_shop_domain === variant.shop_domain && row.shopify_variant_id === variant.variant_id);
    if (existing) return { data: { id: existing.id, created: false }, error: null };
    const row = mappedProduct({ id: `portal-${state.products.length + 1}`, name: variant.name, active: variant.active,
      shopify_product_id: variant.product_id, shopify_variant_id: variant.variant_id });
    state.products.push(row);
    return { data: { id: row.id, created: true }, error: null };
  });
});

describe('Shopify catalog import', () => {
  it('imports stable variant identities without passing any recipe, category, inventory, or cost values', async () => {
    expect(await syncShopifyProduct(productId)).toEqual({ importedCount: 1, updatedCount: 0, productIds: ['portal-1'] });
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith('sync_shopify_product_variant', { p_variant: {
      shop_domain: state.shop, product_id: productId, variant_id: variantId, sku: 'WEB-COFFEE',
      name: 'Coffee', description: 'Fresh coffee', active: true, updated_at: '2026-10-09T14:00:00Z',
    } });
    expect(await syncShopifyProduct(productId)).toEqual({ importedCount: 0, updatedCount: 1, productIds: ['portal-1'] });
  });

  it('loads every variant page before saving, including variants after the webhook truncation limit', async () => {
    state.graphql.mockImplementation(async (_query: string, variables: { after?: string | null }) => ({ product: remoteProduct({
      variants: variables.after
        ? connection([{ id: 'gid://shopify/ProductVariant/3000', title: 'Large / Decaf', sku: null }])
        : connection(Array.from({ length: 100 }, (_, index) => ({ id: `gid://shopify/ProductVariant/${2000 + index}`, title: `Size ${index}`, sku: null })), 'variants-2'),
    }) }));
    const result = await syncShopifyProduct(productId);
    expect(result.importedCount).toBe(101);
    expect(state.graphql).toHaveBeenNthCalledWith(2, expect.stringContaining('variants(first: 100, after: $after)'), { id: productId, after: 'variants-2' });
    expect(state.rpc).toHaveBeenLastCalledWith('sync_shopify_product_variant', { p_variant: expect.objectContaining({
      name: 'Coffee — Large / Decaf', sku: null, variant_id: 'gid://shopify/ProductVariant/3000',
    }) });
    expect(state.graphql.mock.invocationCallOrder[1]).toBeLessThan(state.rpc.mock.invocationCallOrder[0]);
  });

  it.each(['page failure', 'changed product', 'repeated cursor'])('does not save an incomplete or inconsistent product: %s', async (failure) => {
    state.graphql.mockResolvedValueOnce({ product: remoteProduct({ variants: connection([{ id: variantId, title: 'First', sku: null }], 'next') }) });
    if (failure === 'page failure') state.graphql.mockRejectedValueOnce(new Error('Shopify unavailable'));
    else state.graphql.mockResolvedValueOnce({ product: remoteProduct({
      updatedAt: failure === 'changed product' ? '2026-10-09T14:01:00Z' : '2026-10-09T14:00:00Z',
      variants: connection([{ id: 'gid://shopify/ProductVariant/2002', title: 'Second', sku: null }], failure === 'repeated cursor' ? 'next' : null),
    }) });
    await expect(syncShopifyProduct(productId)).rejects.toThrow();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each([['ACTIVE', true], ['UNLISTED', true], ['DRAFT', false], ['ARCHIVED', false]])('sets availability from Shopify %s status', async (status, active) => {
    state.graphql.mockResolvedValue({ product: remoteProduct({ status }) });
    await syncShopifyProduct(productId);
    expect(state.rpc).toHaveBeenCalledWith('sync_shopify_product_variant', { p_variant: expect.objectContaining({ active }) });
  });

  it('reports a failed save so a webhook or administrator can retry it', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: 'Database unavailable' } });
    await expect(syncShopifyProduct(productId)).rejects.toThrow('Database unavailable');
  });

  it('paginates the whole catalog and returns product failures alongside successful counts', async () => {
    state.graphql.mockImplementation(async (query: string, variables: { id?: string; after?: string | null }) => {
      if (query.includes('PortalShopifyCatalog')) return { products: variables.after
        ? connection([{ id: 'gid://shopify/Product/1003', title: 'Third product' }])
        : connection([{ id: productId, title: 'Coffee' }, { id: 'gid://shopify/Product/1002', title: 'Failed product' }], 'catalog-2') };
      if (variables.id === 'gid://shopify/Product/1002') throw new Error('Shopify unavailable');
      return { product: remoteProduct({ id: variables.id, variants: connection([{ id: `gid://shopify/ProductVariant/${variables.id?.endsWith('1003') ? '2003' : '2001'}`, title: 'Default Title', sku: null }]) }) };
    });
    expect(await syncShopifyCatalog()).toEqual({ importedCount: 2, updatedCount: 0, productIds: ['portal-1', 'portal-2'],
      errorCount: 1, errors: ['Failed product: Shopify unavailable'] });
    expect(state.graphql.mock.calls.some(([query, variables]) => query.includes('PortalShopifyCatalog') && variables.after === 'catalog-2')).toBe(true);
  });

  it('rejects invalid product IDs before contacting Shopify or the database', async () => {
    await expect(syncShopifyProduct('wrong-store/product/1001')).rejects.toThrow('exact ID');
    expect(state.graphql).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('order variant resolution', () => {
  it('uses imported variant identity when the portal SKU differs and does not require another API read', async () => {
    state.products = [mappedProduct()];
    const result = await ensureShopifyOrderProducts({ line_items: [{ variant_id: '2001', product_id: '1001', sku: 'WEB-COFFEE' }] });
    expect(result).toEqual(state.products);
    expect(state.graphql).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('imports missing variants once per source product before resolving the order', async () => {
    state.graphql.mockResolvedValue({ product: remoteProduct({ variants: connection([
      { id: variantId, title: 'Small', sku: 'WEB-1' }, { id: 'gid://shopify/ProductVariant/2002', title: 'Large', sku: 'WEB-2' },
    ]) }) });
    const result = await ensureShopifyOrderProducts({ line_items: [
      { variant_id: '2001', product_id: '1001' }, { variant_id: '2002', product_id: '1001' },
    ] });
    expect(result).toHaveLength(2);
    expect(state.graphql).toHaveBeenCalledTimes(1);
    expect(result.map(row => row.shopify_variant_id)).toEqual([variantId, 'gid://shopify/ProductVariant/2002']);
  });

  it('finds the parent product by exact variant ID when the webhook has no product ID', async () => {
    const largeVariantId = 'gid://shopify/ProductVariant/9007199254740993';
    state.graphql.mockImplementation(async (query: string) => query.includes('PortalShopifyVariantProduct')
      ? { productVariant: { id: largeVariantId, product: { id: productId } } }
      : { product: remoteProduct({ variants: connection([{ id: largeVariantId, title: 'Default Title', sku: '' }]) }) });
    const result = await ensureShopifyOrderProducts({ line_items: [{ variant_id: '9007199254740993' }] });
    expect(result[0].shopify_variant_id).toBe(largeVariantId);
    expect(state.graphql).toHaveBeenNthCalledWith(1, expect.stringContaining('productVariant(id: $id)'), { id: largeVariantId });
  });

  it('does not use another store’s mapped variant', async () => {
    state.products = [mappedProduct({ shopify_shop_domain: 'other.myshopify.com' })];
    const result = await ensureShopifyOrderProducts({ line_items: [{ variant_id: 2001, product_id: 1001 }] });
    expect(state.graphql).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].shopify_shop_domain).toBe(state.shop);
  });

  it.each([undefined, null, Number.MAX_SAFE_INTEGER + 1])('holds unmappable custom or inexact variant IDs: %s', async (variant_id) => {
    await expect(ensureShopifyOrderProducts({ line_items: [{ variant_id, product_id: '1001', sku: 'SAME-SKU' }] })).rejects.toThrow('exact ID');
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.graphql).not.toHaveBeenCalled();
  });

  it('does not accept an absent variant after importing its claimed product', async () => {
    await expect(ensureShopifyOrderProducts({ line_items: [{ variant_id: '9999', product_id: '1001' }] })).rejects.toThrow('could not be matched');
  });
});

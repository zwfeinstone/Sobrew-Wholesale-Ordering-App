import 'server-only';

import { mapWithConcurrency } from '@/lib/async-work';
import { getShopifyConfig, shopifyGraphQL } from '@/lib/shopify';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type RemoteVariant = { id: string; title: string; sku: string | null };
type RemoteProduct = {
  id: string;
  title: string;
  description: string;
  status: string;
  updatedAt: string;
  variants: Connection<RemoteVariant>;
};

export type ShopifyProductSyncResult = { importedCount: number; updatedCount: number; productIds: string[] };
export type ShopifyCatalogSyncResult = ShopifyProductSyncResult & { errorCount: number; errors: string[] };
export type ShopifyMappedProduct = {
  id: string;
  name: string;
  sku: string;
  active: boolean | null;
  shopify_shop_domain: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
};

const PRODUCT_QUERY = `query PortalShopifyProduct($id: ID!, $after: String) {
  product(id: $id) {
    id title description status updatedAt
    variants(first: 100, after: $after) { nodes { id title sku } pageInfo { hasNextPage endCursor } }
  }
}`;
const PRODUCT_COLUMNS = 'id,name,sku,active,shopify_shop_domain,shopify_product_id,shopify_variant_id';

function exactGid(value: unknown, kind: 'Product' | 'ProductVariant') {
  if (typeof value === 'string' && new RegExp(`^gid://shopify/${kind}/[1-9][0-9]*$`).test(value)) return value;
  const numericId = typeof value === 'string' ? value : Number.isSafeInteger(value) ? String(value) : '';
  if (/^[1-9][0-9]*$/.test(numericId)) return `gid://shopify/${kind}/${numericId}`;
  throw new Error(`Shopify ${kind === 'ProductVariant' ? 'variant' : 'product'} is missing a valid, exact ID.`);
}

function configuredShopDomain() {
  const domain = getShopifyConfig().shopDomain;
  if (!domain) throw new Error('Configure the Shopify store before importing products.');
  return domain;
}

function nextCursor(connection: Connection<unknown>, seen: Set<string>) {
  if (!connection.pageInfo.hasNextPage) return null;
  const cursor = connection.pageInfo.endCursor;
  if (!cursor || seen.has(cursor)) throw new Error('Shopify catalog pagination could not be completed. Retry the import.');
  seen.add(cursor);
  return cursor;
}

/** Always reads the complete live product: webhook variant arrays can be truncated. */
async function readCompleteProduct(productId: string) {
  let after: string | null = null;
  let snapshot: RemoteProduct | null = null;
  const variants: RemoteVariant[] = [];
  const seenCursors = new Set<string>();
  const seenVariants = new Set<string>();
  do {
    const { product } = await shopifyGraphQL<{ product: RemoteProduct | null }>(PRODUCT_QUERY, { id: productId, after });
    if (!product || product.id !== productId) throw new Error('Shopify product was not found. It may have been deleted or the app may need product access.');
    if (!product.title?.trim() || !Number.isFinite(Date.parse(product.updatedAt))
      || !['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED'].includes(product.status)) {
      throw new Error('Shopify product details could not be verified. Retry the import.');
    }
    if (snapshot && snapshot.updatedAt !== product.updatedAt) {
      throw new Error('This Shopify product changed while its variants were loading. Retry the import.');
    }
    snapshot = product;
    for (const variant of product.variants.nodes) {
      exactGid(variant.id, 'ProductVariant');
      if (seenVariants.has(variant.id)) throw new Error('Shopify returned a duplicate variant while loading this product. Retry the import.');
      seenVariants.add(variant.id);
      variants.push(variant);
    }
    after = nextCursor(product.variants, seenCursors);
  } while (after);
  if (!snapshot || !variants.length) throw new Error('Shopify product has no variants to import.');
  return { product: snapshot, variants };
}

/** Import one product's variants without changing portal recipes, costs, categories, or SKUs. */
export async function syncShopifyProduct(productGid: string): Promise<ShopifyProductSyncResult> {
  const shopDomain = configuredShopDomain();
  const productId = exactGid(productGid, 'Product');
  const { product, variants } = await readCompleteProduct(productId);
  const admin = getSupabaseAdmin();
  const result: ShopifyProductSyncResult = { importedCount: 0, updatedCount: 0, productIds: [] };
  for (const variant of variants) {
    const title = variant.title?.trim();
    const name = title && title !== 'Default Title' ? `${product.title.trim()} — ${title}` : product.title.trim();
    const { data, error } = await admin.rpc('sync_shopify_product_variant', {
      p_variant: {
        shop_domain: shopDomain, product_id: product.id, variant_id: variant.id,
        sku: variant.sku?.trim() || null, name, description: product.description?.trim() || null,
        active: product.status === 'ACTIVE' || product.status === 'UNLISTED', updated_at: product.updatedAt,
      },
    });
    const saved = data as { id?: unknown; created?: unknown } | null;
    if (error || !saved || typeof saved.id !== 'string' || typeof saved.created !== 'boolean') {
      throw new Error(error?.message || 'A Shopify variant could not be saved. Retry the product import.');
    }
    result[saved.created ? 'importedCount' : 'updatedCount'] += 1;
    result.productIds.push(saved.id);
  }
  return result;
}

/** Page through the whole catalog; each product can be safely retried after partial failure. */
export async function syncShopifyCatalog(): Promise<ShopifyCatalogSyncResult> {
  configuredShopDomain();
  const result: ShopifyCatalogSyncResult = { importedCount: 0, updatedCount: 0, errorCount: 0, errors: [], productIds: [] };
  const seenCursors = new Set<string>();
  const seenProducts = new Set<string>();
  let after: string | null = null;
  do {
    const { products } = await shopifyGraphQL<{ products: Connection<{ id: string; title: string }> }>(`query PortalShopifyCatalog($after: String) {
      products(first: 50, after: $after, sortKey: ID) { nodes { id title } pageInfo { hasNextPage endCursor } }
    }`, { after });
    const page = products.nodes.filter((product) => {
      if (seenProducts.has(product.id)) return false;
      seenProducts.add(product.id);
      return true;
    });
    const results = await mapWithConcurrency(page, 3, async (product) => {
      try { return { synced: await syncShopifyProduct(product.id), error: null }; }
      catch (error) {
        return { synced: null, error: `${product.title || product.id}: ${error instanceof Error ? error.message : 'Product import failed.'}` };
      }
    });
    for (const item of results) {
      if (item.synced) {
        result.importedCount += item.synced.importedCount;
        result.updatedCount += item.synced.updatedCount;
        result.productIds.push(...item.synced.productIds);
      } else {
        result.errorCount += 1;
        result.errors.push(item.error!);
      }
    }
    after = nextCursor(products, seenCursors);
  } while (after);
  return result;
}

/** Resolve durable Shopify variant IDs; import missing catalog items before placing an order. */
export async function ensureShopifyOrderProducts(payload: unknown): Promise<ShopifyMappedProduct[]> {
  const shopDomain = configuredShopDomain();
  const source = payload && typeof payload === 'object' ? payload as { line_items?: unknown } : {};
  if (!Array.isArray(source.line_items) || !source.line_items.length) throw new Error('Shopify order has no product variants to import.');
  const requested = new Map<string, string | null>();
  for (const rawLine of source.line_items) {
    const line = rawLine && typeof rawLine === 'object' ? rawLine as { variant_id?: unknown; product_id?: unknown } : {};
    const variantId = exactGid(line.variant_id, 'ProductVariant');
    const productId = line.product_id == null ? null : exactGid(line.product_id, 'Product');
    if (requested.has(variantId) && requested.get(variantId) !== productId) throw new Error('Shopify order contains inconsistent product and variant IDs.');
    requested.set(variantId, productId);
  }
  const admin = getSupabaseAdmin();
  async function loadMappings() {
    const rows: ShopifyMappedProduct[] = [];
    const variantIds = [...requested.keys()];
    for (let start = 0; start < variantIds.length; start += 100) {
      const { data, error } = await admin.from('products').select(PRODUCT_COLUMNS)
        .eq('shopify_shop_domain', shopDomain).in('shopify_variant_id', variantIds.slice(start, start + 100));
      if (error) throw new Error('Could not read imported Shopify products. Retry the order import.');
      rows.push(...(data ?? []));
    }
    return rows;
  }
  const existing = await loadMappings();
  const mapped = new Map(existing.map((product) => [product.shopify_variant_id, product]));
  const missing = [...requested].filter(([id]) => !mapped.has(id) || mapped.get(id)?.active !== true);
  if (!missing.length) return existing;
  const productIds = new Set<string>();
  for (const [variantId, knownProductId] of missing) {
    if (knownProductId) productIds.add(knownProductId);
    else {
      const { productVariant } = await shopifyGraphQL<{ productVariant: { id: string; product: { id: string } } | null }>(`query PortalShopifyVariantProduct($id: ID!) {
        productVariant(id: $id) { id product { id } }
      }`, { id: variantId });
      if (!productVariant || productVariant.id !== variantId) throw new Error('A Shopify order variant no longer exists. Review this order in Shopify.');
      productIds.add(exactGid(productVariant.product.id, 'Product'));
    }
  }
  await mapWithConcurrency([...productIds], 3, (id) => syncShopifyProduct(id));
  const products = await loadMappings();
  if ([...requested.keys()].some((id) => !products.some((product) => product.shopify_variant_id === id))) {
    throw new Error('A Shopify variant could not be matched after importing its product. Review the product in Shopify.');
  }
  return products;
}

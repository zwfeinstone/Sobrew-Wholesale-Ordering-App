import 'server-only';

import { getShopifyConfig } from '@/lib/shopify';
import { syncShopifyProduct } from '@/lib/shopify-catalog';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';

export type ShopifyProductTopic = 'products/create' | 'products/update';
export type ShopifyProductImportResult = { status: 'imported' | 'error'; error?: string };

export function shopifyProductIdentity(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Shopify product payload.');
  const product = payload as Record<string, unknown>;
  if (typeof product.admin_graphql_api_id === 'string' && /^gid:\/\/shopify\/Product\/[1-9][0-9]*$/.test(product.admin_graphql_api_id)) return product.admin_graphql_api_id;
  const id = typeof product.id === 'string' ? product.id : Number.isSafeInteger(product.id) ? String(product.id) : '';
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('Shopify product is missing a valid, exact ID.');
  return `gid://shopify/Product/${id}`;
}

async function processShopifyProductImport(receiptId: string): Promise<ShopifyProductImportResult> {
  const admin = getSupabaseAdmin();
  const { data: receipt, error } = await admin.from('shopify_product_imports').select('*').eq('id', receiptId).single();
  if (error || !receipt) throw new Error('Could not read the Shopify product delivery.');
  if (receipt.shop_domain !== getShopifyConfig().shopDomain) throw new Error('This product delivery belongs to a different Shopify store.');
  if (receipt.status === 'imported') return { status: 'imported' };
  if (shopifyProductIdentity(receipt.payload) !== receipt.shopify_product_id) throw new Error('The Shopify product delivery has mismatched identifiers.');
  try {
    // Fetch the current complete product, not the event's potentially stale or
    // truncated variant list. Replays are safe because catalog upserts use IDs.
    await syncShopifyProduct(receipt.shopify_product_id);
    const saved = await admin.from('shopify_product_imports').update({
      status: 'imported', error: null, updated_at: new Date().toISOString(),
    }).eq('id', receiptId);
    if (saved.error) throw new Error('Product was synced but its delivery confirmation could not be saved.');
    return { status: 'imported' };
  } catch (failure) {
    const message = (failure instanceof Error ? failure.message : 'Shopify product import failed. Retry this delivery.').slice(0, 2000);
    const saved = await admin.from('shopify_product_imports').update({ status: 'error', error: message, updated_at: new Date().toISOString() })
      .eq('id', receiptId).neq('status', 'imported');
    if (saved.error) throw new Error('Could not save the Shopify product import failure. Shopify should retry delivery.');
    return { status: 'error', error: message };
  }
}

export async function receiveShopifyProduct(payload: unknown, topic: ShopifyProductTopic, webhookId: string): Promise<ShopifyProductImportResult> {
  const { shopDomain } = getShopifyConfig();
  if (!shopDomain) throw new Error('Shopify store is not configured.');
  if (!['products/create', 'products/update'].includes(topic)) throw new Error('Unsupported Shopify product topic.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(webhookId)) throw new Error('Missing or invalid Shopify delivery ID.');
  const productId = shopifyProductIdentity(payload);
  const admin = getSupabaseAdmin();
  const saved = await admin.from('shopify_product_imports').upsert({
    shop_domain: shopDomain, shopify_product_id: productId, webhook_id: webhookId, topic,
    payload: payload as Json, status: 'pending', error: null,
  }, { onConflict: 'shop_domain,webhook_id', ignoreDuplicates: true });
  if (saved.error) throw new Error('Could not durably save the Shopify product delivery.');
  const { data: receipt, error } = await admin.from('shopify_product_imports').select('id,shopify_product_id,topic')
    .eq('shop_domain', shopDomain).eq('webhook_id', webhookId).single();
  if (error || !receipt) throw new Error('Could not read the saved Shopify product delivery.');
  if (receipt.shopify_product_id !== productId || receipt.topic !== topic) throw new Error('Shopify delivery ID was reused for a different product event.');
  return processShopifyProductImport(receipt.id);
}

// The admin action exposing this helper must enforce Products edit access.
export async function retryShopifyProductImport(receiptId: string): Promise<ShopifyProductImportResult> {
  return processShopifyProductImport(receiptId);
}

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPortalRestockData,
  type PortalProductRow,
  type RecentOrderRow,
  type RecurringOrderRow,
} from '@/lib/portal-restock-data';

function throwForQueryError(scope: string, error: { message?: string } | null) {
  if (!error) return;
  console.error(`[quick-restock] ${scope} query failed`, { message: error.message });
  throw new Error('Unable to load Quick Restock right now.');
}

function isMissingPortalCatalog(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = error.message?.toLocaleLowerCase() ?? '';
  return (
    (error.code === '42P01' || error.code === 'PGRST205' || message.includes('schema cache')) &&
    message.includes('portal_catalog')
  );
}

async function loadLegacyCatalog(supabase: SupabaseClient, centerId: string): Promise<PortalProductRow[]> {
  const [assignmentsResult, pricesResult] = await Promise.all([
    supabase.from('user_products').select('product_id').eq('center_id', centerId),
    supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', centerId),
  ]);
  throwForQueryError('legacy catalog assignments', assignmentsResult.error);
  throwForQueryError('legacy catalog prices', pricesResult.error);

  const priceByProductId = new Map(
    (pricesResult.data ?? []).map((price) => [price.product_id as string, Number(price.price_cents)])
  );
  const productIds = [...new Set(
    (assignmentsResult.data ?? [])
      .map((assignment) => assignment.product_id as string)
      .filter((productId) => productId && priceByProductId.has(productId))
  )];
  if (!productIds.length) return [];

  const productsResult = await supabase
    .from('products')
    .select('id,name,description,image_url,category')
    .in('id', productIds)
    .eq('active', true);
  throwForQueryError('legacy catalog products', productsResult.error);

  return (productsResult.data ?? []).flatMap((product) => {
    const priceCents = priceByProductId.get(product.id as string);
    if (!Number.isFinite(priceCents)) return [];
    return [{
      product_id: product.id as string,
      name: product.name as string,
      description: (product.description as string | null) ?? null,
      image_url: (product.image_url as string | null) ?? null,
      category: (product.category as string | null) ?? null,
      current_price_cents: Math.max(0, Math.trunc(priceCents!)),
    }];
  });
}

export async function loadPortalRestockData(supabase: SupabaseClient, centerId: string) {
  const [catalogResult, recentOrderResult, recurringOrdersResult] = await Promise.all([
    supabase
      .from('portal_catalog')
      .select('product_id,name,description,image_url,category,current_price_cents'),
    supabase
      .from('orders')
      .select('id,subtotal_cents,created_at,order_items(id,product_id,product_name_snapshot,qty,unit_price_cents)')
      .eq('center_id', centerId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('recurring_orders')
      .select('frequency,created_at,last_generated_at')
      .eq('center_id', centerId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  throwForQueryError('recent order', recentOrderResult.error);
  throwForQueryError('recurring summary', recurringOrdersResult.error);

  let productRows: PortalProductRow[];
  if (catalogResult.error && isMissingPortalCatalog(catalogResult.error)) {
    console.warn('[quick-restock] portal_catalog is not deployed; using the legacy catalog loader.');
    productRows = await loadLegacyCatalog(supabase, centerId);
  } else {
    throwForQueryError('catalog', catalogResult.error);
    productRows = (catalogResult.data ?? []) as PortalProductRow[];
  }

  return buildPortalRestockData({
    productRows,
    recentOrder: ((recentOrderResult.data ?? [])[0] ?? null) as RecentOrderRow | null,
    recurringOrderRows: (recurringOrdersResult.data ?? []) as RecurringOrderRow[],
  });
}

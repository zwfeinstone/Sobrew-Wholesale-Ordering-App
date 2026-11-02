import type { CartProductSnapshot } from '@/lib/cart';
import { loadCustomerStockBalances } from '@/lib/customer-stock';

type PortalCatalogRow = {
  product_id: string;
  name: string;
  current_price_cents: number;
};

export async function getCenterCartProducts(supabase: any, centerId: string): Promise<CartProductSnapshot[]> {
  const [{ data, error }, balances] = await Promise.all([supabase
    .from('portal_catalog')
    .select('product_id,name,current_price_cents'), loadCustomerStockBalances(supabase, centerId)]);
  if (error) throw new Error('Unable to load your current order guide. Please refresh before ordering.');
  const stockByProductId = new Map(balances.map((balance) => [balance.product_id, balance]));

  return ((data ?? []) as PortalCatalogRow[]).map((product) => ({
    product_id: product.product_id,
    name: product.name,
    price_cents: product.current_price_cents,
    ...(stockByProductId.has(product.product_id) ? { customer_stock: stockByProductId.get(product.product_id) } : {}),
  }));
}

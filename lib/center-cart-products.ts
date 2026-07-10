import type { CartProductSnapshot } from '@/lib/cart';

type PortalCatalogRow = {
  product_id: string;
  name: string;
  current_price_cents: number;
};

export async function getCenterCartProducts(supabase: any, _centerId: string): Promise<CartProductSnapshot[]> {
  const { data } = await supabase
    .from('portal_catalog')
    .select('product_id,name,current_price_cents');

  return ((data ?? []) as PortalCatalogRow[]).map((product) => ({
    product_id: product.product_id,
    name: product.name,
    price_cents: product.current_price_cents,
  }));
}

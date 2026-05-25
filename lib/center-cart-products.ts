import type { CartProductSnapshot } from '@/components/cart-client';

type AssignedProductRow = {
  product_id: string;
};

type PriceRow = {
  product_id: string;
  price_cents: number;
};

type ProductRow = {
  id: string;
  name: string;
};

export async function getCenterCartProducts(supabase: any, centerId: string): Promise<CartProductSnapshot[]> {
  const [{ data: assigned }, { data: prices }] = await Promise.all([
    supabase.from('user_products').select('product_id').eq('center_id', centerId),
    supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', centerId),
  ]);

  const productIds = ((assigned ?? []) as AssignedProductRow[]).map((row) => row.product_id);
  if (!productIds.length) return [];

  const { data: products } = await supabase
    .from('products')
    .select('id,name')
    .in('id', productIds)
    .eq('active', true);

  const priceMap = new Map(((prices ?? []) as PriceRow[]).map((row) => [row.product_id, row.price_cents]));

  return ((products ?? []) as ProductRow[]).map((product) => ({
    product_id: product.id,
    name: product.name,
    price_cents: priceMap.get(product.id) ?? 0,
  }));
}

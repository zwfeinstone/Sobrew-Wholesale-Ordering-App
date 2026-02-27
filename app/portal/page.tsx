import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';
import { AddToCartButton } from '@/components/cart-client';

export default async function PortalPage() {
  const { user } = await requireUser();
  const supabase = await createClient();

  const [{ data: assigned }, { data: prices }] = await Promise.all([
    supabase.from('user_products').select('product_id').eq('user_id', user.id),
    supabase.from('user_product_prices').select('product_id,price_cents').eq('user_id', user.id),
  ]);

  const productIds = (assigned ?? []).map((row) => row.product_id);
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id,name,description,image_url').in('id', productIds).eq('active', true)
    : { data: [] as any[] };

  const priceMap = new Map((prices ?? []).map((row) => [row.product_id, row.price_cents]));

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {products?.map((product) => {
        const price = priceMap.get(product.id) ?? 0;
        return (
          <div key={product.id} className="card space-y-2">
            <h2 className="font-semibold">{product.name}</h2>
            <p className="text-sm text-slate-600">{product.description}</p>
            <p className="font-semibold">{usd(price)}</p>
            <AddToCartButton product={{ product_id: product.id, name: product.name, price_cents: price }} />
          </div>
        );
      })}
    </div>
  );
}

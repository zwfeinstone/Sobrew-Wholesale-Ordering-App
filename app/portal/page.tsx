import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';
import { AddToCartButton } from '@/components/cart-client';

export default async function PortalPage() {
  const { user } = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_products')
    .select('products(id,name,description,image_url),user_product_prices(price_cents)')
    .eq('user_id', user.id);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {data?.map((row: any) => {
        const product = row.products;
        const price = row.user_product_prices?.[0]?.price_cents ?? 0;
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

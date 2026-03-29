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
    <div className="space-y-6">
      <section className="panel overflow-hidden">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="max-w-2xl space-y-4">
            <span className="eyebrow">Sobrew Catalog</span>
            <div>
              <h1 className="page-title">Welcome to Your Sobrew Catalog</h1>
              <p className="page-subtitle mt-3">Great coffee with a greater purpose. Every order supports recovery.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:w-[22rem]">
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Available Products</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{products?.length ?? 0}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Signed In</p>
              <p className="mt-2 break-all text-base font-semibold text-slate-950">{user.email}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {products?.map((product) => {
          const price = priceMap.get(product.id) ?? 0;
          return (
            <div key={product.id} className="card flex h-full flex-col justify-between gap-5">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-slate-950">{product.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{product.description || 'No description available.'}</p>
                  </div>
                  <div className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">{usd(price)}</div>
                </div>
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ready To Order</p>
                  <p className="mt-2 text-sm text-slate-600">Add this product to your cart when you&apos;re ready to place your next order.</p>
                </div>
              </div>
              <AddToCartButton product={{ product_id: product.id, name: product.name, price_cents: price }} />
            </div>
          );
        })}
      </section>
    </div>
  );
}

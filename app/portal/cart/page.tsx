import { CartCatalogSync, CartTable } from '@/components/cart-client';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';
import { getCenterCartProducts } from '@/lib/center-cart-products';
import { createClient } from '@/lib/supabase/server';

export default async function CartPage() {
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const centerId = profile?.center_id ?? user.id;
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const cartProducts = await getCenterCartProducts(supabase, centerId);

  return (
    <div className="space-y-6">
      <CartCatalogSync products={cartProducts} storageKey={cartStorageKey} />
      <section className="panel">
        <span className="eyebrow">Your order draft</span>
        <h1 className="page-title mt-4">Review your restock.</h1>
        <p className="page-subtitle mt-3">Fine-tune quantities, confirm the subtotal, and continue when your order is ready.</p>
      </section>
      <CartTable storageKey={cartStorageKey} />
    </div>
  );
}

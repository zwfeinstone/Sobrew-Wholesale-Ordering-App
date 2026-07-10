import Link from 'next/link';
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
    <div className="cart-page space-y-5">
      <CartCatalogSync products={cartProducts} storageKey={cartStorageKey} />
      <header className="cart-page-header">
        <Link className="cart-back-link" href="/portal">← Quick Restock</Link>
        <h1>Review your order</h1>
        <p>Fine-tune quantities before checkout.</p>
      </header>
      <CartTable storageKey={cartStorageKey} />
    </div>
  );
}

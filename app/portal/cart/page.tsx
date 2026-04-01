import { CartTable } from '@/components/cart-client';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';

export default async function CartPage() {
  const { user, profile } = await requireUser();
  const cartStorageKey = cartStorageKeyForUser(user.id);

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Review Order</span>
        <h1 className="page-title mt-4">Your cart</h1>
        <p className="page-subtitle mt-3">Adjust quantities, remove products, and confirm your subtotal before heading to checkout.</p>
      </section>
      <CartTable storageKey={cartStorageKey} />
    </div>
  );
}

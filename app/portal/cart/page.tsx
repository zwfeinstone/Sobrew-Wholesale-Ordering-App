import { CartTable } from '@/components/cart-client';

export default function CartPage() {
  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Review Order</span>
        <h1 className="page-title mt-4">Your cart</h1>
        <p className="page-subtitle mt-3">Adjust quantities, remove products, and confirm your subtotal before heading to checkout.</p>
      </section>
      <CartTable />
    </div>
  );
}

import { CartTable } from '@/components/cart-client';

export default function CartPage() {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Cart</h1>
      <CartTable />
    </div>
  );
}

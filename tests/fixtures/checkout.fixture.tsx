import { createRoot } from 'react-dom/client';
import CheckoutForm from '@/components/checkout-form';
import OrderConfirmation from '@/components/order-confirmation';
import { ClearCart, readCartItems, saveCartItems } from '@/components/cart-client';
import { OrderStatusBadge, OrderStatusTimeline } from '@/components/order-status';
import { OrderNotes } from '@/components/order-notes';
import { readCheckoutSubmission, resolveCheckoutSubmission } from '@/lib/checkout-submission';
import type { CartItem } from '@/lib/cart';
import '@/app/globals.css';

declare global {
  interface Window {
    checkoutFixture: {
      cartStorageKey: string;
      otherCartStorageKey: string;
      calls: Record<string, string>[];
      completeOrder: (() => void) | null;
      setCartQuantity: (quantity: number) => void;
      readCart: () => CartItem[];
      readSubmission: () => ReturnType<typeof readCheckoutSubmission>;
    };
  }
}

const cartStorageKey = 'sobrew-cart:fixture-customer';
const otherCartStorageKey = 'sobrew-cart:another-customer';
const orderId = '4a13baf3-1111-4111-8111-111111111111';
const product = { product_id: '22222222-2222-4222-8222-222222222222', name: 'Meeting Coffee Medium Roast Ground - 5 lb', price_cents: 4000 };
const items = [{ ...product, qty: 4 }];
const shipping = {
  shipping_name: 'Augustine Recovery',
  shipping_address1: '123 Recovery Way',
  shipping_address2: null,
  shipping_city: 'St. Augustine',
  shipping_state: 'FL',
  shipping_zip: '32084',
};
const query = new URLSearchParams(location.search);
const isConfirmation = location.pathname.startsWith('/portal/orders/');
const recurringStatus = query.get('recurring') === 'error' ? 'error' : query.get('recurring') === 'created' ? 'created' : 'none';

// Seed once so reloading a completed receipt never manufactures a fresh cart.
if (!localStorage.getItem('checkout-fixture-initialized')) {
  saveCartItems(cartStorageKey, items);
  saveCartItems(otherCartStorageKey, [{ ...product, qty: 2 }]);
  localStorage.setItem('checkout-fixture-initialized', '1');
}

window.checkoutFixture = {
  cartStorageKey,
  otherCartStorageKey,
  calls: [],
  completeOrder: null,
  setCartQuantity(quantity) {
    saveCartItems(cartStorageKey, [{ ...product, qty: quantity }]);
    resolveCheckoutSubmission(localStorage, cartStorageKey, readCartItems(cartStorageKey));
  },
  readCart: () => readCartItems(cartStorageKey),
  readSubmission: () => readCheckoutSubmission(localStorage, cartStorageKey),
};

// React's delegated handler runs first. Record only submissions it permits, then
// prevent the browser's POST. No action URL, live API, or database is contacted.
document.addEventListener('submit', (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.defaultPrevented) return;
  event.preventDefault();
  const data = Object.fromEntries(Array.from(new FormData(event.target).entries(), ([name, value]) => [name, String(value)]));
  window.checkoutFixture.calls.push(data);
  window.checkoutFixture.completeOrder = () => {
    const params = new URLSearchParams({ submission_id: data.submission_id, toast: 'order_placed' });
    if (data.is_recurring === 'on') params.set('recurring', 'created');
    location.assign(`/portal/orders/${orderId}?${params}`);
  };
});

createRoot(document.getElementById('fixture-root')!).render(
  <div className="portal-shell">
    <header className="portal-header border-b px-3 py-2 sm:px-4 sm:py-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div><span className="eyebrow portal-header-eyebrow">Wholesale Portal</span><p className="portal-brand-title text-base font-semibold sm:text-xl">Sobrew Ordering</p></div>
        <span className="text-sm font-medium">Augustine Recovery</span>
      </div>
    </header>
    <main className="portal-main mx-auto px-3 pb-32 pt-5 sm:px-4 md:px-6 md:py-8">
      {isConfirmation ? (
        <div className="space-y-6">
          <ClearCart storageKey={cartStorageKey} submissionId={query.get('submission_id')} orderId={orderId} />
          <OrderConfirmation orderId={orderId} createdAt="2026-09-30T15:59:00Z" subtotalCents={16000} itemCount={4} recurringStatus={recurringStatus} shipping={shipping} />
          <section className="card">
            <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold text-slate-950">Order summary</h2><OrderStatusBadge status="New" /></div>
            <div className="mt-6"><OrderStatusTimeline status="New" /></div>
          </section>
          <OrderNotes notes="Deliver to the receiving entrance." />
          <div className="card flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><span>{product.name} × 4</span><strong>$160.00</strong></div>
        </div>
      ) : (
        <CheckoutForm
          actionUrl="/portal/checkout/submit"
          cartStorageKey={cartStorageKey}
          initialToast={query.get('toast') === 'checkout_error' ? 'checkout_error' : ''}
          locations={[{ id: '33333333-3333-4333-8333-333333333333', name: shipping.shipping_name, address1: shipping.shipping_address1, address2: null, city: shipping.shipping_city, state: shipping.shipping_state, zip: shipping.shipping_zip }]}
          products={[product]}
        />
      )}
    </main>
  </div>,
);

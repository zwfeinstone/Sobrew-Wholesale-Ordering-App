'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  CART_UPDATED_EVENT,
  CartCatalogSync,
  CheckoutCartField,
  CheckoutCartSummary,
  readCartItemCount,
  type CartProductSnapshot,
} from '@/components/cart-client';
import CheckoutSubmitButton from '@/components/checkout-submit-button';
import StatusToast from '@/components/status-toast';
import { RECURRING_FREQUENCY_OPTIONS } from '@/lib/recurring';

type CheckoutFormProps = {
  actionUrl: string;
  cartStorageKey: string;
  initialToast: '' | 'invalid_cart' | 'checkout_error' | 'location_required';
  locations: CheckoutLocationOption[];
  products: CartProductSnapshot[];
};

type CheckoutLocationOption = {
  id: string;
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

function locationLabel(location: CheckoutLocationOption) {
  const address = [location.address1, location.city, location.state, location.zip]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(', ');
  return address ? `${location.name || 'Delivery location'} - ${address}` : location.name || 'Delivery location';
}

export default function CheckoutForm({ actionUrl, cartStorageKey, initialToast, locations, products }: CheckoutFormProps) {
  const [submissionId] = useState(() => crypto.randomUUID());
  const [cartItemCount, setCartItemCount] = useState(0);
  const [isRecurring, setIsRecurring] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const shouldSelectLocation = locations.length > 1;
  const isCartEmpty = cartItemCount <= 0;

  useEffect(() => {
    const syncCount = () => setCartItemCount(readCartItemCount(cartStorageKey));
    syncCount();
    window.addEventListener(CART_UPDATED_EVENT, syncCount as EventListener);
    window.addEventListener('storage', syncCount);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncCount as EventListener);
      window.removeEventListener('storage', syncCount);
    };
  }, [cartStorageKey]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isCartEmpty || submittingRef.current) {
      event.preventDefault();
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
  };

  return (
    <form action={actionUrl} method="post" className="checkout-form space-y-6" onSubmit={handleSubmit}>
      <CartCatalogSync products={products} storageKey={cartStorageKey} />
      {initialToast === 'invalid_cart' ? (
        <StatusToast
          message="Your cart changed. Please review the items before placing this order."
          tone="error"
        />
      ) : null}
      {initialToast === 'checkout_error' ? (
        <StatusToast
          message="We couldn't place your order. Please try again."
          tone="error"
        />
      ) : null}
      {initialToast === 'location_required' ? (
        <StatusToast
          message="Please choose a delivery location before placing this order."
          tone="error"
        />
      ) : null}
      <section className="panel checkout-hero">
        <span className="eyebrow">Checkout</span>
        <h1 className="page-title checkout-title mt-4">Place your order</h1>
        <p className="page-subtitle checkout-subtitle mt-3">Review, add notes, set recurring if needed, and submit.</p>
      </section>
      <section className="card checkout-card space-y-5">
        <CheckoutCartField storageKey={cartStorageKey} />
        <input type="hidden" name="submission_id" value={submissionId} />
        {locations.length === 1 ? <input type="hidden" name="center_location_id" value={locations[0].id} /> : null}
        <CheckoutCartSummary storageKey={cartStorageKey} />
        {shouldSelectLocation ? (
          <div className="subtle-panel checkout-location-panel space-y-2">
            <label className="text-sm font-medium text-slate-700" htmlFor="checkout-delivery-location">Delivery location</label>
            <select id="checkout-delivery-location" className="input checkout-location-select" name="center_location_id" required defaultValue="">
              <option value="" disabled>Choose a location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{locationLabel(location)}</option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="subtle-panel checkout-recurring-panel">
          <label className="checkout-recurring-choice flex items-start gap-3 text-sm font-medium text-slate-800 sm:items-center" htmlFor="checkout-is-recurring">
            <input
              id="checkout-is-recurring"
              checked={isRecurring}
              className="checkout-recurring-checkbox"
              type="checkbox"
              name="is_recurring"
              onChange={(event) => setIsRecurring(event.target.checked)}
            />
            <span>Make this order recurring</span>
          </label>
          {isRecurring ? (
            <div className="checkout-recurring-frequency mt-4">
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="checkout-recurring-frequency">Recurring frequency</label>
              <select id="checkout-recurring-frequency" className="input checkout-recurring-select" name="recurring_frequency" defaultValue="2_weeks">
                {RECURRING_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="checkout-field space-y-2">
          <label className="text-sm font-medium text-slate-700" htmlFor="checkout-notes">Notes</label>
          <textarea id="checkout-notes" className="input checkout-notes min-h-28" name="notes" placeholder="Delivery notes, special handling, or anything your team should know." />
        </div>
      </section>
      <section className="sticky-action-bar checkout-action-bar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="checkout-action-copy">
          <p className="text-sm font-semibold text-slate-950">Ready to place this order?</p>
          <p className="mt-1 text-sm text-slate-500">Your cart and recurring preferences will be submitted together.</p>
          <p className="mt-2 text-sm font-medium text-slate-700">
            An invoice will be sent when this order is processed. No payment is collected in the ordering app.
          </p>
        </div>
        <CheckoutSubmitButton disabled={isCartEmpty} pending={isSubmitting} />
      </section>
    </form>
  );
}

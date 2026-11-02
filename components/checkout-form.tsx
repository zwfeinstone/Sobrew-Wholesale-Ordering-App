'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  CartCatalogSync,
  CheckoutCartField,
  CheckoutCartSummary,
  readCartItems,
  useCart,
  type CartProductSnapshot,
} from '@/components/cart-client';
import CheckoutSubmitButton from '@/components/checkout-submit-button';
import { CustomerStockRefresh } from '@/components/customer-stock-refresh';
import { cartCustomerStockGroups, cartExceedsAvailableStock } from '@/lib/cart';
import { CustomerStockSummary } from '@/components/customer-stock-summary';
import { trackProductEvent } from '@/lib/analytics';
import { checkoutSubmitState } from '@/lib/checkout-submit-state';
import {
  checkoutCartFingerprint,
  readCheckoutSubmission,
  resolveCheckoutSubmission,
  submitCheckoutSubmission,
} from '@/lib/checkout-submission';
import {
  RECURRING_FREQUENCY_OPTIONS,
  formatNextRecurringOrderDate,
  type RecurringFrequency,
} from '@/lib/recurring';

type CheckoutFormProps = {
  actionUrl: string;
  cartStorageKey: string;
  initialToast: '' | 'invalid_cart' | 'checkout_error' | 'location_required' | 'stock_unavailable';
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

function locationAddressLines(location: CheckoutLocationOption) {
  const cityStateZip = [location.city, location.state, location.zip]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(', ');
  return [location.address1, location.address2, cityStateZip]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function checkoutErrorMessage(initialToast: CheckoutFormProps['initialToast']) {
  if (initialToast === 'invalid_cart') return 'Your order changed. Review the items and try placing it again.';
  if (initialToast === 'checkout_error') return 'We couldn’t confirm your order yet. Your draft is saved. Try again to check its status without placing a second order.';
  if (initialToast === 'location_required') return 'Choose a delivery location before placing your order.';
  if (initialToast === 'stock_unavailable') return 'Your stored bag inventory changed. Your cart has been updated to the available quantity. Review it before placing your order again.';
  return '';
}

export default function CheckoutForm({ actionUrl, cartStorageKey, initialToast, locations, products }: CheckoutFormProps) {
  const router = useRouter();
  const [submissionId, setSubmissionId] = useState('');
  const [clientError, setClientError] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>('2_weeks');
  const [selectedLocationId, setSelectedLocationId] = useState(locations.length === 1 ? locations[0].id : '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { itemCount, items, subtotalCents } = useCart(cartStorageKey);
  const productMap = useMemo(() => new Map(products.map((product) => [product.product_id, product])), [products]);
  const containsCustomerStock = items.some((item) => Boolean(productMap.get(item.product_id)?.customer_stock));
  const onlyCustomerStock = items.length > 0 && items.every((item) => Boolean(productMap.get(item.product_id)?.customer_stock));
  const recurringEnabled = isRecurring && !containsCustomerStock;
  const cartFingerprint = checkoutCartFingerprint(items);
  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? null;
  const { disabled: checkoutDisabled, disabledLabel } = checkoutSubmitState({
    hasSelectedLocation: Boolean(selectedLocation),
    itemCount,
    locationCount: locations.length,
    submissionId,
  });
  const errorMessage = clientError || checkoutErrorMessage(initialToast);
  const nextRecurringDate = useMemo(
    () => recurringEnabled ? formatNextRecurringOrderDate(frequency, new Date()) : '',
    [frequency, recurringEnabled]
  );

  useEffect(() => {
    try {
      const submission = resolveCheckoutSubmission(localStorage, cartStorageKey, readCartItems(cartStorageKey));
      setSubmissionId(submission?.submissionId ?? '');
      setClientError('');
    } catch {
      setSubmissionId('');
      setClientError('Your browser couldn’t prepare checkout. Please reload this page before placing your order.');
    }
  }, [cartFingerprint, cartStorageKey]);

  useEffect(() => {
    const restoreCheckout = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      submittingRef.current = false;
      setIsSubmitting(false);
      try {
        const submission = readCheckoutSubmission(localStorage, cartStorageKey);
        if (submission?.status === 'completed') {
          router.replace(`/portal/orders/${submission.orderId}?toast=order_placed`);
        }
      } catch {
        // The regular preparation/submit path presents storage errors to the customer.
      }
    };
    window.addEventListener('pageshow', restoreCheckout);
    return () => window.removeEventListener('pageshow', restoreCheckout);
  }, [cartStorageKey, router]);

  useEffect(() => {
    trackProductEvent('portal_checkout_started', { available_locations: locations.length });
  }, [locations.length]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (checkoutDisabled || submittingRef.current) {
      event.preventDefault();
      return;
    }
    try {
      const currentItems = readCartItems(cartStorageKey);
      if (!currentItems.length) {
        event.preventDefault();
        const previous = readCheckoutSubmission(localStorage, cartStorageKey);
        router.replace(previous?.status === 'completed'
          ? `/portal/orders/${previous.orderId}?toast=order_placed`
          : '/portal/cart');
        return;
      }
      if (checkoutCartFingerprint(currentItems) !== cartFingerprint) {
        event.preventDefault();
        setClientError('Your cart changed in another tab. Review your updated cart before placing this order.');
        router.refresh();
        return;
      }
      if (cartExceedsAvailableStock(currentItems, products)) {
        event.preventDefault();
        setClientError('The combined quantity exceeds your shared bag inventory. Review the updated cart before placing this order.');
        router.refresh();
        return;
      }
      const submission = submitCheckoutSubmission(localStorage, cartStorageKey, currentItems);
      if (!submission || submission.status === 'completed') {
        event.preventDefault();
        if (submission?.orderId) router.replace(`/portal/orders/${submission.orderId}?toast=order_placed`);
        return;
      }
      // Native form posting reads the DOM immediately, before React flushes state updates.
      const field = event.currentTarget.elements.namedItem('submission_id') as HTMLInputElement;
      field.value = submission.submissionId;
      setSubmissionId(submission.submissionId);
    } catch {
      event.preventDefault();
      setClientError('Your browser couldn’t prepare checkout. Please reload this page before placing your order.');
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
  };

  return (
    <form action={actionUrl} method="post" className="checkout-form" onSubmit={handleSubmit}>
      <CustomerStockRefresh enabled={!isSubmitting && products.some((product) => Boolean(product.customer_stock))} />
      <CartCatalogSync products={products} storageKey={cartStorageKey} />
      <CheckoutCartField storageKey={cartStorageKey} />
      <input type="hidden" name="submission_id" value={submissionId} />

      <header className="checkout-page-header">
        <Link href="/portal/cart" className="checkout-back-link">← Back</Link>
        <h1>Checkout</h1>
        <span aria-hidden="true" />
      </header>

      {errorMessage ? <div className="checkout-critical-alert" role="alert">{errorMessage}</div> : null}

      <div className="checkout-content">
        <CheckoutCartSummary storageKey={cartStorageKey} />
        {cartCustomerStockGroups(items, products).map(({ balance, quantity, productName }) => (
          <CustomerStockSummary key={balance.allocation_id} balance={balance} productName={productName} requestedQuantity={quantity} />
        ))}
        {onlyCustomerStock ? (
          <p className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-950">This delivery is included in your purchased batch. Sobrew covers boxes and shipping; no additional invoice will be sent.</p>
        ) : null}

        <section className="checkout-section" aria-labelledby="checkout-delivery-heading">
          <div className="checkout-section-heading">
            <div>
              <p className="checkout-section-kicker">Delivery</p>
              <h2 id="checkout-delivery-heading" className="checkout-section-title">Where this order is going</h2>
            </div>
          </div>

          {locations.length > 1 ? (
            <div className="checkout-location-picker">
              <label htmlFor="checkout-delivery-location">Delivery location</label>
              <select
                id="checkout-delivery-location"
                className="input"
                name="center_location_id"
                required
                value={selectedLocationId}
                onChange={(event) => setSelectedLocationId(event.target.value)}
              >
                <option value="" disabled>Choose a location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name || 'Delivery location'}</option>
                ))}
              </select>
            </div>
          ) : selectedLocation ? (
            <input type="hidden" name="center_location_id" value={selectedLocation.id} />
          ) : null}

          {selectedLocation ? (
            <address className="checkout-address">
              <strong>{selectedLocation.name || 'Delivery location'}</strong>
              {locationAddressLines(selectedLocation).map((line) => <span key={line}>{line}</span>)}
            </address>
          ) : locations.length > 1 ? (
            <p className="checkout-location-hint">Choose a location to review its delivery address.</p>
          ) : null}
          <Link className="mt-4 inline-flex text-sm font-medium text-slate-950 underline" href="/portal/settings#delivery-locations">
            Add or edit delivery locations
          </Link>
        </section>

        <section className="checkout-section" aria-labelledby="checkout-recurring-heading">
          <div className="checkout-recurring-row">
            <div>
              <p className="checkout-section-kicker">Schedule</p>
              <h2 id="checkout-recurring-heading" className="checkout-section-title">Make recurring</h2>
            </div>
            <label className="checkout-switch">
              <span className="sr-only">Make this order recurring</span>
              <input
                checked={recurringEnabled}
                disabled={containsCustomerStock}
                name="is_recurring"
                type="checkbox"
                onChange={(event) => setIsRecurring(event.target.checked)}
              />
              <span aria-hidden="true" className="checkout-switch-track"><span /></span>
            </label>
          </div>
          {recurringEnabled ? (
            <div className="checkout-recurring-options">
              <label htmlFor="checkout-recurring-frequency">Repeat this order</label>
              <select
                id="checkout-recurring-frequency"
                className="input"
                name="recurring_frequency"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as RecurringFrequency)}
              >
                {RECURRING_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <p className="checkout-next-date">Next expected order: <strong>{nextRecurringDate}</strong></p>
            </div>
          ) : (
            <p className="checkout-section-help">{containsCustomerStock ? 'Your purchased bags have a fixed remaining quantity. Request each delivery as needed; recurring orders are unavailable for this cart.' : 'Turn this on to automatically create the same order on a schedule.'}</p>
          )}
        </section>

        <section className="checkout-section" aria-labelledby="checkout-notes-heading">
          <div>
            <p className="checkout-section-kicker">Optional</p>
            <h2 id="checkout-notes-heading" className="checkout-section-title">Order notes</h2>
          </div>
          <label className="sr-only" htmlFor="checkout-notes">Order notes</label>
          <textarea
            id="checkout-notes"
            className="input checkout-notes"
            name="notes"
            placeholder="Delivery notes, special handling, or anything your team should know."
          />
        </section>
      </div>

      <section className="checkout-submit-bar" aria-label="Place order">
        <div aria-live="polite">
          <span>Subtotal</span>
          <strong>${(subtotalCents / 100).toFixed(2)}</strong>
        </div>
        {!onlyCustomerStock ? <p>No payment is collected here. An invoice is sent when your order is processed.</p> : null}
        <CheckoutSubmitButton disabled={checkoutDisabled} disabledLabel={disabledLabel} pending={isSubmitting} />
        {isSubmitting ? (
          <p className="checkout-pending-notice" role="status">
            Sending your order… Please keep this page open. We’ll show your confirmation next.
          </p>
        ) : null}
      </section>
    </form>
  );
}

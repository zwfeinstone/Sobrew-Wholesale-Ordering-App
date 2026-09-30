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
    () => isRecurring ? formatNextRecurringOrderDate(frequency, new Date()) : '',
    [frequency, isRecurring]
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
                checked={isRecurring}
                name="is_recurring"
                type="checkbox"
                onChange={(event) => setIsRecurring(event.target.checked)}
              />
              <span aria-hidden="true" className="checkout-switch-track"><span /></span>
            </label>
          </div>
          {isRecurring ? (
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
            <p className="checkout-section-help">Turn this on to automatically create the same order on a schedule.</p>
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
        <p>No payment is collected here. An invoice is sent when your order is processed.</p>
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

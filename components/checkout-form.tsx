'use client';

import { useRef, useState } from 'react';
import { CheckoutCartField, CheckoutCartSummary } from '@/components/cart-client';
import CheckoutSubmitButton from '@/components/checkout-submit-button';
import StatusToast from '@/components/status-toast';
import { RECURRING_FREQUENCY_OPTIONS } from '@/lib/recurring';

type CheckoutFormProps = {
  actionUrl: string;
  cartStorageKey: string;
  initialToast: '' | 'invalid_cart' | 'checkout_error';
};

export default function CheckoutForm({ actionUrl, cartStorageKey, initialToast }: CheckoutFormProps) {
  const [submissionId] = useState(() => crypto.randomUUID());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const handleSubmit = () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
  };

  return (
    <form action={actionUrl} method="post" className="checkout-form space-y-6" onSubmit={handleSubmit}>
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
      <section className="panel checkout-hero">
        <span className="eyebrow">Checkout</span>
        <h1 className="page-title checkout-title mt-4">Place your order</h1>
        <p className="page-subtitle checkout-subtitle mt-3">Review, add notes, set recurring if needed, and submit.</p>
      </section>
      <section className="card checkout-card space-y-5">
        <CheckoutCartField storageKey={cartStorageKey} />
        <input type="hidden" name="submission_id" value={submissionId} />
        <CheckoutCartSummary storageKey={cartStorageKey} />
        <div className="subtle-panel checkout-recurring-panel">
          <label className="checkout-recurring-choice flex items-start gap-3 text-sm font-medium text-slate-800 sm:items-center">
            <input className="checkout-recurring-checkbox" type="checkbox" name="is_recurring" />
            <span>Make this order recurring</span>
          </label>
          <div className="checkout-recurring-frequency mt-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">Recurring frequency</label>
            <select className="input checkout-recurring-select" name="recurring_frequency" defaultValue="2_weeks">
              {RECURRING_FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="checkout-field space-y-2">
          <label className="text-sm font-medium text-slate-700">Notes</label>
          <textarea className="input checkout-notes min-h-28" name="notes" placeholder="Delivery notes, special handling, or anything your team should know." />
        </div>
      </section>
      <section className="sticky-action-bar checkout-action-bar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="checkout-action-copy">
          <p className="text-sm font-semibold text-slate-950">Ready to place this order?</p>
          <p className="mt-1 text-sm text-slate-500">Your cart and recurring preferences will be submitted together.</p>
        </div>
        <CheckoutSubmitButton pending={isSubmitting} />
      </section>
    </form>
  );
}

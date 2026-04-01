'use client';

import { FormEvent, useRef, useState } from 'react';
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
    <form action={actionUrl} method="post" className="space-y-6" onSubmit={handleSubmit}>
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
      <section className="panel">
        <span className="eyebrow">Checkout</span>
        <h1 className="page-title mt-4">Place your order</h1>
        <p className="page-subtitle mt-3">Add any final notes, optionally turn this into a recurring order, and submit when everything looks right.</p>
      </section>
      <section className="card space-y-5">
        <CheckoutCartField storageKey={cartStorageKey} />
        <input type="hidden" name="submission_id" value={submissionId} />
        <CheckoutCartSummary storageKey={cartStorageKey} />
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Notes</label>
          <textarea className="input min-h-28" name="notes" placeholder="Delivery notes, special handling, or anything your team should know." />
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-white/60 p-4">
          <label className="flex items-start gap-3 text-sm font-medium text-slate-800 sm:items-center">
            <input type="checkbox" name="is_recurring" />
            <span>Make this order recurring</span>
          </label>
          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">Recurring frequency</label>
            <select className="input" name="recurring_frequency" defaultValue="2_weeks">
              {RECURRING_FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <CheckoutSubmitButton pending={isSubmitting} />
      </section>
    </form>
  );
}

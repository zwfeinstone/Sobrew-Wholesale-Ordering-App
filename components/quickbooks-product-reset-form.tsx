'use client';

import { useState } from 'react';
import PendingSubmitButton from '@/components/pending-submit-button';

export function QuickBooksProductResetForm({
  action,
  activeProductCount,
  disabledReason,
  environment,
}: {
  action: (formData: FormData) => void | Promise<void>;
  activeProductCount: number;
  disabledReason?: string;
  environment: 'production' | 'sandbox';
}) {
  const [confirmed, setConfirmed] = useState(false);
  const isDisabled = Boolean(disabledReason) || !confirmed;

  return (
    <form action={action} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
      <div className="space-y-3">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <label className="flex items-start gap-3 text-sm font-medium text-rose-950">
            <input
              checked={confirmed}
              className="mt-1"
              name="confirm_product_reset"
              type="checkbox"
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              I understand this will rename and inactivate active QuickBooks products in the connected {environment === 'production' ? 'live' : 'sandbox'} company, then create {activeProductCount} new QuickBooks items from active portal products.
            </span>
          </label>
          <PendingSubmitButton
            className="rounded-full bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isDisabled}
            disabledLabel="Reset QuickBooks Products"
            label="Reset QuickBooks Products"
            pendingLabel="Resetting..."
          />
        </div>
        {disabledReason ? (
          <p className="text-sm font-medium text-rose-800">
            Reset unavailable: {disabledReason}
          </p>
        ) : !confirmed ? (
          <p className="text-sm font-medium text-rose-800">
            Check the confirmation box to enable the live reset.
          </p>
        ) : null}
      </div>
    </form>
  );
}

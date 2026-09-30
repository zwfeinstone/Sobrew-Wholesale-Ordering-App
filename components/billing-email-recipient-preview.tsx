'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

type RecipientPreview = {
  cc: string[];
  to: string[];
};

export default function BillingEmailRecipientPreview({
  centerId,
  connected,
  orderId,
}: {
  centerId?: string;
  connected: boolean;
  orderId: string;
}) {
  const previewId = useId();
  const [recipients, setRecipients] = useState<RecipientPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const billingCcHref = `/admin/invoicing?view=customers${centerId ? `#qb-center-${encodeURIComponent(centerId)}` : ''}`;

  async function loadRecipients() {
    setPending(true);
    setError(null);
    setRecipients(null);
    try {
      const response = await fetch(`/api/admin/quickbooks/invoices/recipients?${new URLSearchParams({ orderId })}`, { cache: 'no-store' });
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Unable to preview recipients. Refresh the page and try again.');
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to preview recipients.');
      setRecipients(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to preview recipients.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 text-left text-xs">
      <button
        aria-controls={previewId}
        aria-expanded={Boolean(recipients || error)}
        className="btn-secondary text-xs disabled:opacity-60"
        disabled={!connected || pending}
        onClick={loadRecipients}
        type="button"
      >
        {pending ? 'Loading recipients...' : recipients ? 'Refresh recipients' : 'Preview recipients'}
      </button>
      <div aria-busy={pending} aria-live="polite" id={previewId}>
        {error ? <p className="font-medium text-rose-700">{error}</p> : null}
        {recipients ? (
          <div className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">
            <p className="break-words"><span className="font-semibold">To:</span> {recipients.to.join(', ') || 'Missing billing email'}</p>
            <p className="break-words"><span className="font-semibold">CC:</span> {recipients.cc.join(', ') || 'None'}</p>
            <p className="break-words"><span className="font-semibold">Portal PDF audit copy:</span> zach@sobrew.com</p>
            <p className="pt-1 text-slate-500">New customers use the invoice recipients saved during setup. Existing customers keep their QuickBooks contacts and CooperRiis billing exception. <Link className="underline" href={billingCcHref} prefetch={false}>Edit billing CC</Link></p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

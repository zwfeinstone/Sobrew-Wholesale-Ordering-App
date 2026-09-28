'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { SingleLeadResult } from '@/lib/prospecting-single-lead-result';
import { hasSampleRequestContact, SAMPLE_CONTACT_REQUIRED } from '@/lib/prospecting-sample-contact';

type Props = {
  action: (data: FormData) => Promise<SingleLeadResult>;
  canEdit: boolean;
  children: ReactNode;
};

export default function ProspectingSingleLeadForm({ action, canEdit, children }: Props) {
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [result, setResult] = useState<SingleLeadResult | null>(null);
  const inFlight = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { if (result || slow) feedback.current?.focus(); }, [result, slow]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || inFlight.current) return;
    const data = new FormData(event.currentTarget);
    if (data.get('stage') === 'sample_requested' && !hasSampleRequestContact([{
      full_name: String(data.get('contact_full_name') || ''),
      email: String(data.get('contact_email') || ''),
    }])) {
      setResult({ ok: false, message: SAMPLE_CONTACT_REQUIRED });
      return;
    }
    inFlight.current = true;
    setPending(true);
    setSlow(false);
    setResult(null);
    // A late response may still confirm the save. Keep this attempt in flight
    // and prevent overlapping submissions while giving the user a way to check.
    timer.current = setTimeout(() => setSlow(true), 25_000);
    try {
      setResult(await action(data));
    } catch {
      setResult({ ok: false, message: 'The connection was interrupted before the save was confirmed. Your details are still here. Check the lead list before trying again.' });
    } finally {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      inFlight.current = false;
      setPending(false);
      setSlow(false);
    }
  }

  if (result?.ok) return (
    <section className="card space-y-4">
      <div ref={feedback} role="status" tabIndex={-1}>
        <h2 className="text-xl font-semibold tracking-tight text-slate-950">Lead saved</h2>
        <p className="mt-2 text-slate-600">{result.message}</p>
        {result.sampleOrderHref ? <p className="mt-2 font-medium text-slate-900">Next, choose the sample boxes and review the delivery details to create the order.</p> : null}
      </div>
      <div className="flex flex-wrap gap-3">
        {result.sampleOrderHref ? <Link className="btn-primary" href={result.sampleOrderHref}>Create sample order</Link> : null}
        <Link className={result.sampleOrderHref ? 'btn-secondary' : 'btn-primary'} href={result.href}>View lead</Link>
        <button type="button" className="btn-secondary" onClick={() => setResult(null)}>Add another lead</button>
      </div>
    </section>
  );

  return (
    <form onSubmit={submit} className="card space-y-5" aria-busy={pending}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Single Lead</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Add one prospect</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">Add a single company directly, assign it to a rep, and optionally place it into a lead list. Sample Requested leads also enter the HubSpot queue.</p>
        </div>
        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={!canEdit || pending}>
          {!canEdit ? 'No edit access' : slow ? 'Checking save…' : pending ? 'Adding…' : 'Add Lead'}
        </button>
      </div>
      {result && !result.ok ? (
        <div ref={feedback} role="alert" tabIndex={-1} className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <p>{result.message}</p>
          <Link className="mt-2 inline-block font-semibold underline" href={result.leadId ? `/admin/sales/prospecting/${result.leadId}` : '/admin/sales/prospecting/admin?tab=leads'} target="_blank" rel="noopener noreferrer">{result.leadId ? 'Review saved lead' : 'Check lead list'} (opens a new tab)</Link>
        </div>
      ) : slow ? (
        <div ref={feedback} role="status" tabIndex={-1} className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>The save is taking longer than expected and may already have completed. Your details are still here while we wait for confirmation.</p>
          <Link className="mt-2 inline-block font-semibold underline" href="/admin/sales/prospecting/admin?tab=leads" target="_blank" rel="noopener noreferrer">Check lead list (opens a new tab)</Link>
        </div>
      ) : null}
      <fieldset className="min-w-0 space-y-5" disabled={!canEdit || pending}>{children}</fieldset>
    </form>
  );
}

'use client';

import { startTransition, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { SampleOutcomeResult } from '@/lib/prospecting-sample-outcome';

type Props = {
  action: (data: FormData) => Promise<SampleOutcomeResult>;
  canEdit: boolean;
  leadId: string;
  companyName: string;
  expectedUpdatedAt: string | null;
  children: ReactNode;
};

export default function ProspectingSampleOutcomeCard({ action, canEdit, leadId, companyName, expectedUpdatedAt, children }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<'lost' | 'converted' | null>(null);
  const [saved, setSaved] = useState<'lost' | 'converted' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const submission = useRef<{ signature: string; id: string } | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 15_000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => { if (error) feedback.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || inFlight.current || saved) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const outcome = submitter instanceof HTMLButtonElement ? submitter.value : '';
    if (outcome !== 'lost' && outcome !== 'converted') {
      setError('Choose Mark Won or Mark Lost to save an outcome.');
      return;
    }

    // Capture the note and the clicked button before disabling the controls.
    const data = new FormData(event.currentTarget);
    data.set('lead_id', leadId);
    data.set('expected_updated_at', expectedUpdatedAt ?? '');
    data.set('outcome', outcome);
    const signature = JSON.stringify([leadId, expectedUpdatedAt, outcome, data.get('outcome_note')]);
    if (submission.current?.signature !== signature) submission.current = { signature, id: crypto.randomUUID() };
    data.set('submission_id', submission.current.id);

    inFlight.current = true;
    setPending(outcome);
    setSlow(false);
    setError(null);
    try {
      const result = await action(data);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Remove this card before fetching the updated totals and next page rows.
      // Keep this state even if a slower refresh still contains the old lead.
      setSaved(outcome);
      startTransition(() => router.refresh());
    } catch {
      setError('The connection was interrupted. Your note is still here. Retry the same outcome to check whether it was saved.');
    } finally {
      inFlight.current = false;
      setPending(null);
      setSlow(false);
    }
  }

  if (saved) return <span role="status" className="sr-only">{companyName} marked {saved === 'lost' ? 'lost' : 'won'}.</span>;

  return (
    <article className="card" aria-label={companyName}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        {children}
        <form onSubmit={submit} className="grid gap-3 rounded-lg border border-slate-200 bg-white/70 p-3" aria-busy={Boolean(pending)}>
          <label className="text-sm font-semibold text-slate-700">
            Outcome note
            <textarea className="input mt-2 min-h-24" name="outcome_note" disabled={!canEdit || Boolean(pending)} placeholder="Decision maker, order plan, reason lost..." />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn-primary w-full" disabled={!canEdit || Boolean(pending)} name="outcome" type="submit" value="converted">
              {pending === 'converted' ? 'Marking won…' : 'Mark Won'}
            </button>
            <button className="w-full rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 disabled:opacity-50" disabled={!canEdit || Boolean(pending)} name="outcome" type="submit" value="lost">
              {pending === 'lost' ? 'Marking lost…' : 'Mark Lost'}
            </button>
          </div>
          {pending ? <p role="status" className="text-sm text-slate-600">{slow ? 'Still saving. Keep this page open; the lead will leave this list once confirmed.' : 'Saving outcome…'}</p> : null}
          {error ? <p ref={feedback} role="alert" tabIndex={-1} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error}</p> : null}
          {!canEdit ? <p className="text-xs font-semibold text-rose-700">No edit access</p> : null}
        </form>
      </div>
    </article>
  );
}

'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import ProspectingDialog from '@/components/prospecting-dialog';
import { useProspectingDraftNavigation } from '@/components/use-prospecting-draft-navigation';
import { SAMPLE_QUOTE_ITEMS, buildSampleQuoteEmail, validateSampleQuoteInput, type SampleQuoteLine } from '@/lib/prospecting-sample-quote';

export type SampleQuoteFormState = { error?: string; sentAt?: string; locked?: boolean };

type Props = {
  action: (previous: SampleQuoteFormState, formData: FormData) => Promise<SampleQuoteFormState>;
  orderId: string;
  contactName: string;
  contactEmail: string;
  senderName: string;
  senderEmail: string;
  initialTrackingNumber?: string;
  initialLines?: SampleQuoteLine[];
  canEdit: boolean;
  sentAt?: string | null;
  locked?: boolean;
  savedEmail?: { subject: string; html: string };
  backHref: string;
};

type QuoteDraft = { version: 1; trackingNumber: string; included: string[]; prices: Record<string, string>; uncertain: boolean };

function initialDraft(props: Props): QuoteDraft {
  return {
    version: 1,
    trackingNumber: props.initialTrackingNumber || '',
    included: props.initialLines?.map(line => line.id) ?? SAMPLE_QUOTE_ITEMS.map(item => item.id),
    prices: Object.fromEntries(SAMPLE_QUOTE_ITEMS.map(item => [item.id, ((props.initialLines?.find(line => line.id === item.id)?.priceCents ?? item.defaultPriceCents) / 100).toFixed(2)])),
    uncertain: Boolean(props.locked),
  };
}

function restoreDraft(raw: string | null): QuoteDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<QuoteDraft>;
    if (draft.version !== 1 || typeof draft.trackingNumber !== 'string' || draft.trackingNumber.length > 120 || !Array.isArray(draft.included) || !draft.prices || typeof draft.prices !== 'object' || typeof draft.uncertain !== 'boolean') return null;
    if (!draft.included.every(id => SAMPLE_QUOTE_ITEMS.some(item => item.id === id)) || !SAMPLE_QUOTE_ITEMS.every(item => typeof draft.prices?.[item.id] === 'string' && draft.prices[item.id].length <= 12)) return null;
    return draft as QuoteDraft;
  } catch { return null; }
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const categories = [...new Set(SAMPLE_QUOTE_ITEMS.map(item => item.category))];

export default function ProspectingSampleQuoteForm(props: Props) {
  const storageKey = `prospecting-sample-quote-v1:${props.orderId}`;
  const [draft, setDraft] = useState<QuoteDraft>(() => initialDraft(props));
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLElement>(null);
  const submitPendingRef = useRef(false);
  const sentAtRef = useRef(props.sentAt || '');
  const [result, action, pending] = useActionState(async (previous: SampleQuoteFormState): Promise<SampleQuoteFormState> => {
    if (sentAtRef.current) return { sentAt: sentAtRef.current, locked: true };
    const submitted = { ...draft, uncertain: true };
    setDraft(submitted);
    setDirty(true);
    try { sessionStorage.setItem(storageKey, JSON.stringify(submitted)); } catch { /* The current form retains the exact send attempt. */ }
    const formData = new FormData();
    formData.set('order_id', props.orderId);
    formData.set('tracking_number', submitted.trackingNumber);
    formData.set('lines', JSON.stringify(submitted.included.map(id => ({ id, priceCents: Math.round(Number(submitted.prices[id]) * 100) }))));
    let response: SampleQuoteFormState;
    try { response = await props.action(previous, formData); }
    catch { response = { error: 'The response was interrupted. Check this same email send to recover its status safely.', locked: true }; }
    if (response.sentAt) {
      sentAtRef.current = response.sentAt;
      setDirty(false);
      try { sessionStorage.removeItem(storageKey); } catch { /* Best-effort cleanup. */ }
    } else {
      const next = { ...submitted, uncertain: Boolean(response.locked) };
      setDraft(next);
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* The open form still retains the draft. */ }
    }
    submitPendingRef.current = false;
    return response;
  }, {});
  const sentAt = result.sentAt || props.sentAt;
  const locked = Boolean(props.locked || result.locked || draft.uncertain);
  const disabled = !ready || !props.canEdit || pending || locked || Boolean(sentAt);
  const navigation = useProspectingDraftNavigation(dirty && !sentAt, pending);
  const lines = draft.included.map(id => ({ id, priceCents: Math.round(Number(draft.prices[id]) * 100) }));
  const pricesValid = draft.included.every(id => /^\d+(?:\.\d{1,2})?$/.test(draft.prices[id]) && Number(draft.prices[id]) > 0 && Number(draft.prices[id]) <= 99999.99);
  const previewInput = validateSampleQuoteInput(draft.trackingNumber.trim() || 'Tracking number pending', lines);
  const preview = props.locked && props.savedEmail ? props.savedEmail : pricesValid && previewInput.ok ? buildSampleQuoteEmail({ contactName: props.contactName, senderName: props.senderName, trackingNumber: previewInput.trackingNumber, lines: previewInput.lines }) : null;

  useEffect(() => {
    try {
      if (props.sentAt) sessionStorage.removeItem(storageKey);
      else if (!props.locked) {
        const saved = restoreDraft(sessionStorage.getItem(storageKey));
        if (saved) { setDraft(saved); setDirty(true); setRestored(true); }
      }
    } catch { /* Browser storage is optional. */ }
    setReady(true);
  }, [storageKey, props.sentAt, props.locked]);
  useEffect(() => {
    if (!ready || !dirty || sentAt) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* The open form still retains the draft. */ }
  }, [draft, dirty, ready, sentAt, storageKey]);
  useEffect(() => { if (result.error) errorRef.current?.focus(); }, [result]);
  useEffect(() => { if (sentAt) successRef.current?.focus(); }, [sentAt]);

  function updateDraft(next: QuoteDraft) { setDraft(next); setDirty(true); }

  return <form action={action} onSubmit={event => { if (submitPendingRef.current || pending || !ready || !props.canEdit || sentAtRef.current) event.preventDefault(); else submitPendingRef.current = true; }} className="space-y-6" data-prospecting-record="true">
    <input type="hidden" name="order_id" value={props.orderId} />
    <input type="hidden" name="lines" value={JSON.stringify(lines)} />
    {sentAt ? <section ref={successRef} tabIndex={-1} role="status" className="card border-emerald-200 bg-emerald-50 text-emerald-950"><h2 className="text-lg font-semibold">Samples and pricing email sent</h2><p className="mt-2 text-sm">Sent from {props.senderEmail} to {props.contactEmail}. This order’s email is complete.</p><div className="mt-4 flex flex-wrap gap-3"><Link className="btn-primary" href={props.backHref}>Back to prospecting</Link><Link className="btn-secondary" href={`/admin/orders/${props.orderId}`}>View sample order</Link></div></section> : null}
    {restored && !sentAt ? <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900">Your tracking and pricing draft was restored.</p> : null}
    {result.error ? <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900">{result.error}</div> : null}
    {locked && !sentAt ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This email send has already started. Its tracking number and prices are kept unchanged so checking or retrying cannot send a different quote.</p> : null}
    <section className="card space-y-4">
      <div><h2 className="text-xl font-semibold">Sample tracking</h2><p className="mt-2 text-sm text-slate-600">Add the sample box tracking number, then choose the pricing to include in the customer’s email.</p></div>
      <label className="block text-sm font-semibold" htmlFor="sample-tracking-number">Tracking number</label>
      <input id="sample-tracking-number" className="input max-w-xl" name="tracking_number" value={draft.trackingNumber} onChange={event => updateDraft({ ...draft, trackingNumber: event.target.value })} maxLength={120} pattern={'[A-Za-z0-9][A-Za-z0-9 \\-]*'} title="Use letters, numbers, spaces, or hyphens." required disabled={disabled} autoComplete="off" spellCheck={false} placeholder="Enter the sample box tracking number" />
      {!sentAt ? <p className="text-sm text-slate-500">Waiting on tracking? You can return to this sample order’s tracking and pricing step later. Draft changes are kept in this browser tab.</p> : null}
    </section>
    <section className="card space-y-6">
      <div><h2 className="text-xl font-semibold">Customer pricing</h2><p className="mt-2 text-sm text-slate-600">Uncheck items to leave them out of the email. Edit any selected price for this customer’s quote.</p></div>
      {categories.map(category => <fieldset key={category} className="min-w-0 space-y-3" disabled={disabled}>
        <legend className="mb-3 text-lg font-semibold text-slate-950">{category}</legend>
        {SAMPLE_QUOTE_ITEMS.filter(item => item.category === category).map(item => {
          const included = draft.included.includes(item.id);
          const price = Number(draft.prices[item.id]);
          return <div key={item.id} className={`grid gap-3 rounded-xl border p-4 sm:grid-cols-[minmax(0,1fr)_10rem] ${included ? 'border-teal-200 bg-teal-50/40' : 'border-slate-200 bg-slate-50'}`}>
            <label className="flex cursor-pointer items-start gap-3"><input className="mt-1 h-4 w-4 shrink-0 accent-teal-700" type="checkbox" checked={included} onChange={event => updateDraft({ ...draft, included: event.target.checked ? SAMPLE_QUOTE_ITEMS.filter(candidate => candidate.id === item.id || draft.included.includes(candidate.id)).map(candidate => candidate.id) : draft.included.filter(id => id !== item.id) })} /><span><span className="block font-semibold text-slate-950">{item.description}</span><span className="mt-1 block text-sm text-slate-600">{item.packLabel}</span></span></label>
            <label className="block text-sm font-semibold">Quote price <span className="font-normal text-slate-500">($)</span><span className="sr-only"> for {item.description}, {item.packLabel}</span><input className="input mt-1" type="number" inputMode="decimal" min="0.01" max="99999.99" step="0.01" value={draft.prices[item.id]} required={included} disabled={disabled || !included} onChange={event => updateDraft({ ...draft, prices: { ...draft.prices, [item.id]: event.target.value } })} />{'pounds' in item && item.pounds && included && Number.isFinite(price) && price > 0 ? <span className="mt-1 block text-xs font-normal text-slate-600">{dollars(Math.round(price * 100 / item.pounds))}/lb</span> : null}</label>
          </div>;
        })}
      </fieldset>)}
      {!lines.length ? <p role="alert" className="text-sm text-rose-800">Select at least one item to include in the quote.</p> : null}
    </section>
    <section className="card space-y-4" aria-labelledby="sample-quote-preview">
      <h2 id="sample-quote-preview" className="text-xl font-semibold">Email preview</h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-[5rem_minmax(0,1fr)]"><dt className="font-semibold">From</dt><dd className="break-words">{props.senderName} &lt;{props.senderEmail}&gt;</dd><dt className="font-semibold">To</dt><dd className="break-words">{props.contactName} &lt;{props.contactEmail}&gt;</dd><dt className="font-semibold">Subject</dt><dd>{preview?.subject || 'Sobrew Coffee Samples, Pricing, and Ordering Process'}</dd></dl>
      {preview ? <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" dangerouslySetInnerHTML={{ __html: preview.html }} /> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Enter valid tracking details and at least one item price to preview your email.</p>}
    </section>
    {!sentAt ? <div className="flex flex-wrap items-center gap-3"><button className="btn-primary" type="submit" disabled={!ready || !props.canEdit || pending || !preview || !draft.trackingNumber.trim()} aria-busy={pending}>{pending ? 'Sending email…' : !props.canEdit ? 'Read-only access' : locked ? 'Check / retry email send' : 'Send samples & pricing email'}</button><Link className="btn-secondary" href={props.backHref}>Finish later</Link><p className="w-full text-sm text-slate-500">Sending emails the selected quote and tracking details directly to {props.contactEmail} from the lead owner’s email.</p></div> : null}
    <ProspectingDialog open={Boolean(navigation.destination)} title="Keep this email draft for later?" onClose={navigation.stay}>
      <p className="text-sm text-slate-600">Your tracking and pricing changes are saved in this browser tab. You can return through the sample order’s tracking and pricing link.</p>
      <div className="mt-5 flex flex-wrap gap-2"><button type="button" className="btn-primary" onClick={() => navigation.destination && navigation.navigate(navigation.destination)}>Keep draft and leave</button><button type="button" className="btn-secondary" onClick={navigation.stay}>Stay here</button>{!locked ? <button type="button" className="btn-secondary" onClick={() => { if (navigation.destination) { try { sessionStorage.removeItem(storageKey); } catch { /* Best-effort cleanup. */ } setDirty(false); navigation.navigate(navigation.destination); } }}>Discard draft and leave</button> : null}</div>
    </ProspectingDialog>
  </form>;
}

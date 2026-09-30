'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { US_STATE_OPTIONS } from '@/lib/prospecting';
import ProspectingDialog from '@/components/prospecting-dialog';
import { useProspectingDraftNavigation } from '@/components/use-prospecting-draft-navigation';
import { parseSampleOrderDraft, sampleOrderDraftFormData, sampleOrderDraftKey, type SampleOrderDraft, type SampleOrderFields } from '@/lib/prospecting-sample-draft';

export type SampleOrderFormState = { error?: string; code?: string; orderId?: string; successHref?: string };
export type { SampleOrderFields } from '@/lib/prospecting-sample-draft';
type Props = {
  action: (previous: SampleOrderFormState, data: FormData) => Promise<SampleOrderFormState>;
  initialValues: SampleOrderFields;
  submissionId: string;
  actorId: string;
  hiddenFields: Array<{ name: string; value: string }>;
  contacts: Array<{ id: string; full_name: string | null; email: string | null; eligible: boolean }>;
  products: Array<{ id: string; label: string }>;
  initialQuantities: Record<string, number>;
  canEdit: boolean;
  productsUnavailable?: boolean;
  linked: boolean;
  editLeadHref?: string;
  backHref: string;
};

export default function ProspectingSampleOrderForm(props: Props) {
  const storageKey = sampleOrderDraftKey(props.actorId, props.hiddenFields);
  const [draft, setDraft] = useState<SampleOrderDraft>({ values: props.initialValues, quantities: Object.fromEntries(props.products.map(product => [product.id, String(props.initialQuantities[product.id] ?? 0)])), submissionId: props.submissionId, hiddenFields: props.hiddenFields, uncertain: false });
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [dirty, setDirty] = useState(false);
  const leaveAfterSave = useRef<string | null>(null);
  const completedNavigation = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [result, action, pending] = useActionState(async (previous: SampleOrderFormState) => {
    const submitted = { ...draft, uncertain: true };
    setDraft(submitted); setDirty(true);
    try { sessionStorage.setItem(storageKey, JSON.stringify(submitted)); } catch { /* Storage may be unavailable. The open form retains its exact attempt. */ }
    let response: SampleOrderFormState;
    try { response = await props.action(previous, sampleOrderDraftFormData(submitted)); }
    catch { response = { code: 'connection_error', error: 'The response was interrupted. Retry this same submission to check whether the order was created.' }; }
    if (response.orderId) {
      try { sessionStorage.removeItem(storageKey); } catch { /* Best-effort browser storage cleanup. */ }
      setDirty(false);
    } else {
      leaveAfterSave.current = null;
      const next = { ...submitted, uncertain: response.code === 'connection_error' };
      setDraft(next);
      try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the open draft available. */ }
    }
    return response;
  }, {});
  const navigation = useProspectingDraftNavigation(dirty && !result.orderId, pending);
  const errorRef = useRef<HTMLDivElement>(null);
  const { values, quantities, submissionId, uncertain } = draft;
  const disabled = !recoveryReady || !props.canEdit || pending || uncertain || Boolean(result.orderId);
  const displayedProducts = [...props.products, ...Object.keys(quantities).filter(id => !props.products.some(product => product.id === id)).map(id => ({ id, label: 'Previously selected sample box (currently unavailable)' }))];
  const cannotSubmit = !recoveryReady || pending || !props.canEdit || (!uncertain && (props.productsUnavailable || !props.products.length || (props.linked && !values.contact_id)));
  useEffect(() => {
    try {
      const saved = parseSampleOrderDraft(sessionStorage.getItem(storageKey));
      if (saved && sampleOrderDraftKey(props.actorId, saved.hiddenFields) === storageKey) { setDraft(saved); setDirty(true); setRestored(true); }
    } catch { /* The form works when browser storage is unavailable. */ }
    setRecoveryReady(true);
  }, [storageKey, props.actorId]);
  useEffect(() => {
    if (!recoveryReady || !dirty || result.orderId) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* Keep the open draft available. */ }
  }, [draft, dirty, recoveryReady, result.orderId, storageKey]);
  useEffect(() => { if (result.error) errorRef.current?.focus(); }, [result]);
  useEffect(() => {
    if (!result.orderId || completedNavigation.current) return;
    if (props.linked) {
      completedNavigation.current = true;
      const backHref = leaveAfterSave.current || result.successHref || props.backHref;
      leaveAfterSave.current = null;
      navigation.navigate(`/admin/sales/prospecting/sample-order/${result.orderId}/quote?back=${encodeURIComponent(backHref)}`);
    } else if (leaveAfterSave.current) {
      completedNavigation.current = true;
      const destination = leaveAfterSave.current;
      leaveAfterSave.current = null;
      navigation.navigate(destination);
    }
  }, [result.orderId, result.successHref, props.linked, props.backHref, navigation]);

  function change(name: keyof SampleOrderFields, value: string) {
    setDraft(previous => ({ ...previous, values: { ...previous.values, [name]: value }, ...(result.error && !uncertain ? { submissionId: crypto.randomUUID() } : {}) }));
    setDirty(true);
  }
  const quantityTotal = Object.values(quantities).reduce((total, value) => total + (Number(value) || 0), 0);
  if (result.orderId) return (
    <section className="card space-y-4" role="status">
      <h2 className="text-xl font-semibold">Sample order created</h2>
      <p className="text-slate-600">{props.linked ? 'The shipment is ready for production. The request and its order were saved together.' : 'The standalone sample shipment is ready for production.'}</p>
      <div className="flex flex-wrap gap-3">
        {props.linked ? <Link className="btn-primary" href={`/admin/sales/prospecting/sample-order/${result.orderId}/quote?back=${encodeURIComponent(result.successHref || props.backHref)}`}>Continue to tracking &amp; pricing</Link> : null}
        <Link className={props.linked ? 'btn-secondary' : 'btn-primary'} href={`/admin/orders/${result.orderId}`}>View sample order</Link>
        <Link className="btn-secondary" href={result.successHref || props.backHref}>{props.linked ? 'Continue prospecting' : 'Back to prospecting'}</Link>
      </div>
    </section>
  );
  return (
    <form ref={formRef} action={action} className="card space-y-6" data-prospecting-record="true">
      {draft.hiddenFields.map(field => <input key={field.name} type="hidden" name={field.name} value={field.value} />)}
      <input type="hidden" name="submission_id" value={submissionId} />
      {restored ? <p role="status" className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900">Your sample draft was restored with its original record version.{uncertain ? ' Its last attempt may have completed. Retry this same submission to safely recover the result.' : ''}</p> : null}
      {result.error ? <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900"><p className="font-semibold">{result.error}</p>{uncertain ? <p className="mt-2 text-sm">Keep this form open and retry. This submission can create only one order.</p> : null}{result.code === 'record_stale' ? <button type="button" className="btn-secondary mt-3" onClick={() => { try { sessionStorage.removeItem(storageKey); } catch { /* Best-effort cleanup. */ } navigation.bypass.current = true; window.location.reload(); }}>Discard draft and reload current record</button> : null}</div> : null}
      {props.linked ? <section className="space-y-3">
        <h2 className="text-lg font-semibold">1. Sample contact</h2>
        <label className="block text-sm font-semibold">Contact for this request
          <select className="input mt-2" name="contact_id" value={values.contact_id} onChange={event => change('contact_id', event.target.value)} disabled={disabled} required>
            <option value="">Choose a contact</option>
            {props.contacts.map(contact => <option key={contact.id} value={contact.id} disabled={!contact.eligible}>{contact.full_name || 'Unnamed contact'} · {contact.email || 'Email needed'}</option>)}
          </select>
        </label>
        <p className="text-sm text-slate-600">The contact needs a name and valid email.{props.editLeadHref ? <> <Link className="font-semibold text-teal-800 underline" href={props.editLeadHref}>Edit lead contacts</Link></> : null}</p>
      </section> : null}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">{props.linked ? '2. ' : ''}Shipping details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {([
            ['center_name', 'Company / center', true], ['attention_name', 'Attention name', true],
            ['address1', 'Address', true], ['address2', 'Address line 2', false], ['city', 'City', true],
          ] as const).map(([name, label, required]) => <label className="text-sm font-semibold" key={name}>{label}<input className="input mt-2" name={name} value={values[name]} required={required} disabled={disabled} onChange={event => change(name, event.target.value)} /></label>)}
          <label className="text-sm font-semibold">State<select className="input mt-2" name="state" value={values.state} onChange={event => change('state', event.target.value)} required disabled={disabled}><option value="">Select state</option>{US_STATE_OPTIONS.map(state => <option key={state.id} value={state.id}>{state.label}</option>)}</select></label>
          <label className="text-sm font-semibold">ZIP code<input className="input mt-2" name="zip" value={values.zip} required disabled={disabled} onChange={event => change('zip', event.target.value)} /></label>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{props.linked ? '3. ' : ''}Sample boxes</h2>
        {!displayedProducts.length ? <p className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">No sample boxes are available. An administrator needs to add an active sample box with a saved recipe.</p> : displayedProducts.map(product => <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 rounded-lg border border-slate-200 p-3" key={product.id}>
          <p className="font-semibold">{product.label}</p>
          <label className="text-sm font-semibold">Quantity<span className="sr-only"> for {product.label}</span>
            <input type="hidden" name="product_id" value={product.id} />
            <input className="input mt-1" type="number" inputMode="numeric" name="quantity" min="0" max="9999" step="1" value={quantities[product.id] ?? '0'} disabled={disabled} onChange={event => { const value = event.target.value; setDraft(previous => ({ ...previous, quantities: { ...previous.quantities, [product.id]: value }, ...(result.error && !uncertain ? { submissionId: crypto.randomUUID() } : {}) })); setDirty(true); }} />
          </label>
        </div>)}
      </section>
      <label className="block text-sm font-semibold">Delivery notes and preferences<textarea className="input mt-2 min-h-24" name="notes" maxLength={5000} value={values.notes} disabled={disabled} onChange={event => change('notes', event.target.value)} /></label>
      <div className="rounded-lg bg-slate-50 p-4 text-sm"><p className="font-semibold">{quantityTotal} sample {quantityTotal === 1 ? 'box' : 'boxes'} · $0.00</p><p className="mt-1 text-slate-600">Submitting creates a production order for the address above.</p></div>
      <button className="btn-primary w-full sm:w-auto" type="submit" disabled={cannotSubmit} aria-busy={pending}>{pending ? 'Creating order…' : !props.canEdit ? 'Read-only access' : uncertain ? 'Retry this submission' : props.linked ? 'Save order & continue' : 'Create sample order'}</button>
      <ProspectingDialog open={Boolean(navigation.destination)} title="Leave this sample draft?" onClose={navigation.stay}>
        <p className="text-sm text-slate-600">{uncertain ? 'The last response was interrupted. Retry this submission before starting another sample order to avoid creating a second request.' : 'The shipping details and quantities you entered have not been submitted.'}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {props.canEdit ? <button type="button" className="btn-primary" disabled={cannotSubmit} onClick={() => { if (formRef.current?.reportValidity()) { leaveAfterSave.current = navigation.destination; navigation.stay(); formRef.current.requestSubmit(); } }}>{uncertain ? 'Retry and leave' : 'Submit and leave'}</button> : null}
          <button type="button" className="btn-secondary" onClick={() => { if (navigation.destination) { try { sessionStorage.removeItem(storageKey); } catch { /* Best-effort cleanup. */ } setDirty(false); navigation.navigate(navigation.destination); } }}>Discard and leave</button>
          <button type="button" className="btn-secondary" onClick={navigation.stay}>Stay here</button>
        </div>
      </ProspectingDialog>
    </form>
  );
}

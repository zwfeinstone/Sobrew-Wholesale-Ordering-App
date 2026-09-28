'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CALL_RESULTS, EMAIL_RESULTS, PROSPECTING_PRIORITIES, PROSPECTING_STAGES, formatDate, formatDateTime, resolveActivityStage, stageLabel, type ProspectingStage } from '@/lib/prospecting';
import { initialRecordDraft, validFollowUpDate, type EditableContact, type RecordActionResult, type RecordContact, type RecordDraft, type RecordLead, type RecordSampleDraft, type RecordSaveInput, type RecordTextField } from '@/lib/prospecting-record';
import ProspectingDialog from '@/components/prospecting-dialog';
import { useProspectingDraftNavigation } from '@/components/use-prospecting-draft-navigation';

type Product = { id: string; name: string | null; sku: string | null };
type Props = {
  lead: RecordLead; contacts: RecordContact[]; actorId: string; canEdit: boolean; isOwner: boolean;
  salesReps: { id: string; full_name: string | null; email: string | null }[];
  products: Product[]; productsError: boolean; contactsError: boolean; today: string;
  queueParams: string; backHref: string; previousHref?: string; nextHref?: string;
  action: (input: RecordSaveInput) => Promise<RecordActionResult>;
  history: ReactNode; source: ReactNode;
  initialSampleOpen?: boolean; fresh?: boolean; navigationUnavailable?: boolean;
  previousSampleOrders?: { id: string; created_at: string | null; status: string | null }[]; sampleHistoryError?: boolean;
};

function TextField({ label, value, onChange, name, type = 'text', required = false, disabled = false, error }: { label: string; value: string; onChange: (value: string) => void; name: string; type?: string; required?: boolean; disabled?: boolean; error?: string }) {
  return <label className="block min-w-0 text-sm font-medium text-slate-700">{label}<input className="input mt-1 w-full" name={name} type={type} value={value} required={required} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${name}-error` : undefined} />{error ? <span id={`${name}-error`} className="mt-1 block text-sm text-rose-700">{error}</span> : null}</label>;
}

function ContactFields({ contact, onChange, prefix }: { contact: EditableContact; onChange: (contact: EditableContact) => void; prefix: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">{(['full_name', 'title', 'email', 'phone'] as const).map((field) => <TextField key={field} name={`${prefix}_${field}`} label={field === 'full_name' ? 'Contact name' : field === 'title' ? 'Job title' : field === 'email' ? 'Contact email' : 'Contact phone'} type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} value={contact[field]} onChange={(value) => onChange({ ...contact, [field]: value })} />)}<label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={contact.is_primary} onChange={(event) => onChange({ ...contact, is_primary: event.target.checked })} />Primary contact</label><label className="text-sm font-medium text-slate-700 sm:col-span-2">Contact notes<textarea className="input mt-1 min-h-20" value={contact.notes} onChange={(event) => onChange({ ...contact, notes: event.target.value })} /></label></div>;
}

function initialSample(lead: RecordLead, contacts: RecordContact[], products: Product[]): RecordSampleDraft {
  const contact = contacts.find((item) => item.is_primary && item.full_name && item.email) || contacts.find((item) => item.full_name && item.email);
  return { mode: 'order', contactId: contact?.id || 'new', centerName: lead.company_name || '', attentionName: contact?.full_name || '', address1: lead.address_line_1 || '', address2: lead.address_line_2 || '', city: lead.city || '', state: lead.state || '', zip: lead.postal_code || '', notes: '', items: products.map(({ id }) => ({ productId: id, quantity: 0 })) };
}

export default function ProspectingRecordEditor(props: Props) {
  const { lead, contacts, actorId, canEdit, isOwner, salesReps, products, productsError, contactsError, today, queueParams, backHref, previousHref, nextHref, action, history, source } = props;
  const router = useRouter();
  const [draft, setDraft] = useState(() => { const initial = initialRecordDraft(lead, contacts); if (props.initialSampleOpen && canEdit) initial.lead.stage = 'sample_requested'; return initial; });
  const [activityTab, setActivityTab] = useState<RecordDraft['activity']['type']>('call');
  const [sample, setSampleValue] = useState(() => initialSample(lead, contacts, products));
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(lead.updated_at);
  const [submissionId, setSubmissionId] = useState('');
  const [pending, setPending] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<Extract<RecordActionResult, { ok: false }>['error'] | null>(null);
  const [message, setMessage] = useState('');
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  const [sampleOpen, setSampleOpen] = useState(Boolean(props.initialSampleOpen && canEdit));
  const [step, setStep] = useState(0);
  const [sampleError, setSampleError] = useState('');
  const [receipt, setReceipt] = useState<Extract<RecordActionResult, { ok: true }> | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const baseline = useRef(JSON.stringify(initialRecordDraft(lead, contacts)));
  const sampleBaseline = useRef(JSON.stringify(initialSample(lead, contacts, products)));
  const dirty = !committed && (JSON.stringify(draft) !== baseline.current || JSON.stringify(sample) !== sampleBaseline.current);
  const navigation = useProspectingDraftNavigation(dirty, pending);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const storageKey = `prospecting-draft-v2:${actorId}:${lead.id}`;
  const runKey = `prospecting-run-v2:${actorId}:${queueParams}`;
  const retryPayload = useRef<RecordSaveInput | null>(null);
  const sampleSaveDestination = useRef<string | undefined>(undefined);
  const sampleAdvance = useRef(false);

  useEffect(() => {
    let id = crypto.randomUUID();
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (!props.fresh && stored?.draft?.lead && stored.draft.contacts && stored.updatedAt && Date.now() - stored.savedAt < 24 * 60 * 60 * 1000) {
        setActivityTab(['none', 'call', 'email', 'note'].includes(stored.activityTab) ? stored.activityTab : stored.draft.activity.type);
        setDraft(stored.draft); setSample(stored.sample || initialSample(lead, contacts, products)); setExpectedUpdatedAt(stored.updatedAt); setRestored(true);
        if (typeof stored.submissionId === 'string') id = stored.submissionId;
        if (stored.retryPayload?.leadId === lead.id && stored.retryPayload.submissionId === id) retryPayload.current = stored.retryPayload;
        if (stored.updatedAt !== lead.updated_at) setError({ code: 'record_stale', message: 'The saved record changed since this draft. Your draft has been restored for review.', fieldErrors: {} });
      }
    } catch { /* Storage is optional; in-memory editing continues. */ }
    setSubmissionId(id); setReady(true);
    // The parent keys this editor by record identity and version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ draft, sample, activityTab, updatedAt: expectedUpdatedAt, submissionId, retryPayload: retryPayload.current, savedAt: Date.now() }));
      else sessionStorage.removeItem(storageKey);
    } catch { /* Keep editing if browser storage is unavailable. */ }
  }, [draft, sample, activityTab, dirty, ready, storageKey, expectedUpdatedAt, submissionId]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function updateDraft(next: RecordDraft) {
    setDraft(next); setMessage('');
    if (retryPayload.current) { retryPayload.current = null; setSubmissionId(crypto.randomUUID()); }
  }
  function setSample(next: RecordSampleDraft) {
    setSampleValue(next);
    if (retryPayload.current) { retryPayload.current = null; setSubmissionId(crypto.randomUUID()); }
  }
  function editLead(field: RecordTextField, value: string) { updateDraft({ ...draft, lead: { ...draft.lead, [field]: value } }); }
  function setFollowUpDate(date: string) {
    const mode = date === (lead.next_follow_up_at || '') ? 'keep' : date ? 'reschedule' : 'clear';
    updateDraft({ ...draft, followUp: { mode, date } });
  }
  function editContact(index: number, contact: EditableContact) {
    updateDraft({ ...draft, contacts: draft.contacts.map((item, i) => i === index ? contact : contact.is_primary ? { ...item, is_primary: false } : item), newContact: contact.is_primary ? { ...draft.newContact, is_primary: false } : draft.newContact });
  }
  function editNewContact(contact: EditableContact) { updateDraft({ ...draft, newContact: contact, contacts: contact.is_primary ? draft.contacts.map((item) => ({ ...item, is_primary: false })) : draft.contacts }); }
  function setChannel(type: RecordDraft['activity']['type']) {
    if (type === activityTab) return;
    setActivityTab(type);
    const inferred = resolveActivityStage({ currentStage: lead.stage, result: draft.activity.result });
    updateDraft({ ...draft, lead: { ...draft.lead, stage: draft.activity.result && draft.lead.stage === inferred ? (lead.stage || 'new') as ProspectingStage : draft.lead.stage }, activity: { ...draft.activity, type, result: '', contactId: type === 'none' ? '' : draft.activity.contactId, body: type === 'none' ? '' : draft.activity.body } });
  }
  function startSample() { updateDraft({ ...draft, lead: { ...draft.lead, stage: 'sample_requested' } }); sampleSaveDestination.current = undefined; sampleAdvance.current = false; setStep(0); setSampleError(''); setSampleOpen(true); }
  function clearStoredDraft() { try { sessionStorage.removeItem(storageKey); } catch { /* optional */ } }
  function discardAndNavigate(href: string) {
    const clean = initialRecordDraft(lead, contacts);
    const cleanSample = initialSample(lead, contacts, products);
    retryPayload.current = null;
    baseline.current = JSON.stringify(clean); sampleBaseline.current = JSON.stringify(cleanSample);
    setDraft(clean); setActivityTab('call'); setSampleValue(cleanSample); setError(null); setRestored(false);
    clearStoredDraft(); navigation.navigate(href);
  }
  function revealMissingDetails() {
    const container = formRef.current;
    if (!container) return;
    const incompleteContact = container.querySelector<HTMLDetailsElement>('#prospect-contacts details');
    const company = container.querySelector<HTMLDetailsElement>('#prospect-company');
    const needsContact = !bestContact?.full_name || !bestContact?.email;
    const target = needsContact ? incompleteContact : company;
    if (target) { target.open = true; target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }); }
  }
  function storedVisited() { try { const stored = JSON.parse(sessionStorage.getItem(runKey) || '[]'); return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []; } catch { return []; } }

  async function save(advance = false, destination?: string, sampleConfirmed = false) {
    if (pending || committed || !canEdit || contactsError) return;
    if (!formRef.current?.reportValidity()) return;
    if (!['recycle_try_later', 'lost', 'not_a_fit'].includes(draft.lead.stage) && draft.followUp.mode === 'reschedule' && !validFollowUpDate(draft.followUp.date)) { setError({ code: 'validation', message: 'Choose a valid follow-up date.', fieldErrors: { follow_up: 'Choose a valid date.' } }); return; }
    if (draft.lead.stage === 'sample_requested' && !sampleConfirmed && lead.stage !== 'sample_requested') { sampleSaveDestination.current = destination; sampleAdvance.current = advance; setStep(0); setSampleOpen(true); return; }
    setPending(true); setError(null); setMessage('');
    const input: RecordSaveInput = retryPayload.current || { leadId: lead.id, expectedUpdatedAt, submissionId, draft, sample: sampleConfirmed ? sample : undefined, queueParams, visitedIds: storedVisited() };
    retryPayload.current = input;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, sample, activityTab, updatedAt: expectedUpdatedAt, submissionId, retryPayload: input, savedAt: Date.now() })); } catch { /* In-memory retry remains available. */ }
    try {
      const result = await action(input);
      if (!result.ok) { setError(result.error); if (sampleConfirmed) { setSampleError(result.error.message); } return; }
      retryPayload.current = null; clearStoredDraft(); baseline.current = JSON.stringify(draft); sampleBaseline.current = JSON.stringify(sample); setExpectedUpdatedAt(result.receipt.updatedAt); setSampleOpen(false); setCommitted(true); navigation.bypass.current = true;
      try { sessionStorage.setItem(runKey, JSON.stringify([...new Set([...storedVisited(), lead.id])].slice(-5000))); } catch { /* optional */ }
      if (result.receipt.requestId || result.receipt.orderId || result.handedOff) { setReceipt(result); return; }
      if (destination || advance) { navigation.navigate(destination || result.nextHref || backHref); return; }
      setMessage('Saved.'); setSubmissionId(crypto.randomUUID()); router.refresh();
    } catch { setError({ code: 'connection_error', message: 'The response was interrupted. Your draft is here. Retry without changing it to check whether it was saved.', fieldErrors: {} }); }
    finally { setPending(false); }
  }

  const selectedSampleContact = sample.contactId === 'new' ? draft.newContact : draft.contacts.find(({ id }) => id === sample.contactId);
  function nextSampleStep() {
    setSampleError('');
    if (step === 0 && (!selectedSampleContact?.full_name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(selectedSampleContact.email.trim()) || draft.deletedContactIds.includes(selectedSampleContact.id))) { setSampleError('Enter a name and valid email on the selected contact.'); return; }
    if (step === 1 && sample.mode === 'order') {
      if (props.sampleHistoryError) { setSampleError('Shipment history could not be checked. Reload before ordering, or request manager fulfillment.'); return; }
      if (![sample.centerName, sample.attentionName, sample.address1, sample.city, sample.state, sample.zip].every((value) => value.trim())) { setSampleError('Complete the company, attention name, and shipping address.'); return; }
      if (productsError || !sample.items.some(({ quantity }) => Number(quantity) > 0) || sample.items.some(({ quantity }) => !Number.isInteger(Number(quantity)) || Number(quantity) < 0)) { setSampleError('Choose at least one available sample box with a whole-number quantity.'); return; }
    }
    if (step === 0 && selectedSampleContact && !sample.attentionName) setSample({ ...sample, attentionName: selectedSampleContact.full_name });
    setStep((value) => value + 1);
  }
  const channelResults = activityTab === 'call' ? CALL_RESULTS : EMAIL_RESULTS;
  const bestContact = draft.contacts.find((contact) => contact.is_primary && !draft.deletedContactIds.includes(contact.id)) || draft.contacts.find((contact) => !draft.deletedContactIds.includes(contact.id));
  const phone = bestContact?.phone || draft.lead.phone;
  const email = bestContact?.email || draft.lead.company_email;
  const missingDetails = !draft.lead.phone || !draft.lead.address_line_1 || !bestContact?.full_name || !bestContact?.email;
  const parked = ['recycle_try_later', 'lost', 'not_a_fit'].includes(draft.lead.stage);
  const followUpDate = parked || draft.followUp.mode === 'clear' ? '' : draft.followUp.mode === 'keep' ? lead.next_follow_up_at || '' : draft.followUp.date;

  return <div className="min-w-0 space-y-4" data-testid="prospecting-record-editor">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><Link href={backHref} className="font-semibold text-teal-800">← Back to {queueParams.includes('origin=') && !queueParams.includes('origin=rep') ? 'workspace' : 'queue'}</Link><div className="flex gap-3">{previousHref ? <Link href={previousHref} scroll={false} className="font-semibold text-teal-800">Previous</Link> : <span className="text-slate-400">Previous</span>}{nextHref ? <Link href={nextHref} scroll={false} className="font-semibold text-teal-800">Next</Link> : <span className="text-slate-400">{props.navigationUnavailable ? 'Navigation unavailable' : 'End of queue'}</span>}</div></div>
    {props.navigationUnavailable ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Queue navigation could not be loaded. Your record remains available; use Back to queue to retry.</p> : null}
    {restored ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Your unsaved draft was restored in this browser tab.</p> : null}
    {!canEdit ? <p className="rounded-lg bg-slate-100 p-3 text-sm">You have read-only access to this record.</p> : null}
    {contactsError ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Contacts could not be loaded. Reload this record before editing to avoid losing contact information.</p> : null}
    {error ? <div ref={errorRef} tabIndex={-1} role="alert" className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><p className="font-semibold">{error.message}</p>{Object.entries(error.fieldErrors).map(([field, value]) => <p key={field}>{value}</p>)}{error.code === 'record_stale' ? <button type="button" className="underline" onClick={() => setConflictOpen(true)}>Review saved record and draft</button> : null}</div> : null}
    {message ? <p role="status" className="text-sm font-semibold text-teal-800">{message}</p> : null}
    <form ref={formRef} data-prospecting-record="true" onInvalidCapture={(event) => { if (event.target instanceof HTMLElement) { let container = event.target.closest('details'); while (container) { container.open = true; container = container.parentElement?.closest('details') || null; } event.target.focus(); } }} onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Prospect</p><h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-slate-950">{draft.lead.company_name || 'Unnamed prospect'}</h1><p className="mt-1 text-sm text-slate-600">{[draft.lead.city, draft.lead.state].filter(Boolean).join(', ') || 'Location not recorded'} · {stageLabel(draft.lead.stage)}</p></div>{missingDetails ? <button type="button" onClick={revealMissingDetails} className="rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">Needs details</button> : null}</div><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm"><span className="font-semibold">{bestContact?.full_name || 'Company contact'}</span>{phone ? <a className="break-all text-teal-800 underline" href={`tel:${phone}`}>{phone}</a> : <span className="text-slate-500">No phone recorded</span>}{email ? <a className="break-all text-teal-800 underline" href={`mailto:${email}`}>{email}</a> : <span className="text-slate-500">No email recorded</span>}</div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600"><span>Follow-up: <strong>{formatDate(lead.next_follow_up_at)}</strong></span><span>Priority: <strong className="capitalize">{draft.lead.priority}</strong></span><span>Last result: {lead.last_result || 'None recorded'}</span>{lead.hubspot_status && lead.hubspot_status !== 'not_queued' ? <span>HubSpot: {lead.hubspot_status.replaceAll('_', ' ')}</span> : null}</div>{draft.lead.do_not_contact ? <p className="mt-3 font-semibold text-rose-800">Do Not Contact</p> : null}</header>
      <fieldset disabled={!canEdit || contactsError || pending || committed || Boolean(receipt)} className="min-w-0 space-y-4">
        <section className="rounded-xl border border-teal-200 bg-white p-4 sm:p-5" aria-labelledby="outreach-title"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="outreach-title" className="font-semibold text-slate-950">Outreach & next step</h2><button type="button" className="text-sm font-semibold text-teal-800 underline" onClick={startSample}>Request samples</button></div><div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Activity to record">{([['none', 'Edit only'], ['call', 'Log call'], ['email', 'Log email'], ['note', 'Add note']] as const).map(([type, label]) => <button type="button" key={type} aria-pressed={activityTab === type} className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${activityTab === type ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-200 text-slate-700'}`} onClick={() => setChannel(type)}>{label}</button>)}</div>
          {activityTab !== 'none' ? <div className="mb-4 space-y-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Contact<select className="input mt-1" value={draft.activity.contactId} onChange={(event) => updateDraft({ ...draft, activity: { ...draft.activity, type: activityTab, contactId: event.target.value } })}><option value="">Company level</option>{draft.contacts.filter(({ id }) => !draft.deletedContactIds.includes(id)).map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name || contact.email || 'Unnamed contact'}</option>)}</select></label>{activityTab !== 'note' ? <label className="text-sm font-medium text-slate-700">Outcome<select className="input mt-1" value={draft.activity.result} onChange={(event) => { const result = event.target.value; updateDraft({ ...draft, activity: { ...draft.activity, type: activityTab, result }, lead: { ...draft.lead, stage: resolveActivityStage({ currentStage: lead.stage, result }) } }); }}><option value="">No outcome recorded</option>{channelResults.map((result) => <option key={result} value={result}>{result}</option>)}</select></label> : null}</div><label className="block text-sm font-medium text-slate-700">{activityTab === 'note' ? 'Note' : 'What happened?'}<textarea className="input mt-1 min-h-24" name="activity_body" required={activityTab === 'note'} value={draft.activity.body} onChange={(event) => updateDraft({ ...draft, activity: { ...draft.activity, type: activityTab, body: event.target.value } })} placeholder="Conversation, useful context, and what happens next" /></label></div> : <p className="mb-4 text-sm text-slate-500">Save company or contact edits without recording an outreach activity.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Stage after saving<select className="input mt-1" value={draft.lead.stage} onChange={(event) => updateDraft({ ...draft, lead: { ...draft.lead, stage: event.target.value as ProspectingStage } })}>{PROSPECTING_STAGES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
            <div className="min-w-0 space-y-2">
              <TextField name="follow_up" label="Follow-up date" type="date" disabled={parked} required={!parked && draft.followUp.mode === 'reschedule'} value={followUpDate} error={error?.fieldErrors.follow_up} onChange={setFollowUpDate} />
              <div className="flex flex-wrap gap-2">
                {([[0, 'Today'], [1, 'Tomorrow'], [7, 'In one week']] as const).map(([offset, label]) => <button type="button" key={label} disabled={parked} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold disabled:opacity-50" onClick={() => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); setFollowUpDate(date.toISOString().slice(0, 10)); }}>{label}</button>)}
                <button type="button" disabled={parked || !followUpDate} className="min-h-9 px-2 text-xs font-semibold text-slate-600 underline disabled:opacity-50" onClick={() => setFollowUpDate('')}>Clear follow-up</button>
              </div>
            </div>
          </div>
          {parked ? <p className="mt-3 text-sm text-amber-900">Saving removes this lead from the assigned queue and clears its follow-up.</p> : draft.followUp.mode === 'keep' && lead.next_follow_up_at && lead.next_follow_up_at <= today ? <p className="mt-3 text-xs text-slate-600">Keeping this date leaves the follow-up due. Save and next moves you forward without completing it.</p> : null}
          {draft.activity.result ? <p className="mt-3 text-xs text-slate-600">{draft.activity.result} → {stageLabel(resolveActivityStage({ currentStage: draft.lead.stage, explicitStage: draft.lead.stage, result: draft.activity.result }))}</p> : null}
        </section>
        {history}
        <section id="prospect-contacts" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="font-semibold text-slate-950">Contacts</h2><p className="mt-1 text-xs text-slate-500">Samples require a name and valid email on the same contact.</p><div className="mt-3 space-y-3">{draft.contacts.map((contact, index) => draft.deletedContactIds.includes(contact.id) ? <div key={contact.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-rose-50 p-3 text-sm"><span>{contact.full_name || 'Contact'} will be removed when you save.</span><button type="button" className="font-semibold underline" onClick={() => updateDraft({ ...draft, deletedContactIds: draft.deletedContactIds.filter((id) => id !== contact.id) })}>Undo removal</button></div> : <details key={contact.id} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold">{contact.full_name || contact.email || 'Unnamed contact'}{contact.is_primary ? ' · Primary' : ''}<span className="ml-2 font-normal text-slate-500">Edit details</span></summary><div className="mt-3"><ContactFields contact={contact} prefix={`contact_${contact.id}`} onChange={(next) => editContact(index, next)} /><button className="mt-3 min-h-9 text-sm font-semibold text-rose-700 underline" type="button" onClick={() => updateDraft({ ...draft, deletedContactIds: [...draft.deletedContactIds, contact.id], activity: draft.activity.contactId === contact.id ? { ...draft.activity, contactId: '' } : draft.activity })}>Remove contact</button></div></details>)}{!draft.contacts.length ? <p className="text-sm text-slate-500">No contacts recorded yet.</p> : null}<details className="rounded-lg border border-dashed border-slate-300 p-3"><summary className="cursor-pointer text-sm font-semibold text-teal-800">Add contact</summary><div className="mt-3"><ContactFields contact={draft.newContact} prefix="new_contact" onChange={editNewContact} /></div></details></div></section>
        <details id="prospect-company" className="scroll-mt-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><summary className="cursor-pointer font-semibold text-slate-950">Company details & ownership</summary><div className="mt-4 grid gap-3 sm:grid-cols-2">{([['company_name', 'Company name'], ['phone', 'Company phone'], ['company_email', 'Company email'], ['company_website', 'Website'], ['address_line_1', 'Address 1'], ['address_line_2', 'Address 2'], ['city', 'City'], ['state', 'State'], ['postal_code', 'ZIP / postal code'], ['country', 'Country']] as const).map(([field, label]) => <TextField key={field} label={label} name={field} type={field === 'company_email' ? 'email' : field === 'phone' ? 'tel' : 'text'} required={field === 'company_name'} value={draft.lead[field]} onChange={(value) => editLead(field, value)} error={error?.fieldErrors[field]} />)}<label className="text-sm font-medium text-slate-700">Priority<select className="input mt-1" value={draft.lead.priority} onChange={(event) => updateDraft({ ...draft, lead: { ...draft.lead, priority: event.target.value } })}>{PROSPECTING_PRIORITIES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>{isOwner ? <label className="text-sm font-medium text-slate-700">Assigned rep<select className="input mt-1" value={draft.lead.assigned_profile_id} onChange={(event) => updateDraft({ ...draft, lead: { ...draft.lead, assigned_profile_id: event.target.value } })}><option value="">Unassigned</option>{salesReps.map((rep) => <option value={rep.id} key={rep.id}>{rep.full_name || rep.email}</option>)}</select></label> : null}<label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={draft.lead.do_not_contact} onChange={(event) => updateDraft({ ...draft, lead: { ...draft.lead, do_not_contact: event.target.checked, stage: event.target.checked ? 'not_a_fit' : draft.lead.stage } })} />Do Not Contact</label></div></details>
        <details className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><summary className="cursor-pointer font-semibold text-slate-950">Internal notes & source</summary><div className="mt-3 space-y-3">{source}<label className="block text-sm font-medium text-slate-700">Internal lead notes<textarea className="input mt-1 min-h-36" value={draft.lead.notes} onChange={(event) => editLead('notes', event.target.value)} /></label></div></details>
      </fieldset>
      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-lg"><p className="text-xs text-slate-600">{pending ? 'Saving…' : dirty ? `${draft.activity.type === 'none' ? 'Record edits' : draft.activity.type === 'note' ? 'Note' : draft.activity.type === 'call' ? 'Call' : 'Email'} and all edited record fields will be saved together.` : 'No unsaved changes'}</p><div className="flex w-full gap-2 sm:w-auto"><button type="submit" className="btn-secondary flex-1 justify-center" disabled={!canEdit || !ready || contactsError || pending || committed || Boolean(receipt) || !dirty}>Save</button><button type="button" className="btn-primary flex-1 justify-center whitespace-nowrap" disabled={!canEdit || !ready || contactsError || pending || committed || Boolean(receipt) || !dirty} onClick={() => void save(true)}>Save and next</button></div></footer>
    </form>
    <ProspectingDialog open={Boolean(navigation.destination)} title="Save your changes?" onClose={navigation.stay}><p className="text-sm text-slate-600">Your record edits and pending activity have not been saved.</p><div className="mt-5 flex flex-wrap gap-2"><button type="button" className="btn-secondary" onClick={navigation.stay}>Stay here</button><button type="button" className="btn-secondary" onClick={() => navigation.destination && discardAndNavigate(navigation.destination)}>Discard and leave</button><button type="button" className="btn-primary" disabled={pending} onClick={() => { const target = navigation.destination || undefined; navigation.stay(); void save(false, target); }}>Save and leave</button></div></ProspectingDialog>
    <ProspectingDialog open={sampleOpen} title="Sample handoff" wide onClose={() => { if (!pending) setSampleOpen(false); }}><p className="mb-4 text-sm text-slate-500">{step + 1} of 3 · {['Contact', 'Fulfillment', 'Review'][step]}</p><fieldset disabled={pending} className="min-w-0 space-y-4">{sampleError ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{sampleError}</p> : null}{step === 0 ? <><label className="block text-sm font-semibold">Sample contact<select className="input mt-1" value={sample.contactId || 'new'} onChange={(event) => setSample({ ...sample, contactId: event.target.value })}>{draft.contacts.filter(({ id }) => !draft.deletedContactIds.includes(id)).map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name || contact.email || 'Unnamed contact'}</option>)}<option value="new">Add a new contact</option></select></label>{selectedSampleContact ? <ContactFields prefix="sample_contact" contact={selectedSampleContact} onChange={(contact) => sample.contactId === 'new' ? editNewContact(contact) : editContact(draft.contacts.findIndex(({ id }) => id === sample.contactId), contact)} /> : null}</> : null}
      {step === 1 ? <>{props.sampleHistoryError ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Shipment history is unavailable. Request manager fulfillment or reload before creating another shipment.</p> : props.previousSampleOrders?.length ? <section className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><h3 className="font-semibold">Previous sample orders</h3><p className="mt-1">Review these shipments before creating another order.</p><ul className="mt-2 space-y-1">{props.previousSampleOrders.map((order) => <li key={order.id}><a href={`/admin/orders/${order.id}`} target="_blank" rel="noreferrer" className="underline">{formatDateTime(order.created_at)} · {order.status || 'View order'}</a></li>)}</ul></section> : null}<div className="space-y-2"><label className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="sample_mode" value="order" checked={sample.mode === 'order'} onChange={() => setSample({ ...sample, mode: 'order' })} /><span><strong>Create shipment order</strong><span className="mt-1 block text-slate-600">Choose sample boxes and send the free order to production.</span></span></label><label className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="radio" name="sample_mode" value="request_only" checked={sample.mode === 'request_only'} onChange={() => setSample({ ...sample, mode: 'request_only' })} /><span><strong>Request manager fulfillment</strong><span className="mt-1 block text-slate-600">Record the request for management to arrange the shipment.</span></span></label></div>{sample.mode === 'order' ? <><div className="grid gap-3 sm:grid-cols-2">{([['centerName', 'Company'], ['attentionName', 'Attention name'], ['address1', 'Shipping address 1'], ['address2', 'Shipping address 2'], ['city', 'Shipping city'], ['state', 'Shipping state'], ['zip', 'Shipping ZIP']] as const).map(([field, label]) => <TextField key={field} name={`sample_${field}`} label={label} value={sample[field]} onChange={(value) => setSample({ ...sample, [field]: value })} />)}</div><div className="space-y-3"><p className="text-sm font-semibold">Sample boxes</p>{productsError ? <p className="text-sm text-rose-800">Products could not be loaded. You can request manager fulfillment or reload.</p> : !products.length ? <p className="text-sm text-slate-600">No active sample boxes with recipes are available. Request manager fulfillment instead.</p> : products.map((product) => <TextField key={product.id} type="number" name={`sample_product_${product.id}`} label={product.name || product.sku || 'Sample box'} value={String(sample.items.find(({ productId }) => productId === product.id)?.quantity ?? 0)} onChange={(value) => setSample({ ...sample, items: sample.items.map((item) => item.productId === product.id ? { ...item, quantity: value } : item) })} />)}</div></> : null}<label className="block text-sm font-semibold">Fulfillment notes<textarea className="input mt-1 min-h-24" value={sample.notes} onChange={(event) => setSample({ ...sample, notes: event.target.value })} /></label></> : null}
      {step === 2 ? <div className="space-y-3 text-sm"><p><strong>{draft.lead.company_name}</strong></p><p>{selectedSampleContact?.full_name} · {selectedSampleContact?.email}</p>{sample.mode === 'order' ? <><p>{sample.attentionName}<br />{[sample.address1, sample.address2, sample.city, sample.state, sample.zip].filter(Boolean).join(', ')}</p><ul className="list-inside list-disc">{sample.items.filter(({ quantity }) => Number(quantity) > 0).map((item) => <li key={item.productId}>{item.quantity} × {products.find(({ id }) => id === item.productId)?.name || 'Sample box'}</li>)}</ul><p>A free shipment order will be sent to production.</p></> : <p>A request will be added to management’s fulfillment queue. No order is created at this step.</p>}<p className="rounded-lg bg-teal-50 p-3 text-teal-900">The lead moves to Sample Requested and the existing HubSpot handoff queue. {isOwner ? '' : 'Your work on this lead is handed to management.'} Your record edits and pending activity are saved with this request.</p></div> : null}
      <div className="flex flex-wrap justify-between gap-2 border-t pt-4"><button type="button" className="btn-secondary" onClick={() => step > 0 ? setStep(step - 1) : setSampleOpen(false)}>{step > 0 ? 'Back' : 'Back to draft'}</button>{step < 2 ? <button type="button" className="btn-primary" onClick={nextSampleStep}>Continue</button> : <button type="button" className="btn-primary" onClick={() => void save(sampleAdvance.current, sampleSaveDestination.current, true)}>{pending ? 'Submitting…' : sample.mode === 'order' ? 'Submit sample order' : 'Submit fulfillment request'}</button>}</div></fieldset></ProspectingDialog>
    <ProspectingDialog open={Boolean(receipt)} title={receipt?.receipt.orderId ? 'Sample order created' : receipt?.receipt.requestId ? 'Request handed to management' : 'Record saved'} onClose={() => receipt && navigation.navigate(receipt.nextHref || backHref)}><div className="space-y-3 text-sm"><p>{receipt?.receipt.orderId ? 'The free sample order is ready for production.' : receipt?.receipt.requestId ? 'Management can now arrange fulfillment. The sample request has been saved.' : 'The lead has left your assigned work queue.'}</p>{receipt?.receipt.orderId ? <p className="break-all text-slate-500">Order: {receipt.receipt.orderId}</p> : null}<button type="button" className="btn-primary" onClick={() => navigation.navigate(receipt?.nextHref || backHref)}>Continue in queue</button></div></ProspectingDialog>
    <ProspectingDialog open={conflictOpen} title="Review your draft" wide onClose={() => setConflictOpen(false)}><p className="mb-3 text-sm text-slate-600">Another change was saved after this draft began. Open the latest record in a separate tab to compare; your draft stays here until you choose to discard it.</p><div className="max-h-60 overflow-auto rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{draft.lead.company_name}</p><p>Stage: {stageLabel(draft.lead.stage)}</p><p>Follow-up: {draft.followUp.mode === 'keep' ? formatDate(draft.followUp.date) : draft.followUp.mode === 'clear' ? 'Clear' : draft.followUp.date}</p><p className="whitespace-pre-wrap">{draft.activity.body}</p><details><summary>All draft fields</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(draft, null, 2)}</pre></details></div><div className="mt-4 flex flex-wrap gap-2"><a className="btn-secondary" href={`/admin/sales/prospecting/${lead.id}?${queueParams}&fresh=1`} target="_blank" rel="noreferrer">Open latest record</a><button type="button" className="btn-secondary" onClick={() => setConflictOpen(false)}>Keep draft</button><button type="button" className="btn-primary" onClick={() => { clearStoredDraft(); navigation.bypass.current = true; window.location.reload(); }}>Discard draft and reload</button></div></ProspectingDialog>
  </div>;
}

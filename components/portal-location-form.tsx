'use client';

import { useActionState, useEffect, useId, useRef, useState } from 'react';
import { US_ADDRESS_STATES } from '@/lib/customer-address';
import { initialPortalLocationFormState, type PortalLocationFields, type PortalLocationFormState } from '@/lib/portal-locations';

const emptyFields = { name: '', address1: '', address2: '', city: '', state: '', zip: '' };

export default function PortalLocationForm({ action, location }: {
  action: (previousState: PortalLocationFormState, data: FormData) => Promise<PortalLocationFormState>;
  location?: PortalLocationFields & { id: string };
}) {
  const prefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const adding = !location;
  const [result, formAction, pending] = useActionState(action, initialPortalLocationFormState);
  const [fields, setFields] = useState(() => location ? { ...location, address2: location.address2 ?? '' } : emptyFields);
  useEffect(() => {
    const element = form.current;
    if (!element) return;
    // React resets action forms during commit, when synthetic onReset is disabled.
    // Keep drafts intact; successful additions are explicitly cleared below.
    const preserveDraft = (event: Event) => event.preventDefault();
    element.addEventListener('reset', preserveDraft);
    return () => element.removeEventListener('reset', preserveDraft);
  }, []);
  useEffect(() => {
    submitting.current = false;
    if (result.status === 'success' && adding) setFields(emptyFields);
  }, [result, adding]);

  const textFields = [
    { key: 'name', name: 'location_name', label: 'Location name', maxLength: 100, autoComplete: 'organization', placeholder: 'Main office' },
    { key: 'address1', name: 'address1', label: 'Street address', maxLength: 200, autoComplete: 'address-line1' },
    { key: 'address2', name: 'address2', label: 'Apartment, suite, etc. (optional)', maxLength: 200, autoComplete: 'address-line2' },
    { key: 'city', name: 'city', label: 'City', maxLength: 100, autoComplete: 'address-level2' },
  ] as const;

  return <form ref={form} action={formAction} className="space-y-4" onSubmit={(event) => {
    if (submitting.current || pending) {
      event.preventDefault();
      return;
    }
    submitting.current = true;
  }}>
    {location ? <input type="hidden" name="location_id" value={location.id} /> : null}
    <fieldset disabled={pending} className="min-w-0 space-y-4">
      <legend className="sr-only">{location ? `Edit ${location.name}` : 'Add delivery location'}</legend>
      {textFields.map((field) => <div key={field.key} className="space-y-2">
        <label className="block text-sm font-medium text-slate-700" htmlFor={`${prefix}-${field.key}`}>{field.label}</label>
        <input id={`${prefix}-${field.key}`} name={field.name} className="input w-full" autoComplete={field.autoComplete}
          maxLength={field.maxLength} required={field.key !== 'address2'} placeholder={'placeholder' in field ? field.placeholder : undefined}
          value={fields[field.key]} onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })} />
      </div>)}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor={`${prefix}-state`}>State</label>
          <select id={`${prefix}-state`} className="input w-full" name="state" autoComplete="address-level1" required value={fields.state}
            onChange={(event) => setFields({ ...fields, state: event.target.value })}>
            <option value="">Choose state</option>
            {US_ADDRESS_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700" htmlFor={`${prefix}-zip`}>ZIP code</label>
          <input id={`${prefix}-zip`} className="input w-full" name="zip" autoComplete="postal-code" required maxLength={10}
            pattern="[0-9]{5}(-[0-9]{4})?" placeholder="12345" value={fields.zip}
            onChange={(event) => setFields({ ...fields, zip: event.target.value })} />
        </div>
      </div>
      <button className="btn-primary w-full sm:w-auto" type="submit" disabled={pending}>
        {pending ? 'Saving…' : location ? 'Save address' : 'Add location'}
      </button>
    </fieldset>
    {result.message ? <p role={result.status === 'error' ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${result.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{result.message}</p> : null}
  </form>;
}

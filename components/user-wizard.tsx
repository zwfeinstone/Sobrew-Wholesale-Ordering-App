'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { customerAddressError, US_ADDRESS_STATES, type CustomerAddress } from '@/lib/customer-address';
import { productCategoryLabel, groupProductsByCategory } from '@/lib/product-categories';

type Product = { id: string; name: string | null; category?: string | null };

type WizardState = CustomerAddress & {
  center_name: string;
  center_notes: string;
  login_email: string;
  login_name: string;
  password: string;
};


function productDisplayName(product: Product) {
  return product.name?.trim() || 'Unnamed product';
}


export function UserWizard({ products }: { products: Product[] }) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [state, setState] = useState<WizardState>({
    center_name: '',
    center_notes: '',
    login_email: '',
    login_name: '',
    password: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
  });
  const selectedProducts = useMemo(() => products.filter((product) => selected[product.id]), [products, selected]);
  const groupedProducts = useMemo(() => groupProductsByCategory(products), [products]);
  const stepLabels = ['Center details', 'Assign products', 'Set prices', 'Review'];

  useEffect(() => {
    // Native POST navigation may preserve this form in the back/forward cache.
    // Restore its controls when returning to correct a failed submission.
    function restoreForm(event: PageTransitionEvent) {
      if (!event.persisted) return;
      submittingRef.current = false;
      setSubmitting(false);
    }
    window.addEventListener('pageshow', restoreForm);
    return () => window.removeEventListener('pageshow', restoreForm);
  }, []);

  function nextStep() {
    if (!formRef.current?.reportValidity()) return;
    if (step === 1) {
      const addressError = customerAddressError(state);
      if (addressError || !state.center_name.trim() || state.password.trim().length < 8) {
        setError(addressError || 'Enter a center name and a temporary password of at least 8 characters.');
        return;
      }
    }
    setError('');
    setStep(step + 1);
  }

  return (
    <form ref={formRef} action="/api/admin/users/new" method="post" className="card space-y-6" onSubmit={(event) => {
      if (submittingRef.current) {
        event.preventDefault();
        return;
      }
      if (step < 4) {
        event.preventDefault();
        nextStep();
        return;
      }
      const addressError = customerAddressError(state);
      if (addressError) {
        event.preventDefault();
        setError(addressError);
        setStep(1);
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
    }}>
      <input type="hidden" name="center_name" value={state.center_name} />
      <input type="hidden" name="center_notes" value={state.center_notes} />
      <input type="hidden" name="login_email" value={state.login_email} />
      <input type="hidden" name="login_name" value={state.login_name} />
      <input type="hidden" name="password" value={state.password} />
      {(['address1', 'address2', 'city', 'state', 'zip'] as const).map((field) => (
        <input key={field} type="hidden" name={field} value={state[field]} />
      ))}
      <input type="hidden" name="selected_json" value={JSON.stringify(selectedProducts.map((product) => product.id))} />
      {selectedProducts.map((product) => (
        <input key={`hidden-price-${product.id}`} type="hidden" name={`price_${product.id}`} value={prices[product.id] ?? '0.00'} />
      ))}
      <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
        {stepLabels.map((label, index) => (
          <div
            key={label}
            className={`rounded-2xl border px-4 py-3 text-sm font-medium ${step === index + 1 ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white/60 text-slate-500'}`}
          >
            {index + 1}. {label}
          </div>
        ))}
      </div>
      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p> : null}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Step 1: Create center + first login</h2>
            <p className="mt-1 text-sm text-slate-500">Add the customer’s address and first login. We’ll save the address for billing and delivery, link the customer to QuickBooks, and send their welcome email.</p>
          </div>
          <input
            className="input"
            name="center_name"
            required
            placeholder="Center name"
            aria-label="Center name"
            value={state.center_name}
            onChange={(event) => setState({ ...state, center_name: event.target.value })}
          />
          <fieldset className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4 sm:p-5">
            <legend className="px-2 text-sm font-semibold text-teal-900">Billing & delivery address</legend>
            <p className="mb-4 text-sm text-slate-600">A complete US address is required before the customer is created. You can add more delivery locations later.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Street address <span aria-hidden="true">*</span></span>
                <input className="input" required autoComplete="street-address" value={state.address1} onChange={(event) => setState({ ...state, address1: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>Apartment, suite, or building <span className="font-normal text-slate-500">(optional)</span></span>
                <input className="input" autoComplete="address-line2" value={state.address2} onChange={(event) => setState({ ...state, address2: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-slate-700 sm:col-span-2">
                <span>City <span aria-hidden="true">*</span></span>
                <input className="input" required autoComplete="address-level2" value={state.city} onChange={(event) => setState({ ...state, city: event.target.value })} />
              </label>
              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                <span>State <span aria-hidden="true">*</span></span>
                <select className="input" required autoComplete="address-level1" value={state.state} onChange={(event) => setState({ ...state, state: event.target.value })}>
                  <option value="">Select state</option>
                  {US_ADDRESS_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium text-slate-700">
                <span>ZIP code <span aria-hidden="true">*</span></span>
                <input className="input" required autoComplete="postal-code" pattern="[0-9]{5}(-[0-9]{4})?" title="Enter a 5-digit ZIP code or ZIP+4." value={state.zip} onChange={(event) => setState({ ...state, zip: event.target.value })} />
              </label>
            </div>
          </fieldset>
          <textarea
            className="input"
            name="center_notes"
            placeholder="Center notes"
            aria-label="Center notes"
            value={state.center_notes}
            onChange={(event) => setState({ ...state, center_notes: event.target.value })}
          />
          <input
            className="input"
            name="login_name"
            placeholder="First login name"
            aria-label="First login name"
            value={state.login_name}
            onChange={(event) => setState({ ...state, login_name: event.target.value })}
          />
          <input
            className="input"
            name="login_email"
            type="email"
            required
            placeholder="First login email"
            aria-label="First login email"
            value={state.login_email}
            onChange={(event) => setState({ ...state, login_email: event.target.value })}
          />
          <input
            className="input"
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Temporary password"
            aria-label="Temporary password"
            autoComplete="new-password"
            value={state.password}
            onChange={(event) => setState({ ...state, password: event.target.value })}
          />
          <button type="button" className="btn-primary w-full sm:w-auto" onClick={nextStep}>
            Next
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Step 2: Assign products</h2>
            <p className="mt-1 text-sm text-slate-500">Choose which products everyone at this center should see in their shared catalog.</p>
          </div>
          {!groupedProducts.length ? <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-600">No active products found.</div> : null}
          {groupedProducts.map((group) => (
            <div key={group.category} className="space-y-3">
              <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{productCategoryLabel(group.category)}</h3>
              {group.products.map((product) => (
                <label key={product.id} className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 sm:items-center">
                  <span className="font-medium text-slate-900">{productDisplayName(product)}</span>
                  <input type="checkbox" checked={!!selected[product.id]} onChange={(event) => setSelected({ ...selected, [product.id]: event.target.checked })} />
                </label>
              ))}
            </div>
          ))}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="btn-primary w-full sm:w-auto" onClick={nextStep}>Next</button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Step 3: Set prices</h2>
            <p className="mt-1 text-sm text-slate-500">Set shared pricing for the selected center catalog.</p>
          </div>
          {selectedProducts.map((product) => (
            <div key={product.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <label className="mb-2 block font-medium text-slate-900">{productDisplayName(product)}</label>
              <input
                className="input"
                name={`price_${product.id}`}
                type="number"
                min="0"
                step="0.01"
                required
                value={prices[product.id] ?? '0.00'}
                onChange={(event) => setPrices({ ...prices, [product.id]: event.target.value })}
              />
            </div>
          ))}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setStep(2)}>Back</button>
            <button type="button" className="btn-primary w-full sm:w-auto" onClick={nextStep}>Next</button>
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Step 4: Review & Create</h2>
            <p className="mt-1 text-sm text-slate-500">Double-check the center details, first login, and shared catalog before creating the center.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Center</p>
              <p className="mt-2 font-semibold text-slate-950">{state.center_name || 'Unnamed center'}</p>
              <p className="mt-1 text-sm text-slate-500">{state.center_notes || 'No notes added.'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">First login</p>
              <p className="mt-2 font-semibold text-slate-950">{state.login_name || state.login_email}</p>
              <p className="mt-1 text-sm text-slate-500">{state.login_email}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Billing & delivery address</p>
              <address className="mt-2 text-sm not-italic text-slate-700">
                {state.address1}<br />
                {state.address2 ? <>{state.address2}<br /></> : null}
                {state.city}, {state.state} {state.zip}
              </address>
              <p className="mt-3 text-sm text-slate-500">QuickBooks invoices will use this address and {state.login_email}.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Assigned products</p>
              <p className="mt-2 font-semibold text-slate-950">{selectedProducts.length} selected</p>
              <p className="mt-1 text-sm text-slate-500">{selectedProducts.map(productDisplayName).join(', ') || 'Blank order guide. Products can be added later.'}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" disabled={submitting} className="btn-secondary w-full sm:w-auto" onClick={() => setStep(3)}>Back</button>
            <button type="submit" disabled={submitting} className="btn-primary w-full sm:w-auto">{submitting ? 'Creating & linking customer…' : 'Create customer & send welcome'}</button>
          </div>
        </div>
      )}
    </form>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseBillingEmail, parseBillingEmailCc } from '@/lib/billing-email';
import { customerAddressError, US_ADDRESS_STATES, type CustomerAddress } from '@/lib/customer-address';
import { productCategoryGroupKey, productCategoryLabel } from '@/lib/product-categories';
import { CATALOG_ROAST_OPTIONS, compareCatalogProducts, getProductPackInfo, groupCatalogProducts, isPackCategory, matchesCatalogSearch } from '@/lib/product-catalog';

type Product = { id: string; name: string | null; category?: string | null; sku?: string | null };

type WizardState = CustomerAddress & {
  center_name: string;
  center_notes: string;
  login_email: string;
  billing_email: string;
  billing_email_cc: string;
  login_name: string;
  password: string;
};


function productDisplayName(product: Product) {
  return product.name?.trim() || 'Unnamed product';
}

function PackDetails({ product }: { product: Product }) {
  if (!isPackCategory(product.category)) return null;
  const { sizeOz, count, withFilters } = getProductPackInfo(product);
  if (sizeOz === null && count === null && !withFilters) return null;
  return <span className="mt-1 flex flex-wrap gap-1.5 text-xs font-medium text-slate-600">
    {sizeOz !== null ? <span className="rounded bg-slate-100 px-2 py-0.5">{sizeOz} oz / pack</span> : null}
    {count !== null ? <span className="rounded bg-slate-100 px-2 py-0.5">{count} / case</span> : null}
    {withFilters ? <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-800">With filters</span> : null}
  </span>;
}


export function UserWizard({ products }: { products: Product[] }) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [productQuery, setProductQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [roastFilter, setRoastFilter] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [state, setState] = useState<WizardState>({
    center_name: '',
    center_notes: '',
    login_email: '',
    billing_email: '',
    billing_email_cc: '',
    login_name: '',
    password: '',
    address1: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
  });
  const selectedProducts = useMemo(() => products.filter((product) => selected[product.id]).sort(compareCatalogProducts), [products, selected]);
  const allGroupedProducts = useMemo(() => groupCatalogProducts(products), [products]);
  const selectedGroups = useMemo(() => groupCatalogProducts(selectedProducts), [selectedProducts]);
  const visibleProducts = useMemo(() => products.filter((product) =>
    matchesCatalogSearch(product, productQuery)
    && (!categoryFilter || productCategoryGroupKey(product.category) === categoryFilter)
    && (!roastFilter || isPackCategory(product.category) && (getProductPackInfo(product).roast ?? 'Other') === roastFilter)
    && (!selectedOnly || selected[product.id]),
  ), [products, productQuery, categoryFilter, roastFilter, selectedOnly, selected]);
  const groupedProducts = useMemo(() => groupCatalogProducts(visibleProducts), [visibleProducts]);
  const hasProductFilters = Boolean(productQuery.trim() || categoryFilter || roastFilter || selectedOnly);
  const selectedCategoryCounts = useMemo(() => new Map(selectedGroups.map((group) => [group.category, group.products.length])), [selectedGroups]);

  function resetProductFilters() {
    setProductQuery('');
    setCategoryFilter('');
    setRoastFilter('');
    setSelectedOnly(false);
    setExpandedCategories({});
  }
  const billingEmail = useMemo(() => {
    try {
      return { recipient: parseBillingEmail(state.billing_email), error: '' };
    } catch (error) {
      return { recipient: '', error: error instanceof Error ? error.message : 'Enter a valid invoice email address.' };
    }
  }, [state.billing_email]);
  const billingCc = useMemo(() => {
    try {
      return { recipients: parseBillingEmailCc(state.billing_email_cc), error: '' };
    } catch (error) {
      return { recipients: [], error: error instanceof Error ? error.message : 'Check the invoice CC email addresses.' };
    }
  }, [state.billing_email_cc]);
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
      if (addressError || billingEmail.error || billingCc.error || !state.center_name.trim() || state.password.length < 8) {
        setError(addressError || billingEmail.error || billingCc.error || 'Enter a center name and a temporary password of at least 8 characters.');
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
      if (addressError || billingEmail.error || billingCc.error) {
        event.preventDefault();
        setError(addressError || billingEmail.error || billingCc.error);
        setStep(1);
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
    }}>
      <input type="hidden" name="center_name" value={state.center_name} />
      <input type="hidden" name="center_notes" value={state.center_notes} />
      <input type="hidden" name="login_email" value={state.login_email} />
      <input type="hidden" name="billing_email" value={state.billing_email} />
      <input type="hidden" name="billing_email_cc" value={state.billing_email_cc} />
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
            <p className="mt-1 text-sm text-slate-500">Add the customer’s address, first login, and invoice recipients. We’ll save the billing details in QuickBooks and send the welcome email to the first login.</p>
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
          <fieldset className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
            <legend className="px-2 text-sm font-semibold text-slate-900">Who should receive invoices?</legend>
            <p id="invoice-email-help" className="text-sm text-slate-600">Choose the billing contact for invoices sent when orders ship. We’ll save this email in QuickBooks. The welcome email goes to the first login email above.</p>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Invoice email <span aria-hidden="true">*</span></span>
              <input
                className="input"
                type="email"
                required
                placeholder="billing@example.com"
                aria-describedby="invoice-email-help"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={state.billing_email}
                onChange={(event) => setState({ ...state, billing_email: event.target.value })}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Invoice CC emails <span className="font-normal text-slate-500">(optional)</span></span>
              <textarea
                className="input min-h-24"
                placeholder="accounting@example.com, manager@example.com"
                aria-describedby="invoice-cc-help"
                autoCapitalize="none"
                spellCheck={false}
                value={state.billing_email_cc}
                onChange={(event) => setState({ ...state, billing_email_cc: event.target.value })}
              />
            </label>
            <p id="invoice-cc-help" className="text-sm text-slate-500">Add up to 20 addresses, separated by commas, semicolons, or new lines. They’ll receive invoice copies through QuickBooks.</p>
          </fieldset>
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
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
              <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2 lg:col-span-1">Search products
                <input type="search" className="input" placeholder="Name, size, or SKU" value={productQuery} onChange={(event) => { setProductQuery(event.target.value); setExpandedCategories({}); }} />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Category
                <select className="input" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setExpandedCategories({}); }}>
                  <option value="">All categories</option>
                  {allGroupedProducts.map((group) => <option key={group.category} value={group.category}>{productCategoryLabel(group.category)}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">Roast
                <select className="input" value={roastFilter} onChange={(event) => { setRoastFilter(event.target.value); setExpandedCategories({}); }}>
                  <option value="">All roasts</option>
                  {CATALOG_ROAST_OPTIONS.map((roast) => <option key={roast} value={roast}>{roast}</option>)}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <label className="flex min-h-9 items-center gap-2 font-medium text-slate-700"><input type="checkbox" checked={selectedOnly} onChange={(event) => { setSelectedOnly(event.target.checked); setExpandedCategories({}); }} />Selected only ({selectedProducts.length})</label>
              <div className="flex flex-wrap items-center gap-3"><span className="text-slate-500" role="status">{visibleProducts.length} of {products.length} products · {selectedProducts.length} selected</span>{hasProductFilters ? <button type="button" className="text-sm font-semibold text-teal-800 underline" onClick={resetProductFilters}>Clear filters</button> : null}</div>
            </div>
          </div>
          {!groupedProducts.length ? <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-5 text-sm text-slate-600">{!products.length ? 'No active products found.' : selectedOnly && !selectedProducts.length ? 'No products selected yet. Clear filters to browse the catalog.' : 'No products match these filters. Try another search or clear filters.'}</div> : null}
          {groupedProducts.map((group) => {
            const expanded = expandedCategories[group.category] ?? (hasProductFilters || allGroupedProducts.length === 1);
            return <section key={group.category} className="overflow-hidden rounded-2xl border border-slate-200 bg-white/70">
              <h3><button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50" aria-expanded={expanded} aria-controls={`assign-category-${group.category}`} onClick={() => setExpandedCategories((previous) => ({ ...previous, [group.category]: !expanded }))}>
                <span className="font-semibold text-slate-900">{productCategoryLabel(group.category)}<span className="ml-2 text-sm font-normal text-slate-500">{group.products.length} products · {selectedCategoryCounts.get(group.category) ?? 0} selected</span></span>
                <span aria-hidden="true" className="text-xl text-slate-500">{expanded ? '−' : '+'}</span>
              </button></h3>
              <div id={`assign-category-${group.category}`} hidden={!expanded} className="border-t border-slate-200">
                {group.roasts.map((roastGroup) => <div key={roastGroup.label ?? 'all'}>
                  {roastGroup.label ? <h4 className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{roastGroup.label}</h4> : null}
                  <div className="divide-y divide-slate-100">{roastGroup.products.map((product) => <label key={product.id} className={`flex cursor-pointer items-start gap-3 px-4 py-3 ${selected[product.id] ? 'bg-teal-50/60' : 'hover:bg-slate-50'}`}>
                    <input className="mt-1 h-4 w-4 shrink-0 accent-teal-700" type="checkbox" aria-label={productDisplayName(product)} checked={!!selected[product.id]} onChange={(event) => setSelected((previous) => ({ ...previous, [product.id]: event.target.checked }))} />
                    <span className="min-w-0 break-words"><span className="text-sm font-medium text-slate-900">{productDisplayName(product)}</span><PackDetails product={product} /></span>
                  </label>)}</div>
                </div>)}
              </div>
            </section>;
          })}
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
          {!selectedProducts.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No products selected. You can go back to add products or create a blank order guide.</p> : null}
          {selectedGroups.map((group) => <section key={group.category} className="overflow-hidden rounded-2xl border border-slate-200 bg-white/70">
            <h3 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">{productCategoryLabel(group.category)} <span className="text-sm font-normal text-slate-500">{group.products.length} selected</span></h3>
            {group.roasts.map((roastGroup) => <div key={roastGroup.label ?? 'all'}>
              {roastGroup.label ? <h4 className="bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">{roastGroup.label}</h4> : null}
              <div className="divide-y divide-slate-100">{roastGroup.products.map((product) => <div key={product.id} className="grid items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <div className="min-w-0 break-words"><p className="text-sm font-medium text-slate-900">{productDisplayName(product)}</p><PackDetails product={product} /></div>
                <label className="space-y-1 text-xs font-medium text-slate-600">Price ($)<span className="sr-only"> for {productDisplayName(product)}</span>
                  <input className="input" name={`price_${product.id}`} type="number" min="0" step="0.01" required value={prices[product.id] ?? '0.00'} onChange={(event) => setPrices((previous) => ({ ...previous, [product.id]: event.target.value }))} />
                </label>
              </div>)}</div>
            </div>)}
          </section>)}
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
            <p className="mt-1 text-sm text-slate-500">Double-check the center details, first login, invoice recipients, and shared catalog before creating the center.</p>
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
              <p className="mt-3 text-sm text-slate-500">QuickBooks invoices will use this address.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Invoice recipients</p>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="font-medium text-slate-900">To</dt>
                  <dd className="mt-1 break-words text-slate-700">{billingEmail.recipient}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-900">CC</dt>
                  <dd className="mt-1 break-words text-slate-700">{billingCc.recipients.join(', ') || 'No CC recipients.'}</dd>
                </div>
              </dl>
              <p className="mt-3 text-sm text-slate-500">These recipients will receive invoices through QuickBooks when orders ship.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Assigned products</p>
              <p className="mt-2 font-semibold text-slate-950">{selectedProducts.length} selected</p>
              {!selectedProducts.length ? <p className="mt-1 text-sm text-slate-500">Blank order guide. Products can be added later.</p> : <div className="mt-4 space-y-4">
                {selectedGroups.map((group) => <section key={group.category}>
                  <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-900">{productCategoryLabel(group.category)}</h3>
                  {group.roasts.map((roastGroup) => <div key={roastGroup.label ?? 'all'}>
                    {roastGroup.label ? <h4 className="pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{roastGroup.label}</h4> : null}
                    <ul className="divide-y divide-slate-100">{roastGroup.products.map((product) => <li key={product.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                      <span className="min-w-0 break-words text-slate-700">{productDisplayName(product)}<PackDetails product={product} /></span>
                      <span className="shrink-0 font-semibold text-slate-900">${Number(prices[product.id] ?? '0.00').toFixed(2)}</span>
                    </li>)}</ul>
                  </div>)}
                </section>)}
              </div>}
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

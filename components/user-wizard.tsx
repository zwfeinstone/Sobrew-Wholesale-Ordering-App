'use client';

import { useMemo, useState } from 'react';
import { productCategoryGroupKey, productCategoryLabel, productCategorySortRank, type ProductCategoryGroup } from '@/lib/product-categories';

type Product = { id: string; name: string | null; category?: string | null };

type WizardState = {
  center_name: string;
  center_notes: string;
  login_email: string;
  login_name: string;
  password: string;
};

const productNameCollator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

function productDisplayName(product: Product) {
  return product.name?.trim() || 'Unnamed product';
}

function groupProductsByCategory(products: Product[]) {
  const sortedProducts = [...products].sort((a, b) => {
    const categoryComparison = productCategorySortRank(a.category) - productCategorySortRank(b.category);
    if (categoryComparison !== 0) return categoryComparison;
    return productNameCollator.compare(productDisplayName(a), productDisplayName(b));
  });

  const groups: Array<{ category: ProductCategoryGroup; products: Product[] }> = [];
  for (const product of sortedProducts) {
    const category = productCategoryGroupKey(product.category);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup?.category === category) {
      currentGroup.products.push(product);
    } else {
      groups.push({ category, products: [product] });
    }
  }
  return groups;
}

export function UserWizard({ products }: { products: Product[] }) {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [state, setState] = useState<WizardState>({
    center_name: '',
    center_notes: '',
    login_email: '',
    login_name: '',
    password: '',
  });
  const selectedProducts = useMemo(() => products.filter((product) => selected[product.id]), [products, selected]);
  const groupedProducts = useMemo(() => groupProductsByCategory(products), [products]);
  const stepLabels = ['Center details', 'Assign products', 'Set prices', 'Review'];

  return (
    <form action="/api/admin/users/new" method="post" className="card space-y-6">
      <input type="hidden" name="center_name" value={state.center_name} />
      <input type="hidden" name="center_notes" value={state.center_notes} />
      <input type="hidden" name="login_email" value={state.login_email} />
      <input type="hidden" name="login_name" value={state.login_name} />
      <input type="hidden" name="password" value={state.password} />
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
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Step 1: Create center + first login</h2>
            <p className="mt-1 text-sm text-slate-500">Start with the center details, then set up the first login that will access the shared center data.</p>
          </div>
          <input
            className="input"
            name="center_name"
            required
            placeholder="Center name"
            value={state.center_name}
            onChange={(event) => setState({ ...state, center_name: event.target.value })}
          />
          <textarea
            className="input"
            name="center_notes"
            placeholder="Center notes"
            value={state.center_notes}
            onChange={(event) => setState({ ...state, center_notes: event.target.value })}
          />
          <input
            className="input"
            name="login_name"
            placeholder="First login name"
            value={state.login_name}
            onChange={(event) => setState({ ...state, login_name: event.target.value })}
          />
          <input
            className="input"
            name="login_email"
            type="email"
            required
            placeholder="First login email"
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
            value={state.password}
            onChange={(event) => setState({ ...state, password: event.target.value })}
          />
          <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setStep(2)}>
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
            <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setStep(3)}>Next</button>
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
            <button type="button" className="btn-primary w-full sm:w-auto" onClick={() => setStep(4)}>Next</button>
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
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Assigned products</p>
              <p className="mt-2 font-semibold text-slate-950">{selectedProducts.length} selected</p>
              <p className="mt-1 text-sm text-slate-500">{selectedProducts.map(productDisplayName).join(', ') || 'No products selected yet.'}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className="btn-secondary w-full sm:w-auto" onClick={() => setStep(3)}>Back</button>
            <button className="btn-primary w-full sm:w-auto">Create Center</button>
          </div>
        </div>
      )}
    </form>
  );
}

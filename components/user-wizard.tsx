'use client';

import { useMemo, useState } from 'react';

type Product = { id: string; name: string };

type WizardState = {
  email: string;
  full_name: string;
  password: string;
  notes: string;
  is_admin: boolean;
};

export function UserWizard({ products }: { products: Product[] }) {
  const [step, setStep] = useState(1);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [state, setState] = useState<WizardState>({
    email: '',
    full_name: '',
    password: '',
    notes: '',
    is_admin: false,
  });
  const selectedProducts = useMemo(() => products.filter((p) => selected[p.id]), [products, selected]);
  const stepLabels = ['User details', 'Assign products', 'Set prices', 'Review'];

  return (
    <form action="/api/admin/users/new" method="post" className="card space-y-6">
      <input type="hidden" name="email" value={state.email} />
      <input type="hidden" name="full_name" value={state.full_name} />
      <input type="hidden" name="password" value={state.password} />
      <input type="hidden" name="notes" value={state.notes} />
      <input type="hidden" name="selected_json" value={JSON.stringify(selectedProducts.map((p) => p.id))} />
      <input type="hidden" name="is_admin" value={state.is_admin ? 'true' : 'false'} />
      {selectedProducts.map((p) => (
        <input key={`hidden-price-${p.id}`} type="hidden" name={`price_${p.id}`} value={prices[p.id] ?? '0.00'} />
      ))}
      <div className="grid gap-2 sm:grid-cols-4">
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
            <h2 className="text-xl font-semibold">Step 1: Create user</h2>
            <p className="mt-1 text-sm text-slate-500">Start with the account details and access level for this customer.</p>
          </div>
          <input
            className="input"
            name="email"
            type="email"
            required
            placeholder="Email"
            value={state.email}
            onChange={(e) => setState({ ...state, email: e.target.value })}
          />
          <input
            className="input"
            name="full_name"
            placeholder="Full Name"
            value={state.full_name}
            onChange={(e) => setState({ ...state, full_name: e.target.value })}
          />
          <input
            className="input"
            name="password"
            type="password"
            required
            placeholder="Password"
            value={state.password}
            onChange={(e) => setState({ ...state, password: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state.is_admin}
              onChange={(e) => setState({ ...state, is_admin: e.target.checked })}
            />
            Make this user an admin
          </label>
          <textarea
            className="input"
            name="notes"
            placeholder="Notes"
            value={state.notes}
            onChange={(e) => setState({ ...state, notes: e.target.value })}
          />
          <button type="button" className="btn-primary" onClick={() => setStep(2)}>
            Next
          </button>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Step 2: Assign products</h2>
            <p className="mt-1 text-sm text-slate-500">Choose which products this user should see in their catalog.</p>
          </div>
          {products.map((p) => (
            <label key={p.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/70 px-4 py-3">
              <span className="font-medium text-slate-900">{p.name}</span>
              <input type="checkbox" checked={!!selected[p.id]} onChange={(e) => setSelected({ ...selected, [p.id]: e.target.checked })} />
            </label>
          ))}
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="btn-primary" onClick={() => setStep(3)}>Next</button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Step 3: Set prices</h2>
            <p className="mt-1 text-sm text-slate-500">Set custom prices for each selected product.</p>
          </div>
          {selectedProducts.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <label className="mb-2 block font-medium text-slate-900">{p.name}</label>
              <input
                className="input"
                name={`price_${p.id}`}
                type="number"
                min="0"
                step="0.01"
                required
                value={prices[p.id] ?? '0.00'}
                onChange={(e) => setPrices({ ...prices, [p.id]: e.target.value })}
              />
            </div>
          ))}
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={() => setStep(2)}>Back</button>
            <button type="button" className="btn-primary" onClick={() => setStep(4)}>Next</button>
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Step 4: Review & Create</h2>
            <p className="mt-1 text-sm text-slate-500">Double-check the user details, product access, and pricing before creating the account.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">User</p>
              <p className="mt-2 font-semibold text-slate-950">{state.full_name || state.email}</p>
              <p className="mt-1 text-sm text-slate-500">{state.email}</p>
              <p className="mt-3 text-sm text-slate-600">Role: {state.is_admin ? 'Admin' : 'User'}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Assigned products</p>
              <p className="mt-2 font-semibold text-slate-950">{selectedProducts.length} selected</p>
              <p className="mt-1 text-sm text-slate-500">{selectedProducts.map((p) => p.name).join(', ') || 'No products selected yet.'}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" onClick={() => setStep(3)}>Back</button>
            <button className="btn-primary">Create User</button>
          </div>
        </div>
      )}
    </form>
  );
}

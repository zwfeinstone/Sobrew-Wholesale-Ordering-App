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
  const [state, setState] = useState<WizardState>({
    email: '',
    full_name: '',
    password: '',
    notes: '',
    is_admin: false,
  });
  const selectedProducts = useMemo(() => products.filter((p) => selected[p.id]), [products, selected]);

  return (
    <form action="/admin/users/new" method="post" className="card space-y-4">
      <input type="hidden" name="selected_json" value={JSON.stringify(selectedProducts.map((p) => p.id))} />
      <input type="hidden" name="is_admin" value={state.is_admin ? 'true' : 'false'} />
      {step === 1 && (
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Step 1: Create user</h2>
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
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Step 2: Assign products</h2>
          {products.map((p) => (
            <label key={p.id} className="block"><input type="checkbox" checked={!!selected[p.id]} onChange={(e) => setSelected({ ...selected, [p.id]: e.target.checked })} /> {p.name}</label>
          ))}
          <button type="button" className="rounded border px-4 py-2" onClick={() => setStep(1)}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep(3)}>Next</button>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Step 3: Set prices</h2>
          {selectedProducts.map((p) => (
            <div key={p.id}>
              <label>{p.name}</label>
              <input className="input" name={`price_${p.id}`} type="number" min="0" step="0.01" defaultValue="0.00" required />
            </div>
          ))}
          <button type="button" className="rounded border px-4 py-2" onClick={() => setStep(2)}>Back</button>
          <button type="button" className="btn-primary" onClick={() => setStep(4)}>Next</button>
        </div>
      )}
      {step === 4 && (
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Step 4: Review & Create</h2>
          <p>{selectedProducts.length} products selected.</p>
          <p className="text-sm text-slate-600">Role: {state.is_admin ? 'Admin' : 'User'}</p>
          <button type="button" className="rounded border px-4 py-2" onClick={() => setStep(3)}>Back</button>
          <button className="btn-primary">Create User</button>
        </div>
      )}
    </form>
  );
}

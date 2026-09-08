'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import PendingSubmitButton from '@/components/pending-submit-button';
type Product = { id: string; name: string; category: string; assigned: boolean; price: number | null; complimentary: boolean };
export default function CenterCatalogEditor({ centerId, products, action }: { centerId: string; products: Product[]; action: (form: FormData) => Promise<void> }) {
  const [query,setQuery] = useState('');
  const [filter,setFilter] = useState('all');
  const [rows,setRows] = useState(products.map(p => ({ ...p, amount: p.price === null ? '' : (p.price / 100).toFixed(2) })));
  const missing = (p: typeof rows[number]) => p.assigned && (!p.amount || Number(p.amount) <= 0 && !p.complimentary);
  const matches = (p: typeof rows[number]) => `${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'assigned' && p.assigned || filter === 'review' && missing(p));
  function update(id: string, values: Partial<typeof rows[number]>) { setRows(prev => prev.map(p => p.id === id ? { ...p, ...values } : p)); }
  return <form action={action} className="space-y-5">
    <input type="hidden" name="center_id" value={centerId} />
    <div className="workspace-heading"><h2 className="text-lg font-semibold">Catalog & pricing <span className="text-sm font-normal text-slate-500">{rows.filter(p => p.assigned).length} assigned</span></h2><PendingSubmitButton className="btn-primary" label="Save pricing" pendingLabel="Saving..." /></div>
    <div className="workspace-toolbar"><label className="workspace-search"><Search size={18} /><input aria-label="Search customer products" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search products" /></label><select className="input" aria-label="Product visibility" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All products</option><option value="assigned">Assigned</option><option value="review">Needs pricing</option></select></div>
    {rows.some(missing) ? <p className="workspace-notice warning" role="status">{rows.filter(missing).length} assigned products need a price or complimentary approval.</p> : null}
    <div className="catalog-pricing-list">
      {rows.map(p => <div key={p.id} className="catalog-pricing-row" hidden={!matches(p)}>
        <label className="flex items-start gap-3"><input type="checkbox" name="product_id" value={p.id} checked={p.assigned} onChange={e => update(p.id,{ assigned:e.target.checked })} /><span><strong>{p.name}</strong><small className="block text-slate-500">{p.category}</small></span></label>
        <label className="workspace-field">Price ($)<input className="input" name={`price_${p.id}`} value={p.amount} type="number" min="0" step="0.01" disabled={!p.assigned} onChange={e => update(p.id,{ amount:e.target.value })} aria-invalid={missing(p)} /></label>
        <label className="flex items-center gap-2 text-sm"><input name={`complimentary_${p.id}`} type="checkbox" checked={p.complimentary} disabled={!p.assigned || Number(p.amount) !== 0} onChange={e => update(p.id,{ complimentary:e.target.checked })} /> Complimentary</label>
      </div>)}
    </div>
    {!rows.some(matches) ? <div className="workspace-empty"><h3>No products found</h3>{products.length ? <button type="button" className="btn-secondary" onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</button> : null}</div> : null}
  </form>;
}

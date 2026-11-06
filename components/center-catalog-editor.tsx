'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import PendingSubmitButton from '@/components/pending-submit-button';
import { PRODUCT_CATEGORY_OPTIONS, productCategoryLabel } from '@/lib/product-categories';
import { CATALOG_ROAST_OPTIONS, getProductPackInfo, groupCatalogProducts, isPackCategory, matchesCatalogSearch } from '@/lib/product-catalog';

type Product = { id: string; name: string; category: string; sku?: string | null; assigned: boolean; price: number | null; complimentary: boolean };

export default function CenterCatalogEditor({ centerId, products, action }: { centerId: string; products: Product[]; action: (form: FormData) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [roast, setRoast] = useState('all');
  const [rows, setRows] = useState(() => products.map(product => ({
    ...product,
    // Older callers pass the display label; support both labels and stored keys.
    category: PRODUCT_CATEGORY_OPTIONS.find(option => option.value === product.category || option.label === product.category)?.value ?? 'uncategorized',
    amount: product.price === null ? '' : (product.price / 100).toFixed(2),
  })));
  const missing = (product: typeof rows[number]) => product.assigned && (!product.amount || !Number.isFinite(Number(product.amount)) || Number(product.amount) < 0 || (Number(product.amount) === 0 && !product.complimentary));
  const matches = (product: typeof rows[number]) => matchesCatalogSearch(product, query)
    && (category === 'all' || product.category === category)
    && (roast === 'all' || isPackCategory(product.category) && (getProductPackInfo(product).roast ?? 'Other') === roast)
    && (filter === 'all' || filter === 'assigned' && product.assigned || filter === 'review' && missing(product));
  const groups = groupCatalogProducts(rows.filter(matches));
  const assignedCount = rows.filter(product => product.assigned).length;
  const missingCount = rows.filter(missing).length;
  const filtering = Boolean(query.trim()) || category !== 'all' || roast !== 'all' || filter !== 'all';

  function update(id: string, values: Partial<typeof rows[number]>) {
    setRows(previous => previous.map(product => product.id === id ? { ...product, ...values } : product));
  }

  function clearFilters() {
    setQuery('');
    setFilter('all');
    setCategory('all');
    setRoast('all');
  }

  return <form action={action} className="space-y-5">
    <input type="hidden" name="center_id" value={centerId} />
    {/* Submit the full selection even when filters or collapsed groups hide it. */}
    {rows.filter(product => product.assigned).map(product => <div key={product.id} hidden>
      <input type="hidden" name="product_id" value={product.id} />
      <input type="hidden" name={`price_${product.id}`} value={product.amount} />
      {product.complimentary && Number(product.amount) === 0 ? <input type="hidden" name={`complimentary_${product.id}`} value="on" /> : null}
    </div>)}
    <div className="workspace-heading">
      <div><h2 className="text-lg font-semibold">Catalog &amp; pricing <span className="text-sm font-normal text-slate-500">{assignedCount} assigned</span></h2><p className="mt-1 text-sm text-slate-600">Browse by category and roast. Packs run from smallest to largest.</p></div>
      <PendingSubmitButton className="btn-primary" label="Save pricing" pendingLabel="Saving..." />
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="workspace-search !w-full"><Search size={18} aria-hidden="true" /><input aria-label="Search customer products" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, roast, or size" /></label>
      <select className="input" aria-label="Product category" value={category} onChange={event => setCategory(event.target.value)}>
        <option value="all">All categories</option>
        {PRODUCT_CATEGORY_OPTIONS.filter(option => rows.some(product => product.category === option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        {rows.some(product => product.category === 'uncategorized') ? <option value="uncategorized">Needs category</option> : null}
      </select>
      <select className="input" aria-label="Pack roast" value={roast} onChange={event => setRoast(event.target.value)}>
        <option value="all">All pack roasts</option>
        {CATALOG_ROAST_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      <select className="input" aria-label="Product visibility" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">All products</option><option value="assigned">Selected products ({assignedCount})</option><option value="review">Needs pricing ({missingCount})</option>
      </select>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600" aria-live="polite">
      <span>{groups.reduce((count, group) => count + group.products.length, 0)} products shown · {assignedCount} assigned</span>
      {filtering ? <button type="button" className="workspace-text-link" onClick={clearFilters}>Clear filters</button> : null}
    </div>
    {missingCount ? <p className="workspace-notice warning" role="status">{missingCount} assigned products need a price or complimentary approval.</p> : null}
    <div className="space-y-3">
      {groups.map(group => {
        const selectedCount = rows.filter(product => product.category === group.category && product.assigned).length;
        return <details key={`${group.category}-${filtering ? 'filtered' : 'browse'}`} open={filtering || selectedCount > 0} className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700">
            {productCategoryLabel(group.category)} <span className="ml-2 font-normal text-slate-600">{group.products.length} shown · {selectedCount} selected</span>
          </summary>
          <div className="border-t border-slate-200 px-3 sm:px-4">
            {group.roasts.map(roastGroup => <section key={roastGroup.label ?? 'products'} aria-label={roastGroup.label ?? productCategoryLabel(group.category)}>
              {roastGroup.label ? <h3 className="-mx-3 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 sm:-mx-4 sm:px-4">{roastGroup.label}</h3> : null}
              {roastGroup.products.map(product => {
                const pack = getProductPackInfo(product);
                return <div key={product.id} className="grid min-w-0 gap-3 border-b border-slate-100 py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center">
                  <label className="flex min-w-0 items-start gap-3">
                    <input type="checkbox" className="mt-1" checked={product.assigned} onChange={event => update(product.id, { assigned: event.target.checked })} />
                    <span className="min-w-0"><strong className="break-words text-sm font-medium">{product.name}</strong>
                      {isPackCategory(product.category) ? <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
                        {pack.sizeOz !== null ? <span>{pack.sizeOz} oz per pack</span> : null}
                        {pack.count !== null ? <span>{pack.count} packs per case</span> : null}
                        {pack.withFilters ? <span className="font-semibold text-teal-800">With filters</span> : null}
                      </span> : null}
                    </span>
                  </label>
                  <label className="workspace-field">Price ($)<input className="input" aria-label={`Price for ${product.name}`} value={product.amount} type="number" min="0" step="0.01" disabled={!product.assigned} onChange={event => update(product.id, { amount: event.target.value })} aria-invalid={missing(product)} /></label>
                  <label className="flex items-center gap-2 text-sm"><input aria-label={`Complimentary ${product.name}`} type="checkbox" checked={product.complimentary} disabled={!product.assigned || Number(product.amount) !== 0} onChange={event => update(product.id, { complimentary: event.target.checked })} /> Complimentary</label>
                </div>;
              })}
            </section>)}
          </div>
        </details>;
      })}
    </div>
    {!groups.length ? <div className="workspace-empty"><h3>No products found</h3>{products.length ? <button type="button" className="btn-secondary" onClick={clearFilters}>Clear filters</button> : null}</div> : null}
  </form>;
}

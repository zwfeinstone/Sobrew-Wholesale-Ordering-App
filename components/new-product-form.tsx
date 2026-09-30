'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import ProductRecipeFields, { type ProductRecipeInventoryItem } from '@/components/product-recipe-fields';
import { PRODUCT_CATEGORY_OPTIONS } from '@/lib/product-categories';

export type NewProductFormResult = { error?: string; productId?: string; successHref?: string };

export default function NewProductForm({ action, inventoryItems, initialError }: {
  action: (data: FormData) => Promise<NewProductFormResult>;
  inventoryItems: ProductRecipeInventoryItem[];
  initialError?: string;
}) {
  const router = useRouter();
  const [result, setResult] = useState<NewProductFormResult>({ error: initialError });
  const [pending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  useEffect(() => { if (result.error) errorRef.current?.focus(); }, [result]);

  return (
    <form className="space-y-6" onSubmit={(event) => {
      event.preventDefault();
      if (submitting.current || result.productId || result.successHref) return;
      const data = new FormData(event.currentTarget);
      submitting.current = true;
      // Submit manually so React does not reset recipe fields after a failed action.
      startTransition(async () => {
        try {
          const response = await action(data);
          setResult(response);
          if (response.successHref) router.push(response.successHref);
        } catch {
          setResult({ error: 'Could not confirm whether the product was saved. Check the product catalog before trying again.' });
        } finally {
          submitting.current = false;
        }
      });
    }}>
      {result.error ? <div ref={errorRef} tabIndex={-1} className="card space-y-2 text-sm text-red-700" role="alert">
        <p>{result.error}</p>
        {result.productId ? <Link className="font-semibold underline" href={`/admin/products/${result.productId}`}>Open the saved product</Link> : null}
      </div> : null}
      <fieldset disabled={pending || Boolean(result.productId || result.successHref)} className="min-w-0 space-y-6">
        <section className="card space-y-4" aria-labelledby="product-details-heading">
          <h2 id="product-details-heading" className="text-xl font-semibold text-slate-950">Product details</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-slate-700">Name<input className="input" name="name" required /></label>
            <label className="space-y-2 text-sm font-medium text-slate-700">SKU<input className="input" name="sku" required /></label>
          </div>
          <label className="block space-y-2 text-sm font-medium text-slate-700">Category
            <select className="input" name="category" required defaultValue="">
              <option value="" disabled>Select product category</option>
              {PRODUCT_CATEGORY_OPTIONS.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
          </label>
          <label className="block space-y-2 text-sm font-medium text-slate-700">Description<textarea className="input min-h-28" name="description" /></label>
          <div className="grid gap-3">
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" name="active" defaultChecked /> Active</label>
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" name="shipping_box_count_required" /> Box count required at shipping</label>
            <label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" name="receivable_finished_good" /> Can be received as purchased finished good</label>
          </div>
        </section>
        <section className="card space-y-5" aria-labelledby="product-recipe-heading">
          <div>
            <span className="eyebrow">Recipe</span>
            <h2 id="product-recipe-heading" className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Production recipe and COGS</h2>
            <p className="mt-2 text-sm text-slate-500">Choose ingredients and packaging, then enter labor and fixed costs. Everything saves with the new product.</p>
          </div>
          {!inventoryItems.length ? <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">No active ingredients or materials are available. Add them in <Link className="font-semibold underline" href="/admin/inventory">Inventory</Link> to include them in a recipe.</p> : null}
          <ProductRecipeFields inventoryItems={inventoryItems} />
        </section>
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className="btn-primary w-full sm:w-auto">{pending ? 'Creating and syncing...' : 'Create product'}</button>
          <p className="text-sm text-slate-500">Saves product details, ingredients, and COGS together.</p>
        </div>
      </fieldset>
    </form>
  );
}

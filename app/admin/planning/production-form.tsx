'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  buildProductionMaterialPreview,
  type ProductionMaterialItem,
  type ProductionMaterialRecipe,
} from '@/lib/production-materials';
import PlanningSubmitButton from './submit-button';

type Props = {
  productId: string;
  quantity: number;
  optionalQty: number;
  reviewQty: number;
  recipe: ProductionMaterialRecipe | null;
  productCategory: string | null;
  materialStockByItemId: Record<string, number>;
  materialItems: ProductionMaterialItem[];
  returnTo: string;
  disabled?: boolean;
  action: (formData: FormData) => Promise<void>;
};

function materialQuantity(value: number, unit: string) {
  if (value > 0 && value < 0.001) return `<0.001 ${unit}`;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`;
}

export default function ProductionForm({ productId, quantity, optionalQty, reviewQty, recipe, productCategory, materialStockByItemId, materialItems, returnTo, disabled = false, action }: Props) {
  const [actual, setActual] = useState(String(quantity));
  const [includeExtra, setIncludeExtra] = useState(false);
  const [includeReview, setIncludeReview] = useState(false);
  const actualQuantity = Number(actual);
  const validQuantity = Number.isSafeInteger(actualQuantity) && actualQuantity > 0;
  const reviewRequired = quantity <= 0 && optionalQty <= 0 && reviewQty > 0 && !includeReview;
  const preview = validQuantity ? buildProductionMaterialPreview({
    recipe,
    productCategory,
    quantity: actualQuantity,
    onHandByItemId: new Map(Object.entries(materialStockByItemId)),
    fallbackItems: materialItems,
  }) : null;
  const invalidPreview = preview?.missingRecipe || preview?.invalidRecipe || preview?.invalidUnit;
  const materialNames = new Map(materialItems.map((item) => [item.id, item.name || item.sku || 'Unknown material']));

  function updateExtra(extra: boolean, review: boolean) {
    // The reviewed quantity is only the increment above actionable replenishment.
    const nextExtra = optionalQty > 0 && (extra || review);
    setIncludeExtra(nextExtra);
    setIncludeReview(review);
    setActual(String(quantity + (nextExtra ? optionalQty : 0) + (review ? reviewQty : 0)));
  }

  return (
    <form action={action} className="space-y-3 border-t border-slate-200 pt-4">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="return_to" value={returnTo} />
      {optionalQty > 0 ? <label className="flex items-start gap-2 text-sm text-slate-700">
        <input className="mt-1 h-4 w-4" type="checkbox" checked={includeExtra} disabled={disabled} onChange={(event) => updateExtra(event.target.checked, event.target.checked && includeReview)} />
        Include {optionalQty.toLocaleString('en-US')} additional {optionalQty === 1 ? 'unit' : 'units'} for replenishment in this run
      </label> : null}
      {reviewQty > 0 ? <label className="flex items-start gap-2 text-sm text-amber-950">
        <input className="mt-1 h-4 w-4" type="checkbox" checked={includeReview} disabled={disabled} onChange={(event) => updateExtra(includeExtra, event.target.checked)} />
        I reviewed the low-confidence forecast; include {reviewQty.toLocaleString('en-US')} additional {reviewQty === 1 ? 'unit' : 'units'}
      </label> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block space-y-1 text-sm font-semibold text-slate-700 sm:w-36">
          <span>Actually made</span>
          <input aria-label="Actually made" className="input" type="number" name="quantity_produced" min="1" step="1" required value={actual} disabled={disabled} onChange={(event) => setActual(event.target.value)} />
        </label>
        <div><PlanningSubmitButton disabled={disabled || !validQuantity || reviewRequired} /></div>
      </div>
      {reviewRequired ? <p className="text-xs leading-relaxed text-amber-950">Review and select the forecast above before recording production for this item.</p> : null}
      {preview ? <div className={`rounded-lg border p-3 text-sm ${invalidPreview ? 'border-amber-200 bg-amber-50 text-amber-950' : preview.hasShortages ? 'border-rose-200 bg-rose-50 text-rose-950' : 'border-teal-100 bg-teal-50/60 text-teal-950'}`}>
        <p aria-live="polite" className="font-semibold">{invalidPreview
          ? 'Material estimate unavailable. Check the recipe and its units.'
          : preview.hasShortages
            ? `Materials are short for ${actualQuantity.toLocaleString('en-US')} ${actualQuantity === 1 ? 'unit' : 'units'}.`
            : `Material estimate covered for this quantity (${actualQuantity.toLocaleString('en-US')} ${actualQuantity === 1 ? 'unit' : 'units'}).`}</p>
        {!invalidPreview ? <>
          {preview.hasShortages ? <ul className="mt-2 space-y-1">{preview.lines.filter((line) => line.shortageQty > 0).map((line) => <li key={line.inventoryItemId}>{materialNames.get(line.inventoryItemId) ?? 'Unknown material'}: short {materialQuantity(line.shortageQty, line.unit)}</li>)}</ul> : null}
          <p className="mt-2 text-xs leading-relaxed">Estimate uses the stock loaded with this plan for this run alone. Other runs use the same materials. Recording checks current inventory again.</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold">Material quantities for this run</summary>
            <ul className="mt-2 space-y-2">{preview.lines.map((line) => <li key={line.inventoryItemId} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white/70 p-2 text-xs"><span className="font-medium">{materialNames.get(line.inventoryItemId) ?? 'Unknown material'}</span><span>Need {materialQuantity(line.requiredQty, line.unit)} · On hand {materialQuantity(line.availableQty, line.unit)}{line.shortageQty > 0 ? ` · Short ${materialQuantity(line.shortageQty, line.unit)}` : ''}</span></li>)}</ul>
          </details>
        </> : null}
      </div> : null}
      <p className="text-xs leading-relaxed text-slate-600">Record only after the work is finished. This adds finished stock and consumes recipe materials using estimated usage and labor.</p>
      <Link className="inline-block text-sm font-semibold text-teal-800 underline underline-offset-4" href={`/admin/production?produce_product=${encodeURIComponent(productId)}&produce_qty=${encodeURIComponent(validQuantity ? actual : String(Math.max(1, quantity + optionalQty + reviewQty)))}`}>Record actual materials, labor, waste, or notes</Link>
    </form>
  );
}

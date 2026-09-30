import {
  INVENTORY_UNITS,
  dollarsInputValueFromCents,
  formatInventoryQuantity,
  numericInputValue,
  type InventoryUnit,
} from '@/lib/inventory';

import { EXTRA_COMPONENT_ROWS, RAW_COFFEE_ROWS, RAW_COFFEE_UNITS } from '@/lib/product-recipe';

export type ProductRecipeInventoryItem = {
  id: string;
  name: string;
  sku: string | null;
  item_type: string;
  base_unit: InventoryUnit;
  active: boolean;
};

export type ProductRecipeComponent = {
  inventory_item_id: string;
  quantity: number | string;
  unit: InventoryUnit;
  component_role: string | null;
  sort_order: number | null;
  notes: string | null;
};

export type ProductRecipeDefaults = {
  output_qty: number | string;
  waste_percent: number | string;
  labor_minutes: number | string;
  labor_rate_cents: number | string;
  shipping_label_qty: number | string;
  branding_label_qty: number | string;
  notes: string | null;
};

function itemDisplayName(item: ProductRecipeInventoryItem) {
  return item.sku ? `${item.name} (${item.sku})` : item.name;
}

export default function ProductRecipeFields({
  inventoryItems,
  recipe,
  components = [],
  inventoryRemainingByItem,
}: {
  inventoryItems: ProductRecipeInventoryItem[];
  recipe?: ProductRecipeDefaults | null;
  components?: ProductRecipeComponent[];
  inventoryRemainingByItem?: ReadonlyMap<string, { remaining: number }>;
}) {
  const rawCoffeeItems = inventoryItems.filter((item) => item.item_type === 'raw_coffee');
  const materialItems = inventoryItems.filter((item) => item.item_type === 'material_supply');
  const recipeComponents = [...components].sort((a, b) => {
    const sortOrderA = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : Number.MAX_SAFE_INTEGER;
    const sortOrderB = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : Number.MAX_SAFE_INTEGER;
    return sortOrderA - sortOrderB || (a.component_role ?? '').localeCompare(b.component_role ?? '') || (a.notes ?? '').localeCompare(b.notes ?? '');
  });
  const rawCoffeeComponents = recipeComponents.filter((component) => component.component_role === 'raw_coffee');
  const extraComponents = recipeComponents.filter((component) => component.component_role === 'material_supply');
  const componentByRole = new Map(recipeComponents.map((component) => [component.component_role ?? '', component]));

  return (
    <>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Finished units this recipe makes
          <input className="input" name="output_qty" min="0.0001" step="0.0001" type="number" defaultValue={numericInputValue(recipe?.output_qty) || '1'} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Planned waste or shrink %
          <input className="input" name="waste_percent" min="0" step="0.01" type="number" defaultValue={numericInputValue(recipe?.waste_percent) || '0'} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Labor minutes
          <input className="input" name="labor_minutes" min="0" step="0.01" type="number" defaultValue={numericInputValue(recipe?.labor_minutes)} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Labor rate/hour
          <input className="input" name="labor_rate" min="0" step="0.01" type="number" defaultValue={dollarsInputValueFromCents(recipe?.labor_rate_cents)} />
        </label>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
        <p className="text-sm font-semibold text-slate-950">Raw coffee used for this recipe output</p>
        <div className="mt-3 space-y-3">
          {Array.from({ length: RAW_COFFEE_ROWS }).map((_, index) => {
            const existing = rawCoffeeComponents[index];
            return (
              <div key={index} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_8rem]">
                <select className="input" aria-label={`Raw coffee ${index + 1}`} name={`raw_coffee_item_id_${index}`} defaultValue={existing?.inventory_item_id ?? ''}>
                  <option value="">{index === 0 ? 'Select raw coffee' : 'Add another raw coffee'}</option>
                  {rawCoffeeItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)}{inventoryRemainingByItem ? ` - ${formatInventoryQuantity(inventoryRemainingByItem.get(item.id)?.remaining ?? 0, item.base_unit)}` : ''}</option>)}
                </select>
                <input className="input" aria-label={`Raw coffee ${index + 1} amount`} name={`raw_coffee_qty_${index}`} min="0" step="0.0001" type="number" placeholder="Amount" defaultValue={numericInputValue(existing?.quantity)} />
                <select className="input" aria-label={`Raw coffee ${index + 1} unit`} name={`raw_coffee_unit_${index}`} defaultValue={RAW_COFFEE_UNITS.includes(existing?.unit as InventoryUnit) ? existing?.unit : 'oz'}>
                  {RAW_COFFEE_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
        <p className="text-sm font-semibold text-slate-950">Tracked materials and supplies</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {[
            ['fraction_bag', 'Fraction bag'],
            ['box', 'Box'],
            ['filter_pack', 'Filter packs'],
            ['bag', 'Bag'],
          ].map(([role, label]) => {
            const existing = componentByRole.get(role);
            return (
              <div key={role} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  {label}
                  <select className="input" name={`${role}_item_id`} defaultValue={existing?.inventory_item_id ?? ''}>
                    <option value="">Select item</option>
                    {materialItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)}</option>)}
                  </select>
                </label>
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Qty
                  <input className="input" aria-label={`${label} quantity`} name={`${role}_qty`} min="0" step="1" type="number" defaultValue={numericInputValue(existing?.quantity)} />
                </label>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-slate-500">Tape COGS is fixed at $0.05 per box quantity and does not create tape inventory.</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
        <p className="text-sm font-semibold text-slate-950">Fixed non-stock labels</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Shipping label quantity at $0.02 each
            <input className="input" name="shipping_label_qty" min="0" step="0.0001" type="number" defaultValue={numericInputValue(recipe?.shipping_label_qty)} />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Branding label quantity at $0.04 each
            <input className="input" name="branding_label_qty" min="0" step="0.0001" type="number" defaultValue={numericInputValue(recipe?.branding_label_qty)} />
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
        <p className="text-sm font-semibold text-slate-950">Additional tracked components</p>
        <div className="mt-3 space-y-3">
          {Array.from({ length: EXTRA_COMPONENT_ROWS }).map((_, index) => {
            const extra = extraComponents[index];
            return (
              <div key={index} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem_minmax(0,1fr)]">
                <select className="input" aria-label={`Additional component ${index + 1}`} name={`extra_item_id_${index}`} defaultValue={extra?.inventory_item_id ?? ''}>
                  <option value="">Add another item</option>
                  {materialItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)}</option>)}
                </select>
                <input className="input" aria-label={`Additional component ${index + 1} quantity`} name={`extra_qty_${index}`} min="0" step="0.0001" type="number" placeholder="Qty" defaultValue={numericInputValue(extra?.quantity)} />
                <select className="input" aria-label={`Additional component ${index + 1} unit`} name={`extra_unit_${index}`} defaultValue={extra?.unit ?? 'each'}>
                  {INVENTORY_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                </select>
                <input className="input" aria-label={`Additional component ${index + 1} note`} name={`extra_note_${index}`} placeholder="Note" defaultValue={extra?.notes ?? ''} />
              </div>
            );
          })}
        </div>
      </div>

      <label className="block space-y-2 text-sm font-medium text-slate-700">
        Recipe notes
        <textarea className="input min-h-20" name="recipe_notes" defaultValue={recipe?.notes ?? ''} placeholder="Recipe notes" />
      </label>
    </>
  );
}

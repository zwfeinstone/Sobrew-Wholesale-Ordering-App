import { notFound, redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  INVENTORY_UNITS,
  centsFromDollars,
  convertInventoryQuantity,
  dollarsInputValueFromCents,
  fixedRecipeCostCents,
  formatInventoryQuantity,
  isWholeCountPackagingComponentRole,
  isWholeCountQuantity,
  laborCostCents,
  normalizeInventoryNumber,
  numericInputValue,
  roundWholeCountQuantity,
  type InventoryUnit,
} from '@/lib/inventory';
import { PRODUCT_CATEGORY_OPTIONS, isProductCategory } from '@/lib/product-categories';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd } from '@/lib/utils';

const EXTRA_COMPONENT_ROWS = 4;

type InventoryItemRow = {
  id: string;
  name: string;
  sku: string | null;
  item_type: string;
  base_unit: InventoryUnit;
  active: boolean;
};

type RecipeComponentRow = {
  id: string;
  inventory_item_id: string;
  quantity: number | string;
  unit: InventoryUnit;
  component_role: string | null;
  notes: string | null;
  inventory_items?: InventoryItemRow | InventoryItemRow[] | null;
};

type RecipeRow = {
  id: string;
  product_id: string;
  output_qty: number | string;
  waste_percent: number | string;
  labor_minutes: number | string;
  labor_rate_cents: number | string;
  shipping_label_qty: number | string;
  branding_label_qty: number | string;
  notes: string | null;
  product_recipe_components?: RecipeComponentRow[] | null;
};

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function itemDisplayName(item: InventoryItemRow | undefined | null) {
  if (!item) return 'Unknown item';
  return item.sku ? `${item.name} (${item.sku})` : item.name;
}

function parsePositiveNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseWholeCountNumber(value: FormDataEntryValue | null) {
  const quantity = parsePositiveNumber(value);
  if (quantity <= 0) return 0;
  if (!isWholeCountQuantity(quantity)) throw new Error('Packaging quantities must be whole numbers.');
  return roundWholeCountQuantity(quantity);
}

async function updateProduct(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  await requireAdminWriteAccess(`/admin/products/${id}?error=admin_write_denied`, 'products');

  const category = String(formData.get('category') ?? '');
  if (!isProductCategory(category)) redirect(`/admin/products/${id}?error=invalid_category`);

  const supabase = await createClient();
  const file = formData.get('image') as File;
  let image_url;
  if (file?.size) {
    const path = `${id}/${Date.now()}-${file.name}`;
    await supabaseAdmin.storage.from('products').upload(path, file, { upsert: true });
    image_url = supabaseAdmin.storage.from('products').getPublicUrl(path).data.publicUrl;
  }
  await supabase.from('products').update({
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    category,
    active: formData.get('active') === 'on',
    shipping_box_count_required: formData.get('shipping_box_count_required') === 'on',
    ...(image_url ? { image_url } : {})
  }).eq('id', id);
  redirect(`/admin/products/${id}`);
}

async function removeProduct(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  await requireAdminWriteAccess(`/admin/products/${id}?error=admin_write_denied`, 'products');

  const supabase = await createClient();
  await supabase.from('products').delete().eq('id', id);
  redirect('/admin/products');
}

async function saveRecipe(formData: FormData) {
  'use server';
  const productId = String(formData.get('product_id') ?? '');
  await requireAdminWriteAccess(`/admin/products/${productId}?toast=admin_write_denied`, 'products');

  const supabase = await createClient();
  const outputQty = Math.max(1, parsePositiveNumber(formData.get('output_qty'), 1));
  const wastePercent = Math.max(0, parsePositiveNumber(formData.get('waste_percent'), 0));
  const laborMinutes = Math.max(0, Number.parseFloat(String(formData.get('labor_minutes') ?? '0')) || 0);
  const laborRateCents = centsFromDollars(String(formData.get('labor_rate') ?? '0'));
  const shippingLabelQty = Math.max(0, Number.parseFloat(String(formData.get('shipping_label_qty') ?? '0')) || 0);
  const brandingLabelQty = Math.max(0, Number.parseFloat(String(formData.get('branding_label_qty') ?? '0')) || 0);
  const componentMap = new Map<string, { inventory_item_id: string; quantity: number; unit: string; component_role: string; sort_order: number; notes: string | null }>();

  function addComponent(inventoryItemId: string, quantity: number, unit: string, componentRole: string, sortOrder: number, notes?: string) {
    if (!inventoryItemId || quantity <= 0 || !INVENTORY_UNITS.some((inventoryUnit) => inventoryUnit.value === unit)) return;
    const key = `${componentRole}:${inventoryItemId}:${unit}`;
    const existing = componentMap.get(key);
    componentMap.set(key, {
      inventory_item_id: inventoryItemId,
      quantity: (existing?.quantity ?? 0) + quantity,
      unit,
      component_role: componentRole,
      sort_order: Math.min(existing?.sort_order ?? sortOrder, sortOrder),
      notes: notes || existing?.notes || null,
    });
  }

  addComponent(
    String(formData.get('raw_coffee_item_id') ?? ''),
    parsePositiveNumber(formData.get('raw_coffee_qty')),
    String(formData.get('raw_coffee_unit') ?? 'oz'),
    'raw_coffee',
    0,
    'Raw coffee'
  );
  try {
    addComponent(String(formData.get('fraction_bag_item_id') ?? ''), parseWholeCountNumber(formData.get('fraction_bag_qty')), 'each', 'fraction_bag', 10, 'Fraction bag');
    addComponent(String(formData.get('box_item_id') ?? ''), parseWholeCountNumber(formData.get('box_qty')), 'each', 'box', 20, 'Box');
    addComponent(String(formData.get('filter_pack_item_id') ?? ''), parseWholeCountNumber(formData.get('filter_pack_qty')), 'each', 'filter_pack', 30, 'Filter pack');
    addComponent(String(formData.get('bag_item_id') ?? ''), parseWholeCountNumber(formData.get('bag_qty')), 'each', 'bag', 40, 'Bag');
  } catch {
    redirect(`/admin/products/${productId}?toast=recipe_error`);
  }

  for (let index = 0; index < EXTRA_COMPONENT_ROWS; index += 1) {
    addComponent(
      String(formData.get(`extra_item_id_${index}`) ?? ''),
      parsePositiveNumber(formData.get(`extra_qty_${index}`)),
      String(formData.get(`extra_unit_${index}`) ?? 'each'),
      'material_supply',
      100 + index,
      String(formData.get(`extra_note_${index}`) ?? '').trim()
    );
  }

  if (!productId) redirect('/admin/products?toast=recipe_error');

  const { data: recipe, error: recipeError } = await supabase
    .from('product_recipes')
    .upsert({
      product_id: productId,
      output_qty: outputQty,
      waste_percent: wastePercent,
      labor_minutes: laborMinutes,
      labor_rate_cents: laborRateCents,
      shipping_label_qty: shippingLabelQty,
      branding_label_qty: brandingLabelQty,
      notes: String(formData.get('recipe_notes') ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' })
    .select('id')
    .single();

  if (recipeError || !recipe) redirect(`/admin/products/${productId}?toast=recipe_error`);

  const { error: deleteError } = await supabase.from('product_recipe_components').delete().eq('recipe_id', recipe.id);
  if (deleteError) redirect(`/admin/products/${productId}?toast=recipe_error`);

  const components = [...componentMap.values()].sort((a, b) => a.sort_order - b.sort_order);
  if (components.length) {
    const { error: componentError } = await supabase.from('product_recipe_components').insert(
      components.map((component, index) => ({
        recipe_id: recipe.id,
        ...component,
        sort_order: index,
      }))
    );
    if (componentError) redirect(`/admin/products/${productId}?toast=recipe_error`);
  }

  redirect(`/admin/products/${productId}?toast=recipe_saved`);
}

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const { data: product } = await supabase.from('products').select('*').eq('id', params.id).single();
  if (!product) return notFound();
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const [{ data: items }, { data: recipeData }, { data: lots }] = await Promise.all([
    supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,active').neq('item_type', 'finished_good').eq('active', true).order('name', { ascending: true }),
    supabase.from('product_recipes').select('id,product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,shipping_label_qty,branding_label_qty,notes,product_recipe_components(id,inventory_item_id,quantity,unit,component_role,notes,inventory_items(id,name,sku,item_type,base_unit,active))').eq('product_id', params.id).maybeSingle(),
    supabase.from('inventory_lots').select('inventory_item_id,quantity_remaining,unit_cost_cents').limit(50000),
  ]);
  const inventoryItems = (items ?? []) as InventoryItemRow[];
  const rawCoffeeItems = inventoryItems.filter((item) => item.item_type === 'raw_coffee');
  const materialItems = inventoryItems.filter((item) => item.item_type === 'material_supply');
  const recipe = recipeData as RecipeRow | null;
  const recipeComponents = (recipe?.product_recipe_components ?? []).sort((a, b) => (a.component_role ?? '').localeCompare(b.component_role ?? '') || (a.notes ?? '').localeCompare(b.notes ?? ''));
  const componentByRole = new Map(recipeComponents.map((component) => [component.component_role ?? '', component]));
  const lotSummaryByItem = new Map<string, { remaining: number; avgCostCents: number }>();
  for (const item of inventoryItems) {
    const itemLots = (lots ?? []).filter((lot: any) => lot.inventory_item_id === item.id);
    const remaining = itemLots.reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    const valueCents = itemLots.reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining) * normalizeInventoryNumber(lot.unit_cost_cents), 0);
    lotSummaryByItem.set(item.id, { remaining, avgCostCents: remaining > 0 ? valueCents / remaining : 0 });
  }
  const boxQty = recipeComponents.filter((component) => component.component_role === 'box' || relatedOne(component.inventory_items)?.sku?.startsWith('BOX-')).reduce((sum, component) => sum + normalizeInventoryNumber(component.quantity), 0);
  const fixedCostForRecipeOutput = fixedRecipeCostCents({
    boxQty,
    shippingLabelQty: recipe?.shipping_label_qty,
    brandingLabelQty: recipe?.branding_label_qty,
  });
  const laborCostForRecipeOutput = laborCostCents(recipe?.labor_minutes, recipe?.labor_rate_cents);
  const materialCostForRecipeOutput = recipeComponents.reduce((sum, component) => {
    const item = relatedOne(component.inventory_items);
    if (!item) return sum;
    try {
      const rawBaseQty = convertInventoryQuantity(normalizeInventoryNumber(component.quantity), component.unit, item.base_unit);
      const baseQty = isWholeCountPackagingComponentRole(component.component_role) && item.base_unit === 'each'
        ? roundWholeCountQuantity(rawBaseQty)
        : rawBaseQty;
      return sum + baseQty * (lotSummaryByItem.get(component.inventory_item_id)?.avgCostCents ?? 0);
    } catch {
      return sum;
    }
  }, 0);
  const recipeOutputQty = normalizeInventoryNumber(recipe?.output_qty) || 1;
  const estimatedUnitCogs = (materialCostForRecipeOutput + fixedCostForRecipeOutput + laborCostForRecipeOutput) / recipeOutputQty;

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Catalog Admin</span>
        <h1 className="page-title mt-4">Edit product</h1>
        <p className="page-subtitle mt-3">Update availability, refresh product copy, or upload a cleaner product image.</p>
      </section>
      {error ? (
        <div className="card text-sm text-red-700">
          {error === 'admin_write_denied' ? 'Only superadmins can change admin data.' : 'Choose a product category before saving.'}
        </div>
      ) : null}
      {toast === 'recipe_saved' ? <StatusToast message="Product recipe saved." tone="success" /> : null}
      {toast === 'recipe_error' ? <StatusToast message="Unable to save product recipe." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only superadmins can change admin data." tone="error" /> : null}
      <form action={updateProduct} className="card space-y-4">
        <input type="hidden" name="id" value={product.id} />
        <input className="input" name="name" defaultValue={product.name} required />
        <select className="input" name="category" required defaultValue={product.category ?? ''}>
          <option value="" disabled>Select product category</option>
          {PRODUCT_CATEGORY_OPTIONS.map((category) => (
            <option key={category.value} value={category.value}>{category.label}</option>
          ))}
        </select>
        <textarea className="input min-h-28" name="description" defaultValue={product.description ?? ''} />
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700"><input type="checkbox" name="active" defaultChecked={product.active} /> Active</label>
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700"><input type="checkbox" name="shipping_box_count_required" defaultChecked={Boolean(product.shipping_box_count_required)} /> Box count required at shipping</label>
        <input className="input" type="file" name="image" accept="image/*" />
        <PendingSubmitButton className="btn-primary" label="Save" pendingLabel="Saving..." />
      </form>

      <section className="card space-y-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <span className="eyebrow">Recipe</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Production recipe and COGS</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">Coffee and materials are consumed from inventory. Tape, shipping labels, branding labels, and labor are fixed COGS lines, not inventory.</p>
          </div>
          <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4 text-sm">
            <p className="font-semibold text-teal-900">Estimated unit COGS</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{usd(Math.round(estimatedUnitCogs))}</p>
            <p className="mt-1 text-teal-800">Materials {usd(Math.round(materialCostForRecipeOutput))} - Fixed {usd(Math.round(fixedCostForRecipeOutput))} - Labor {usd(Math.round(laborCostForRecipeOutput))}</p>
          </div>
        </div>

        <form action={saveRecipe} className="space-y-5">
          <input type="hidden" name="product_id" value={product.id} />
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
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_8rem]">
              <select className="input" name="raw_coffee_item_id" defaultValue={componentByRole.get('raw_coffee')?.inventory_item_id ?? ''}>
                <option value="">Select raw coffee</option>
                {rawCoffeeItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)} - {formatInventoryQuantity(lotSummaryByItem.get(item.id)?.remaining ?? 0, item.base_unit)}</option>)}
              </select>
              <input className="input" name="raw_coffee_qty" min="0" step="0.0001" type="number" placeholder="Amount" defaultValue={numericInputValue(componentByRole.get('raw_coffee')?.quantity)} />
              <select className="input" name="raw_coffee_unit" defaultValue={componentByRole.get('raw_coffee')?.unit ?? 'oz'}>
                <option value="oz">oz</option>
                <option value="lb">lb</option>
              </select>
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
                      <input className="input" name={`${role}_qty`} min="0" step="1" type="number" defaultValue={numericInputValue(existing?.quantity)} />
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
                const extra = recipeComponents.filter((component) => component.component_role === 'material_supply')[index];
                return (
                  <div key={index} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem_minmax(0,1fr)]">
                    <select className="input" name={`extra_item_id_${index}`} defaultValue={extra?.inventory_item_id ?? ''}>
                      <option value="">Add another item</option>
                      {materialItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)}</option>)}
                    </select>
                    <input className="input" name={`extra_qty_${index}`} min="0" step="0.0001" type="number" placeholder="Qty" defaultValue={numericInputValue(extra?.quantity)} />
                    <select className="input" name={`extra_unit_${index}`} defaultValue={extra?.unit ?? 'each'}>
                      {INVENTORY_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                    </select>
                    <input className="input" name={`extra_note_${index}`} placeholder="Note" defaultValue={extra?.notes ?? ''} />
                  </div>
                );
              })}
            </div>
          </div>

          <textarea className="input min-h-20" name="recipe_notes" defaultValue={recipe?.notes ?? ''} placeholder="Recipe notes" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save product recipe" pendingLabel="Saving..." />
        </form>
      </section>

      <form action={removeProduct}><input type="hidden" name="id" value={product.id} /><PendingSubmitButton className="rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50" label="Delete" pendingLabel="Deleting..." /></form>
    </div>
  );
}

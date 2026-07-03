import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { hasSuperadminAccess } from '@/lib/admin-permission-definitions';
import { requireAdmin } from '@/lib/auth';
import {
  centsFromDollars,
  dollarsInputValueFromCents,
  fixedRecipeCostCents,
  formatInventoryQuantity,
  isWholeCountPackagingComponentRole,
  laborCostCents,
  normalizeInventoryNumber,
  numericInputValue,
  recipeComponentWasteMultiplier,
  roundWholeCountQuantity,
  scaledRecipeCostForQuantity,
  type InventoryUnit,
} from '@/lib/inventory';
import { recordRecipeProductionRun } from '@/lib/inventory-production';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

type ProductRow = {
  id: string;
  name: string | null;
  sku: string | null;
  active: boolean | null;
};

type InventoryItemRow = {
  id: string;
  name: string;
  sku: string | null;
  item_type: string;
  base_unit: InventoryUnit;
};

type InventoryLotRow = {
  id: string;
  inventory_item_id: string;
  quantity_remaining: number | string;
  unit_cost_cents: number | string;
};

type RecipeComponentRow = {
  id: string;
  inventory_item_id: string;
  quantity: number | string;
  unit: InventoryUnit;
  component_role: string | null;
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
  product_recipe_components?: RecipeComponentRow[] | null;
};

type ProductionRunRow = {
  id: string;
  product_id: string;
  finished_lot_id: string | null;
  quantity_produced: number | string;
  quantity_voided?: number | string | null;
  status?: string | null;
  actual_unit_cost_cents: number | string | null;
  actual_labor_cost_cents: number | string | null;
  fixed_cost_cents: number | string | null;
  fixed_tape_cost_cents: number | string | null;
  fixed_shipping_label_cost_cents: number | string | null;
  fixed_branding_label_cost_cents: number | string | null;
  fixed_other_cost_cents: number | string | null;
  produced_at: string | null;
  void_reason?: string | null;
  voided_at?: string | null;
  products?: { name: string | null } | Array<{ name: string | null }> | null;
};

type ProductionRunVoidRow = {
  production_run_id: string;
  quantity_voided: number | string;
  reason: string;
  voided_at: string | null;
};

function productionHref(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return search ? `/admin/production?${search}` : '/admin/production';
}

function productName(product: ProductRow | undefined | null) {
  return product?.name?.trim() || 'Unnamed product';
}

function itemDisplayName(item: InventoryItemRow | undefined | null) {
  if (!item) return 'Unknown item';
  return item.sku ? `${item.name} (${item.sku})` : item.name;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parsePositiveNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatRunDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(date);
}

function productionStatusLabel(status: string | null | undefined) {
  if (status === 'void') return 'Voided';
  if (status === 'partially_voided') return 'Partially voided';
  return 'Active';
}

function productionStatusClass(status: string | null | undefined) {
  if (status === 'void') return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (status === 'partially_voided') return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
}

function isBoxComponent(component: RecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  return component.component_role === 'box' || Boolean(item?.sku?.startsWith('BOX-'));
}

async function recordProductionRun(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(productionHref({ toast: 'admin_write_denied' }), 'production');

  const productId = String(formData.get('product_id') ?? '');
  const quantityProduced = parsePositiveNumber(formData.get('quantity_produced'));
  const wasteQuantity = Math.max(0, parsePositiveNumber(formData.get('waste_quantity'), 0));
  const actualQuantityByComponentId = new Map<string, number>();

  for (const [key, value] of formData.entries()) {
    if (key.startsWith('actual_')) {
      actualQuantityByComponentId.set(key.replace('actual_', ''), Math.max(0, Number.parseFloat(String(value)) || 0));
    }
  }

  const actualLaborMinutesValue = String(formData.get('actual_labor_minutes') ?? '').trim();
  const actualLaborRateValue = String(formData.get('actual_labor_rate') ?? '').trim();
  const supabase = await createClient();
  const result = await recordRecipeProductionRun({
    actualLaborMinutes: actualLaborMinutesValue ? Math.max(0, Number.parseFloat(actualLaborMinutesValue) || 0) : undefined,
    actualLaborRateCents: actualLaborRateValue ? centsFromDollars(actualLaborRateValue) : undefined,
    actualQuantityByComponentId,
    notes: String(formData.get('notes') ?? '').trim(),
    productId,
    quantityProduced,
    supabase,
    wasteQuantity,
  });

  if (result.error === 'unit_error') {
    redirect(productionHref({ produce_product: productId, produce_qty: String(quantityProduced), toast: 'production_unit_error' }));
  }
  if (result.error === 'insufficient_inventory') {
    redirect(productionHref({ produce_product: productId, produce_qty: String(quantityProduced), toast: 'production_inventory_error' }));
  }
  redirect(productionHref({ toast: result.error ? 'production_error' : 'production_recorded' }));
}

async function voidProductionRun(formData: FormData) {
  'use server';
  const { user, profile } = await requireAdmin();
  const isSuperadmin = hasSuperadminAccess(user.email || profile?.email, profile?.is_superadmin);
  if (!isSuperadmin) {
    redirect(productionHref({ toast: 'production_void_denied' }));
  }

  const runId = String(formData.get('production_run_id') ?? '').trim();
  const quantityToVoid = parsePositiveNumber(formData.get('quantity_to_void'));
  const reason = String(formData.get('reason') ?? '').trim();

  if (!runId || quantityToVoid <= 0 || !reason) {
    redirect(productionHref({ toast: 'production_void_missing' }));
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('void_inventory_production_run', {
    p_production_run_id: runId,
    p_quantity_to_void: quantityToVoid,
    p_reason: reason,
  });

  if (error) {
    const message = String(error.message ?? '').toLowerCase();
    if (message.includes('superadmin')) redirect(productionHref({ toast: 'production_void_denied' }));
    if (message.includes('exceeds')) redirect(productionHref({ toast: 'production_void_exceeds' }));
    if (message.includes('finished lot')) redirect(productionHref({ toast: 'production_void_lot_error' }));
    if (message.includes('required') || message.includes('greater than zero')) redirect(productionHref({ toast: 'production_void_missing' }));
    redirect(productionHref({ toast: 'production_void_error' }));
  }

  redirect(productionHref({ toast: 'production_voided' }));
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { user, profile } = await requireAdmin();
  const canVoidProductionRuns = hasSuperadminAccess(user.email || profile?.email, profile?.is_superadmin);
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const produceProductId = typeof searchParams?.produce_product === 'string' ? searchParams.produce_product : '';
  const produceQty = typeof searchParams?.produce_qty === 'string' ? searchParams.produce_qty : '';
  const [{ data: products }, { data: recipes }, { data: lots }, { data: runs }] = await Promise.all([
    supabase.from('products').select('id,name,sku,active').eq('active', true).order('name', { ascending: true }),
    supabase.from('product_recipes').select('id,product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,shipping_label_qty,branding_label_qty,product_recipe_components(id,inventory_item_id,quantity,unit,component_role,inventory_items(id,name,sku,item_type,base_unit))'),
    supabase.from('inventory_lots').select('id,inventory_item_id,quantity_remaining,unit_cost_cents').limit(50000),
    supabase.from('production_runs').select('id,product_id,finished_lot_id,quantity_produced,quantity_voided,status,actual_unit_cost_cents,actual_labor_cost_cents,fixed_cost_cents,fixed_tape_cost_cents,fixed_shipping_label_cost_cents,fixed_branding_label_cost_cents,fixed_other_cost_cents,produced_at,voided_at,void_reason,products(name)').order('produced_at', { ascending: false }).limit(10),
  ]);

  const productRows = (products ?? []) as ProductRow[];
  const recipeRows = (recipes ?? []) as RecipeRow[];
  const lotRows = (lots ?? []) as InventoryLotRow[];
  const runRows = (runs ?? []) as ProductionRunRow[];
  const runIds = runRows.map((run) => run.id);
  const { data: voidEvents } = runIds.length
    ? await supabase
        .from('production_run_voids')
        .select('production_run_id,quantity_voided,reason,voided_at')
        .in('production_run_id', runIds)
        .order('voided_at', { ascending: false })
    : { data: [] as ProductionRunVoidRow[] };
  const voidEventsByRunId = new Map<string, ProductionRunVoidRow[]>();
  for (const event of (voidEvents ?? []) as ProductionRunVoidRow[]) {
    const rows = voidEventsByRunId.get(event.production_run_id) ?? [];
    rows.push(event);
    voidEventsByRunId.set(event.production_run_id, rows);
  }
  const lotById = new Map(lotRows.map((lot) => [lot.id, lot]));
  const productById = new Map(productRows.map((product) => [product.id, product]));
  const productionProductId = produceProductId || recipeRows[0]?.product_id || '';
  const productionRecipe = recipeRows.find((recipe) => recipe.product_id === productionProductId);
  const productionQty = Math.max(0, Number.parseFloat(produceQty || '0'));
  const components = (productionRecipe?.product_recipe_components ?? []).sort((a, b) => (a.component_role ?? '').localeCompare(b.component_role ?? ''));

  const lotSummaryByItem = new Map<string, { remaining: number; avgCostCents: number }>();
  for (const lot of lotRows) {
    const existing = lotSummaryByItem.get(lot.inventory_item_id) ?? { remaining: 0, avgCostCents: 0 };
    existing.remaining += normalizeInventoryNumber(lot.quantity_remaining);
    lotSummaryByItem.set(lot.inventory_item_id, existing);
  }
  for (const [itemId, summary] of lotSummaryByItem.entries()) {
    const itemLots = lotRows.filter((lot) => lot.inventory_item_id === itemId);
    const value = itemLots.reduce((sum, lot) => sum + normalizeInventoryNumber(lot.quantity_remaining) * normalizeInventoryNumber(lot.unit_cost_cents), 0);
    summary.avgCostCents = summary.remaining > 0 ? value / summary.remaining : 0;
  }

  const outputQty = normalizeInventoryNumber(productionRecipe?.output_qty) || 1;
  const boxQty = components.filter(isBoxComponent).reduce((sum, component) => sum + normalizeInventoryNumber(component.quantity), 0);
  const fixedCostForRecipeOutput = fixedRecipeCostCents({
    boxQty,
    shippingLabelQty: productionRecipe?.shipping_label_qty,
    brandingLabelQty: productionRecipe?.branding_label_qty,
  });
  const fixedCostForRun = productionRecipe && productionQty > 0 ? scaledRecipeCostForQuantity(fixedCostForRecipeOutput, outputQty, productionQty) : 0;
  const expectedLaborMinutes = productionRecipe && productionQty > 0 ? (normalizeInventoryNumber(productionRecipe.labor_minutes) / outputQty) * productionQty : 0;
  const expectedLaborCost = productionRecipe && productionQty > 0
    ? scaledRecipeCostForQuantity(laborCostCents(productionRecipe.labor_minutes, productionRecipe.labor_rate_cents), outputQty, productionQty)
    : 0;

  return (
    <div className="space-y-6">
      {toast === 'production_recorded' ? <StatusToast message="Production run recorded and sellable inventory updated." tone="success" /> : null}
      {toast === 'production_error' ? <StatusToast message="Unable to record production. Check recipe setup and available materials." tone="error" /> : null}
      {toast === 'production_inventory_error' ? <StatusToast message="Unable to record production because one or more recipe materials do not have enough inventory." tone="error" /> : null}
      {toast === 'production_unit_error' ? <StatusToast message="A recipe component uses units that cannot be converted." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="You do not have permission to edit production." tone="error" /> : null}
      {toast === 'production_voided' ? <StatusToast message="Production run voided and inventory reversed." tone="success" /> : null}
      {toast === 'production_void_denied' ? <StatusToast message="Only superadmins can void production runs." tone="error" /> : null}
      {toast === 'production_void_missing' ? <StatusToast message="Enter a void quantity and reason before voiding a production run." tone="error" /> : null}
      {toast === 'production_void_exceeds' ? <StatusToast message="Unable to void more than the unused finished goods from this run." tone="error" /> : null}
      {toast === 'production_void_lot_error' ? <StatusToast message="Unable to void because the finished production lot could not be verified." tone="error" /> : null}
      {toast === 'production_void_error' ? <StatusToast message="Unable to void production run. No inventory was changed." tone="error" /> : null}

      <section className="panel">
        <span className="eyebrow">Production</span>
        <h1 className="page-title mt-4">Add sellable inventory</h1>
        <p className="page-subtitle mt-3">Choose a product recipe, confirm the run, and snapshot materials, fixed costs, and labor into finished COGS.</p>
      </section>

      <section className="card space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <span className="eyebrow">Plan Run</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Record finished production</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">Products must have a saved recipe before production can add sellable inventory.</p>
          </div>
          <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <select className="input min-w-64" name="produce_product" defaultValue={productionProductId}>
              {recipeRows.map((recipe) => {
                const product = productById.get(recipe.product_id);
                return <option key={recipe.product_id} value={recipe.product_id}>{productName(product)}</option>;
              })}
            </select>
            <input className="input" name="produce_qty" min="1" step="1" type="number" placeholder="Qty" defaultValue={produceQty || '1'} />
            <button className="btn-secondary">Load run</button>
          </form>
        </div>

        {productionRecipe && productionQty > 0 ? (
          <form action={recordProductionRun} className="space-y-4">
            <input type="hidden" name="product_id" value={productionProductId} />
            <input type="hidden" name="quantity_produced" value={productionQty} />
            <div className="grid gap-3 rounded-2xl border border-teal-100 bg-teal-50/60 p-4 text-sm sm:grid-cols-3">
              <div>
                <p className="font-semibold text-teal-900">Finished output</p>
                <p className="mt-1 text-teal-800">{formatInventoryQuantity(productionQty, 'each')} of {productName(productById.get(productionProductId))}</p>
              </div>
              <div>
                <p className="font-semibold text-teal-900">Fixed label/tape cost</p>
                <p className="mt-1 text-teal-800">{usd(Math.round(fixedCostForRun))}</p>
              </div>
              <div>
                <p className="font-semibold text-teal-900">Expected labor</p>
                <p className="mt-1 text-teal-800">{usd(Math.round(expectedLaborCost))}</p>
              </div>
            </div>
            <div className="space-y-3">
              {components.map((component) => {
                const item = relatedOne(component.inventory_items);
                const rawExpected = (
                  normalizeInventoryNumber(component.quantity) / outputQty
                ) * productionQty * recipeComponentWasteMultiplier(component.component_role, productionRecipe.waste_percent);
                const expected = isWholeCountPackagingComponentRole(component.component_role) && item?.base_unit === 'each'
                  ? roundWholeCountQuantity(rawExpected)
                  : rawExpected;
                const quantityStep = isWholeCountPackagingComponentRole(component.component_role) && item?.base_unit === 'each' ? '1' : '0.0001';
                const summary = lotSummaryByItem.get(component.inventory_item_id);
                return (
                  <div key={component.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 md:grid-cols-[minmax(0,1fr)_10rem_7rem] md:items-center">
                    <div>
                      <p className="font-semibold text-slate-950">{itemDisplayName(item)}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        Expected {formatInventoryQuantity(expected, component.unit)} - Available {formatInventoryQuantity(summary?.remaining ?? 0, item?.base_unit)}
                      </p>
                    </div>
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Actual used
                      <input className="input" name={`actual_${component.id}`} min="0" step={quantityStep} type="number" defaultValue={numericInputValue(expected)} />
                    </label>
                    <p className="text-sm text-slate-500 md:self-end">in {component.unit}</p>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Actual labor minutes
                <input className="input" name="actual_labor_minutes" min="0" step="0.01" type="number" defaultValue={numericInputValue(expectedLaborMinutes)} />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Actual labor rate/hour
                <input className="input" name="actual_labor_rate" min="0" step="0.01" type="number" defaultValue={dollarsInputValueFromCents(productionRecipe.labor_rate_cents)} />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Finished units lost
                <input className="input" name="waste_quantity" min="0" step="0.0001" type="number" placeholder="0" />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Production notes
                <input className="input" name="notes" placeholder="Run notes" />
              </label>
            </div>
            <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Record production run" pendingLabel="Recording..." />
          </form>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">
            Save a recipe on a product, choose it here, and enter a quantity to build a production run.
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <div>
          <span className="eyebrow">Recent Runs</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">COGS snapshots</h2>
          <p className="mt-2 text-sm text-slate-500">These costs remain tied to each run even if recipe labor or material costs change later.</p>
        </div>
        <div className="space-y-3">
          {runRows.map((run) => {
            const runProduct = relatedOne(run.products);
            const finishedLot = run.finished_lot_id ? lotById.get(run.finished_lot_id) : undefined;
            const quantityProduced = normalizeInventoryNumber(run.quantity_produced);
            const quantityVoided = normalizeInventoryNumber(run.quantity_voided);
            const unvoidedQuantity = Math.max(0, quantityProduced - quantityVoided);
            const lotRemaining = normalizeInventoryNumber(finishedLot?.quantity_remaining);
            const maxVoidable = Math.max(0, Math.min(lotRemaining, unvoidedQuantity));
            const runVoidEvents = voidEventsByRunId.get(run.id) ?? [];
            return (
              <div key={run.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{runProduct?.name ?? 'Finished product'}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${productionStatusClass(run.status)}`}>
                        {productionStatusLabel(run.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Produced {formatInventoryQuantity(quantityProduced, 'each')}
                      {quantityVoided > 0 ? ` - Voided ${formatInventoryQuantity(quantityVoided, 'each')}` : ''}
                      {unvoidedQuantity !== quantityProduced ? ` - Active ${formatInventoryQuantity(unvoidedQuantity, 'each')}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Max voidable now: {formatInventoryQuantity(maxVoidable, 'each')}</p>
                    {runVoidEvents.length ? (
                      <div className="mt-2 space-y-1 text-xs text-slate-500">
                        {runVoidEvents.slice(0, 2).map((event) => (
                          <p key={`${event.production_run_id}-${event.voided_at}-${event.quantity_voided}`}>
                            Voided {formatInventoryQuantity(event.quantity_voided, 'each')}
                            {event.voided_at ? ` on ${formatRunDate(event.voided_at)}` : ''}: {event.reason}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm sm:min-w-[24rem]">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Unit COGS</p>
                      <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(normalizeInventoryNumber(run.actual_unit_cost_cents)))}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Labor</p>
                      <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(normalizeInventoryNumber(run.actual_labor_cost_cents)))}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Fixed</p>
                      <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(normalizeInventoryNumber(run.fixed_cost_cents)))}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Tape {usd(Math.round(normalizeInventoryNumber(run.fixed_tape_cost_cents)))} / Labels {usd(Math.round(normalizeInventoryNumber(run.fixed_shipping_label_cost_cents) + normalizeInventoryNumber(run.fixed_branding_label_cost_cents)))}
                      </p>
                    </div>
                  </div>
                </div>
                {canVoidProductionRuns && maxVoidable > 0 && run.status !== 'void' ? (
                  <form action={voidProductionRun} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[8rem_minmax(0,1fr)_auto] md:items-end">
                    <input name="production_run_id" type="hidden" value={run.id} />
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Qty to void
                      <input className="input" name="quantity_to_void" min="0.0001" max={numericInputValue(maxVoidable)} required step="0.0001" type="number" defaultValue={numericInputValue(maxVoidable)} />
                    </label>
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Reason
                      <input className="input" name="reason" required placeholder="Why this run is being voided" />
                    </label>
                    <PendingSubmitButton className="btn-secondary" label="Void Run" pendingLabel="Voiding..." />
                  </form>
                ) : null}
              </div>
            );
          })}
          {!runRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No production runs have been recorded yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

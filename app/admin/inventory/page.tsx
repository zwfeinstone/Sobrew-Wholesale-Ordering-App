import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  INVENTORY_ADJUSTMENT_TYPES,
  convertInventoryQuantity,
  centsFromDollars,
  dollarsInputValueFromCents,
  fixedRecipeCostCents,
  formatInventoryQuantity,
  inventoryItemTypeLabel,
  isInventoryAdjustmentType,
  isWholeCountPackagingComponentRole,
  laborCostCents,
  normalizeInventoryNumber,
  recipeComponentWasteMultiplier,
  roundWholeCountQuantity,
  type InventoryUnit,
} from '@/lib/inventory';
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
  product_id: string | null;
  active: boolean;
};

type InventoryLotRow = {
  inventory_item_id: string;
  quantity_remaining: number | string;
  unit_cost_cents: number | string;
};

type InventoryMovementRow = {
  inventory_item_id: string;
  quantity_change: number | string;
  unit_cost_cents: number | string | null;
};

type InventoryAdjustmentRow = {
  id: string;
  inventory_item_id: string;
  adjustment_type: string;
  quantity_change: number | string;
  unit: InventoryUnit;
  unit_cost_cents: number | string | null;
  notes: string | null;
  adjusted_at: string | null;
  created_at: string | null;
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
  product_id: string;
  quantity_produced?: number | string | null;
  quantity_voided?: number | string | null;
  status?: string | null;
  actual_unit_cost_cents: number | string | null;
};

type FinishedGoodsSort = 'name' | 'on_hand';

function inventoryHref(toast: string) {
  return `/admin/inventory?toast=${toast}`;
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

function isBoxComponent(component: RecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  return component.component_role === 'box' || Boolean(item?.sku?.startsWith('BOX-'));
}

function activeProductionQuantity(run: ProductionRunRow) {
  if (run.status === 'void') return 0;
  return Math.max(0, normalizeInventoryNumber(run.quantity_produced) - normalizeInventoryNumber(run.quantity_voided));
}

function adjustmentTypeLabel(value: string | null | undefined) {
  return INVENTORY_ADJUSTMENT_TYPES.find((type) => type.value === value)?.label ?? 'Adjustment';
}

function formatAdjustmentTimestamp(value: string | null | undefined) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone: 'America/Chicago',
    timeZoneName: 'short',
    year: 'numeric',
  }).format(date);
}

function normalizeFinishedGoodsSort(value: string | string[] | undefined): FinishedGoodsSort {
  return value === 'on_hand' ? 'on_hand' : 'name';
}

function parsePositiveNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function adjustFinishedGoods(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(inventoryHref('admin_write_denied'));

  const supabase = await createClient();
  const productId = String(formData.get('product_id') ?? '').trim();
  const adjustmentType = String(formData.get('adjustment_type') ?? '');
  const direction = String(formData.get('direction') ?? 'add');
  const quantity = parsePositiveNumber(formData.get('quantity'));
  let unitCostCents = 0;

  try {
    unitCostCents = centsFromDollars(String(formData.get('unit_cost') ?? '0'));
  } catch {
    redirect(inventoryHref('finished_adjustment_error'));
  }

  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!productId || quantity <= 0 || !isInventoryAdjustmentType(adjustmentType) || !['add', 'subtract'].includes(direction)) {
    redirect(inventoryHref('finished_adjustment_error'));
  }

  const { data: product } = await supabase
    .from('products')
    .select('id,name,sku')
    .eq('id', productId)
    .single();

  if (!product) redirect(inventoryHref('finished_adjustment_error'));

  let { data: item } = await supabase
    .from('inventory_items')
    .select('id,base_unit,item_type,product_id')
    .eq('item_type', 'finished_good')
    .eq('product_id', productId)
    .maybeSingle();

  if (!item && direction === 'subtract') redirect(inventoryHref('finished_adjustment_error'));

  if (!item) {
    const { data: insertedItem, error: itemError } = await supabase
      .from('inventory_items')
      .insert({
        name: product.name,
        sku: `FIN-${product.sku || productId.slice(0, 8)}`,
        item_type: 'finished_good',
        base_unit: 'each',
        product_id: productId,
        active: true,
      })
      .select('id,base_unit,item_type,product_id')
      .single();

    if (itemError || !insertedItem) redirect(inventoryHref('finished_adjustment_error'));
    item = insertedItem;
  }

  if (item.item_type !== 'finished_good' || item.product_id !== productId) {
    redirect(inventoryHref('finished_adjustment_error'));
  }

  const signedQuantity = direction === 'subtract' ? -quantity : quantity;
  const adjustedAt = new Date().toISOString();
  let lotId: string | null = null;
  let movementUnitCostCents = unitCostCents;

  if (signedQuantity > 0) {
    const { data: lot, error: lotError } = await supabase
      .from('inventory_lots')
      .insert({
        inventory_item_id: item.id,
        lot_code: `FG-ADJ-${adjustedAt.slice(0, 10)}`,
        source_type: 'adjustment',
        quantity_received: signedQuantity,
        quantity_remaining: signedQuantity,
        unit_cost_cents: unitCostCents,
        received_at: adjustedAt,
        notes,
      })
      .select('id')
      .single();

    if (lotError || !lot) redirect(inventoryHref('finished_adjustment_error'));
    lotId = lot.id;
  } else {
    const { data: lots } = await supabase
      .from('inventory_lots')
      .select('id,quantity_remaining,unit_cost_cents')
      .eq('inventory_item_id', item.id)
      .gt('quantity_remaining', 0)
      .order('received_at', { ascending: true })
      .order('created_at', { ascending: true });

    const available = (lots ?? []).reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    let remaining = Math.abs(signedQuantity);
    let consumedValueCents = 0;

    if (available < remaining) redirect(inventoryHref('finished_adjustment_error'));

    for (const lot of lots ?? []) {
      if (remaining <= 0) break;
      const take = Math.min(normalizeInventoryNumber(lot.quantity_remaining), remaining);
      const { error: lotError } = await supabase
        .from('inventory_lots')
        .update({ quantity_remaining: normalizeInventoryNumber(lot.quantity_remaining) - take })
        .eq('id', lot.id);

      if (lotError) redirect(inventoryHref('finished_adjustment_error'));
      consumedValueCents += take * normalizeInventoryNumber(lot.unit_cost_cents);
      lotId = lot.id;
      remaining -= take;
    }

    movementUnitCostCents = quantity > 0 ? consumedValueCents / quantity : unitCostCents;
  }

  const { data: adjustment, error: adjustmentError } = await supabase
    .from('inventory_adjustments')
    .insert({
      inventory_item_id: item.id,
      lot_id: lotId,
      adjustment_type: adjustmentType,
      quantity_change: signedQuantity,
      unit: item.base_unit,
      unit_cost_cents: movementUnitCostCents,
      notes,
      adjusted_at: adjustedAt,
    })
    .select('id')
    .single();

  if (adjustmentError || !adjustment) redirect(inventoryHref('finished_adjustment_error'));

  const { error: movementError } = await supabase.from('inventory_movements').insert({
    inventory_item_id: item.id,
    lot_id: lotId,
    movement_type: 'adjustment',
    quantity_change: signedQuantity,
    unit: item.base_unit,
    unit_cost_cents: movementUnitCostCents,
    notes: notes || `Finished goods ${adjustmentType}`,
  });

  redirect(inventoryHref(movementError ? 'finished_adjustment_error' : 'finished_adjustment_saved'));
}

async function adjustMaterialSupply(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(inventoryHref('admin_write_denied'));

  const supabase = await createClient();
  const itemId = String(formData.get('inventory_item_id') ?? '').trim();
  const adjustmentType = String(formData.get('adjustment_type') ?? '');
  const direction = String(formData.get('direction') ?? 'add');
  const quantity = parsePositiveNumber(formData.get('quantity'));
  let unitCostCents = 0;

  try {
    unitCostCents = centsFromDollars(String(formData.get('unit_cost') ?? '0'));
  } catch {
    redirect(inventoryHref('material_adjustment_error'));
  }

  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!itemId || quantity <= 0 || !isInventoryAdjustmentType(adjustmentType) || !['add', 'subtract'].includes(direction)) {
    redirect(inventoryHref('material_adjustment_error'));
  }

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id,base_unit,item_type')
    .eq('id', itemId)
    .single();

  if (!item || item.item_type !== 'material_supply') {
    redirect(inventoryHref('material_adjustment_error'));
  }

  const signedQuantity = direction === 'subtract' ? -quantity : quantity;
  const adjustedAt = new Date().toISOString();
  let lotId: string | null = null;
  let movementUnitCostCents = unitCostCents;

  if (signedQuantity > 0) {
    const { data: lot, error: lotError } = await supabase
      .from('inventory_lots')
      .insert({
        inventory_item_id: item.id,
        lot_code: `MS-ADJ-${adjustedAt.slice(0, 10)}`,
        source_type: 'adjustment',
        quantity_received: signedQuantity,
        quantity_remaining: signedQuantity,
        unit_cost_cents: unitCostCents,
        received_at: adjustedAt,
        notes,
      })
      .select('id')
      .single();

    if (lotError || !lot) redirect(inventoryHref('material_adjustment_error'));
    lotId = lot.id;
  } else {
    const { data: lots } = await supabase
      .from('inventory_lots')
      .select('id,quantity_remaining,unit_cost_cents')
      .eq('inventory_item_id', item.id)
      .gt('quantity_remaining', 0)
      .order('received_at', { ascending: true })
      .order('created_at', { ascending: true });

    const available = (lots ?? []).reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    let remaining = Math.abs(signedQuantity);
    let consumedValueCents = 0;

    if (available < remaining) redirect(inventoryHref('material_adjustment_error'));

    for (const lot of lots ?? []) {
      if (remaining <= 0) break;
      const take = Math.min(normalizeInventoryNumber(lot.quantity_remaining), remaining);
      const { error: lotError } = await supabase
        .from('inventory_lots')
        .update({ quantity_remaining: normalizeInventoryNumber(lot.quantity_remaining) - take })
        .eq('id', lot.id);

      if (lotError) redirect(inventoryHref('material_adjustment_error'));
      consumedValueCents += take * normalizeInventoryNumber(lot.unit_cost_cents);
      lotId = lot.id;
      remaining -= take;
    }

    movementUnitCostCents = quantity > 0 ? consumedValueCents / quantity : unitCostCents;
  }

  const { data: adjustment, error: adjustmentError } = await supabase
    .from('inventory_adjustments')
    .insert({
      inventory_item_id: item.id,
      lot_id: lotId,
      adjustment_type: adjustmentType,
      quantity_change: signedQuantity,
      unit: item.base_unit,
      unit_cost_cents: movementUnitCostCents,
      notes,
      adjusted_at: adjustedAt,
    })
    .select('id')
    .single();

  if (adjustmentError || !adjustment) redirect(inventoryHref('material_adjustment_error'));

  const { error: movementError } = await supabase.from('inventory_movements').insert({
    inventory_item_id: item.id,
    lot_id: lotId,
    movement_type: 'adjustment',
    quantity_change: signedQuantity,
    unit: item.base_unit,
    unit_cost_cents: movementUnitCostCents,
    notes: notes || `Material supply ${adjustmentType}`,
  });

  redirect(inventoryHref(movementError ? 'material_adjustment_error' : 'material_adjustment_saved'));
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function StockCard({
  costLabel,
  detail,
  name,
  quantity,
  tone = 'default',
  children,
}: {
  costLabel: string;
  detail: string;
  name: string;
  quantity: string;
  tone?: 'default' | 'short';
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-semibold text-slate-950">{name}</p>
          <p className="mt-1 text-sm text-slate-500">{detail}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className={`font-semibold ${tone === 'short' ? 'text-rose-700' : 'text-slate-950'}`}>{quantity}</p>
          <p className="mt-1 text-sm text-slate-500">{costLabel}</p>
        </div>
      </div>
      {children ? <div className="mt-4 border-t border-slate-100 pt-4">{children}</div> : null}
    </div>
  );
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const current = await requireAdminSectionView('inventory');
  const canAdjustInventory = current.isSuperadmin;
  const requestedTab = typeof searchParams?.tab === 'string' ? searchParams.tab : '';
  const finishedGoodsSort = normalizeFinishedGoodsSort(searchParams?.finished_sort);
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  if (requestedTab === 'setup') redirect('/admin/receiving');
  if (requestedTab === 'planning') redirect('/admin/planning');
  if (requestedTab === 'production') redirect('/admin/production');

  const supabase = await createClient();
  const [
    productsResult,
    itemsResult,
    lotsResult,
    recipesResult,
    runsResult,
    openOrdersResult,
    shortageMovementsResult,
    adjustmentsResult,
  ] = await Promise.all([
    supabase.from('products').select('id,name,sku,active').order('name', { ascending: true }),
    supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,product_id,active').order('name', { ascending: true }),
    supabase.from('inventory_lots').select('inventory_item_id,quantity_remaining,unit_cost_cents').limit(50000),
    supabase.from('product_recipes').select('product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,shipping_label_qty,branding_label_qty,product_recipe_components(id,inventory_item_id,quantity,unit,component_role,inventory_items(id,name,sku,item_type,base_unit,product_id,active))'),
    supabase.from('production_runs').select('product_id,quantity_produced,quantity_voided,status,actual_unit_cost_cents').order('produced_at', { ascending: false }).limit(500),
    supabase.from('orders').select('id,status,order_items(product_id,qty)').in('status', ['New', 'Processing']).is('archived_at', null),
    supabase.from('inventory_movements').select('inventory_item_id,quantity_change,unit_cost_cents').in('movement_type', ['shipment_consume', 'sample_box_consume']).is('lot_id', null).limit(50000),
    supabase.from('inventory_adjustments').select('id,inventory_item_id,adjustment_type,quantity_change,unit,unit_cost_cents,notes,adjusted_at,created_at').order('adjusted_at', { ascending: false }).order('created_at', { ascending: false }).limit(25),
  ]);

  if (itemsResult.error) {
    return (
      <div className="space-y-6">
        <section className="panel">
          <span className="eyebrow">Inventory</span>
          <h1 className="page-title mt-4">Inventory</h1>
          <p className="page-subtitle mt-3">Apply the inventory migrations before using this page.</p>
        </section>
        <section className="card text-sm text-slate-600">Missing inventory schema. Apply migrations through `db/migrations/023_inventory_cogs_shipping_labor.sql`.</section>
      </div>
    );
  }

  const products = (productsResult.data ?? []) as ProductRow[];
  const items = (itemsResult.data ?? []) as InventoryItemRow[];
  const lots = (lotsResult.data ?? []) as InventoryLotRow[];
  const recipes = (recipesResult.data ?? []) as RecipeRow[];
  const runs = (runsResult.data ?? []) as ProductionRunRow[];
  const openOrders = (openOrdersResult.data ?? []) as any[];
  const shortageMovements = shortageMovementsResult.error ? [] : ((shortageMovementsResult.data ?? []) as InventoryMovementRow[]);
  const adjustmentRows = adjustmentsResult.error ? [] : ((adjustmentsResult.data ?? []) as InventoryAdjustmentRow[]);
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const lotSummaryByItem = new Map<string, { remaining: number; avgCostCents: number; valueCents: number }>();
  for (const item of items) {
    const itemLots = lots.filter((lot) => lot.inventory_item_id === item.id);
    const remaining = itemLots.reduce((sum, lot) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    const valueCents = itemLots.reduce((sum, lot) => sum + normalizeInventoryNumber(lot.quantity_remaining) * normalizeInventoryNumber(lot.unit_cost_cents), 0);
    lotSummaryByItem.set(item.id, {
      remaining,
      valueCents,
      avgCostCents: remaining > 0 ? valueCents / remaining : 0,
    });
  }
  for (const movement of shortageMovements) {
    const existing = lotSummaryByItem.get(movement.inventory_item_id);
    if (!existing) continue;
    const quantityChange = normalizeInventoryNumber(movement.quantity_change);
    existing.remaining += quantityChange;
    existing.valueCents += quantityChange * normalizeInventoryNumber(movement.unit_cost_cents);
    existing.avgCostCents = existing.remaining > 0 ? existing.valueCents / existing.remaining : 0;
  }

  const reservedQtyByProductId = new Map<string, number>();
  for (const order of openOrders) {
    for (const item of order.order_items ?? []) {
      if (!item.product_id) continue;
      reservedQtyByProductId.set(item.product_id, (reservedQtyByProductId.get(item.product_id) ?? 0) + normalizeInventoryNumber(item.qty));
    }
  }

  const latestActualCostByProductId = new Map<string, number>();
  for (const run of runs) {
    const actual = normalizeInventoryNumber(run.actual_unit_cost_cents);
    if (actual > 0 && activeProductionQuantity(run) > 0 && !latestActualCostByProductId.has(run.product_id)) {
      latestActualCostByProductId.set(run.product_id, actual);
    }
  }

  function estimateRecipeUnitCost(recipe: RecipeRow | undefined) {
    if (!recipe) return 0;
    const outputQty = normalizeInventoryNumber(recipe.output_qty) || 1;
    const materialCost = (recipe.product_recipe_components ?? []).reduce((sum, component) => {
      const item = relatedOne(component.inventory_items) ?? itemsById.get(component.inventory_item_id);
      if (!item) return sum;
      try {
        const rawBaseQuantity = convertInventoryQuantity(
          normalizeInventoryNumber(component.quantity) * recipeComponentWasteMultiplier(component.component_role, recipe.waste_percent),
          component.unit,
          item.base_unit
        );
        const baseQuantity = isWholeCountPackagingComponentRole(component.component_role) && item.base_unit === 'each'
          ? roundWholeCountQuantity(rawBaseQuantity)
          : rawBaseQuantity;
        return sum + baseQuantity * (lotSummaryByItem.get(component.inventory_item_id)?.avgCostCents ?? 0);
      } catch {
        return sum;
      }
    }, 0);
    const boxQty = (recipe.product_recipe_components ?? []).filter(isBoxComponent).reduce((sum, component) => sum + normalizeInventoryNumber(component.quantity), 0);
    const fixedCost = fixedRecipeCostCents({
      boxQty,
      shippingLabelQty: recipe.shipping_label_qty,
      brandingLabelQty: recipe.branding_label_qty,
    });
    const laborCost = laborCostCents(recipe.labor_minutes, recipe.labor_rate_cents);
    return (materialCost + fixedCost + laborCost) / outputQty;
  }

  const recipeByProductId = new Map(recipes.map((recipe) => [recipe.product_id, recipe]));
  const finishedItemByProductId = new Map(
    items
      .filter((item) => item.item_type === 'finished_good' && item.product_id)
      .map((item) => [item.product_id as string, item])
  );

  const rawCoffeeItems = items.filter((item) => item.active && item.item_type === 'raw_coffee');
  const materialSupplyItems = items.filter((item) => item.active && item.item_type === 'material_supply');
  const sellableRows = products
    .filter((product) => product.active !== false)
    .map((product) => {
      const finishedItem = finishedItemByProductId.get(product.id);
      const finishedSummary = finishedItem ? lotSummaryByItem.get(finishedItem.id) : undefined;
      const onHand = finishedSummary?.remaining ?? 0;
      const reserved = reservedQtyByProductId.get(product.id) ?? 0;
      const available = onHand - reserved;
      const latestCost = latestActualCostByProductId.get(product.id) ?? 0;
      const averageFinishedCost = finishedSummary?.avgCostCents ?? 0;
      const estimatedRecipeCost = estimateRecipeUnitCost(recipeByProductId.get(product.id));
      return {
        product,
        onHand,
        reserved,
        available,
        costCents: latestCost || averageFinishedCost || estimatedRecipeCost,
        costSource: latestCost ? 'Latest production COGS' : averageFinishedCost ? 'Average finished stock COGS' : estimatedRecipeCost ? 'Recipe estimate' : 'No COGS yet',
      };
    })
    .sort((left, right) => {
      if (finishedGoodsSort === 'on_hand') {
        const leftHasStock = left.onHand > 0 ? 1 : 0;
        const rightHasStock = right.onHand > 0 ? 1 : 0;
        return rightHasStock - leftHasStock
          || right.onHand - left.onHand
          || productName(left.product).localeCompare(productName(right.product));
      }
      return productName(left.product).localeCompare(productName(right.product));
    });
  const sellableRowsWithOnHand = sellableRows.filter((row) => row.onHand > 0).length;

  return (
    <div className="space-y-6">
      {toast === 'finished_adjustment_saved' ? <StatusToast message="Finished goods inventory adjustment saved." tone="success" /> : null}
      {toast === 'finished_adjustment_error' ? <StatusToast message="Unable to adjust finished goods inventory." tone="error" /> : null}
      {toast === 'material_adjustment_saved' ? <StatusToast message="Material or supply inventory adjustment saved." tone="success" /> : null}
      {toast === 'material_adjustment_error' ? <StatusToast message="Unable to adjust material or supply inventory." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only superadmins can adjust inventory." tone="error" /> : null}

      <section className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="eyebrow">Inventory</span>
            <h1 className="page-title mt-4">Stock and COGS</h1>
            <p className="page-subtitle mt-3">Raw coffee, materials and supplies, and finished sellable inventory are separated so counts do not get mixed together.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/admin/receiving" className="btn-secondary w-full sm:w-auto">Receive inventory</Link>
            <Link href="/admin/production" className="btn-primary w-full sm:w-auto">Add production</Link>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <SectionHeading eyebrow="Raw Coffee" title="Coffee inventory" subtitle="Coffee is received and consumed in pounds." />
        <div className="grid gap-3 lg:grid-cols-2">
          {rawCoffeeItems.map((item) => {
            const summary = lotSummaryByItem.get(item.id);
            return (
              <StockCard
                key={item.id}
                name={itemDisplayName(item)}
                detail={`${inventoryItemTypeLabel(item.item_type)} - stocked in ${item.base_unit}`}
                quantity={formatInventoryQuantity(summary?.remaining ?? 0, item.base_unit)}
                costLabel={`Avg ${usd(Math.round(summary?.avgCostCents ?? 0))} / ${item.base_unit}`}
              />
            );
          })}
          {!rawCoffeeItems.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No raw coffee items have been created yet.</p> : null}
        </div>
      </section>

      <section className="card space-y-4">
        <SectionHeading eyebrow="Materials & Supplies" title="Packaging and production inputs" subtitle="These are received in units and consumed by recipes or shipping. Product box stock can go negative when shipped short." />
        <div className="grid gap-3 lg:grid-cols-2">
          {materialSupplyItems.map((item) => {
            const summary = lotSummaryByItem.get(item.id);
            return (
              <StockCard
                key={item.id}
                name={itemDisplayName(item)}
                detail={`${inventoryItemTypeLabel(item.item_type)} - stocked in ${item.base_unit}`}
                quantity={formatInventoryQuantity(summary?.remaining ?? 0, item.base_unit)}
                costLabel={`Avg ${usd(Math.round(summary?.avgCostCents ?? 0))} / ${item.base_unit}`}
                tone={(summary?.remaining ?? 0) < 0 ? 'short' : 'default'}
              >
                {canAdjustInventory ? (
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-teal-700">Adjust material or supply</summary>
                    <form action={adjustMaterialSupply} className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
                      <input name="inventory_item_id" type="hidden" value={item.id} />
                      <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700">
                        Direction
                        <select className="input" name="direction" defaultValue="add">
                          <option value="add">Add stock</option>
                          <option value="subtract">Subtract stock</option>
                        </select>
                      </label>
                      <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700">
                        Reason
                        <select className="input" name="adjustment_type" defaultValue="count_correction">
                          {INVENTORY_ADJUSTMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                        </select>
                      </label>
                      <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700">
                        Quantity
                        <input className="input" name="quantity" required min="0.0001" step={item.base_unit === 'each' ? '1' : '0.0001'} type="number" placeholder="Qty" />
                      </label>
                      <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700">
                        Unit COGS
                        <input className="input" name="unit_cost" min="0" step="0.0001" type="number" defaultValue={dollarsInputValueFromCents(summary?.avgCostCents ?? 0)} placeholder="0.00" />
                      </label>
                      <label className="min-w-0 space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">
                        Notes
                        <input className="input" name="notes" placeholder="Adjustment reason" />
                      </label>
                      <div className="sm:col-span-2">
                        <PendingSubmitButton className="btn-secondary w-full" label="Save" pendingLabel="Saving..." />
                      </div>
                    </form>
                  </details>
                ) : null}
              </StockCard>
            );
          })}
          {!materialSupplyItems.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No materials or supplies have been created yet.</p> : null}
        </div>
      </section>

      <section className="card space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading eyebrow="Sellable Inventory" title="Finished goods available to sell" subtitle="On hand comes from production. Available stock subtracts open New and Processing orders and can go negative." />
          <form className="grid gap-2 sm:grid-cols-[minmax(12rem,16rem)_auto] sm:items-end">
            <label className="text-sm font-semibold text-slate-700">
              Sort finished goods
              <select className="input mt-2" name="finished_sort" defaultValue={finishedGoodsSort}>
                <option value="name">Product name</option>
                <option value="on_hand">On hand first</option>
              </select>
            </label>
            <button className="btn-secondary" type="submit">Apply</button>
          </form>
        </div>
        <p className="text-sm font-semibold text-slate-500">
          {sellableRowsWithOnHand.toLocaleString()} of {sellableRows.length.toLocaleString()} active products have inventory on hand.
        </p>
        <div className="space-y-3">
          {sellableRows.map((row) => (
            <div key={row.product.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-slate-950">{productName(row.product)}</p>
                  <p className="mt-1 text-sm text-slate-500">{row.product.sku || 'No SKU'} - {row.costSource}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:min-w-[34rem]">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">On hand</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.onHand, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Reserved</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.reserved, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Available</p>
                    <p className={`mt-1 font-semibold ${row.available < 0 ? 'text-rose-700' : 'text-slate-950'}`}>{formatInventoryQuantity(row.available, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Unit COGS</p>
                    <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(row.costCents))}</p>
                  </div>
                </div>
              </div>
              {canAdjustInventory ? (
                <details className="mt-4 border-t border-slate-100 pt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-teal-700">Adjust finished goods</summary>
                  <form action={adjustFinishedGoods} className="mt-4 grid gap-3 md:grid-cols-[9rem_11rem_8rem_9rem_minmax(0,1fr)_auto] md:items-end">
                    <input name="product_id" type="hidden" value={row.product.id} />
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Direction
                      <select className="input" name="direction" defaultValue="add">
                        <option value="add">Add stock</option>
                        <option value="subtract">Subtract stock</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Reason
                      <select className="input" name="adjustment_type" defaultValue="count_correction">
                        {INVENTORY_ADJUSTMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Quantity
                      <input className="input" name="quantity" required min="1" step="1" type="number" placeholder="Qty" />
                    </label>
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Unit COGS
                      <input className="input" name="unit_cost" min="0" step="0.0001" type="number" defaultValue={dollarsInputValueFromCents(row.costCents)} placeholder="0.00" />
                    </label>
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Notes
                      <input className="input" name="notes" placeholder="Adjustment reason" />
                    </label>
                    <PendingSubmitButton className="btn-secondary w-full md:w-auto" label="Save" pendingLabel="Saving..." />
                  </form>
                </details>
              ) : null}
            </div>
          ))}
          {!sellableRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No active products found.</p> : null}
        </div>
      </section>

      <section className="card space-y-4">
        <SectionHeading eyebrow="Adjustment Log" title="Corrections and adjustments" subtitle="Recent manual inventory changes across raw coffee, materials, supplies, and finished goods." />
        <div className="space-y-3">
          {adjustmentRows.map((adjustment) => {
            const item = itemsById.get(adjustment.inventory_item_id);
            const quantityChange = normalizeInventoryNumber(adjustment.quantity_change);
            const isPositive = quantityChange >= 0;
            const quantityLabel = `${isPositive ? '+' : '-'}${formatInventoryQuantity(Math.abs(quantityChange), adjustment.unit)}`;
            return (
              <div key={adjustment.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_9rem_10rem] md:items-start">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-slate-950">{itemDisplayName(item)}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {adjustmentTypeLabel(adjustment.adjustment_type)} - {item ? inventoryItemTypeLabel(item.item_type) : 'Inventory Item'}
                    </p>
                    {adjustment.notes ? <p className="mt-2 break-words text-sm text-slate-600">{adjustment.notes}</p> : null}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Change</p>
                    <p className={`mt-1 font-semibold ${isPositive ? 'text-emerald-700' : 'text-rose-700'}`}>{quantityLabel}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Unit COGS</p>
                    <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(normalizeInventoryNumber(adjustment.unit_cost_cents)))}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Recorded</p>
                    <p className="mt-1 text-sm font-semibold text-slate-950">{formatAdjustmentTimestamp(adjustment.adjusted_at ?? adjustment.created_at)}</p>
                  </div>
                </div>
              </div>
            );
          })}
          {!adjustmentRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No inventory corrections or adjustments have been logged yet.</p> : null}
        </div>
      </section>
    </div>
  );
}

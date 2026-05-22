import Link from 'next/link';
import { redirect } from 'next/navigation';
import StatusToast from '@/components/status-toast';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  COMMON_SUPPLY_SKUS,
  INVENTORY_ITEM_TYPES,
  INVENTORY_UNITS,
  centsFromDollars,
  convertInventoryQuantity,
  formatInventoryQuantity,
  inventoryItemTypeLabel,
  isInventoryItemType,
  isInventoryUnit,
  normalizeInventoryNumber,
  numericInputValue,
  type InventoryUnit,
} from '@/lib/inventory';
import { daysForRecurringFrequency, labelForRecurringFrequency } from '@/lib/recurring';
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
  description: string | null;
  item_type: string;
  base_unit: InventoryUnit;
  product_id: string | null;
  active: boolean;
};

type InventoryLotRow = {
  id: string;
  inventory_item_id: string;
  lot_code: string;
  source_type: string;
  quantity_received: number | string;
  quantity_remaining: number | string;
  unit_cost_cents: number | string;
  received_at: string | null;
};

type RecipeComponentRow = {
  id: string;
  recipe_id: string;
  inventory_item_id: string;
  quantity: number | string;
  unit: InventoryUnit;
  sort_order: number | null;
  inventory_items?: InventoryItemRow | InventoryItemRow[] | null;
};

type RecipeRow = {
  id: string;
  product_id: string;
  output_qty: number | string;
  waste_percent: number | string;
  notes: string | null;
  product_recipe_components?: RecipeComponentRow[] | null;
};

type ProductionRunRow = {
  id: string;
  product_id: string;
  quantity_produced: number | string;
  waste_quantity: number | string;
  estimated_unit_cost_cents: number | string | null;
  actual_unit_cost_cents: number | string | null;
  produced_at: string | null;
  products?: { name: string | null } | { name: string | null }[] | null;
};

type CenterPriceRow = {
  center_id: string | null;
  product_id: string;
  price_cents: number | string;
  centers?: { name: string | null; is_active: boolean | null } | { name: string | null; is_active: boolean | null }[] | null;
};

type ReorderSettingRow = {
  inventory_item_id: string;
  reorder_point: number | string;
  target_stock: number | string;
  lead_time_days: number | string;
  preferred_supplier: string | null;
  notes: string | null;
};

type CenterRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
};

type ParLevelRow = {
  center_id: string;
  product_id: string;
  par_qty: number | string;
  minimum_qty: number | string;
  notes: string | null;
  centers?: { name: string | null; is_active: boolean | null } | { name: string | null; is_active: boolean | null }[] | null;
  products?: { name: string | null; active: boolean | null } | { name: string | null; active: boolean | null }[] | null;
};

type InventoryMovementRow = {
  inventory_item_id: string;
  quantity_change: number | string;
  movement_type: string;
  created_at: string | null;
};

const EXTRA_COMPONENT_ROWS = 5;
const USAGE_LOOKBACK_DAYS = 56;
const INVENTORY_TABS = [
  { id: 'overview', label: 'Overview', description: 'Alerts and workflow' },
  { id: 'setup', label: 'Setup', description: 'Items, receiving, recipes' },
  { id: 'planning', label: 'Planning', description: 'Par, make, buy' },
  { id: 'production', label: 'Production', description: 'Runs and batch COGS' },
  { id: 'stock', label: 'Stock', description: 'On hand and lots' },
  { id: 'margins', label: 'Margins', description: 'COGS and pricing' },
] as const;

type InventoryTab = (typeof INVENTORY_TABS)[number]['id'];

function isInventoryTab(value: string): value is InventoryTab {
  return INVENTORY_TABS.some((tab) => tab.id === value);
}

function productName(product: ProductRow | undefined | null) {
  return product?.name?.trim() || 'Unnamed product';
}

function itemDisplayName(item: InventoryItemRow | undefined | null) {
  if (!item) return 'Unknown item';
  return item.sku ? `${item.name} (${item.sku})` : item.name;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parsePositiveNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inventoryHref(params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return search ? `/admin/inventory?${search}` : '/admin/inventory';
}

async function createInventoryItem(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(inventoryHref({ tab: 'setup', toast: 'admin_write_denied' }));

  const supabase = await createClient();
  const itemType = String(formData.get('item_type') ?? '');
  const baseUnit = String(formData.get('base_unit') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const sku = String(formData.get('sku') ?? '').trim();

  if (!name || !isInventoryItemType(itemType) || !isInventoryUnit(baseUnit)) {
    redirect(inventoryHref({ tab: 'setup', toast: 'item_error' }));
  }

  const { error } = await supabase.from('inventory_items').insert({
    name,
    sku: sku || null,
    description: String(formData.get('description') ?? '').trim() || null,
    item_type: itemType,
    base_unit: baseUnit,
    active: true,
  });

  redirect(inventoryHref({ tab: 'setup', toast: error ? 'item_error' : 'item_created' }));
}

async function receiveInventory(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(inventoryHref({ tab: 'setup', toast: 'admin_write_denied' }));

  const supabase = await createClient();
  const itemId = String(formData.get('inventory_item_id') ?? '');
  const quantity = parsePositiveNumber(formData.get('quantity'));
  const itemUnitCostCents = centsFromDollars(String(formData.get('unit_cost') ?? '0'));
  const freightCents = centsFromDollars(String(formData.get('freight_cost') ?? '0'));
  const otherCostCents = centsFromDollars(String(formData.get('other_cost') ?? '0'));

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id,base_unit')
    .eq('id', itemId)
    .single();

  if (!item || quantity <= 0) redirect(inventoryHref({ tab: 'setup', toast: 'receipt_error' }));

  const landedUnitCostCents = ((quantity * itemUnitCostCents) + freightCents + otherCostCents) / quantity;
  const receivedAt = String(formData.get('received_at') ?? '') || new Date().toISOString();
  const lotCode = String(formData.get('lot_code') ?? '').trim() || `LOT-${new Date().toISOString().slice(0, 10)}`;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const { data: lot, error: lotError } = await supabase
    .from('inventory_lots')
    .insert({
      inventory_item_id: itemId,
      lot_code: lotCode,
      source_type: 'purchase',
      quantity_received: quantity,
      quantity_remaining: quantity,
      unit_cost_cents: landedUnitCostCents,
      received_at: receivedAt,
      notes,
    })
    .select('id')
    .single();

  if (lotError || !lot) redirect(inventoryHref({ tab: 'setup', toast: 'receipt_error' }));

  const { data: receipt, error: receiptError } = await supabase
    .from('inventory_receipts')
    .insert({
      inventory_item_id: itemId,
      lot_id: lot.id,
      supplier: String(formData.get('supplier') ?? '').trim() || null,
      quantity,
      unit: item.base_unit,
      item_unit_cost_cents: itemUnitCostCents,
      freight_cents: freightCents,
      other_cost_cents: otherCostCents,
      landed_unit_cost_cents: landedUnitCostCents,
      received_at: receivedAt,
      notes,
    })
    .select('id')
    .single();

  if (receiptError || !receipt) redirect(inventoryHref({ tab: 'setup', toast: 'receipt_error' }));

  const { error: movementError } = await supabase.from('inventory_movements').insert({
    inventory_item_id: itemId,
    lot_id: lot.id,
    receipt_id: receipt.id,
    movement_type: 'receipt',
    quantity_change: quantity,
    unit: item.base_unit,
    unit_cost_cents: landedUnitCostCents,
    notes: 'Inventory received',
  });

  redirect(inventoryHref({ tab: 'setup', toast: movementError ? 'receipt_error' : 'receipt_created' }));
}

async function saveRecipe(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(inventoryHref({ tab: 'setup', toast: 'admin_write_denied' }));

  const supabase = await createClient();
  const productId = String(formData.get('product_id') ?? '');
  const outputQty = Math.max(1, parsePositiveNumber(formData.get('output_qty'), 1));
  const wastePercent = Math.max(0, parsePositiveNumber(formData.get('waste_percent'), 0));
  const componentMap = new Map<string, { inventory_item_id: string; quantity: number; unit: string; sort_order: number; notes: string | null }>();

  function addComponent(inventoryItemId: string, quantity: number, unit: string, sortOrder: number, notes?: string) {
    if (!inventoryItemId || quantity <= 0 || !isInventoryUnit(unit)) return;
    const key = `${inventoryItemId}:${unit}`;
    const existing = componentMap.get(key);
    componentMap.set(key, {
      inventory_item_id: inventoryItemId,
      quantity: (existing?.quantity ?? 0) + quantity,
      unit,
      sort_order: Math.min(existing?.sort_order ?? sortOrder, sortOrder),
      notes: notes || existing?.notes || null,
    });
  }

  const rawCoffeeId = String(formData.get('raw_coffee_item_id') ?? '');
  addComponent(
    rawCoffeeId,
    parsePositiveNumber(formData.get('raw_coffee_qty')),
    String(formData.get('raw_coffee_unit') ?? 'oz'),
    0,
    'Raw coffee'
  );

  for (const supplyId of formData.getAll('common_component_id').map(String)) {
    addComponent(
      supplyId,
      parsePositiveNumber(formData.get(`common_qty_${supplyId}`)),
      String(formData.get(`common_unit_${supplyId}`) ?? 'each'),
      20,
      'Standard supply'
    );
  }

  for (let index = 0; index < EXTRA_COMPONENT_ROWS; index += 1) {
    const itemId = String(formData.get(`extra_item_id_${index}`) ?? '');
    addComponent(
      itemId,
      parsePositiveNumber(formData.get(`extra_qty_${index}`)),
      String(formData.get(`extra_unit_${index}`) ?? 'each'),
      100 + index,
      String(formData.get(`extra_note_${index}`) ?? '').trim()
    );
  }

  if (!productId || !componentMap.size) redirect(inventoryHref({ tab: 'setup', recipe_product: productId, toast: 'recipe_error' }));

  const { data: recipe, error: recipeError } = await supabase
    .from('product_recipes')
    .upsert({
      product_id: productId,
      output_qty: outputQty,
      waste_percent: wastePercent,
      notes: String(formData.get('notes') ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' })
    .select('id')
    .single();

  if (recipeError || !recipe) redirect(inventoryHref({ tab: 'setup', recipe_product: productId, toast: 'recipe_error' }));

  const { error: deleteError } = await supabase.from('product_recipe_components').delete().eq('recipe_id', recipe.id);
  if (deleteError) redirect(inventoryHref({ tab: 'setup', recipe_product: productId, toast: 'recipe_error' }));

  const components = [...componentMap.values()].sort((a, b) => a.sort_order - b.sort_order);
  const { error: componentError } = await supabase.from('product_recipe_components').insert(
    components.map((component, index) => ({
      recipe_id: recipe.id,
      ...component,
      sort_order: index,
    }))
  );

  redirect(inventoryHref({ tab: 'setup', recipe_product: productId, toast: componentError ? 'recipe_error' : 'recipe_saved' }));
}

async function recordProductionRun(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(inventoryHref({ tab: 'production', toast: 'admin_write_denied' }));

  const supabase = await createClient();
  const productId = String(formData.get('product_id') ?? '');
  const quantityProduced = parsePositiveNumber(formData.get('quantity_produced'));
  const wasteQuantity = Math.max(0, parsePositiveNumber(formData.get('waste_quantity'), 0));

  if (!productId || quantityProduced <= 0) redirect(inventoryHref({ tab: 'production', toast: 'production_error' }));

  const { data: recipe } = await supabase
    .from('product_recipes')
    .select('id,output_qty,waste_percent')
    .eq('product_id', productId)
    .single();

  if (!recipe) redirect(inventoryHref({ tab: 'production', toast: 'production_error' }));

  const { data: recipeComponents } = await supabase
    .from('product_recipe_components')
    .select('id,inventory_item_id,quantity,unit,inventory_items(id,base_unit)')
    .eq('recipe_id', recipe.id)
    .order('sort_order', { ascending: true });

  const components = (recipeComponents ?? []) as RecipeComponentRow[];
  const itemIds = components.map((component) => component.inventory_item_id);
  const { data: lots } = itemIds.length
    ? await supabase
        .from('inventory_lots')
        .select('inventory_item_id,quantity_remaining,unit_cost_cents')
        .in('inventory_item_id', itemIds)
        .gt('quantity_remaining', 0)
    : { data: [] as InventoryLotRow[] };

  const avgCostByItem = new Map<string, number>();
  for (const itemId of itemIds) {
    const itemLots = (lots ?? []).filter((lot: any) => lot.inventory_item_id === itemId);
    const remaining = itemLots.reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    const value = itemLots.reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining) * normalizeInventoryNumber(lot.unit_cost_cents), 0);
    avgCostByItem.set(itemId, remaining > 0 ? value / remaining : 0);
  }

  const outputQty = normalizeInventoryNumber(recipe.output_qty) || 1;
  const wasteMultiplier = 1 + (normalizeInventoryNumber(recipe.waste_percent) / 100);
  const payload = [];
  let estimatedTotalCost = 0;

  try {
    for (const component of components) {
      const item = relatedOne(component.inventory_items);
      const baseUnit = item?.base_unit;
      if (!baseUnit) throw new Error('Missing component base unit.');
      const recipeUnit = component.unit;
      const expectedInRecipeUnit = (normalizeInventoryNumber(component.quantity) / outputQty) * quantityProduced * wasteMultiplier;
      const actualInRecipeUnit = parsePositiveNumber(formData.get(`actual_${component.id}`), expectedInRecipeUnit);
      const expectedBaseQty = convertInventoryQuantity(expectedInRecipeUnit, recipeUnit, baseUnit);
      const usedBaseQty = convertInventoryQuantity(actualInRecipeUnit, recipeUnit, baseUnit);
      estimatedTotalCost += expectedBaseQty * (avgCostByItem.get(component.inventory_item_id) ?? 0);
      payload.push({
        inventory_item_id: component.inventory_item_id,
        quantity_expected: expectedBaseQty,
        quantity_used: usedBaseQty,
        unit: baseUnit,
      });
    }
  } catch {
    redirect(inventoryHref({ tab: 'production', produce_product: productId, produce_qty: String(quantityProduced), toast: 'production_unit_error' }));
  }

  const { error } = await supabase.rpc('record_inventory_production_run', {
    p_product_id: productId,
    p_quantity_produced: quantityProduced,
    p_waste_quantity: wasteQuantity,
    p_notes: String(formData.get('notes') ?? '').trim(),
    p_estimated_unit_cost_cents: quantityProduced > 0 ? estimatedTotalCost / quantityProduced : 0,
    p_components: payload,
  });

  redirect(inventoryHref({ tab: 'production', toast: error ? 'production_error' : 'production_recorded' }));
}

async function updateReorderSetting(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(inventoryHref({ tab: 'planning', toast: 'admin_write_denied' }));

  const supabase = await createClient();
  const inventoryItemId = String(formData.get('inventory_item_id') ?? '');
  const reorderPoint = Math.max(0, parsePositiveNumber(formData.get('reorder_point'), 0));
  const targetStock = Math.max(0, parsePositiveNumber(formData.get('target_stock'), 0));
  const leadTimeDays = Math.max(0, Math.trunc(parsePositiveNumber(formData.get('lead_time_days'), 14)));

  if (!inventoryItemId) redirect(inventoryHref({ tab: 'planning', toast: 'reorder_error' }));

  const { error } = await supabase.from('inventory_reorder_settings').upsert(
    {
      inventory_item_id: inventoryItemId,
      reorder_point: reorderPoint,
      target_stock: targetStock,
      lead_time_days: leadTimeDays,
      preferred_supplier: String(formData.get('preferred_supplier') ?? '').trim() || null,
      notes: String(formData.get('notes') ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'inventory_item_id' }
  );

  redirect(inventoryHref({ tab: 'planning', toast: error ? 'reorder_error' : 'reorder_saved' }));
}

async function updateCenterParLevel(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(inventoryHref({ tab: 'planning', toast: 'admin_write_denied' }));

  const supabase = await createClient();
  const centerId = String(formData.get('center_id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  const parQty = Math.max(0, parsePositiveNumber(formData.get('par_qty'), 0));
  const minimumQty = Math.max(0, parsePositiveNumber(formData.get('minimum_qty'), 0));

  if (!centerId || !productId) redirect(inventoryHref({ tab: 'planning', toast: 'par_error' }));

  const { error } = await supabase.from('inventory_center_par_levels').upsert(
    {
      center_id: centerId,
      product_id: productId,
      par_qty: parQty,
      minimum_qty: minimumQty,
      notes: String(formData.get('notes') ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'center_id,product_id' }
  );

  redirect(inventoryHref({ tab: 'planning', toast: error ? 'par_error' : 'par_saved' }));
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const selectedRecipeProductId = typeof searchParams?.recipe_product === 'string' ? searchParams.recipe_product : '';
  const produceProductId = typeof searchParams?.produce_product === 'string' ? searchParams.produce_product : '';
  const produceQty = typeof searchParams?.produce_qty === 'string' ? searchParams.produce_qty : '';
  const requestedTab = typeof searchParams?.tab === 'string' ? searchParams.tab : '';
  const fallbackTab: InventoryTab = produceProductId
    ? 'production'
    : selectedRecipeProductId
      ? 'setup'
      : toast === 'reorder_saved' || toast === 'reorder_error' || toast === 'par_saved' || toast === 'par_error'
        ? 'planning'
        : toast === 'production_recorded' || toast === 'production_error' || toast === 'production_unit_error'
          ? 'production'
          : toast === 'item_created' || toast === 'item_error' || toast === 'receipt_created' || toast === 'receipt_error' || toast === 'recipe_saved' || toast === 'recipe_error'
            ? 'setup'
            : 'overview';
  const activeTab: InventoryTab = isInventoryTab(requestedTab) ? requestedTab : fallbackTab;
  const usageSince = new Date(Date.now() - USAGE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [
    productsResult,
    itemsResult,
    lotsResult,
    recipesResult,
    runsResult,
    receiptsResult,
    reorderSettingsResult,
    centerPricesResult,
    openOrdersResult,
    inventoryMovementsResult,
    recurringOrdersResult,
    centersResult,
    parLevelsResult,
  ] = await Promise.all([
    supabase.from('products').select('id,name,sku,active').order('name', { ascending: true }),
    supabase.from('inventory_items').select('id,name,sku,description,item_type,base_unit,product_id,active').order('name', { ascending: true }),
    supabase.from('inventory_lots').select('id,inventory_item_id,lot_code,source_type,quantity_received,quantity_remaining,unit_cost_cents,received_at').order('received_at', { ascending: false }).limit(500),
    supabase.from('product_recipes').select('id,product_id,output_qty,waste_percent,notes,product_recipe_components(id,recipe_id,inventory_item_id,quantity,unit,sort_order,inventory_items(id,name,sku,description,item_type,base_unit,product_id,active))'),
    supabase.from('production_runs').select('id,product_id,quantity_produced,waste_quantity,estimated_unit_cost_cents,actual_unit_cost_cents,produced_at,products(name)').order('produced_at', { ascending: false }).limit(50),
    supabase.from('inventory_receipts').select('id,inventory_item_id,quantity,unit,landed_unit_cost_cents,received_at,supplier').order('received_at', { ascending: false }).limit(8),
    supabase.from('inventory_reorder_settings').select('inventory_item_id,reorder_point,target_stock,lead_time_days,preferred_supplier,notes'),
    supabase.from('user_product_prices').select('center_id,product_id,price_cents,centers(name,is_active)'),
    supabase.from('orders').select('id,status,order_items(product_id,qty)').in('status', ['New', 'Processing']).is('archived_at', null),
    supabase.from('inventory_movements').select('inventory_item_id,quantity_change,movement_type,created_at').eq('movement_type', 'production_consume').gte('created_at', usageSince),
    supabase.from('recurring_orders').select('id,center_id,frequency,status,active,centers(name,is_active),recurring_order_items(product_id,qty)').neq('status', 'canceled'),
    supabase.from('centers').select('id,name,is_active').eq('is_active', true).order('name', { ascending: true }),
    supabase.from('inventory_center_par_levels').select('center_id,product_id,par_qty,minimum_qty,notes,centers(name,is_active),products(name,active)'),
  ]);

  if (itemsResult.error) {
    return (
      <div className="space-y-6">
        <section className="panel">
          <span className="eyebrow">Inventory</span>
          <h1 className="page-title mt-4">Inventory management</h1>
          <p className="page-subtitle mt-3">The Phase 1 inventory screens are installed, but the inventory database migration still needs to be applied.</p>
        </section>
        <section className="card space-y-3 text-sm text-slate-600">
          <p className="font-semibold text-slate-950">Apply this migration before using inventory:</p>
          <p className="font-mono text-xs">db/migrations/016_inventory_phase1.sql</p>
        </section>
      </div>
    );
  }

  const products = (productsResult.data ?? []) as ProductRow[];
  const activeProducts = products.filter((product) => product.active !== false);
  const items = (itemsResult.data ?? []) as InventoryItemRow[];
  const lots = (lotsResult.data ?? []) as InventoryLotRow[];
  const recipes = (recipesResult.data ?? []) as RecipeRow[];
  const runs = (runsResult.data ?? []) as ProductionRunRow[];
  const receipts = (receiptsResult.data ?? []) as any[];
  const reorderSettings = (reorderSettingsResult.data ?? []) as ReorderSettingRow[];
  const centerPrices = (centerPricesResult.data ?? []) as CenterPriceRow[];
  const openOrders = (openOrdersResult.data ?? []) as any[];
  const inventoryMovements = (inventoryMovementsResult.data ?? []) as InventoryMovementRow[];
  const recurringOrders = (recurringOrdersResult.data ?? []) as any[];
  const centers = (centersResult.data ?? []) as CenterRow[];
  const parLevels = (parLevelsResult.data ?? []) as ParLevelRow[];
  const phase2MigrationMissing = Boolean(reorderSettingsResult.error);
  const phase3MigrationMissing = Boolean(parLevelsResult.error);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const centersById = new Map(centers.map((center) => [center.id, center]));
  const reorderSettingByItemId = new Map(reorderSettings.map((setting) => [setting.inventory_item_id, setting]));
  const rawCoffeeItems = items.filter((item) => item.item_type === 'raw_coffee' && item.active);
  const receivableItems = items.filter((item) => item.item_type !== 'finished_good' && item.active);
  const commonSupplyItems = COMMON_SUPPLY_SKUS
    .map((sku) => items.find((item) => item.sku === sku))
    .filter(Boolean) as InventoryItemRow[];
  const additionalComponentItems = items.filter((item) => item.active && item.item_type !== 'finished_good');
  const recipeProductId = selectedRecipeProductId || activeProducts[0]?.id || '';
  const selectedRecipe = recipes.find((recipe) => recipe.product_id === recipeProductId);
  const selectedRecipeComponents = (selectedRecipe?.product_recipe_components ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const selectedRecipeComponentByItemId = new Map(selectedRecipeComponents.map((component) => [component.inventory_item_id, component]));
  const productionProductId = produceProductId || recipeProductId;
  const productionRecipe = recipes.find((recipe) => recipe.product_id === productionProductId);
  const productionQty = Math.max(0, Number.parseFloat(produceQty || '0'));
  const productionComponents = (productionRecipe?.product_recipe_components ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const lotSummaryByItem = new Map<string, { remaining: number; valueCents: number; avgCostCents: number }>();
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

  function estimateRecipeUnitCost(recipe: RecipeRow | undefined) {
    if (!recipe) return 0;
    const outputQty = normalizeInventoryNumber(recipe.output_qty) || 1;
    const wasteMultiplier = 1 + (normalizeInventoryNumber(recipe.waste_percent) / 100);
    const totalCost = (recipe.product_recipe_components ?? []).reduce((sum, component) => {
      const item = relatedOne(component.inventory_items) ?? itemsById.get(component.inventory_item_id);
      if (!item) return sum;
      try {
        const baseQuantity = convertInventoryQuantity(normalizeInventoryNumber(component.quantity) * wasteMultiplier, component.unit, item.base_unit);
        return sum + baseQuantity * (lotSummaryByItem.get(component.inventory_item_id)?.avgCostCents ?? 0);
      } catch {
        return sum;
      }
    }, 0);
    return totalCost / outputQty;
  }

  const selectedRecipeEstimatedUnitCostCents = estimateRecipeUnitCost(selectedRecipe);
  const finishedItemByProductId = new Map(
    items
      .filter((item) => item.item_type === 'finished_good' && item.product_id)
      .map((item) => [item.product_id as string, item])
  );
  const latestActualRunCostByProductId = new Map<string, number>();
  for (const run of runs) {
    if (!latestActualRunCostByProductId.has(run.product_id) && normalizeInventoryNumber(run.actual_unit_cost_cents) > 0) {
      latestActualRunCostByProductId.set(run.product_id, normalizeInventoryNumber(run.actual_unit_cost_cents));
    }
  }

  function costBreakdownForProduct(productId: string) {
    const finishedItem = finishedItemByProductId.get(productId);
    const finishedAverageCost = finishedItem ? lotSummaryByItem.get(finishedItem.id)?.avgCostCents ?? 0 : 0;
    const latestActualCost = latestActualRunCostByProductId.get(productId) ?? 0;
    const estimatedRecipeCost = estimateRecipeUnitCost(recipes.find((recipe) => recipe.product_id === productId));
    return {
      latestActualCost,
      finishedAverageCost,
      estimatedRecipeCost,
      selectedCost: latestActualCost || finishedAverageCost || estimatedRecipeCost || 0,
    };
  }

  function costForProduct(productId: string) {
    return costBreakdownForProduct(productId).selectedCost;
  }

  function marginPercent(priceCents: number, costCents: number) {
    if (priceCents <= 0) return 0;
    return ((priceCents - costCents) / priceCents) * 100;
  }

  const reservedQtyByProductId = new Map<string, number>();
  for (const order of openOrders) {
    for (const item of order.order_items ?? []) {
      if (!item.product_id) continue;
      reservedQtyByProductId.set(item.product_id, (reservedQtyByProductId.get(item.product_id) ?? 0) + normalizeInventoryNumber(item.qty));
    }
  }

  const recurringQtyByProductId = new Map<string, number>();
  const recurringWeeklyQtyByProductId = new Map<string, number>();
  const recurringDemandByCenterProduct = new Map<string, { centerId: string; productId: string; cycleQty: number; weeklyQty: number; orderCount: number; schedules: Set<string> }>();
  for (const recurringOrder of recurringOrders) {
    const status = recurringOrder.status || (recurringOrder.active === false ? 'paused' : 'active');
    if (status !== 'active') continue;
    const center = relatedOne(recurringOrder.centers);
    if (center?.is_active === false) continue;
    const centerId = recurringOrder.center_id as string | null;
    const frequencyDays = daysForRecurringFrequency(recurringOrder.frequency) ?? 14;
    const frequencyLabel = labelForRecurringFrequency(recurringOrder.frequency);
    for (const item of recurringOrder.recurring_order_items ?? []) {
      if (!item.product_id) continue;
      const qty = normalizeInventoryNumber(item.qty);
      const weeklyQty = frequencyDays > 0 ? (qty * 7) / frequencyDays : 0;
      recurringQtyByProductId.set(item.product_id, (recurringQtyByProductId.get(item.product_id) ?? 0) + qty);
      recurringWeeklyQtyByProductId.set(item.product_id, (recurringWeeklyQtyByProductId.get(item.product_id) ?? 0) + weeklyQty);
      if (centerId) {
        const key = `${centerId}:${item.product_id}`;
        const existing = recurringDemandByCenterProduct.get(key) ?? {
          centerId,
          productId: item.product_id,
          cycleQty: 0,
          weeklyQty: 0,
          orderCount: 0,
          schedules: new Set<string>(),
        };
        existing.cycleQty += qty;
        existing.weeklyQty += weeklyQty;
        existing.orderCount += 1;
        existing.schedules.add(frequencyLabel);
        recurringDemandByCenterProduct.set(key, existing);
      }
    }
  }

  const usageByItemId = new Map<string, number>();
  for (const movement of inventoryMovements) {
    const usedQty = Math.abs(normalizeInventoryNumber(movement.quantity_change));
    usageByItemId.set(movement.inventory_item_id, (usageByItemId.get(movement.inventory_item_id) ?? 0) + usedQty);
  }
  const usageWeeks = USAGE_LOOKBACK_DAYS / 7;

  const availabilityRows = products
    .map((product) => {
      const finishedItem = finishedItemByProductId.get(product.id);
      const onHand = finishedItem ? lotSummaryByItem.get(finishedItem.id)?.remaining ?? 0 : 0;
      const reserved = reservedQtyByProductId.get(product.id) ?? 0;
      const recurring = recurringQtyByProductId.get(product.id) ?? 0;
      return {
        product,
        onHand,
        reserved,
        recurring,
        available: onHand - reserved,
        costCents: costForProduct(product.id),
      };
    })
    .filter((row) => row.onHand || row.reserved || row.recurring || row.costCents);

  const parQtyByProductId = new Map<string, number>();
  const minimumQtyByProductId = new Map<string, number>();
  for (const parLevel of parLevels) {
    parQtyByProductId.set(parLevel.product_id, (parQtyByProductId.get(parLevel.product_id) ?? 0) + normalizeInventoryNumber(parLevel.par_qty));
    minimumQtyByProductId.set(parLevel.product_id, (minimumQtyByProductId.get(parLevel.product_id) ?? 0) + normalizeInventoryNumber(parLevel.minimum_qty));
  }

  const productionPlanRows = products
    .map((product) => {
      const finishedItem = finishedItemByProductId.get(product.id);
      const onHand = finishedItem ? lotSummaryByItem.get(finishedItem.id)?.remaining ?? 0 : 0;
      const reserved = reservedQtyByProductId.get(product.id) ?? 0;
      const available = onHand - reserved;
      const recurringCycleQty = recurringQtyByProductId.get(product.id) ?? 0;
      const recurringWeeklyQty = recurringWeeklyQtyByProductId.get(product.id) ?? 0;
      const parQty = parQtyByProductId.get(product.id) ?? 0;
      const minimumQty = minimumQtyByProductId.get(product.id) ?? 0;
      const targetQty = Math.max(parQty, recurringCycleQty, minimumQty);
      const suggestedProductionQty = Math.max(0, Math.ceil(targetQty - available));
      return {
        product,
        onHand,
        reserved,
        available,
        recurringCycleQty,
        recurringWeeklyQty,
        parQty,
        minimumQty,
        targetQty,
        suggestedProductionQty,
        hasRecipe: recipes.some((recipe) => recipe.product_id === product.id),
        costCents: costForProduct(product.id),
      };
    })
    .filter((row) => row.suggestedProductionQty || row.recurringCycleQty || row.parQty || row.reserved || row.onHand)
    .sort((a, b) => b.suggestedProductionQty - a.suggestedProductionQty || b.recurringWeeklyQty - a.recurringWeeklyQty);

  const parLevelRows = parLevels
    .map((parLevel) => {
      const center = relatedOne(parLevel.centers) ?? centersById.get(parLevel.center_id);
      const relatedProduct = relatedOne(parLevel.products);
      const product = productsById.get(parLevel.product_id) ?? (relatedProduct ? {
        id: parLevel.product_id,
        name: relatedProduct.name,
        sku: null,
        active: relatedProduct.active,
      } : undefined);
      const demand = recurringDemandByCenterProduct.get(`${parLevel.center_id}:${parLevel.product_id}`);
      return {
        id: `${parLevel.center_id}:${parLevel.product_id}`,
        center,
        product,
        parQty: normalizeInventoryNumber(parLevel.par_qty),
        minimumQty: normalizeInventoryNumber(parLevel.minimum_qty),
        notes: parLevel.notes,
        recurringCycleQty: demand?.cycleQty ?? 0,
        recurringWeeklyQty: demand?.weeklyQty ?? 0,
        schedules: demand ? [...demand.schedules].join(', ') : 'No active recurring order',
      };
    })
    .filter((row) => row.center?.is_active !== false && row.product?.active !== false)
    .sort((a, b) => (a.center?.name ?? '').localeCompare(b.center?.name ?? '') || productName(a.product).localeCompare(productName(b.product)));

  const batchVarianceRows = runs.slice(0, 10).map((run) => {
    const product = relatedOne(run.products);
    const estimated = normalizeInventoryNumber(run.estimated_unit_cost_cents);
    const actual = normalizeInventoryNumber(run.actual_unit_cost_cents);
    const variance = actual - estimated;
    return {
      run,
      product,
      estimated,
      actual,
      variance,
      variancePercent: estimated > 0 ? (variance / estimated) * 100 : 0,
    };
  });

  const productMarginRows = products
    .map((product) => {
      const prices = centerPrices
        .filter((price) => price.product_id === product.id && normalizeInventoryNumber(price.price_cents) > 0)
        .map((price) => normalizeInventoryNumber(price.price_cents));
      const costBreakdown = costBreakdownForProduct(product.id);
      const costCents = costBreakdown.selectedCost;
      const minPriceCents = prices.length ? Math.min(...prices) : 0;
      const avgPriceCents = prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : 0;
      return {
        product,
        costCents,
        costBreakdown,
        minPriceCents,
        avgPriceCents,
        centerCount: prices.length,
        minMarginPercent: marginPercent(minPriceCents, costCents),
        avgMarginPercent: marginPercent(avgPriceCents, costCents),
      };
    })
    .filter((row) => row.centerCount || row.costCents)
    .sort((a, b) => a.minMarginPercent - b.minMarginPercent);

  const customerMarginRows = centerPrices
    .map((price) => {
      const product = productsById.get(price.product_id);
      const center = relatedOne(price.centers);
      const priceCents = normalizeInventoryNumber(price.price_cents);
      const costCents = costForProduct(price.product_id);
      return {
        id: `${price.center_id}-${price.product_id}`,
        product,
        center,
        priceCents,
        costCents,
        marginDollarsCents: priceCents - costCents,
        marginPercent: marginPercent(priceCents, costCents),
      };
    })
    .filter((row) => row.product && row.priceCents > 0 && row.center?.is_active !== false)
    .sort((a, b) => a.marginPercent - b.marginPercent);

  const reorderRows = items
    .filter((item) => item.item_type !== 'finished_good')
    .map((item) => {
      const summary = lotSummaryByItem.get(item.id);
      const setting = reorderSettingByItemId.get(item.id);
      const weeklyUsage = (usageByItemId.get(item.id) ?? 0) / usageWeeks;
      const daysOfSupply = weeklyUsage > 0 ? ((summary?.remaining ?? 0) / weeklyUsage) * 7 : null;
      const reorderPoint = normalizeInventoryNumber(setting?.reorder_point);
      const targetStock = normalizeInventoryNumber(setting?.target_stock);
      return {
        item,
        setting,
        remaining: summary?.remaining ?? 0,
        weeklyUsage,
        daysOfSupply,
        reorderPoint,
        targetStock,
        suggestedOrderQty: targetStock > 0 ? Math.max(0, targetStock - (summary?.remaining ?? 0)) : 0,
        needsReorder: reorderPoint > 0 && (summary?.remaining ?? 0) <= reorderPoint,
      };
    })
    .sort((a, b) => Number(b.needsReorder) - Number(a.needsReorder) || (a.daysOfSupply ?? 99999) - (b.daysOfSupply ?? 99999));

  const totalInventoryValueCents = [...lotSummaryByItem.values()].reduce((sum, summary) => sum + summary.valueCents, 0);
  const rawCoffeeLbs = rawCoffeeItems.reduce((sum, item) => {
    const remaining = lotSummaryByItem.get(item.id)?.remaining ?? 0;
    try {
      return sum + convertInventoryQuantity(remaining, item.base_unit, 'lb');
    } catch {
      return sum;
    }
  }, 0);
  const finishedUnits = items
    .filter((item) => item.item_type === 'finished_good')
    .reduce((sum, item) => sum + (lotSummaryByItem.get(item.id)?.remaining ?? 0), 0);
  const activeLotCount = lots.filter((lot) => normalizeInventoryNumber(lot.quantity_remaining) > 0).length;
  const missingRecipeCount = activeProducts.filter((product) => !recipes.some((recipe) => recipe.product_id === product.id)).length;
  const productionAttentionRows = productionPlanRows.filter((row) => row.suggestedProductionQty > 0);
  const reorderAttentionRows = reorderRows.filter((row) => {
    const leadTimeDays = Math.max(0, Math.trunc(normalizeInventoryNumber(row.setting?.lead_time_days) || 14));
    const watchLeadTime = row.daysOfSupply !== null && row.daysOfSupply <= leadTimeDays;
    return row.needsReorder || watchLeadTime;
  });
  const marginAttentionRows = productMarginRows.filter((row) => row.minPriceCents > 0 && row.minMarginPercent < 35);
  const tabMetrics: Record<InventoryTab, string> = {
    overview: `${productionAttentionRows.length + reorderAttentionRows.length + marginAttentionRows.length} alerts`,
    setup: `${missingRecipeCount} missing`,
    planning: `${productionAttentionRows.length + reorderAttentionRows.length} alerts`,
    production: `${batchVarianceRows.length} batches`,
    stock: `${activeLotCount} lots`,
    margins: `${marginAttentionRows.length} alerts`,
  };

  return (
    <div className="flex flex-col gap-6">
      {toast === 'item_created' ? <StatusToast message="Inventory item added." tone="success" /> : null}
      {toast === 'item_error' ? <StatusToast message="Unable to add that inventory item." tone="error" /> : null}
      {toast === 'receipt_created' ? <StatusToast message="Inventory received and averaged into stock." tone="success" /> : null}
      {toast === 'receipt_error' ? <StatusToast message="Unable to receive inventory." tone="error" /> : null}
      {toast === 'recipe_saved' ? <StatusToast message="Master item recipe saved." tone="success" /> : null}
      {toast === 'recipe_error' ? <StatusToast message="Unable to save that recipe." tone="error" /> : null}
      {toast === 'production_recorded' ? <StatusToast message="Production run recorded and inventory updated." tone="success" /> : null}
      {toast === 'production_error' ? <StatusToast message="Unable to record production. Check available inventory and recipe setup." tone="error" /> : null}
      {toast === 'production_unit_error' ? <StatusToast message="One component uses units that cannot be converted. Check the recipe units." tone="error" /> : null}
      {toast === 'reorder_saved' ? <StatusToast message="Reorder settings saved." tone="success" /> : null}
      {toast === 'reorder_error' ? <StatusToast message="Unable to save reorder settings. Apply the Phase 2 migration if you have not yet." tone="error" /> : null}
      {toast === 'par_saved' ? <StatusToast message="Center par target saved." tone="success" /> : null}
      {toast === 'par_error' ? <StatusToast message="Unable to save center par target. Apply the Phase 3 migration if you have not yet." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only zach@sobrew.com can change admin data." tone="error" /> : null}

      <section className="panel order-1">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)] lg:items-end">
          <div>
            <span className="eyebrow">Inventory Command Center</span>
            <h1 className="page-title mt-4">Inventory operations</h1>
            <p className="page-subtitle mt-3">Receive supplies, build product recipes, make finished goods, and watch COGS from one admin workflow.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <Link href={inventoryHref({ tab: 'planning' })} className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4 text-sm transition hover:bg-rose-50">
              <span className="font-semibold text-rose-800">{productionAttentionRows.length} make alerts</span>
              <span className="mt-1 block text-rose-700">Finished goods below target</span>
            </Link>
            <Link href={inventoryHref({ tab: 'planning' })} className="rounded-2xl border border-amber-100 bg-amber-50/70 p-4 text-sm transition hover:bg-amber-50">
              <span className="font-semibold text-amber-800">{reorderAttentionRows.length} buy alerts</span>
              <span className="mt-1 block text-amber-700">Raw materials or supplies to review</span>
            </Link>
            <Link href={inventoryHref({ tab: 'margins' })} className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4 text-sm transition hover:bg-teal-50">
              <span className="font-semibold text-teal-800">{marginAttentionRows.length} margin alerts</span>
              <span className="mt-1 block text-teal-700">Customer prices below target margin</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="order-2 grid gap-3 md:grid-cols-4">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Inventory Value</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{usd(Math.round(totalInventoryValueCents))}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Raw Coffee</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{formatInventoryQuantity(rawCoffeeLbs, 'lb')}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Finished Goods</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{formatInventoryQuantity(finishedUnits, 'each')}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Active Lots</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{activeLotCount}</p>
        </div>
      </section>

      <section className="card order-3 p-2">
        <nav aria-label="Inventory sections" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {INVENTORY_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <Link
                key={tab.id}
                href={inventoryHref({ tab: tab.id })}
                aria-current={isActive ? 'page' : undefined}
                className={`rounded-2xl border px-4 py-3 text-sm transition ${
                  isActive
                    ? 'border-teal-200 bg-teal-50 text-teal-950 shadow-sm'
                    : 'border-slate-200 bg-white/70 text-slate-700 hover:border-teal-200 hover:bg-white'
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{tab.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${isActive ? 'bg-white text-teal-800' : 'bg-slate-100 text-slate-500'}`}>
                    {tabMetrics[tab.id]}
                  </span>
                </span>
                <span className={`mt-1 block text-xs ${isActive ? 'text-teal-700' : 'text-slate-500'}`}>{tab.description}</span>
              </Link>
            );
          })}
        </nav>
      </section>

      <section className="card order-3 space-y-4" style={activeTab !== 'overview' ? { display: 'none' } : undefined}>
        <div>
          <span className="eyebrow">Workflow</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Use the tab in this order</h2>
          <p className="mt-2 text-sm text-slate-500">Setup is usually done once. Receiving, production, and review are the day-to-day work.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Link href={inventoryHref({ tab: 'setup' })} className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm transition hover:border-teal-200 hover:bg-white">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Step 1</span>
            <span className="mt-2 block font-semibold text-slate-950">Add inventory items</span>
            <span className="mt-1 block text-slate-500">Coffee, bags, boxes, tape, and supplies</span>
          </Link>
          <Link href={inventoryHref({ tab: 'setup' })} className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm transition hover:border-teal-200 hover:bg-white">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Step 2</span>
            <span className="mt-2 block font-semibold text-slate-950">Receive inventory</span>
            <span className="mt-1 block text-slate-500">Create lots and landed costs</span>
          </Link>
          <Link href={inventoryHref({ tab: 'setup' })} className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm transition hover:border-teal-200 hover:bg-white">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Step 3</span>
            <span className="mt-2 block font-semibold text-slate-950">Set recipes</span>
            <span className="mt-1 block text-slate-500">{missingRecipeCount} active products missing recipes</span>
          </Link>
          <Link href={inventoryHref({ tab: 'planning' })} className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm transition hover:border-teal-200 hover:bg-white">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Step 4</span>
            <span className="mt-2 block font-semibold text-slate-950">Set planning targets</span>
            <span className="mt-1 block text-slate-500">Par levels and reorder points</span>
          </Link>
          <Link href={inventoryHref({ tab: 'planning' })} className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm transition hover:border-teal-200 hover:bg-white">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Step 5</span>
            <span className="mt-2 block font-semibold text-slate-950">Review plan</span>
            <span className="mt-1 block text-slate-500">What to make and buy next</span>
          </Link>
          <Link href={inventoryHref({ tab: 'production' })} className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm transition hover:border-teal-200 hover:bg-white">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Step 6</span>
            <span className="mt-2 block font-semibold text-slate-950">Record production</span>
            <span className="mt-1 block text-slate-500">Actual material used</span>
          </Link>
        </div>
      </section>

      {phase2MigrationMissing ? (
        <section className="card order-4 border-amber-200 bg-amber-50/80 text-sm text-amber-900">
          <p className="font-semibold">Phase 2 migration needed</p>
          <p className="mt-2">Apply <span className="font-mono text-xs">db/migrations/017_inventory_phase2.sql</span> to save reorder settings. Margin, availability, and COGS views can still calculate from the existing Phase 1 data.</p>
        </section>
      ) : null}

      {phase3MigrationMissing ? (
        <section className="card order-4 border-amber-200 bg-amber-50/80 text-sm text-amber-900">
          <p className="font-semibold">Phase 3 migration needed</p>
          <p className="mt-2">Apply <span className="font-mono text-xs">db/migrations/018_inventory_phase3.sql</span> to save center par targets. Production planning still uses active recurring orders and open order reservations.</p>
        </section>
      ) : null}

      <section id="pricing-check" className="order-[13] scroll-mt-28 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]" style={activeTab !== 'margins' ? { display: 'none' } : undefined}>
        <div className="card space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <span className="eyebrow">Price Check</span>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Product margins</h2>
              <p className="mt-2 text-sm text-slate-500">Lowest-margin products appear first. Cost uses the latest batch, finished stock average, or recipe estimate.</p>
            </div>
            <Link href="/admin/products" className="btn-secondary w-full sm:w-auto">Manage products</Link>
          </div>
          <div className="space-y-3">
            {productMarginRows.slice(0, 8).map((row) => (
              <div key={row.product.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <Link className="font-semibold text-slate-950 hover:text-teal-700" href={`/admin/products/${row.product.id}`}>
                      {productName(row.product)}
                    </Link>
                    <p className="mt-1 text-sm text-slate-500">
                      Cost {usd(Math.round(row.costCents))} each - {row.centerCount || 'No'} customer prices
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Actual {row.costBreakdown.latestActualCost ? usd(Math.round(row.costBreakdown.latestActualCost)) : 'N/A'} - Avg stock {row.costBreakdown.finishedAverageCost ? usd(Math.round(row.costBreakdown.finishedAverageCost)) : 'N/A'} - Recipe {row.costBreakdown.estimatedRecipeCost ? usd(Math.round(row.costBreakdown.estimatedRecipeCost)) : 'N/A'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-left sm:min-w-56 sm:text-right">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Lowest price</p>
                      <p className="mt-1 font-semibold text-slate-950">{row.minPriceCents ? usd(Math.round(row.minPriceCents)) : 'Not set'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Min margin</p>
                      <p className={`mt-1 font-semibold ${row.minMarginPercent < 20 ? 'text-rose-700' : row.minMarginPercent < 35 ? 'text-amber-700' : 'text-teal-800'}`}>
                        {row.minPriceCents ? `${row.minMarginPercent.toFixed(1)}%` : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {!productMarginRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">Add recipes, production batches, or customer prices to see product margins.</p> : null}
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Customer Price Check</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Center-specific margins</h2>
            <p className="mt-2 text-sm text-slate-500">Shows which center and product combinations are most sensitive when COGS changes.</p>
          </div>
          <div className="space-y-3">
            {customerMarginRows.slice(0, 10).map((row) => (
              <div key={row.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">{row.center?.name ?? 'Unnamed center'}</p>
                    <p className="mt-1 text-sm text-slate-500">{productName(row.product)}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.marginPercent < 20 ? 'bg-rose-50 text-rose-700' : row.marginPercent < 35 ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-800'}`}>
                    {row.marginPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Price</p>
                    <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(row.priceCents))}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">COGS</p>
                    <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(row.costCents))}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Profit</p>
                    <p className={`mt-1 font-semibold ${row.marginDollarsCents < 0 ? 'text-rose-700' : 'text-slate-950'}`}>{usd(Math.round(row.marginDollarsCents))}</p>
                  </div>
                </div>
              </div>
            ))}
            {!customerMarginRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">Customer-specific prices will appear here after they are assigned to centers.</p> : null}
          </div>
        </div>
      </section>

      <section className="card order-[11] scroll-mt-28 space-y-4" id="availability" style={activeTab !== 'planning' ? { display: 'none' } : undefined}>
        <div>
          <span className="eyebrow">Ready To Sell</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Finished goods availability</h2>
          <p className="mt-2 text-sm text-slate-500">On hand minus open orders equals ready stock. Recurring demand shows expected active subscription quantity.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {availabilityRows.slice(0, 12).map((row) => (
            <div key={row.product.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold text-slate-950">{productName(row.product)}</p>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.available < 0 ? 'bg-rose-50 text-rose-700' : row.available <= row.recurring ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-800'}`}>
                  {row.available < 0 ? 'Short' : 'Available'}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">On hand</p>
                  <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.onHand, 'each')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Reserved</p>
                  <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.reserved, 'each')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Ready</p>
                  <p className={`mt-1 font-semibold ${row.available < 0 ? 'text-rose-700' : 'text-slate-950'}`}>{formatInventoryQuantity(row.available, 'each')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Recurring</p>
                  <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.recurring, 'each')}</p>
                </div>
              </div>
            </div>
          ))}
          {!availabilityRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">Produce finished inventory or receive orders to see availability.</p> : null}
        </div>
      </section>

      <section className="order-[8] grid gap-6 xl:grid-cols-[1.15fr_0.85fr]" style={activeTab !== 'planning' ? { display: 'none' } : undefined}>
        <div id="make-next" className="card scroll-mt-28 space-y-4">
          <div>
            <span className="eyebrow">Make Next</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">What to make next</h2>
            <p className="mt-2 text-sm text-slate-500">Suggested quantity covers open orders, recurring demand, and center par targets.</p>
          </div>
          <div className="space-y-3">
            {productionPlanRows.slice(0, 12).map((row) => (
              <div key={row.product.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-950">{productName(row.product)}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Available {formatInventoryQuantity(row.available, 'each')} - Reserved {formatInventoryQuantity(row.reserved, 'each')} - Target {formatInventoryQuantity(row.targetQty, 'each')}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.suggestedProductionQty > 0 ? 'bg-rose-50 text-rose-700' : row.available <= row.recurringCycleQty ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-800'}`}>
                    {row.suggestedProductionQty > 0 ? 'Make' : row.available <= row.recurringCycleQty ? 'Watch' : 'Covered'}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Suggested</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.suggestedProductionQty, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Recurring</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.recurringCycleQty, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Weekly burn</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.recurringWeeklyQty, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Par</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.parQty, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Recipe</p>
                    <p className={`mt-1 font-semibold ${row.hasRecipe ? 'text-teal-800' : 'text-amber-700'}`}>{row.hasRecipe ? 'Ready' : 'Needed'}</p>
                  </div>
                </div>
                {row.suggestedProductionQty > 0 && row.hasRecipe ? (
                  <Link className="btn-secondary mt-4 w-full sm:w-auto" href={inventoryHref({ tab: 'production', produce_product: row.product.id, produce_qty: String(row.suggestedProductionQty) })}>
                    Plan this run
                  </Link>
                ) : null}
              </div>
            ))}
            {!productionPlanRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">Add active recurring orders, center par targets, or finished goods to generate production suggestions.</p> : null}
          </div>
        </div>

      </section>

      <section id="par-targets" className="card order-[7] scroll-mt-28 space-y-4" style={activeTab !== 'planning' ? { display: 'none' } : undefined}>
        <div>
          <span className="eyebrow">Planning Targets</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Center par levels</h2>
          <p className="mt-2 text-sm text-slate-500">Set the finished-good target for each center and product. These targets feed the make-next list.</p>
        </div>
        <form action={updateCenterParLevel} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_8rem_8rem_minmax(0,1fr)_auto] lg:items-end">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Center
            <select className="input" name="center_id" required defaultValue="">
              <option value="" disabled>Select center</option>
              {centers.map((center) => <option key={center.id} value={center.id}>{center.name ?? 'Unnamed center'}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Product
            <select className="input" name="product_id" required defaultValue="">
              <option value="" disabled>Select product</option>
              {activeProducts.map((product) => <option key={product.id} value={product.id}>{productName(product)}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Par target
            <input className="input" name="par_qty" min="0" step="1" type="number" placeholder="0" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Minimum stock
            <input className="input" name="minimum_qty" min="0" step="1" type="number" placeholder="0" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Notes
            <input className="input" name="notes" placeholder="Optional" />
          </label>
          <button className="btn-primary w-full lg:w-auto" disabled={phase3MigrationMissing}>Save target</button>
        </form>
        <div className="grid gap-3 lg:grid-cols-2">
          {parLevelRows.map((row) => (
            <div key={row.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">{row.center?.name ?? 'Unnamed center'}</p>
                  <p className="mt-1 text-sm text-slate-500">{productName(row.product)}</p>
                </div>
                <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">
                  Par {formatInventoryQuantity(row.parQty, 'each')}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Minimum</p>
                  <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.minimumQty, 'each')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Recurring</p>
                  <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.recurringCycleQty, 'each')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Weekly</p>
                  <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.recurringWeeklyQty, 'each')}</p>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-500">{row.schedules}</p>
              {row.notes ? <p className="mt-2 text-sm text-slate-500">{row.notes}</p> : null}
            </div>
          ))}
          {!parLevelRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No center par targets saved yet.</p> : null}
        </div>
      </section>

      <section id="buy-next" className="card order-[9] scroll-mt-28 space-y-4" style={activeTab !== 'planning' ? { display: 'none' } : undefined}>
        <div>
          <span className="eyebrow">Buy Next</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Raw material and supply reorders</h2>
          <p className="mt-2 text-sm text-slate-500">Uses the last {USAGE_LOOKBACK_DAYS} days of production usage to estimate weekly usage and days of supply.</p>
        </div>
        <div className="space-y-4">
          {reorderRows.map((row) => {
            const leadTimeDays = Math.max(0, Math.trunc(normalizeInventoryNumber(row.setting?.lead_time_days) || 14));
            const watchLeadTime = row.daysOfSupply !== null && row.daysOfSupply <= leadTimeDays;
            const status = row.needsReorder ? 'Reorder' : watchLeadTime ? 'Watch' : 'OK';
            return (
              <form key={row.item.id} action={updateReorderSetting} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <input type="hidden" name="inventory_item_id" value={row.item.id} />
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{itemDisplayName(row.item)}</p>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status === 'Reorder' ? 'bg-rose-50 text-rose-700' : status === 'Watch' ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-800'}`}>
                        {status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatInventoryQuantity(row.remaining, row.item.base_unit)} on hand - {formatInventoryQuantity(row.weeklyUsage, row.item.base_unit)} used per week - {row.daysOfSupply === null ? 'No usage yet' : `${Math.round(row.daysOfSupply)} days left`}
                    </p>
                  </div>
                  <div className="text-sm lg:text-right">
                    <p className="font-semibold text-slate-950">
                      Suggested buy: {formatInventoryQuantity(row.needsReorder || watchLeadTime ? row.suggestedOrderQty : 0, row.item.base_unit)}
                    </p>
                    <p className="mt-1 text-slate-500">Supplier lead time: {leadTimeDays} days</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-5">
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Reorder when stock reaches
                    <input className="input" name="reorder_point" min="0" step="0.0001" type="number" defaultValue={numericInputValue(row.setting?.reorder_point)} placeholder="0" />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Restock up to
                    <input className="input" name="target_stock" min="0" step="0.0001" type="number" defaultValue={numericInputValue(row.setting?.target_stock)} placeholder="0" />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Supplier lead time
                    <input className="input" name="lead_time_days" min="0" step="1" type="number" defaultValue={String(leadTimeDays)} />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Supplier
                    <input className="input" name="preferred_supplier" defaultValue={row.setting?.preferred_supplier ?? ''} placeholder="Optional" />
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Notes
                    <input className="input" name="notes" defaultValue={row.setting?.notes ?? ''} placeholder="Optional" />
                  </label>
                </div>
                <button className="btn-secondary mt-4 w-full sm:w-auto" disabled={phase2MigrationMissing}>Save buy settings</button>
              </form>
            );
          })}
          {!reorderRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">Add raw coffee or supply items before setting reorder points.</p> : null}
        </div>
      </section>

      <section className="order-[5] grid gap-6 xl:grid-cols-2" style={activeTab !== 'setup' ? { display: 'none' } : undefined}>
        <form id="setup-items" action={createInventoryItem} className="card scroll-mt-28 space-y-4">
          <div>
            <span className="eyebrow">Step 1</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Add an inventory item</h2>
            <p className="mt-2 text-sm text-slate-500">Create raw coffee, packaging, supplies, and finished-good inventory records before receiving or producing stock.</p>
          </div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Item name
            <input className="input" name="name" required placeholder="Colombian whole bean" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Internal SKU or supplier code
            <input className="input" name="sku" placeholder="COFFEE-COLOMBIAN" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Item type
              <select className="input" name="item_type" required defaultValue="raw_coffee">
                {INVENTORY_ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Stocked in
              <select className="input" name="base_unit" required defaultValue="lb">
                {INVENTORY_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
              </select>
            </label>
          </div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Notes
            <textarea className="input min-h-24" name="description" placeholder="Supplier details, packaging size, roast, or variation info" />
          </label>
          <button className="btn-primary w-full sm:w-auto">Save inventory item</button>
        </form>

        <form id="receive-stock" action={receiveInventory} className="card scroll-mt-28 space-y-4">
          <div>
            <span className="eyebrow">Step 2</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Receive purchased inventory</h2>
            <p className="mt-2 text-sm text-slate-500">Creates a lot, adds stock on hand, and averages landed cost into inventory value.</p>
          </div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Item received
            <select className="input" name="inventory_item_id" required defaultValue="">
              <option value="" disabled>Select raw material or supply</option>
              {receivableItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)} - {item.base_unit}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Lot or batch code
              <input className="input" name="lot_code" placeholder="LOT-2026-05-13" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Received date
              <input className="input" name="received_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
          </div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Supplier
            <input className="input" name="supplier" placeholder="Supplier name" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Quantity received
              <input className="input" name="quantity" required min="0.0001" step="0.0001" type="number" placeholder="Base unit quantity" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Item cost per unit
              <input className="input" name="unit_cost" required min="0" step="0.0001" type="number" placeholder="2.25" />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Freight total
              <input className="input" name="freight_cost" min="0" step="0.01" type="number" placeholder="0.00" />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Other landed cost
              <input className="input" name="other_cost" min="0" step="0.01" type="number" placeholder="0.00" />
            </label>
          </div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Receipt notes
            <textarea className="input min-h-20" name="notes" placeholder="Invoice number, quality notes, or storage notes" />
          </label>
          <button className="btn-primary w-full sm:w-auto">Receive lot and update cost</button>
        </form>
      </section>

      <section id="recipes" className="card order-[6] scroll-mt-28 space-y-5" style={activeTab !== 'setup' ? { display: 'none' } : undefined}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <span className="eyebrow">Step 3</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Product recipes</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">Tell the system what goes into each sellable product so estimated COGS and production usage are ready before a batch is made.</p>
            {selectedRecipe ? (
              <p className="mt-3 inline-flex rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">
                Estimated COGS: {usd(Math.round(selectedRecipeEstimatedUnitCostCents))} per finished unit
              </p>
            ) : null}
          </div>
          <form className="flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="tab" value="setup" />
            <label className="sr-only" htmlFor="recipe-product-select">Product recipe to edit</label>
            <select id="recipe-product-select" className="input min-w-72" name="recipe_product" defaultValue={recipeProductId}>
              {activeProducts.map((product) => <option key={product.id} value={product.id}>{productName(product)}</option>)}
            </select>
            <button className="btn-secondary">Load recipe</button>
          </form>
        </div>

        {recipeProductId ? (
          <form action={saveRecipe} className="space-y-5">
            <input type="hidden" name="product_id" value={recipeProductId} />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Finished units this recipe makes
                <input className="input" name="output_qty" min="0.0001" step="0.0001" type="number" defaultValue={numericInputValue(selectedRecipe?.output_qty) || '1'} />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Planned waste or shrink %
                <input className="input" name="waste_percent" min="0" step="0.01" type="number" defaultValue={numericInputValue(selectedRecipe?.waste_percent) || '0'} />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Raw coffee measuring unit
                <select className="input" name="raw_coffee_unit" defaultValue={selectedRecipeComponents.find((component) => relatedOne(component.inventory_items)?.item_type === 'raw_coffee')?.unit ?? 'oz'}>
                  <option value="oz">oz</option>
                  <option value="lb">lb</option>
                </select>
              </label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
              <p className="text-sm font-semibold text-slate-950">Raw coffee used for this recipe output</p>
              <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem]">
                <select className="input" name="raw_coffee_item_id" defaultValue={selectedRecipeComponents.find((component) => relatedOne(component.inventory_items)?.item_type === 'raw_coffee')?.inventory_item_id ?? ''}>
                  <option value="">Select raw coffee</option>
                  {rawCoffeeItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)} - stocked in {item.base_unit}</option>)}
                </select>
                <input
                  className="input"
                  name="raw_coffee_qty"
                  min="0"
                  step="0.0001"
                  type="number"
                  placeholder="Amount"
                  defaultValue={numericInputValue(selectedRecipeComponents.find((component) => relatedOne(component.inventory_items)?.item_type === 'raw_coffee')?.quantity)}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
              <p className="text-sm font-semibold text-slate-950">Standard supplies used per recipe output</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {commonSupplyItems.map((item) => {
                  const existing = selectedRecipeComponentByItemId.get(item.id);
                  return (
                    <label key={item.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 text-sm sm:grid-cols-[1fr_7rem] sm:items-center">
                      <span className="flex items-center gap-3 font-medium text-slate-800">
                        <input type="checkbox" name="common_component_id" value={item.id} defaultChecked={Boolean(existing)} />
                        {item.name}
                      </span>
                      <span className="flex items-center gap-2">
                        <input className="input px-3 py-2" name={`common_qty_${item.id}`} min="0" step="0.0001" type="number" defaultValue={numericInputValue(existing?.quantity) || '1'} />
                        <input type="hidden" name={`common_unit_${item.id}`} value={item.base_unit} />
                        <span className="text-xs text-slate-500">{item.base_unit}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
              <p className="text-sm font-semibold text-slate-950">Additional components used per recipe output</p>
              <div className="mt-3 space-y-3">
                {Array.from({ length: EXTRA_COMPONENT_ROWS }).map((_, index) => (
                  <div key={index} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_7rem_minmax(0,1fr)]">
                    <select className="input" name={`extra_item_id_${index}`} defaultValue="">
                      <option value="">Add another item</option>
                      {additionalComponentItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)}</option>)}
                    </select>
                    <input className="input" name={`extra_qty_${index}`} min="0" step="0.0001" type="number" placeholder="Qty" />
                    <select className="input" name={`extra_unit_${index}`} defaultValue="each">
                      {INVENTORY_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                    </select>
                    <input className="input" name={`extra_note_${index}`} placeholder="Note" />
                  </div>
                ))}
              </div>
            </div>

            <textarea className="input min-h-20" name="notes" defaultValue={selectedRecipe?.notes ?? ''} placeholder="Recipe notes" />
            <button className="btn-primary w-full sm:w-auto">Save product recipe</button>
          </form>
        ) : (
          <p className="text-sm text-slate-500">Create a product first, then define its inventory recipe.</p>
        )}
      </section>

      <section id="make-finished" className="card order-[10] scroll-mt-28 space-y-5" style={activeTab !== 'production' ? { display: 'none' } : undefined}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <span className="eyebrow">Step 4</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Record finished production</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">Choose a recipe, enter the quantity made, confirm actual material usage, and add the finished batch to stock.</p>
          </div>
          <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <input type="hidden" name="tab" value="production" />
            <label className="sr-only" htmlFor="production-product-select">Product to make</label>
            <select id="production-product-select" className="input min-w-64" name="produce_product" defaultValue={productionProductId}>
              {recipes.map((recipe) => {
                const product = productsById.get(recipe.product_id);
                return <option key={recipe.product_id} value={recipe.product_id}>{productName(product)}</option>;
              })}
            </select>
            <label className="sr-only" htmlFor="production-qty-input">Quantity to make</label>
            <input id="production-qty-input" className="input" name="produce_qty" min="1" step="1" type="number" placeholder="Qty" defaultValue={produceQty || '1'} />
            <button className="btn-secondary">Plan run</button>
          </form>
        </div>

        {productionRecipe && productionQty > 0 ? (
          <form action={recordProductionRun} className="space-y-4">
            <input type="hidden" name="product_id" value={productionProductId} />
            <input type="hidden" name="quantity_produced" value={productionQty} />
            <div className="rounded-2xl border border-teal-100 bg-teal-50/50 p-4">
              <p className="text-sm font-semibold text-teal-900">Recording {formatInventoryQuantity(productionQty, 'finished units')} of {productName(productsById.get(productionProductId))}</p>
              <p className="mt-1 text-sm text-teal-800">Expected usage includes the recipe waste percentage. Override actual usage where the run differed.</p>
            </div>
            <div className="space-y-3">
              {productionComponents.map((component) => {
                const item = relatedOne(component.inventory_items);
                const outputQty = normalizeInventoryNumber(productionRecipe.output_qty) || 1;
                const wasteMultiplier = 1 + (normalizeInventoryNumber(productionRecipe.waste_percent) / 100);
                const expected = (normalizeInventoryNumber(component.quantity) / outputQty) * productionQty * wasteMultiplier;
                const summary = lotSummaryByItem.get(component.inventory_item_id);
                return (
                  <div key={component.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/70 p-4 md:grid-cols-[minmax(0,1fr)_10rem_10rem] md:items-center">
                    <div>
                      <p className="font-semibold text-slate-950">{itemDisplayName(item)}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        Expected {formatInventoryQuantity(expected, component.unit)} - Available {formatInventoryQuantity(summary?.remaining ?? 0, item?.base_unit)}
                      </p>
                    </div>
                    <label className="space-y-1 text-sm font-medium text-slate-700">
                      Actual material used
                      <input className="input" name={`actual_${component.id}`} min="0" step="0.0001" type="number" defaultValue={numericInputValue(expected)} />
                    </label>
                    <p className="text-sm text-slate-500 md:self-end">in {component.unit}</p>
                  </div>
                );
              })}
            </div>
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Finished units lost
                <input className="input" name="waste_quantity" min="0" step="0.0001" type="number" placeholder="0" />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Production notes
                <input className="input" name="notes" placeholder="Seal issues, test run, grind change, or other notes" />
              </label>
            </div>
            <button className="btn-primary w-full sm:w-auto">Record production run</button>
          </form>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">
            Save a recipe, choose a product, and enter a quantity to build a production run.
          </div>
        )}
      </section>

      <section className="card order-[10] space-y-4" style={activeTab !== 'production' ? { display: 'none' } : undefined}>
        <div>
          <span className="eyebrow">Batch Check</span>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Actual vs estimated COGS</h2>
          <p className="mt-2 text-sm text-slate-500">Compares the recipe estimate with actual material usage from each production run.</p>
        </div>
        <div className="space-y-3">
          {batchVarianceRows.map((row) => (
            <div key={row.run.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">{row.product?.name ?? 'Finished product'}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatInventoryQuantity(row.run.quantity_produced, 'each')} - {formatDate(row.run.produced_at)}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.variance > 0 ? 'bg-amber-50 text-amber-700' : row.variance < 0 ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-600'}`}>
                  {row.variance === 0 ? 'Even' : row.variance > 0 ? 'Over' : 'Under'}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Estimated</p>
                  <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(row.estimated))}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Actual</p>
                  <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(row.actual))}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Variance</p>
                  <p className={`mt-1 font-semibold ${row.variance > 0 ? 'text-amber-700' : row.variance < 0 ? 'text-teal-800' : 'text-slate-950'}`}>
                    {row.variance > 0 ? '+' : ''}{usd(Math.round(row.variance))}
                  </p>
                </div>
              </div>
            </div>
          ))}
          {!batchVarianceRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">Record production runs to compare estimated and actual batch COGS.</p> : null}
        </div>
      </section>

      <section id="stock-check" className="order-[12] scroll-mt-28 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]" style={activeTab !== 'stock' ? { display: 'none' } : undefined}>
        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Stock Check</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Inventory on hand by item</h2>
            <p className="mt-2 text-sm text-slate-500">Current quantity and weighted average cost for every raw material, supply, and finished good.</p>
          </div>
          <div className="space-y-3">
            {items.map((item) => {
              const summary = lotSummaryByItem.get(item.id);
              return (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-950">{itemDisplayName(item)}</p>
                      <p className="mt-1 text-sm text-slate-500">{inventoryItemTypeLabel(item.item_type)} - stocked in {item.base_unit}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="font-semibold text-slate-950">{formatInventoryQuantity(summary?.remaining ?? 0, item.base_unit)}</p>
                      <p className="mt-1 text-sm text-slate-500">Avg {usd(Math.round(summary?.avgCostCents ?? 0))} / {item.base_unit}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card space-y-4">
            <div>
              <span className="eyebrow">Lots</span>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Active lots</h2>
              <p className="mt-2 text-sm text-slate-500">Open lots with remaining stock and their current unit cost.</p>
            </div>
            <div className="space-y-3">
              {lots.filter((lot) => normalizeInventoryNumber(lot.quantity_remaining) > 0).slice(0, 8).map((lot) => {
                const item = itemsById.get(lot.inventory_item_id);
                return (
                  <div key={lot.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-950">{item?.name ?? 'Unknown item'}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{lot.lot_code}</p>
                      </div>
                      <p className="text-sm font-semibold text-slate-950">{formatInventoryQuantity(lot.quantity_remaining, item?.base_unit)}</p>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">{usd(Math.round(normalizeInventoryNumber(lot.unit_cost_cents)))} / {item?.base_unit} - {formatDate(lot.received_at)}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card space-y-4">
            <div>
              <span className="eyebrow">History</span>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Recent activity</h2>
              <p className="mt-2 text-sm text-slate-500">Latest production runs and received inventory entries.</p>
            </div>
            <div className="space-y-3">
              {runs.map((run) => {
                const product = relatedOne(run.products);
                return (
                  <div key={run.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                    <p className="font-semibold text-slate-950">{product?.name ?? 'Finished product'}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Produced {formatInventoryQuantity(run.quantity_produced, 'each')} - Actual {usd(Math.round(normalizeInventoryNumber(run.actual_unit_cost_cents)))} each
                    </p>
                  </div>
                );
              })}
              {receipts.map((receipt) => {
                const item = itemsById.get(receipt.inventory_item_id);
                return (
                  <div key={receipt.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                    <p className="font-semibold text-slate-950">{item?.name ?? 'Received inventory'}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      Received {formatInventoryQuantity(receipt.quantity, receipt.unit)} - {usd(Math.round(normalizeInventoryNumber(receipt.landed_unit_cost_cents)))} / {receipt.unit}
                    </p>
                  </div>
                );
              })}
              {!runs.length && !receipts.length ? <p className="text-sm text-slate-500">No inventory activity yet.</p> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

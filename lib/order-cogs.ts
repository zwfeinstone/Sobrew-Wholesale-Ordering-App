import {
  convertInventoryQuantity,
  fixedRecipeCostBreakdownCents,
  isWholeCountPackagingComponentRole,
  laborCostCents,
  normalizeInventoryNumber,
  recipeComponentWasteMultiplier,
  roundWholeCountQuantity,
  type InventoryUnit,
} from '@/lib/inventory';
import { processingFeeCentsForRevenue } from '@/lib/order-fees';

type SupabaseLike = {
  from: (table: string) => any;
};

type CogsSource = 'actual_fifo' | 'partial_estimate' | 'estimated_latest_production' | 'estimated_recipe' | 'missing_cost';

type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string | null;
  qty: number | string | null;
  unit_price_cents: number | string | null;
  line_total_cents: number | string | null;
  shipping_boxes_used: number | string | null;
  cogs_snapshot_at: string | null;
};

type InventoryItemRow = {
  active?: boolean | null;
  id: string;
  name?: string | null;
  product_id: string | null;
  base_unit: InventoryUnit;
  sku?: string | null;
};

type InventoryLotRow = {
  id: string;
  inventory_item_id: string;
  quantity_remaining: number | string;
  unit_cost_cents: number | string;
  production_run_id: string | null;
};

type InventoryCostLotRow = InventoryLotRow & {
  created_at?: string | null;
  received_at?: string | null;
};

type ShippingBoxUsageRow = {
  id: string;
  order_item_id: string;
  inventory_item_id: string;
  quantity: number | string;
  unit_cost_cents: number | string | null;
  total_cost_cents: number | string | null;
  cogs_estimated: boolean | null;
  consumed_at: string | null;
};

type ProductionRunRow = {
  id: string;
  product_id: string;
  quantity_produced: number | string;
  quantity_voided?: number | string | null;
  status?: string | null;
  actual_unit_cost_cents: number | string | null;
  actual_labor_cost_cents: number | string | null;
  fixed_cost_cents: number | string | null;
  fixed_tape_cost_cents?: number | string | null;
  fixed_shipping_label_cost_cents?: number | string | null;
  fixed_branding_label_cost_cents?: number | string | null;
  fixed_other_cost_cents?: number | string | null;
};

type RecipeComponentRow = {
  inventory_item_id: string;
  quantity: number | string;
  unit: InventoryUnit;
  component_role: string | null;
  inventory_items?: { id: string; base_unit: InventoryUnit; sku: string | null } | Array<{ id: string; base_unit: InventoryUnit; sku: string | null }> | null;
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

type ProductRow = {
  id: string;
  name: string | null;
  sku: string | null;
};

type UnitCostBreakdown = {
  brandingLabelCents: number;
  fixedCents: number;
  fixedOtherCents: number;
  laborCents: number;
  materialCents: number;
  shippingLabelCents: number;
  source: CogsSource;
  tapeCents: number;
  totalCents: number;
};

type LineCostBreakdown = Omit<UnitCostBreakdown, 'source' | 'totalCents'> & {
  source: CogsSource;
  totalCents: number;
};

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function lineRevenueCents(item: Pick<OrderItemRow, 'line_total_cents' | 'qty' | 'unit_price_cents'>) {
  const explicit = normalizeInventoryNumber(item.line_total_cents);
  if (explicit > 0) return explicit;
  return normalizeInventoryNumber(item.qty) * normalizeInventoryNumber(item.unit_price_cents);
}

function activeProductionQuantity(run: ProductionRunRow) {
  if (run.status === 'void') return 0;
  return Math.max(0, normalizeInventoryNumber(run.quantity_produced) - normalizeInventoryNumber(run.quantity_voided));
}

function emptyLineBreakdown(source: CogsSource = 'missing_cost'): LineCostBreakdown {
  return {
    brandingLabelCents: 0,
    fixedCents: 0,
    fixedOtherCents: 0,
    laborCents: 0,
    materialCents: 0,
    shippingLabelCents: 0,
    source,
    tapeCents: 0,
    totalCents: 0,
  };
}

function multiplyUnitBreakdown(unit: UnitCostBreakdown, quantity: number): LineCostBreakdown {
  return {
    brandingLabelCents: unit.brandingLabelCents * quantity,
    fixedCents: unit.fixedCents * quantity,
    fixedOtherCents: unit.fixedOtherCents * quantity,
    laborCents: unit.laborCents * quantity,
    materialCents: unit.materialCents * quantity,
    shippingLabelCents: unit.shippingLabelCents * quantity,
    source: unit.source,
    tapeCents: unit.tapeCents * quantity,
    totalCents: unit.totalCents * quantity,
  };
}

function addLineBreakdown(target: LineCostBreakdown, addition: LineCostBreakdown) {
  target.brandingLabelCents += addition.brandingLabelCents;
  target.fixedCents += addition.fixedCents;
  target.fixedOtherCents += addition.fixedOtherCents;
  target.laborCents += addition.laborCents;
  target.materialCents += addition.materialCents;
  target.shippingLabelCents += addition.shippingLabelCents;
  target.tapeCents += addition.tapeCents;
  target.totalCents += addition.totalCents;
}

function unitBreakdownFromProductionRun(run: ProductionRunRow | undefined | null, unitCostOverride?: number): UnitCostBreakdown | null {
  if (!run) return null;
  const quantityProduced = normalizeInventoryNumber(run.quantity_produced) || 1;
  const unitCost = unitCostOverride ?? normalizeInventoryNumber(run.actual_unit_cost_cents);
  if (unitCost <= 0) return null;

  const laborCents = normalizeInventoryNumber(run.actual_labor_cost_cents) / quantityProduced;
  const fixedCents = normalizeInventoryNumber(run.fixed_cost_cents) / quantityProduced;
  const tapeCents = normalizeInventoryNumber(run.fixed_tape_cost_cents) / quantityProduced;
  const shippingLabelCents = normalizeInventoryNumber(run.fixed_shipping_label_cost_cents) / quantityProduced;
  const brandingLabelCents = normalizeInventoryNumber(run.fixed_branding_label_cost_cents) / quantityProduced;
  const explicitOtherCents = normalizeInventoryNumber(run.fixed_other_cost_cents) / quantityProduced;
  const fixedOtherCents = explicitOtherCents || Math.max(0, fixedCents - tapeCents - shippingLabelCents - brandingLabelCents);
  const materialCents = Math.max(0, unitCost - laborCents - fixedCents);

  return {
    brandingLabelCents,
    fixedCents,
    fixedOtherCents,
    laborCents,
    materialCents,
    shippingLabelCents,
    source: 'estimated_latest_production',
    tapeCents,
    totalCents: unitCost,
  };
}

function isBoxComponent(component: RecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  return component.component_role === 'box' || Boolean(item?.sku?.startsWith('BOX-'));
}

function skuSegment(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

function finishedGoodSkuCandidates(product: ProductRow) {
  const sku = skuSegment(product.sku);
  const shortId = product.id.replace(/-/g, '').slice(0, 12);
  return [...new Set([
    `FIN-${sku || shortId}`,
    `FIN-${shortId}`,
    `FIN-${product.id}`,
  ])];
}

async function refetchFinishedItem(supabase: SupabaseLike, productId: string) {
  return supabase
    .from('inventory_items')
    .select('id,product_id,base_unit')
    .eq('item_type', 'finished_good')
    .eq('product_id', productId)
    .maybeSingle();
}

async function ensureFinishedItemsForProducts({
  existingByProductId,
  productIds,
  supabase,
}: {
  existingByProductId: Map<string, InventoryItemRow>;
  productIds: string[];
  supabase: SupabaseLike;
}) {
  const missingProductIds = productIds.filter((productId) => !existingByProductId.has(productId));
  if (!missingProductIds.length) return { error: null };

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id,name,sku')
    .in('id', missingProductIds);

  if (productsError) return { error: 'finished_item_product_error' as const };

  for (const product of (products ?? []) as ProductRow[]) {
    if (existingByProductId.has(product.id)) continue;

    const name = product.name?.trim() || product.sku?.trim() || 'Finished good';
    let createdItem: InventoryItemRow | null = null;

    for (const sku of finishedGoodSkuCandidates(product)) {
      const { data, error } = await supabase
        .from('inventory_items')
        .insert({
          active: true,
          base_unit: 'each',
          item_type: 'finished_good',
          name,
          product_id: product.id,
          sku,
        })
        .select('id,product_id,base_unit')
        .single();

      if (!error && data) {
        createdItem = data as InventoryItemRow;
        break;
      }

      const { data: existing } = await refetchFinishedItem(supabase, product.id);
      if (existing) {
        createdItem = existing as InventoryItemRow;
        break;
      }
    }

    if (!createdItem) return { error: 'finished_item_insert_error' as const };
    existingByProductId.set(product.id, createdItem);
  }

  if (missingProductIds.some((productId) => !existingByProductId.has(productId))) {
    return { error: 'finished_item_product_error' as const };
  }

  return { error: null };
}

function recipeUnitCostBreakdown(recipe: RecipeRow, avgCostByItemId: Map<string, number>): UnitCostBreakdown {
  const components = recipe.product_recipe_components ?? [];
  const outputQty = normalizeInventoryNumber(recipe.output_qty) || 1;
  let materialCostForRecipeOutput = 0;

  for (const component of components) {
    const item = relatedOne(component.inventory_items);
    if (!item?.base_unit) continue;
    try {
      const rawBaseQuantity = convertInventoryQuantity(
        normalizeInventoryNumber(component.quantity) * recipeComponentWasteMultiplier(component.component_role, recipe.waste_percent),
        component.unit,
        item.base_unit
      );
      const baseQuantity = isWholeCountPackagingComponentRole(component.component_role) && item.base_unit === 'each'
        ? roundWholeCountQuantity(rawBaseQuantity)
        : rawBaseQuantity;
      materialCostForRecipeOutput += baseQuantity * (avgCostByItemId.get(component.inventory_item_id) ?? 0);
    } catch {
      // Unit conversion gaps should not block shipment; they make this line an estimate.
    }
  }

  const boxQty = components.filter(isBoxComponent).reduce((sum, component) => sum + normalizeInventoryNumber(component.quantity), 0);
  const fixedBreakdown = fixedRecipeCostBreakdownCents({
    boxQty,
    shippingLabelQty: recipe.shipping_label_qty,
    brandingLabelQty: recipe.branding_label_qty,
  });
  const laborCostForRecipeOutput = laborCostCents(recipe.labor_minutes, recipe.labor_rate_cents);
  const materialCents = materialCostForRecipeOutput / outputQty;
  const laborCents = laborCostForRecipeOutput / outputQty;
  const tapeCents = fixedBreakdown.tapeCents / outputQty;
  const shippingLabelCents = fixedBreakdown.shippingLabelCents / outputQty;
  const brandingLabelCents = fixedBreakdown.brandingLabelCents / outputQty;
  const fixedOtherCents = 0;
  const fixedCents = tapeCents + shippingLabelCents + brandingLabelCents + fixedOtherCents;
  const totalCents = materialCents + laborCents + fixedCents;

  return {
    brandingLabelCents,
    fixedCents,
    fixedOtherCents,
    laborCents,
    materialCents,
    shippingLabelCents,
    source: totalCents > 0 ? 'estimated_recipe' : 'missing_cost',
    tapeCents,
    totalCents,
  };
}

function allocateShipping(items: OrderItemRow[], shippingCostCents: number) {
  const allocations = new Map<string, number>();
  const totalBoxes = items.reduce((sum, item) => sum + Math.max(0, normalizeInventoryNumber(item.shipping_boxes_used)), 0);
  const totalRevenue = items.reduce((sum, item) => sum + Math.max(0, lineRevenueCents(item)), 0);
  const useBoxes = totalBoxes > 0 && items.every((item) => normalizeInventoryNumber(item.shipping_boxes_used) > 0);
  const totalWeight = useBoxes ? totalBoxes : totalRevenue || items.length || 1;
  let allocated = 0;

  items.forEach((item, index) => {
    const weight = useBoxes
      ? Math.max(0, normalizeInventoryNumber(item.shipping_boxes_used))
      : totalRevenue > 0
        ? Math.max(0, lineRevenueCents(item))
        : 1;
    const amount = index === items.length - 1 ? Math.max(0, shippingCostCents - allocated) : (shippingCostCents * weight) / totalWeight;
    allocated += amount;
    allocations.set(item.id, amount);
  });

  return allocations;
}

function allocateByRevenue(items: OrderItemRow[], amountCents: number) {
  const allocations = new Map<string, number>();
  const safeAmount = Math.max(0, amountCents);
  const totalRevenue = items.reduce((sum, item) => sum + Math.max(0, lineRevenueCents(item)), 0);
  const totalWeight = totalRevenue || items.length || 1;
  let allocated = 0;

  items.forEach((item, index) => {
    const weight = totalRevenue > 0 ? Math.max(0, lineRevenueCents(item)) : 1;
    const amount = index === items.length - 1 ? Math.max(0, safeAmount - allocated) : (safeAmount * weight) / totalWeight;
    allocated += amount;
    allocations.set(item.id, amount);
  });

  return allocations;
}

async function insertShipmentMovement({
  inventoryItemId,
  lotId,
  orderId,
  orderItemId,
  quantity,
  notes,
  supabase,
  unitCostCents,
}: {
  inventoryItemId: string;
  lotId: string | null;
  notes?: string;
  orderId: string;
  orderItemId: string;
  quantity: number;
  supabase: SupabaseLike;
  unitCostCents: number;
}) {
  return supabase.from('inventory_movements').insert({
    inventory_item_id: inventoryItemId,
    lot_id: lotId,
    movement_type: 'shipment_consume',
    order_id: orderId,
    order_item_id: orderItemId,
    quantity_change: -Math.max(0, quantity),
    unit: 'each',
    unit_cost_cents: Math.max(0, unitCostCents),
    notes: notes ?? (lotId ? 'Finished goods shipped' : 'Finished goods shipped below available stock'),
  });
}

async function consumeShippingBoxUsages({
  orderId,
  orderItems,
  snapshotAt,
  supabase,
}: {
  orderId: string;
  orderItems: OrderItemRow[];
  snapshotAt: string;
  supabase: SupabaseLike;
}) {
  const { data: usages, error: usagesError } = await supabase
    .from('order_item_shipping_boxes')
    .select('id,order_item_id,inventory_item_id,quantity,unit_cost_cents,total_cost_cents,cogs_estimated,consumed_at')
    .eq('order_id', orderId);

  if (usagesError) return { error: 'shipping_box_usage_error' as const };

  const usageRows = (usages ?? []) as ShippingBoxUsageRow[];
  const costByOrderItemId = new Map<string, { costCents: number; estimated: boolean }>();
  if (!usageRows.length) return { costByOrderItemId, error: null };

  function addUsageCost(orderItemId: string, costCents: number, estimated: boolean) {
    const current = costByOrderItemId.get(orderItemId) ?? { costCents: 0, estimated: false };
    current.costCents += costCents;
    current.estimated = current.estimated || estimated;
    costByOrderItemId.set(orderItemId, current);
  }

  for (const usage of usageRows) {
    if (!usage.consumed_at) continue;
    addUsageCost(usage.order_item_id, normalizeInventoryNumber(usage.total_cost_cents), Boolean(usage.cogs_estimated));
  }

  const unconsumedRows = usageRows.filter((usage) => !usage.consumed_at);
  if (!unconsumedRows.length) return { costByOrderItemId, error: null };

  const rowsByBoxItemId = new Map<string, ShippingBoxUsageRow[]>();
  for (const usage of unconsumedRows) {
    if (!usage.inventory_item_id) continue;
    const rows = rowsByBoxItemId.get(usage.inventory_item_id) ?? [];
    rows.push(usage);
    rowsByBoxItemId.set(usage.inventory_item_id, rows);
  }

  const boxItemIds = [...rowsByBoxItemId.keys()];
  const [{ data: availableLots, error: availableLotsError }, { data: costLots, error: costLotsError }] = await Promise.all([
    boxItemIds.length
      ? supabase
          .from('inventory_lots')
          .select('id,inventory_item_id,quantity_remaining,unit_cost_cents,production_run_id,received_at,created_at')
          .in('inventory_item_id', boxItemIds)
          .gt('quantity_remaining', 0)
          .order('received_at', { ascending: true })
          .order('created_at', { ascending: true })
      : { data: [] as InventoryCostLotRow[] },
    boxItemIds.length
      ? supabase
          .from('inventory_lots')
          .select('id,inventory_item_id,quantity_remaining,unit_cost_cents,production_run_id,received_at,created_at')
          .in('inventory_item_id', boxItemIds)
          .order('received_at', { ascending: false })
          .order('created_at', { ascending: false })
      : { data: [] as InventoryCostLotRow[] },
  ]);

  if (availableLotsError || costLotsError) return { error: 'shipping_box_lot_error' as const };

  const lotsByItemId = new Map<string, InventoryCostLotRow[]>();
  for (const lot of (availableLots ?? []) as InventoryCostLotRow[]) {
    const lots = lotsByItemId.get(lot.inventory_item_id) ?? [];
    lots.push(lot);
    lotsByItemId.set(lot.inventory_item_id, lots);
  }

  const latestCostByItemId = new Map<string, number>();
  for (const lot of (costLots ?? []) as InventoryCostLotRow[]) {
    const unitCost = normalizeInventoryNumber(lot.unit_cost_cents);
    if (unitCost > 0 && !latestCostByItemId.has(lot.inventory_item_id)) {
      latestCostByItemId.set(lot.inventory_item_id, unitCost);
    }
  }

  function addOrderLevelUsageCost(costCents: number, estimated: boolean) {
    const allocations = allocateByRevenue(orderItems, costCents);
    for (const item of orderItems) {
      addUsageCost(item.id, allocations.get(item.id) ?? 0, estimated);
    }
  }

  for (const [inventoryItemId, rows] of rowsByBoxItemId.entries()) {
    const rawQuantity = rows.reduce((sum, usage) => sum + Math.max(0, normalizeInventoryNumber(usage.quantity)), 0);
    const quantity = roundWholeCountQuantity(rawQuantity);
    if (quantity <= 0) continue;

    const lotQueue = lotsByItemId.get(inventoryItemId) ?? [];
    let remaining = quantity;
    let totalCostCents = 0;
    let estimated = false;

    for (const lot of lotQueue) {
      if (remaining <= 0) break;
      const lotRemaining = normalizeInventoryNumber(lot.quantity_remaining);
      if (lotRemaining <= 0) continue;
      const take = Math.min(lotRemaining, remaining);
      const nextRemaining = lotRemaining - take;
      const { error: lotUpdateError } = await supabase
        .from('inventory_lots')
        .update({ quantity_remaining: nextRemaining })
        .eq('id', lot.id);

      if (lotUpdateError) return { error: 'shipping_box_lot_update_error' as const };

      lot.quantity_remaining = nextRemaining;
      const unitCost = normalizeInventoryNumber(lot.unit_cost_cents);
      totalCostCents += take * unitCost;

      const movementResult = await insertShipmentMovement({
        inventoryItemId,
        lotId: lot.id,
        notes: 'Shipping product box used',
        orderId,
        orderItemId: rows[0]?.order_item_id ?? orderItems[0]?.id ?? '',
        quantity: take,
        supabase,
        unitCostCents: unitCost,
      });
      if (movementResult.error) return { error: 'shipping_box_movement_error' as const };

      remaining -= take;
    }

    if (remaining > 0) {
      const fallbackUnitCost = latestCostByItemId.get(inventoryItemId) ?? 0;
      estimated = true;
      totalCostCents += remaining * fallbackUnitCost;
      const movementResult = await insertShipmentMovement({
        inventoryItemId,
        lotId: null,
        notes: 'Shipping product box used below available stock',
        orderId,
        orderItemId: rows[0]?.order_item_id ?? orderItems[0]?.id ?? '',
        quantity: remaining,
        supabase,
        unitCostCents: fallbackUnitCost,
      });
      if (movementResult.error) return { error: 'shipping_box_movement_error' as const };
    }

    let allocatedCostCents = 0;
    let allocatedQuantity = 0;
    for (const [index, usage] of rows.entries()) {
      const rowWeight = rawQuantity > 0 ? Math.max(0, normalizeInventoryNumber(usage.quantity)) / rawQuantity : 1 / rows.length;
      const rowQuantity = index === rows.length - 1 ? Math.max(0, quantity - allocatedQuantity) : quantity * rowWeight;
      const rowCostCents = index === rows.length - 1 ? Math.max(0, totalCostCents - allocatedCostCents) : totalCostCents * rowWeight;
      allocatedQuantity += rowQuantity;
      allocatedCostCents += rowCostCents;

      const updateResult = await supabase
        .from('order_item_shipping_boxes')
        .update({
          cogs_estimated: estimated,
          consumed_at: snapshotAt,
          quantity: rowQuantity,
          total_cost_cents: rowCostCents,
          unit_cost_cents: rowQuantity > 0 ? rowCostCents / rowQuantity : 0,
          updated_at: snapshotAt,
        })
        .eq('id', usage.id);

      if (updateResult.error) return { error: 'shipping_box_usage_update_error' as const };
    }

    addOrderLevelUsageCost(totalCostCents, estimated);
  }

  return { costByOrderItemId, error: null };
}

export async function snapshotOrderCogsForShipment({
  donationCogsCents = 0,
  orderId,
  processingFeeCents,
  shippingCostCents,
  supabase,
}: {
  donationCogsCents?: number;
  orderId: string;
  processingFeeCents?: number;
  shippingCostCents: number;
  supabase: SupabaseLike;
}) {
  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents,shipping_boxes_used,cogs_snapshot_at')
    .eq('order_id', orderId);

  if (itemsError) return { error: 'items_error' as const };

  const orderItems = ((items ?? []) as OrderItemRow[]).filter((item) => normalizeInventoryNumber(item.qty) > 0);
  if (!orderItems.length || orderItems.every((item) => item.cogs_snapshot_at)) {
    return { error: null };
  }

  const productIds = [...new Set(orderItems.map((item) => item.product_id).filter(Boolean) as string[])];
  const [{ data: finishedItems }, { data: productionRuns }, { data: recipes }] = await Promise.all([
    productIds.length
      ? supabase.from('inventory_items').select('id,product_id,base_unit').eq('item_type', 'finished_good').in('product_id', productIds)
      : { data: [] },
    productIds.length
      ? supabase
          .from('production_runs')
          .select('id,product_id,quantity_produced,quantity_voided,status,actual_unit_cost_cents,actual_labor_cost_cents,fixed_cost_cents,fixed_tape_cost_cents,fixed_shipping_label_cost_cents,fixed_branding_label_cost_cents,fixed_other_cost_cents,produced_at')
          .in('product_id', productIds)
          .order('produced_at', { ascending: false })
      : { data: [] },
    productIds.length
      ? supabase
          .from('product_recipes')
          .select('product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,shipping_label_qty,branding_label_qty,product_recipe_components(inventory_item_id,quantity,unit,component_role,inventory_items(id,base_unit,sku))')
          .in('product_id', productIds)
      : { data: [] },
  ]);

  const finishedItemByProductId = new Map(
    ((finishedItems ?? []) as InventoryItemRow[])
      .filter((item) => item.product_id)
      .map((item) => [item.product_id as string, item])
  );
  const ensureFinishedItemsResult = await ensureFinishedItemsForProducts({
    existingByProductId: finishedItemByProductId,
    productIds,
    supabase,
  });
  if (ensureFinishedItemsResult.error) return { error: ensureFinishedItemsResult.error };

  const finishedItemIds = [...finishedItemByProductId.values()].map((item) => item.id);
  const { data: finishedLots } = finishedItemIds.length
    ? await supabase
        .from('inventory_lots')
        .select('id,inventory_item_id,quantity_remaining,unit_cost_cents,production_run_id,received_at,created_at')
        .in('inventory_item_id', finishedItemIds)
        .gt('quantity_remaining', 0)
        .order('received_at', { ascending: true })
        .order('created_at', { ascending: true })
    : { data: [] as InventoryLotRow[] };

  const productionRunRows = (productionRuns ?? []) as ProductionRunRow[];
  const productionRunById = new Map(productionRunRows.map((run) => [run.id, run]));
  const latestRunByProductId = new Map<string, ProductionRunRow>();
  for (const run of productionRunRows) {
    if (!latestRunByProductId.has(run.product_id) && activeProductionQuantity(run) > 0 && normalizeInventoryNumber(run.actual_unit_cost_cents) > 0) {
      latestRunByProductId.set(run.product_id, run);
    }
  }

  const recipeRows = (recipes ?? []) as RecipeRow[];
  const componentItemIds = [
    ...new Set(recipeRows.flatMap((recipe) => (recipe.product_recipe_components ?? []).map((component) => component.inventory_item_id))),
  ];
  const { data: componentLots } = componentItemIds.length
    ? await supabase
        .from('inventory_lots')
        .select('inventory_item_id,quantity_remaining,unit_cost_cents')
        .in('inventory_item_id', componentItemIds)
        .gt('quantity_remaining', 0)
    : { data: [] as Array<{ inventory_item_id: string; quantity_remaining: number | string; unit_cost_cents: number | string }> };

  const avgCostByItemId = new Map<string, number>();
  for (const itemId of componentItemIds) {
    const lots = (componentLots ?? []).filter((lot: any) => lot.inventory_item_id === itemId);
    const remaining = lots.reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    const value = lots.reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining) * normalizeInventoryNumber(lot.unit_cost_cents), 0);
    avgCostByItemId.set(itemId, remaining > 0 ? value / remaining : 0);
  }

  const recipeEstimateByProductId = new Map<string, UnitCostBreakdown>();
  for (const recipe of recipeRows) {
    recipeEstimateByProductId.set(recipe.product_id, recipeUnitCostBreakdown(recipe, avgCostByItemId));
  }

  const lotQueuesByItemId = new Map<string, InventoryLotRow[]>();
  for (const lot of (finishedLots ?? []) as InventoryLotRow[]) {
    const existing = lotQueuesByItemId.get(lot.inventory_item_id) ?? [];
    existing.push(lot);
    lotQueuesByItemId.set(lot.inventory_item_id, existing);
  }

  const orderRevenueCents = orderItems.reduce((sum, item) => sum + Math.max(0, lineRevenueCents(item)), 0);
  const safeProcessingFeeCents = Math.max(0, processingFeeCents ?? processingFeeCentsForRevenue(orderRevenueCents));
  const safeDonationCogsCents = Math.max(0, donationCogsCents);
  const shippingAllocationByItemId = allocateShipping(orderItems, Math.max(0, shippingCostCents));
  const processingFeeAllocationByItemId = allocateByRevenue(orderItems, safeProcessingFeeCents);
  const donationAllocationByItemId = allocateByRevenue(orderItems, safeDonationCogsCents);
  const snapshotAt = new Date().toISOString();
  const shippingBoxUsageResult = await consumeShippingBoxUsages({ orderId, orderItems, snapshotAt, supabase });
  if (shippingBoxUsageResult.error) return { error: shippingBoxUsageResult.error };
  const shippingBoxCostByOrderItemId = shippingBoxUsageResult.costByOrderItemId;

  for (const item of orderItems) {
    if (item.cogs_snapshot_at) continue;

    const qty = Math.max(0, normalizeInventoryNumber(item.qty));
    const productId = item.product_id;
    const finishedItem = productId ? finishedItemByProductId.get(productId) : undefined;
    const lineBreakdown = emptyLineBreakdown();
    let actualQty = 0;
    let estimatedQty = 0;
    let fallbackSource: CogsSource = 'missing_cost';

    if (finishedItem) {
      const lotQueue = lotQueuesByItemId.get(finishedItem.id) ?? [];
      let remainingQty = qty;

      for (const lot of lotQueue) {
        if (remainingQty <= 0) break;
        const lotRemaining = normalizeInventoryNumber(lot.quantity_remaining);
        if (lotRemaining <= 0) continue;
        const take = Math.min(lotRemaining, remainingQty);
        const nextRemaining = lotRemaining - take;
        const { error: lotUpdateError } = await supabase
          .from('inventory_lots')
          .update({ quantity_remaining: nextRemaining })
          .eq('id', lot.id);

        if (lotUpdateError) return { error: 'lot_update_error' as const };

        lot.quantity_remaining = nextRemaining;
        const unitCost = normalizeInventoryNumber(lot.unit_cost_cents);
        const runBreakdown = unitBreakdownFromProductionRun(productionRunById.get(lot.production_run_id ?? ''), unitCost) ?? {
          brandingLabelCents: 0,
          fixedCents: 0,
          fixedOtherCents: 0,
          laborCents: 0,
          materialCents: unitCost,
          shippingLabelCents: 0,
          source: 'actual_fifo' as CogsSource,
          tapeCents: 0,
          totalCents: unitCost,
        };
        runBreakdown.source = 'actual_fifo';
        addLineBreakdown(lineBreakdown, multiplyUnitBreakdown(runBreakdown, take));

        const movementResult = await insertShipmentMovement({
          inventoryItemId: finishedItem.id,
          lotId: lot.id,
          orderId,
          orderItemId: item.id,
          quantity: take,
          supabase,
          unitCostCents: unitCost,
        });
        if (movementResult.error) return { error: 'movement_error' as const };

        actualQty += take;
        remainingQty -= take;
      }

      if (remainingQty > 0) {
        const latestRunBreakdown = productId ? unitBreakdownFromProductionRun(latestRunByProductId.get(productId)) : null;
        const fallback = latestRunBreakdown ?? (productId ? recipeEstimateByProductId.get(productId) : null);
        fallbackSource = fallback?.source ?? 'missing_cost';
        addLineBreakdown(lineBreakdown, multiplyUnitBreakdown(fallback ?? {
          brandingLabelCents: 0,
          fixedCents: 0,
          fixedOtherCents: 0,
          laborCents: 0,
          materialCents: 0,
          shippingLabelCents: 0,
          source: 'missing_cost',
          tapeCents: 0,
          totalCents: 0,
        }, remainingQty));

        const movementResult = await insertShipmentMovement({
          inventoryItemId: finishedItem.id,
          lotId: null,
          orderId,
          orderItemId: item.id,
          quantity: remainingQty,
          supabase,
          unitCostCents: fallback?.totalCents ?? 0,
        });
        if (movementResult.error) return { error: 'movement_error' as const };

        estimatedQty += remainingQty;
      }
    } else if (productId) {
      const latestRunBreakdown = unitBreakdownFromProductionRun(latestRunByProductId.get(productId));
      const fallback = latestRunBreakdown ?? recipeEstimateByProductId.get(productId);
      fallbackSource = fallback?.source ?? 'missing_cost';
      addLineBreakdown(lineBreakdown, multiplyUnitBreakdown(fallback ?? {
        brandingLabelCents: 0,
        fixedCents: 0,
        fixedOtherCents: 0,
        laborCents: 0,
        materialCents: 0,
        shippingLabelCents: 0,
        source: 'missing_cost',
        tapeCents: 0,
        totalCents: 0,
      }, qty));
      estimatedQty = qty;
    }

    const cogsSource: CogsSource = estimatedQty > 0 && actualQty > 0
      ? 'partial_estimate'
      : estimatedQty > 0
        ? fallbackSource
        : actualQty > 0
          ? 'actual_fifo'
          : 'missing_cost';
    const shippingCents = shippingAllocationByItemId.get(item.id) ?? 0;
    const processingFeeCentsForLine = processingFeeAllocationByItemId.get(item.id) ?? 0;
    const donationCents = donationAllocationByItemId.get(item.id) ?? 0;
    const shippingBoxCost = shippingBoxCostByOrderItemId.get(item.id);
    if (shippingBoxCost?.costCents) {
      lineBreakdown.fixedCents += shippingBoxCost.costCents;
      lineBreakdown.fixedOtherCents += shippingBoxCost.costCents;
      lineBreakdown.totalCents += shippingBoxCost.costCents;
    }
    const finalCogsSource: CogsSource = shippingBoxCost?.estimated && cogsSource === 'actual_fifo' ? 'partial_estimate' : cogsSource;
    const productCogsCents = lineBreakdown.materialCents + lineBreakdown.laborCents + lineBreakdown.fixedCents;
    const totalCogsCents = productCogsCents + shippingCents + processingFeeCentsForLine + donationCents;
    const updateResult = await supabase
      .from('order_items')
      .update({
        cogs_branding_label_cents: lineBreakdown.brandingLabelCents,
        cogs_donation_cents: donationCents,
        cogs_estimated: finalCogsSource !== 'actual_fifo' || Boolean(shippingBoxCost?.estimated),
        cogs_fixed_cents: lineBreakdown.fixedCents,
        cogs_fixed_other_cents: lineBreakdown.fixedOtherCents,
        cogs_labor_cents: lineBreakdown.laborCents,
        cogs_material_cents: lineBreakdown.materialCents,
        cogs_processing_fee_cents: processingFeeCentsForLine,
        cogs_product_cents: productCogsCents,
        cogs_shipping_cents: shippingCents,
        cogs_shipping_label_cents: lineBreakdown.shippingLabelCents,
        cogs_snapshot_at: snapshotAt,
        cogs_source: finalCogsSource,
        cogs_tape_cents: lineBreakdown.tapeCents,
        cogs_total_cents: totalCogsCents,
        cogs_unit_cents: qty > 0 ? productCogsCents / qty : 0,
      })
      .eq('id', item.id)
      .is('cogs_snapshot_at', null)
      .select('id');

    if (updateResult.error) return { error: 'item_update_error' as const };
  }

  return { error: null };
}

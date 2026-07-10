import {
  convertInventoryQuantity,
  isWholeCountPackagingComponentRole,
  laborCostCents,
  recipeComponentWasteMultiplier,
  roundWholeCountQuantity,
} from '@/lib/inventory';
import type {
  ProfitabilityOrderItemRow,
  ProfitabilityOrderRow,
  ProfitabilityTotals,
} from '@/lib/profitability-reporting';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

type CenterRow = {
  id: string;
  name?: string | null;
};

type ProductRow = {
  id: string;
  name?: string | null;
  sku?: string | null;
};

type InventoryItemRow = {
  active?: boolean | null;
  id: string;
  name: string;
  sku?: string | null;
  item_type: string;
  base_unit: string;
};

type InventoryLotRow = {
  inventory_item_id: string;
  quantity_remaining?: number | string | null;
  unit_cost_cents?: number | string | null;
  received_at?: string | null;
  created_at?: string | null;
};

type RecipeComponentRow = {
  inventory_item_id: string;
  quantity: number | string;
  unit: string;
  component_role?: string | null;
  inventory_items?: InventoryItemRow | InventoryItemRow[] | null;
};

type RecipeRow = {
  product_id: string;
  output_qty: number | string;
  labor_minutes?: number | string | null;
  labor_rate_cents?: number | string | null;
  waste_percent?: number | string | null;
  product_recipe_components?: RecipeComponentRow[] | null;
};

type ShippingBoxUsageRow = {
  inventory_item_id: string;
  inventory_items?: InventoryItemRow | InventoryItemRow[] | null;
  order_item_id: string;
  quantity?: number | string | null;
  total_cost_cents?: number | string | null;
  unit_cost_cents?: number | string | null;
};

export type GrossProfitSimulatorInputRow = {
  actualUnitCostCents: number;
  baseUnit: string;
  baselineCostCents: number;
  grossProfitImpactCents: number;
  id: string;
  itemType: string;
  lineCount: number;
  name: string;
  productCount: number;
  quantityUsed: number;
  simulatedCostCents: number;
  simulatedUnitCostCents: number;
  sku: string | null;
};

export type GrossProfitSimulatorProductRow = {
  actualGrossProfitCents: number;
  baselineLaborCents: number;
  baselineMaterialCents: number;
  coffeePoundsSold: number;
  grossProfitImpactCents: number;
  id: string;
  name: string;
  revenueCents: number;
  simulatedGrossProfitCents: number;
  simulatedLaborCents: number;
  simulatedMaterialCents: number;
  simulatedRevenueCents: number;
  unitsSold: number;
  unweightedLineCount: number;
  unresolvedLineCount: number;
};

export type GrossProfitSimulatorLaborRow = {
  baselineLaborCents: number;
  baselineLaborMinutes: number;
  baselineLaborRateCents: number;
  grossProfitImpactCents: number;
  hasRecipe: boolean;
  id: string;
  lineCount: number;
  name: string;
  revenueCents: number;
  simulatedLaborCents: number;
  simulatedLaborMinutes: number;
  simulatedLaborRateCents: number;
  unitsSold: number;
  unresolvedLineCount: number;
};

export type GrossProfitSimulatorDashboard = {
  actualGrossProfitCents: number;
  actualLaborCents: number;
  actualMarginPercent: number;
  actualMaterialCents: number;
  actualMaterialSupplyCents: number;
  actualPricePerPoundCents: number;
  actualTotalCogsCents: number;
  appliedOverrideCount: number;
  baselineRecipeLaborCents: number;
  baselineRecipeMaterialCents: number;
  coffeePoundsSold: number;
  grossProfitChangeCents: number;
  inputRows: GrossProfitSimulatorInputRow[];
  laborImpactCents: number;
  laborRows: GrossProfitSimulatorLaborRow[];
  laborScenarioCents: number;
  materialSupplyImpactCents: number;
  materialSupplyScenarioCents: number;
  orderCount: number;
  productRows: GrossProfitSimulatorProductRow[];
  rawCoffeeImpactCents: number;
  rawCoffeeScenarioCents: number;
  revenueImpactCents: number;
  revenueCents: number;
  simulatedGrossProfitCents: number;
  simulatedLaborCents: number;
  simulatedMarginPercent: number;
  simulatedMaterialCents: number;
  simulatedMaterialSupplyCents: number;
  simulatedRevenueCents: number;
  simulatedTotalCogsCents: number;
  unweightedLineCount: number;
  unresolvedLineCount: number;
  weightedRevenueCents: number;
};

export type GrossProfitSimulatorParams = {
  centerId?: string;
  itemUnitCostOverridesCents: Map<string, number>;
  laborMinutesOverrides: Map<string, number>;
  laborPercentDelta: number;
  laborRateOverridesCents: Map<string, number>;
  materialSupplyPercentDelta: number;
  productId?: string;
  rangeEndExclusive: Date;
  rangeStart: Date;
  rawCoffeePercentDelta: number;
  scenarioPricePerPoundCents?: number;
};

type NormalizedLine = {
  actualGrossProfitCents: number;
  actualLaborCents: number;
  actualMaterialCents: number;
  actualTotalCogsCents: number;
  centerId: string | null;
  date: Date;
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  qty: number;
  revenueCents: number;
};

type ComponentCost = {
  actualCostCents: number;
  baselineCostCents: number;
  inventoryItem: InventoryItemRow;
  productId: string;
  quantity: number;
  scenarioActualCostCents: number;
  scenarioCostCents: number;
};

type LaborCost = {
  actualCostCents: number;
  baselineCostCents: number;
  baselineMinutes: number;
  baselineRateCents: number;
  hasRecipe: boolean;
  scenarioActualCostCents: number;
  scenarioCostCents: number;
  scenarioMinutes: number;
  scenarioRateCents: number;
};

function numericValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function productName(product: ProductRow | undefined, snapshot?: string | null) {
  return product?.name?.trim() || snapshot?.trim() || product?.sku?.trim() || 'Unknown product';
}

function lineRevenue(item: ProfitabilityOrderItemRow) {
  const explicit = numericValue(item.line_total_cents);
  if (explicit > 0) return explicit;
  return numericValue(item.qty) * numericValue(item.unit_price_cents);
}

function actualLineCogs(item: ProfitabilityOrderItemRow) {
  const snapshottedTotal = numericValue(item.cogs_total_cents);
  if (snapshottedTotal > 0) return snapshottedTotal;
  return (
    numericValue(item.cogs_product_cents) +
    numericValue(item.cogs_shipping_cents) +
    numericValue(item.cogs_processing_fee_cents) +
    numericValue(item.cogs_donation_cents)
  );
}

function itemTypeForSimulation(itemType: string) {
  if (itemType === 'supply') return 'material_supply';
  return itemType;
}

function itemIsSimulatedInput(item: InventoryItemRow) {
  const itemType = itemTypeForSimulation(item.item_type);
  return itemType === 'raw_coffee' || itemType === 'material_supply';
}

function buildAverageCostByItemId(lots: InventoryLotRow[]) {
  const lotsByItemId = new Map<string, InventoryLotRow[]>();
  for (const lot of lots) {
    const rows = lotsByItemId.get(lot.inventory_item_id) ?? [];
    rows.push(lot);
    lotsByItemId.set(lot.inventory_item_id, rows);
  }

  const avgCostByItemId = new Map<string, number>();
  for (const [itemId, itemLots] of lotsByItemId.entries()) {
    const remainingLots = itemLots.filter((lot) => numericValue(lot.quantity_remaining) > 0 && numericValue(lot.unit_cost_cents) > 0);
    const remaining = remainingLots.reduce((sum, lot) => sum + numericValue(lot.quantity_remaining), 0);
    const value = remainingLots.reduce((sum, lot) => sum + numericValue(lot.quantity_remaining) * numericValue(lot.unit_cost_cents), 0);
    if (remaining > 0) {
      avgCostByItemId.set(itemId, value / remaining);
      continue;
    }
    const latestPositiveCost = [...itemLots]
      .sort((a, b) => {
        const bDate = validDate(b.received_at) ?? validDate(b.created_at) ?? new Date(0);
        const aDate = validDate(a.received_at) ?? validDate(a.created_at) ?? new Date(0);
        return bDate.getTime() - aDate.getTime();
      })
      .find((lot) => numericValue(lot.unit_cost_cents) > 0);
    avgCostByItemId.set(itemId, latestPositiveCost ? numericValue(latestPositiveCost.unit_cost_cents) : 0);
  }

  return avgCostByItemId;
}

function simulatedUnitCostCents({
  avgCostByItemId,
  inventoryItem,
  itemUnitCostOverridesCents,
  materialSupplyPercentDelta,
  rawCoffeePercentDelta,
}: {
  avgCostByItemId: Map<string, number>;
  inventoryItem: InventoryItemRow;
  itemUnitCostOverridesCents: Map<string, number>;
  materialSupplyPercentDelta: number;
  rawCoffeePercentDelta: number;
}) {
  const override = itemUnitCostOverridesCents.get(inventoryItem.id);
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;

  const baseline = avgCostByItemId.get(inventoryItem.id) ?? 0;
  const itemType = itemTypeForSimulation(inventoryItem.item_type);
  if (itemType === 'raw_coffee') return baseline * (1 + rawCoffeePercentDelta / 100);
  if (itemType === 'material_supply') return baseline * (1 + materialSupplyPercentDelta / 100);
  return baseline;
}

function validNonNegativeOverride(overrides: Map<string, number>, key: string) {
  const override = overrides.get(key);
  return typeof override === 'number' && Number.isFinite(override) && override >= 0 ? override : undefined;
}

function materialSupplyPercentMultiplier(params: GrossProfitSimulatorParams) {
  return Math.max(0, 1 + params.materialSupplyPercentDelta / 100);
}

function laborCostForLine({
  line,
  params,
  recipe,
}: {
  line: NormalizedLine;
  params: GrossProfitSimulatorParams;
  recipe: RecipeRow | undefined;
}): LaborCost {
  const actualCostCents = Math.max(0, line.actualLaborCents);

  if (!recipe) {
    return {
      actualCostCents,
      baselineCostCents: 0,
      baselineMinutes: 0,
      baselineRateCents: 0,
      hasRecipe: false,
      scenarioActualCostCents: actualCostCents,
      scenarioCostCents: 0,
      scenarioMinutes: 0,
      scenarioRateCents: 0,
    };
  }

  const outputQty = numericValue(recipe.output_qty) || 1;
  const productKey = line.productId ?? line.productName;
  const baselineMinutes = Math.max(0, numericValue(recipe.labor_minutes));
  const baselineRateCents = Math.max(0, numericValue(recipe.labor_rate_cents));
  const laborPercentMultiplier = Math.max(0, 1 + params.laborPercentDelta / 100);
  const scenarioMinutes = validNonNegativeOverride(params.laborMinutesOverrides, productKey) ?? baselineMinutes * laborPercentMultiplier;
  const scenarioRateCents = validNonNegativeOverride(params.laborRateOverridesCents, productKey) ?? baselineRateCents;
  const baselineCostCents = (laborCostCents(baselineMinutes, baselineRateCents) / outputQty) * line.qty;
  const scenarioCostCents = (laborCostCents(scenarioMinutes, scenarioRateCents) / outputQty) * line.qty;
  const scenarioActualCostCents = baselineCostCents > 0
    ? actualCostCents * Math.max(0, scenarioCostCents / baselineCostCents)
    : scenarioCostCents > 0
      ? scenarioCostCents
      : actualCostCents;

  return {
    actualCostCents,
    baselineCostCents,
    baselineMinutes,
    baselineRateCents,
    hasRecipe: true,
    scenarioActualCostCents,
    scenarioCostCents,
    scenarioMinutes,
    scenarioRateCents,
  };
}

function rawCoffeePoundsPerUnit(recipe: RecipeRow | undefined) {
  if (!recipe) return 0;
  const outputQty = numericValue(recipe.output_qty) || 1;
  let recipeRawCoffeePounds = 0;

  for (const component of recipe.product_recipe_components ?? []) {
    const inventoryItem = relatedOne(component.inventory_items);
    const itemType = inventoryItem ? itemTypeForSimulation(inventoryItem.item_type) : '';
    const isRawCoffee = component.component_role === 'raw_coffee' || itemType === 'raw_coffee';
    if (!isRawCoffee) continue;

    try {
      recipeRawCoffeePounds += convertInventoryQuantity(numericValue(component.quantity), component.unit, 'lb');
    } catch {
      // Pounds sold is informational, so unit conversion gaps leave only this component unweighted.
    }
  }

  return outputQty > 0 ? recipeRawCoffeePounds / outputQty : 0;
}

function normalizeLines({
  orderItems,
  orders,
  products,
}: {
  orderItems: ProfitabilityOrderItemRow[];
  orders: ProfitabilityOrderRow[];
  products: ProductRow[];
}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const itemsByOrderId = new Map<string, ProfitabilityOrderItemRow[]>();
  for (const item of orderItems) {
    const rows = itemsByOrderId.get(item.order_id) ?? [];
    rows.push(item);
    itemsByOrderId.set(item.order_id, rows);
  }

  const lines: NormalizedLine[] = [];
  for (const order of orders) {
    if (order.status !== 'Shipped') continue;
    const orderDate = validDate(order.shipped_at) ?? validDate(order.created_at);
    if (!orderDate) continue;

    for (const item of itemsByOrderId.get(order.id) ?? []) {
      const qty = numericValue(item.qty);
      if (qty <= 0) continue;
      const revenueCents = lineRevenue(item);
      const totalCogsCents = actualLineCogs(item);
      const product = item.product_id ? productById.get(item.product_id) : undefined;
      lines.push({
        actualGrossProfitCents: revenueCents - totalCogsCents,
        actualLaborCents: numericValue(item.cogs_labor_cents),
        actualMaterialCents: numericValue(item.cogs_material_cents),
        actualTotalCogsCents: totalCogsCents,
        centerId: order.center_id,
        date: orderDate,
        id: item.id,
        orderId: order.id,
        productId: item.product_id,
        productName: productName(product, item.product_name_snapshot),
        qty,
        revenueCents,
      });
    }
  }

  return lines;
}

function recipeComponentCostsForLine({
  avgCostByItemId,
  itemUnitCostOverridesCents,
  line,
  materialSupplyPercentDelta,
  rawCoffeePercentDelta,
  recipe,
}: {
  avgCostByItemId: Map<string, number>;
  itemUnitCostOverridesCents: Map<string, number>;
  line: NormalizedLine;
  materialSupplyPercentDelta: number;
  rawCoffeePercentDelta: number;
  recipe: RecipeRow | undefined;
}): ComponentCost[] {
  if (!recipe) return [];
  const outputQty = numericValue(recipe.output_qty) || 1;
  const costs: ComponentCost[] = [];

  for (const component of recipe.product_recipe_components ?? []) {
    const inventoryItem = relatedOne(component.inventory_items);
    if (!inventoryItem?.base_unit) continue;

    try {
      const rawRecipeOutputQuantity = convertInventoryQuantity(
        numericValue(component.quantity) * recipeComponentWasteMultiplier(component.component_role, recipe.waste_percent),
        component.unit,
        inventoryItem.base_unit
      );
      const recipeOutputQuantity = isWholeCountPackagingComponentRole(component.component_role) && inventoryItem.base_unit === 'each'
        ? roundWholeCountQuantity(rawRecipeOutputQuantity)
        : rawRecipeOutputQuantity;
      const quantityForLine = (recipeOutputQuantity / outputQty) * line.qty;
      const baselineUnitCost = avgCostByItemId.get(component.inventory_item_id) ?? 0;
      const scenarioUnitCost = simulatedUnitCostCents({
        avgCostByItemId,
        inventoryItem,
        itemUnitCostOverridesCents,
        materialSupplyPercentDelta,
        rawCoffeePercentDelta,
      });

      costs.push({
        actualCostCents: 0,
        baselineCostCents: quantityForLine * baselineUnitCost,
        inventoryItem,
        productId: line.productId ?? line.productName,
        quantity: quantityForLine,
        scenarioActualCostCents: 0,
        scenarioCostCents: quantityForLine * scenarioUnitCost,
      });
    } catch {
      // Unit conversion gaps leave that component out of the scenario instead of breaking reports.
    }
  }

  return costs;
}

function allocateActualMaterialCosts(componentCosts: ComponentCost[], actualMaterialCents: number) {
  const baselineMaterialCents = componentCosts.reduce((sum, cost) => sum + Math.max(0, cost.baselineCostCents), 0);
  const actualCostCents = Math.max(0, actualMaterialCents);

  return componentCosts.map((cost) => {
    if (baselineMaterialCents <= 0) {
      return {
        ...cost,
        actualCostCents: 0,
        scenarioActualCostCents: Math.max(0, cost.scenarioCostCents),
      };
    }

    return {
      ...cost,
      actualCostCents: actualCostCents * (Math.max(0, cost.baselineCostCents) / baselineMaterialCents),
      scenarioActualCostCents: actualCostCents * (Math.max(0, cost.scenarioCostCents) / baselineMaterialCents),
    };
  });
}

function shippingBoxCostsForLine({
  avgCostByItemId,
  inventoryItemById,
  line,
  params,
  usages,
}: {
  avgCostByItemId: Map<string, number>;
  inventoryItemById: Map<string, InventoryItemRow>;
  line: NormalizedLine;
  params: GrossProfitSimulatorParams;
  usages: ShippingBoxUsageRow[];
}): ComponentCost[] {
  const costs: ComponentCost[] = [];

  for (const usage of usages) {
    const inventoryItem = relatedOne(usage.inventory_items) ?? inventoryItemById.get(usage.inventory_item_id);
    if (!inventoryItem?.base_unit || !itemIsSimulatedInput(inventoryItem)) continue;

    const quantity = Math.max(0, numericValue(usage.quantity));
    const actualCostCents =
      Math.max(0, numericValue(usage.total_cost_cents)) ||
      quantity * Math.max(0, numericValue(usage.unit_cost_cents)) ||
      quantity * (avgCostByItemId.get(usage.inventory_item_id) ?? 0);
    const unitOverrideCents = validNonNegativeOverride(params.itemUnitCostOverridesCents, usage.inventory_item_id);
    const scenarioActualCostCents = typeof unitOverrideCents === 'number'
      ? quantity * unitOverrideCents
      : actualCostCents * materialSupplyPercentMultiplier(params);

    costs.push({
      actualCostCents,
      baselineCostCents: actualCostCents,
      inventoryItem,
      productId: line.productId ?? line.productName,
      quantity,
      scenarioActualCostCents,
      scenarioCostCents: scenarioActualCostCents,
    });
  }

  return costs;
}

function simulatorInputRowForItem({
  avgCostByItemId,
  item,
  params,
}: {
  avgCostByItemId: Map<string, number>;
  item: InventoryItemRow;
  params: GrossProfitSimulatorParams;
}): GrossProfitSimulatorInputRow & { productIds: Set<string> } {
  return {
    actualUnitCostCents: avgCostByItemId.get(item.id) ?? 0,
    baseUnit: item.base_unit,
    baselineCostCents: 0,
    grossProfitImpactCents: 0,
    id: item.id,
    itemType: itemTypeForSimulation(item.item_type),
    lineCount: 0,
    name: item.name,
    productCount: 0,
    productIds: new Set<string>(),
    quantityUsed: 0,
    simulatedCostCents: 0,
    simulatedUnitCostCents: simulatedUnitCostCents({
      avgCostByItemId,
      inventoryItem: item,
      itemUnitCostOverridesCents: params.itemUnitCostOverridesCents,
      materialSupplyPercentDelta: params.materialSupplyPercentDelta,
      rawCoffeePercentDelta: params.rawCoffeePercentDelta,
    }),
    sku: item.sku ?? null,
  };
}

function emptyDashboard(actual: ProfitabilityTotals): GrossProfitSimulatorDashboard {
  return {
    actualGrossProfitCents: actual.grossProfitCents,
    actualLaborCents: actual.laborCents,
    actualMarginPercent: actual.marginPercent,
    actualMaterialCents: actual.materialCents,
    actualMaterialSupplyCents: actual.materialCents,
    actualPricePerPoundCents: 0,
    actualTotalCogsCents: actual.totalCogsCents,
    appliedOverrideCount: 0,
    baselineRecipeLaborCents: 0,
    baselineRecipeMaterialCents: 0,
    coffeePoundsSold: 0,
    grossProfitChangeCents: 0,
    inputRows: [],
    laborImpactCents: 0,
    laborRows: [],
    laborScenarioCents: 0,
    materialSupplyImpactCents: 0,
    materialSupplyScenarioCents: 0,
    orderCount: actual.orderCount,
    productRows: [],
    rawCoffeeImpactCents: 0,
    rawCoffeeScenarioCents: 0,
    revenueImpactCents: 0,
    revenueCents: actual.revenueCents,
    simulatedGrossProfitCents: actual.grossProfitCents,
    simulatedLaborCents: actual.laborCents,
    simulatedMarginPercent: actual.marginPercent,
    simulatedMaterialCents: actual.materialCents,
    simulatedMaterialSupplyCents: actual.materialCents,
    simulatedRevenueCents: actual.revenueCents,
    simulatedTotalCogsCents: actual.totalCogsCents,
    unweightedLineCount: 0,
    unresolvedLineCount: 0,
    weightedRevenueCents: 0,
  };
}

export function buildGrossProfitSimulator({
  actual,
  centers,
  inventoryItems,
  inventoryLots,
  orderItems,
  orders,
  params,
  products,
  recipes,
  shippingBoxUsages = [],
}: {
  actual: ProfitabilityTotals;
  centers: CenterRow[];
  inventoryItems: InventoryItemRow[];
  inventoryLots: InventoryLotRow[];
  orderItems: ProfitabilityOrderItemRow[];
  orders: ProfitabilityOrderRow[];
  params: GrossProfitSimulatorParams;
  products: ProductRow[];
  recipes: RecipeRow[];
  shippingBoxUsages?: ShippingBoxUsageRow[];
}): GrossProfitSimulatorDashboard {
  if (!orders.length || !orderItems.length) return emptyDashboard(actual);

  const centerIds = new Set(centers.map((center) => center.id));
  const avgCostByItemId = buildAverageCostByItemId(inventoryLots);
  const recipeByProductId = new Map(recipes.map((recipe) => [recipe.product_id, recipe]));
  const inventoryItemById = new Map(inventoryItems.map((item) => [item.id, item]));
  const shippingBoxUsagesByOrderItemId = new Map<string, ShippingBoxUsageRow[]>();
  for (const usage of shippingBoxUsages) {
    const rows = shippingBoxUsagesByOrderItemId.get(usage.order_item_id) ?? [];
    rows.push(usage);
    shippingBoxUsagesByOrderItemId.set(usage.order_item_id, rows);
  }
  const lines = normalizeLines({ orderItems, orders, products }).filter((line) => {
    if (line.date < params.rangeStart || line.date >= params.rangeEndExclusive) return false;
    if (params.productId && line.productId !== params.productId) return false;
    if (params.centerId && line.centerId !== params.centerId) return false;
    if (params.centerId && !centerIds.has(params.centerId)) return false;
    return true;
  });
  if (!lines.length) return emptyDashboard(actual);

  const inputRowsById = new Map<string, GrossProfitSimulatorInputRow & { productIds: Set<string> }>();
  const productRowsById = new Map<string, GrossProfitSimulatorProductRow & { orderItemIds: Set<string> }>();
  const laborRowsById = new Map<string, GrossProfitSimulatorLaborRow>();
  let baselineRecipeLaborCents = 0;
  let baselineRecipeMaterialCents = 0;
  let scenarioLaborCents = 0;
  let scenarioMaterialCents = 0;
  let laborDeltaCents = 0;
  let recipeMaterialDeltaCents = 0;
  let shippingBoxActualCents = 0;
  let shippingBoxDeltaCents = 0;
  let rawCoffeeImpactCents = 0;
  let rawCoffeeScenarioCents = 0;
  let materialSupplyImpactCents = 0;
  let materialSupplyScenarioCents = 0;
  let coffeePoundsSold = 0;
  let revenueDeltaCents = 0;
  let unweightedLineCount = 0;
  let unresolvedLineCount = 0;
  let weightedRevenueCents = 0;
  const scenarioPricePerPoundCents =
    typeof params.scenarioPricePerPoundCents === 'number' &&
    Number.isFinite(params.scenarioPricePerPoundCents) &&
    params.scenarioPricePerPoundCents >= 0
      ? params.scenarioPricePerPoundCents
      : undefined;

  for (const line of lines) {
    const recipe = line.productId ? recipeByProductId.get(line.productId) : undefined;
    const recipeComponentCosts = allocateActualMaterialCosts(recipeComponentCostsForLine({
      avgCostByItemId,
      itemUnitCostOverridesCents: params.itemUnitCostOverridesCents,
      line,
      materialSupplyPercentDelta: params.materialSupplyPercentDelta,
      rawCoffeePercentDelta: params.rawCoffeePercentDelta,
      recipe,
    }).filter((cost) => inventoryItemById.has(cost.inventoryItem.id)), line.actualMaterialCents);
    const shippingBoxCosts = shippingBoxCostsForLine({
      avgCostByItemId,
      inventoryItemById,
      line,
      params,
      usages: shippingBoxUsagesByOrderItemId.get(line.id) ?? [],
    });
    const componentCosts = [...recipeComponentCosts, ...shippingBoxCosts];
    const laborCost = laborCostForLine({ line, params, recipe });

    if (!componentCosts.length) unresolvedLineCount += 1;

    const lineBaselineMaterialCents = recipeComponentCosts.reduce((sum, cost) => sum + cost.baselineCostCents, 0);
    const lineScenarioMaterialCents = recipeComponentCosts.reduce((sum, cost) => sum + cost.scenarioCostCents, 0);
    const lineActualMaterialCents = recipeComponentCosts.reduce((sum, cost) => sum + cost.actualCostCents, 0);
    const lineScenarioActualMaterialCents = recipeComponentCosts.reduce((sum, cost) => sum + cost.scenarioActualCostCents, 0);
    const lineShippingBoxActualCents = shippingBoxCosts.reduce((sum, cost) => sum + cost.actualCostCents, 0);
    const lineShippingBoxScenarioCents = shippingBoxCosts.reduce((sum, cost) => sum + cost.scenarioActualCostCents, 0);
    const lineMaterialDeltaCents = (lineScenarioActualMaterialCents - lineActualMaterialCents) + (lineShippingBoxScenarioCents - lineShippingBoxActualCents);
    const lineLaborDeltaCents = laborCost.scenarioActualCostCents - laborCost.actualCostCents;
    const lineLaborImpactCents = laborCost.actualCostCents - laborCost.scenarioActualCostCents;
    const lineCoffeePoundsSold = rawCoffeePoundsPerUnit(recipe) * line.qty;
    const isWeightedCoffeeLine = lineCoffeePoundsSold > 0;
    const lineSimulatedRevenueCents =
      isWeightedCoffeeLine && typeof scenarioPricePerPoundCents === 'number'
        ? lineCoffeePoundsSold * scenarioPricePerPoundCents
        : line.revenueCents;
    const lineRevenueDeltaCents = lineSimulatedRevenueCents - line.revenueCents;
    baselineRecipeLaborCents += laborCost.baselineCostCents;
    baselineRecipeMaterialCents += lineBaselineMaterialCents;
    scenarioLaborCents += laborCost.scenarioCostCents;
    scenarioMaterialCents += lineScenarioMaterialCents;
    laborDeltaCents += lineLaborDeltaCents;
    recipeMaterialDeltaCents += lineScenarioActualMaterialCents - lineActualMaterialCents;
    shippingBoxActualCents += lineShippingBoxActualCents;
    shippingBoxDeltaCents += lineShippingBoxScenarioCents - lineShippingBoxActualCents;
    revenueDeltaCents += lineRevenueDeltaCents;
    if (isWeightedCoffeeLine) {
      coffeePoundsSold += lineCoffeePoundsSold;
      weightedRevenueCents += line.revenueCents;
    } else {
      unweightedLineCount += 1;
    }

    const productId = line.productId ?? line.productName;
    const productRow = productRowsById.get(productId) ?? {
      actualGrossProfitCents: 0,
      baselineLaborCents: 0,
      baselineMaterialCents: 0,
      coffeePoundsSold: 0,
      grossProfitImpactCents: 0,
      id: productId,
      name: line.productName,
      orderItemIds: new Set<string>(),
      revenueCents: 0,
      simulatedGrossProfitCents: 0,
      simulatedLaborCents: 0,
      simulatedMaterialCents: 0,
      simulatedRevenueCents: 0,
      unitsSold: 0,
      unweightedLineCount: 0,
      unresolvedLineCount: 0,
    };
    productRow.actualGrossProfitCents += line.actualGrossProfitCents;
    productRow.baselineLaborCents += laborCost.actualCostCents;
    productRow.baselineMaterialCents += lineActualMaterialCents + lineShippingBoxActualCents;
    productRow.coffeePoundsSold += lineCoffeePoundsSold;
    productRow.grossProfitImpactCents += lineRevenueDeltaCents - lineMaterialDeltaCents - lineLaborDeltaCents;
    productRow.revenueCents += line.revenueCents;
    productRow.simulatedGrossProfitCents += line.actualGrossProfitCents + lineRevenueDeltaCents - lineMaterialDeltaCents - lineLaborDeltaCents;
    productRow.simulatedLaborCents += laborCost.scenarioActualCostCents;
    productRow.simulatedMaterialCents += lineScenarioActualMaterialCents + lineShippingBoxScenarioCents;
    productRow.simulatedRevenueCents += lineSimulatedRevenueCents;
    productRow.unitsSold += line.qty;
    if (!isWeightedCoffeeLine) productRow.unweightedLineCount += 1;
    productRow.orderItemIds.add(line.id);
    if (!componentCosts.length) productRow.unresolvedLineCount += 1;
    productRowsById.set(productId, productRow);

    const laborRow = laborRowsById.get(productId) ?? {
      baselineLaborCents: 0,
      baselineLaborMinutes: laborCost.baselineMinutes,
      baselineLaborRateCents: laborCost.baselineRateCents,
      grossProfitImpactCents: 0,
      hasRecipe: laborCost.hasRecipe,
      id: productId,
      lineCount: 0,
      name: line.productName,
      revenueCents: 0,
      simulatedLaborCents: 0,
      simulatedLaborMinutes: laborCost.scenarioMinutes,
      simulatedLaborRateCents: laborCost.scenarioRateCents,
      unitsSold: 0,
      unresolvedLineCount: 0,
    };
    laborRow.baselineLaborCents += laborCost.actualCostCents;
    laborRow.grossProfitImpactCents += lineLaborImpactCents;
    laborRow.hasRecipe = laborRow.hasRecipe || laborCost.hasRecipe;
    laborRow.lineCount += 1;
    laborRow.revenueCents += line.revenueCents;
    laborRow.simulatedLaborCents += laborCost.scenarioActualCostCents;
    laborRow.unitsSold += line.qty;
    if (!laborCost.hasRecipe) laborRow.unresolvedLineCount += 1;
    laborRowsById.set(productId, laborRow);

    for (const cost of componentCosts) {
      const itemType = itemTypeForSimulation(cost.inventoryItem.item_type);
      const impactCents = cost.actualCostCents - cost.scenarioActualCostCents;
      if (itemType === 'raw_coffee') {
        rawCoffeeImpactCents += impactCents;
        rawCoffeeScenarioCents += cost.scenarioActualCostCents;
      }
      if (itemType === 'material_supply') {
        materialSupplyImpactCents += impactCents;
        materialSupplyScenarioCents += cost.scenarioActualCostCents;
      }

      const row = inputRowsById.get(cost.inventoryItem.id) ?? simulatorInputRowForItem({
        avgCostByItemId,
        item: cost.inventoryItem,
        params,
      });
      row.baselineCostCents += cost.actualCostCents;
      row.grossProfitImpactCents += impactCents;
      row.lineCount += 1;
      row.productIds.add(cost.productId);
      row.productCount = row.productIds.size;
      row.quantityUsed += cost.quantity;
      row.simulatedCostCents += cost.scenarioActualCostCents;
      inputRowsById.set(cost.inventoryItem.id, row);
    }
  }

  for (const item of inventoryItems) {
    if (inputRowsById.has(item.id) || !itemIsSimulatedInput(item) || item.active === false) continue;
    inputRowsById.set(item.id, simulatorInputRowForItem({ avgCostByItemId, item, params }));
  }

  const materialSupplyDeltaCents = recipeMaterialDeltaCents + shippingBoxDeltaCents;
  const simulatedLaborCents = Math.max(0, actual.laborCents + laborDeltaCents);
  const boundedLaborDeltaCents = simulatedLaborCents - actual.laborCents;
  const boundedLaborImpactCents = -boundedLaborDeltaCents;
  const actualMaterialSupplyCents = actual.materialCents + shippingBoxActualCents;
  const simulatedRevenueCents = actual.revenueCents + revenueDeltaCents;
  const simulatedGrossProfitCents = actual.grossProfitCents + revenueDeltaCents - materialSupplyDeltaCents - boundedLaborDeltaCents;
  const simulatedTotalCogsCents = actual.totalCogsCents + materialSupplyDeltaCents + boundedLaborDeltaCents;
  const validLaborMinuteOverrideCount = [...params.laborMinutesOverrides.values()].filter((value) => Number.isFinite(value) && value >= 0).length;
  const validLaborRateOverrideCount = [...params.laborRateOverridesCents.values()].filter((value) => Number.isFinite(value) && value >= 0).length;
  const hasLaborPercentOverride = Number.isFinite(params.laborPercentDelta) && params.laborPercentDelta !== 0;
  const hasPricePerPoundOverride = typeof scenarioPricePerPoundCents === 'number';

  return {
    actualGrossProfitCents: actual.grossProfitCents,
    actualLaborCents: actual.laborCents,
    actualMarginPercent: actual.marginPercent,
    actualMaterialCents: actual.materialCents,
    actualMaterialSupplyCents,
    actualPricePerPoundCents: coffeePoundsSold > 0 ? weightedRevenueCents / coffeePoundsSold : 0,
    actualTotalCogsCents: actual.totalCogsCents,
    appliedOverrideCount: [...params.itemUnitCostOverridesCents.values()].filter((value) => Number.isFinite(value) && value >= 0).length + validLaborMinuteOverrideCount + validLaborRateOverrideCount + (hasLaborPercentOverride ? 1 : 0) + (hasPricePerPoundOverride ? 1 : 0),
    baselineRecipeLaborCents,
    baselineRecipeMaterialCents,
    coffeePoundsSold,
    grossProfitChangeCents: simulatedGrossProfitCents - actual.grossProfitCents,
    inputRows: [...inputRowsById.values()]
      .map(({ productIds, ...row }) => row)
      .sort((a, b) => Math.abs(b.grossProfitImpactCents) - Math.abs(a.grossProfitImpactCents) || b.simulatedCostCents - a.simulatedCostCents || a.name.localeCompare(b.name)),
    laborImpactCents: boundedLaborImpactCents,
    laborRows: [...laborRowsById.values()]
      .sort((a, b) => Math.abs(b.grossProfitImpactCents) - Math.abs(a.grossProfitImpactCents) || b.simulatedLaborCents - a.simulatedLaborCents || a.name.localeCompare(b.name)),
    laborScenarioCents: scenarioLaborCents,
    materialSupplyImpactCents,
    materialSupplyScenarioCents,
    orderCount: new Set(lines.map((line) => line.orderId)).size,
    productRows: [...productRowsById.values()]
      .map(({ orderItemIds, ...row }) => row)
      .sort((a, b) => Math.abs(b.grossProfitImpactCents) - Math.abs(a.grossProfitImpactCents) || b.revenueCents - a.revenueCents || a.name.localeCompare(b.name)),
    rawCoffeeImpactCents,
    rawCoffeeScenarioCents,
    revenueImpactCents: revenueDeltaCents,
    revenueCents: actual.revenueCents,
    simulatedGrossProfitCents,
    simulatedLaborCents,
    simulatedMarginPercent: percent(simulatedGrossProfitCents, simulatedRevenueCents),
    simulatedMaterialCents: actual.materialCents + recipeMaterialDeltaCents,
    simulatedMaterialSupplyCents: actualMaterialSupplyCents + materialSupplyDeltaCents,
    simulatedRevenueCents,
    simulatedTotalCogsCents,
    unweightedLineCount,
    unresolvedLineCount,
    weightedRevenueCents,
  };
}

export function defaultSimulatorRangeForMonth(month: Date) {
  const rangeStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const rangeEndExclusive = new Date(rangeStart.getTime() + 32 * DAY_IN_MS);
  rangeEndExclusive.setDate(1);
  rangeEndExclusive.setHours(0, 0, 0, 0);
  return { rangeEndExclusive, rangeStart };
}

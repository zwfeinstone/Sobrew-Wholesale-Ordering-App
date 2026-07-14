import {
  convertInventoryQuantity,
  fixedRecipeCostCents,
  isWholeCountPackagingComponentRole,
  laborCostCents,
  normalizeInventoryNumber,
  recipeComponentWasteMultiplier,
  roundWholeCountQuantity,
  type InventoryUnit,
} from '@/lib/inventory';

export type SalesPriceGuideCostSource = 'latest_production' | 'finished_stock' | 'recipe_estimate' | 'missing_cost';

export type SalesPriceGuidePriceRange = {
  maxCents: number;
  medianCents: number;
  minCents: number;
};

export type SalesPriceGuideCostChoice = {
  costCents: number;
  source: SalesPriceGuideCostSource;
};

export type SalesPriceGuideShippingSummary = {
  averageShippingCents: number;
  lineCount: number;
  orderCount: number;
  shippingCents: number;
  unitsSold: number;
};

export type SalesPriceGuideOrderRow = {
  id: string;
  shipping_cost_cents?: number | string | null;
  status?: string | null;
};

export type SalesPriceGuideOrderItemRow = {
  cogs_shipping_cents?: number | string | null;
  cogs_snapshot_at?: string | null;
  id: string;
  line_total_cents?: number | string | null;
  order_id: string;
  product_id: string | null;
  qty?: number | string | null;
  shipping_boxes_used?: number | string | null;
  unit_price_cents?: number | string | null;
};

export type SalesPriceGuideRecipeComponentRow = {
  component_role: string | null;
  inventory_item_id: string;
  inventory_items?: { base_unit: InventoryUnit; id: string; sku?: string | null } | Array<{ base_unit: InventoryUnit; id: string; sku?: string | null }> | null;
  quantity: number | string | null;
  unit: InventoryUnit;
};

export type SalesPriceGuideRecipeRow = {
  branding_label_qty: number | string | null;
  labor_minutes: number | string | null;
  labor_rate_cents: number | string | null;
  output_qty: number | string | null;
  product_id: string;
  product_recipe_components?: SalesPriceGuideRecipeComponentRow[] | null;
  shipping_label_qty: number | string | null;
  waste_percent: number | string | null;
};

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function lineRevenueCents(item: SalesPriceGuideOrderItemRow) {
  const explicit = normalizeInventoryNumber(item.line_total_cents);
  if (explicit > 0) return explicit;
  return normalizeInventoryNumber(item.qty) * normalizeInventoryNumber(item.unit_price_cents);
}

export function roundToNearestQuarterCents(valueCents: number) {
  if (!Number.isFinite(valueCents) || valueCents <= 0) return 0;
  return Math.round(valueCents / 25) * 25;
}

export function targetMarginPriceCents(costCents: number, marginPercent: number) {
  const safeCost = Math.max(0, costCents);
  const marginRate = marginPercent / 100;
  if (!safeCost || marginRate <= 0 || marginRate >= 1) return 0;
  return roundToNearestQuarterCents(safeCost / (1 - marginRate));
}

export function priceRangeCents(values: Array<number | string | null | undefined>): SalesPriceGuidePriceRange | null {
  const prices = values
    .map((value) => Math.max(0, normalizeInventoryNumber(value)))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  if (!prices.length) return null;

  const middle = Math.floor(prices.length / 2);
  const medianCents = prices.length % 2
    ? prices[middle]
    : (prices[middle - 1] + prices[middle]) / 2;

  return {
    maxCents: prices[prices.length - 1],
    medianCents,
    minCents: prices[0],
  };
}

export function chooseProductCostCents({
  averageFinishedStockCostCents,
  latestProductionCostCents,
  recipeEstimateCostCents,
}: {
  averageFinishedStockCostCents?: number | null;
  latestProductionCostCents?: number | null;
  recipeEstimateCostCents?: number | null;
}): SalesPriceGuideCostChoice {
  if (normalizeInventoryNumber(latestProductionCostCents) > 0) {
    return { costCents: normalizeInventoryNumber(latestProductionCostCents), source: 'latest_production' };
  }
  if (normalizeInventoryNumber(averageFinishedStockCostCents) > 0) {
    return { costCents: normalizeInventoryNumber(averageFinishedStockCostCents), source: 'finished_stock' };
  }
  if (normalizeInventoryNumber(recipeEstimateCostCents) > 0) {
    return { costCents: normalizeInventoryNumber(recipeEstimateCostCents), source: 'recipe_estimate' };
  }
  return { costCents: 0, source: 'missing_cost' };
}

export function allocateShippingCents(items: SalesPriceGuideOrderItemRow[], orderShippingCents: number) {
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
    const amount = index === items.length - 1 ? Math.max(0, orderShippingCents - allocated) : (Math.max(0, orderShippingCents) * weight) / totalWeight;
    allocated += amount;
    allocations.set(item.id, amount);
  });

  return allocations;
}

export function historicalShippingByProduct({
  orderItems,
  orders,
}: {
  orderItems: SalesPriceGuideOrderItemRow[];
  orders: SalesPriceGuideOrderRow[];
}) {
  const itemsByOrderId = new Map<string, SalesPriceGuideOrderItemRow[]>();
  for (const item of orderItems) {
    const items = itemsByOrderId.get(item.order_id) ?? [];
    items.push(item);
    itemsByOrderId.set(item.order_id, items);
  }

  const summaries = new Map<string, SalesPriceGuideShippingSummary & { orderIds: Set<string> }>();
  for (const order of orders) {
    if (order.status !== 'Shipped') continue;
    const items = itemsByOrderId.get(order.id) ?? [];
    const allocations = allocateShippingCents(items, normalizeInventoryNumber(order.shipping_cost_cents));

    for (const item of items) {
      if (!item.product_id) continue;
      const qty = Math.max(0, normalizeInventoryNumber(item.qty));
      if (qty <= 0) continue;
      const savedShipping = normalizeInventoryNumber(item.cogs_shipping_cents);
      const shippingCents = savedShipping > 0 ? savedShipping : allocations.get(item.id) ?? 0;
      const summary = summaries.get(item.product_id) ?? {
        averageShippingCents: 0,
        lineCount: 0,
        orderCount: 0,
        orderIds: new Set<string>(),
        shippingCents: 0,
        unitsSold: 0,
      };

      summary.lineCount += 1;
      summary.orderIds.add(order.id);
      summary.shippingCents += Math.max(0, shippingCents);
      summary.unitsSold += qty;
      summaries.set(item.product_id, summary);
    }
  }

  const publicSummaries = new Map<string, SalesPriceGuideShippingSummary>();
  for (const [productId, summary] of summaries.entries()) {
    publicSummaries.set(productId, {
      averageShippingCents: summary.unitsSold > 0 ? summary.shippingCents / summary.unitsSold : 0,
      lineCount: summary.lineCount,
      orderCount: summary.orderIds.size,
      shippingCents: summary.shippingCents,
      unitsSold: summary.unitsSold,
    });
  }
  return publicSummaries;
}

export function recipeUnitCostEstimateCents(recipe: SalesPriceGuideRecipeRow | null | undefined, avgCostByItemId: Map<string, number>) {
  if (!recipe) return 0;
  const outputQty = normalizeInventoryNumber(recipe.output_qty) || 1;
  const components = recipe.product_recipe_components ?? [];
  const materialCost = components.reduce((sum, component) => {
    const item = relatedOne(component.inventory_items);
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
      return sum + baseQuantity * (avgCostByItemId.get(component.inventory_item_id) ?? 0);
    } catch {
      return sum;
    }
  }, 0);
  const boxQty = components
    .filter((component) => component.component_role === 'box' || Boolean(relatedOne(component.inventory_items)?.sku?.startsWith('BOX-')))
    .reduce((sum, component) => sum + normalizeInventoryNumber(component.quantity), 0);
  const fixedCost = fixedRecipeCostCents({
    boxQty,
    brandingLabelQty: recipe.branding_label_qty,
    shippingLabelQty: recipe.shipping_label_qty,
  });
  const laborCost = laborCostCents(recipe.labor_minutes, recipe.labor_rate_cents);

  return (materialCost + fixedCost + laborCost) / outputQty;
}

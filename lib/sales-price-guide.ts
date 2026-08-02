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
  projectedFromProductId?: string;
  projectedFromProductName?: string | null;
  projectedPricePerLbCents?: number;
  projectedWeightLb?: number;
  shippingCents: number;
  source?: 'historical' | 'projected';
  unitsSold: number;
};

export type SalesPriceGuideProductRow = {
  category?: string | null;
  id: string;
  name?: string | null;
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
  inventory_items?: {
    base_unit: InventoryUnit;
    id: string;
    item_type?: string | null;
    name?: string | null;
    sku?: string | null;
  } | Array<{
    base_unit: InventoryUnit;
    id: string;
    item_type?: string | null;
    name?: string | null;
    sku?: string | null;
  }> | null;
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

function normalizeCategory(value: string | null | undefined) {
  return String(value ?? '').trim().toLowerCase();
}

function boxVolumeFromText(value: string | null | undefined) {
  const text = String(value ?? '').toLowerCase();
  const match = text.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i);
  if (!match) return 0;
  return Number(match[1]) * Number(match[2]) * Number(match[3]);
}

function boxVolumeForComponent(component: SalesPriceGuideRecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  return Math.max(boxVolumeFromText(item?.sku), boxVolumeFromText(item?.name));
}

function isBoxComponent(component: SalesPriceGuideRecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  const sku = String(item?.sku ?? '').toUpperCase();
  return component.component_role === 'box' || sku.startsWith('BOX-') || sku.includes('-BOX-');
}

function isWeightComponent(component: SalesPriceGuideRecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  return component.component_role === 'raw_coffee' || item?.item_type === 'raw_coffee';
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
      source: 'historical',
      unitsSold: summary.unitsSold,
    });
  }
  return publicSummaries;
}

function packageProfileForRecipe(recipe: SalesPriceGuideRecipeRow | null | undefined) {
  if (!recipe) return { boxVolume: 0, weightLb: 0 };
  const outputQty = normalizeInventoryNumber(recipe.output_qty) || 1;
  const components = recipe.product_recipe_components ?? [];
  let weightLb = 0;
  let boxVolume = 0;

  for (const component of components) {
    if (isWeightComponent(component)) {
      try {
        weightLb += convertInventoryQuantity(
          normalizeInventoryNumber(component.quantity) * recipeComponentWasteMultiplier(component.component_role, recipe.waste_percent),
          component.unit,
          'lb'
        );
      } catch {
        // Ignore non-weight components that were misclassified.
      }
    }

    if (isBoxComponent(component)) {
      boxVolume = Math.max(boxVolume, boxVolumeForComponent(component));
    }
  }

  return {
    boxVolume,
    weightLb: weightLb / outputQty,
  };
}

function packageSimilarityScore(
  target: { boxVolume: number; weightLb: number },
  candidate: { boxVolume: number; weightLb: number }
) {
  const weightDelta = target.weightLb > 0 ? Math.abs(candidate.weightLb - target.weightLb) / target.weightLb : 1;
  const boxDelta = target.boxVolume > 0 && candidate.boxVolume > 0
    ? Math.abs(candidate.boxVolume - target.boxVolume) / target.boxVolume
    : target.boxVolume === candidate.boxVolume
      ? 0
      : 1;
  return weightDelta * 2 + boxDelta;
}

export function projectedShippingByProduct({
  historicalSummaries,
  products,
  recipes,
}: {
  historicalSummaries: Map<string, SalesPriceGuideShippingSummary>;
  products: SalesPriceGuideProductRow[];
  recipes: SalesPriceGuideRecipeRow[];
}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const recipeByProductId = new Map(recipes.map((recipe) => [recipe.product_id, recipe]));
  const profiles = new Map(products.map((product) => [product.id, {
    ...packageProfileForRecipe(recipeByProductId.get(product.id)),
    category: normalizeCategory(product.category),
    productId: product.id,
  }]));
  const projected = new Map<string, SalesPriceGuideShippingSummary>();

  for (const product of products) {
    if (historicalSummaries.has(product.id)) continue;
    const target = profiles.get(product.id);
    if (!target || !target.category || target.weightLb <= 0) continue;

    const candidates = [...historicalSummaries.entries()]
      .map(([productId, summary]) => ({
        product: productById.get(productId) ?? null,
        profile: profiles.get(productId) ?? null,
        summary,
      }))
      .filter((candidate) => (
        candidate.product
        && candidate.profile
        && candidate.profile.category === target.category
        && candidate.profile.weightLb > 0
        && candidate.summary.averageShippingCents > 0
      ));

    let best: (typeof candidates)[number] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const score = packageSimilarityScore(target, candidate.profile!);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best?.profile) continue;

    const projectedPricePerLbCents = best.summary.averageShippingCents / best.profile.weightLb;
    const averageShippingCents = Math.round(projectedPricePerLbCents * target.weightLb);
    if (averageShippingCents <= 0) continue;

    projected.set(product.id, {
      averageShippingCents,
      lineCount: 0,
      orderCount: 0,
      projectedFromProductId: best.profile.productId,
      projectedFromProductName: best.product?.name ?? null,
      projectedPricePerLbCents,
      projectedWeightLb: target.weightLb,
      shippingCents: 0,
      source: 'projected',
      unitsSold: 0,
    });
  }

  return projected;
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

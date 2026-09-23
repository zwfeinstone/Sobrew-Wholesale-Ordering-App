import {
  convertInventoryQuantity,
  isWholeCountPackagingComponentRole,
  normalizeInventoryNumber,
  recipeComponentWasteMultiplier,
  roundWholeCountQuantity,
  type InventoryUnit,
} from '@/lib/inventory';

export type ProductionMaterialItem = {
  id: string;
  base_unit: InventoryUnit;
  active?: boolean | null;
  name?: string;
  sku?: string | null;
};

export type ProductionMaterialComponent = {
  id: string;
  inventory_item_id: string;
  quantity: number | string;
  unit: InventoryUnit;
  component_role: string | null;
  inventory_items?: ProductionMaterialItem | ProductionMaterialItem[] | null;
};

export type ProductionMaterialRecipe = {
  output_qty: number | string;
  waste_percent: number | string;
  product_recipe_components?: ProductionMaterialComponent[] | null;
};

export type ProductionComponentPayload = {
  inventory_item_id: string;
  quantity_expected: number;
  quantity_used: number;
  unit: InventoryUnit;
};

export type ProductionMaterialLine = {
  inventoryItemId: string;
  unit: InventoryUnit;
  requiredQty: number;
  expectedQty: number;
  availableQty: number;
  shortageQty: number;
};

export type ProductionMaterialPreview = {
  lines: ProductionMaterialLine[];
  components: ProductionComponentPayload[];
  missingRecipe: boolean;
  invalidRecipe: boolean;
  invalidUnit: boolean;
  hasShortages: boolean;
  remainingOnHandByItemId: Map<string, number>;
};

export const SAMPLE_BOX_FALLBACK_BOX_SKUS = ['MAT-BOX-12X6X4', 'BOX-12X6X4'];
const SAMPLE_BOX_PRIMARY_BOX_SKUS = new Set(['BOX-12X7X4', 'MAT-BOX-12X7X4']);
const QUANTITY_EPSILON = 0.0001;

function relatedItem(component: ProductionMaterialComponent) {
  return Array.isArray(component.inventory_items) ? component.inventory_items[0] : component.inventory_items;
}

function normalizeSku(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

export function isProductionBoxComponent(component: ProductionMaterialComponent) {
  const sku = normalizeSku(relatedItem(component)?.sku);
  return component.component_role === 'box' || sku.startsWith('BOX-') || sku.startsWith('MAT-BOX-');
}

function isSampleBoxPrimaryComponent(component: ProductionMaterialComponent) {
  return SAMPLE_BOX_PRIMARY_BOX_SKUS.has(normalizeSku(relatedItem(component)?.sku));
}

export function productionNeedsFallbackBoxes(recipe: ProductionMaterialRecipe, productCategory?: string | null) {
  return productCategory === 'sample_boxes' && (recipe.product_recipe_components ?? []).some(isSampleBoxPrimaryComponent);
}

export function preferredProductionFallbackItem(items: readonly ProductionMaterialItem[]) {
  for (const sku of SAMPLE_BOX_FALLBACK_BOX_SKUS) {
    const item = items.find((candidate) => candidate.id && candidate.active !== false && normalizeSku(candidate.sku) === sku);
    if (item) return item;
  }
  return null;
}

/** The same recipe calculation powers the planning preview and the recorded run. */
export function buildProductionMaterialPreview({
  recipe,
  productCategory,
  quantity,
  onHandByItemId,
  fallbackItems = [],
  actualQuantityByComponentId = new Map<string, number>(),
}: {
  recipe: ProductionMaterialRecipe | null | undefined;
  productCategory?: string | null;
  quantity: number;
  onHandByItemId: ReadonlyMap<string, number>;
  fallbackItems?: readonly ProductionMaterialItem[];
  actualQuantityByComponentId?: ReadonlyMap<string, number>;
}): ProductionMaterialPreview {
  const unchangedStock = new Map(onHandByItemId);
  const result: ProductionMaterialPreview = {
    lines: [],
    components: [],
    missingRecipe: !recipe,
    invalidRecipe: false,
    invalidUnit: false,
    hasShortages: false,
    remainingOnHandByItemId: unchangedStock,
  };
  if (!recipe) return result;

  const components = recipe.product_recipe_components ?? [];
  const outputQty = normalizeInventoryNumber(recipe.output_qty);
  if (!components.length || outputQty <= 0 || !Number.isFinite(quantity) || quantity < 0) {
    return { ...result, invalidRecipe: true };
  }

  const remaining = new Map(onHandByItemId);
  const fallback = productCategory === 'sample_boxes' ? preferredProductionFallbackItem(fallbackItems) : null;
  const payload: ProductionComponentPayload[] = [];
  const available = (id: string) => Math.max(0, normalizeInventoryNumber(remaining.get(id)));
  const addLine = (line: ProductionComponentPayload) => {
    payload.push(line);
    remaining.set(line.inventory_item_id, Math.max(0, available(line.inventory_item_id) - line.quantity_used));
  };

  for (const component of components) {
    const item = relatedItem(component);
    const componentQty = normalizeInventoryNumber(component.quantity);
    if (!component.inventory_item_id || !item?.base_unit || componentQty <= 0) {
      return { ...result, invalidRecipe: true };
    }

    const expectedRecipeQty = componentQty / outputQty * quantity
      * recipeComponentWasteMultiplier(component.component_role, recipe.waste_percent);
    const actualRecipeQty = actualQuantityByComponentId.has(component.id)
      ? Math.max(0, actualQuantityByComponentId.get(component.id) ?? expectedRecipeQty)
      : expectedRecipeQty;
    let expectedQty: number;
    let usedQty: number;
    try {
      expectedQty = convertInventoryQuantity(expectedRecipeQty, component.unit, item.base_unit);
      usedQty = convertInventoryQuantity(actualRecipeQty, component.unit, item.base_unit);
    } catch {
      return { ...result, invalidUnit: true };
    }
    if (!Number.isFinite(expectedQty) || !Number.isFinite(usedQty) || expectedQty < 0) {
      return { ...result, invalidRecipe: true };
    }
    if (isWholeCountPackagingComponentRole(component.component_role) && item.base_unit === 'each') {
      expectedQty = roundWholeCountQuantity(expectedQty);
      usedQty = roundWholeCountQuantity(usedQty);
    }

    if (fallback && isSampleBoxPrimaryComponent(component) && fallback.base_unit === item.base_unit) {
      const primaryAvailable = available(component.inventory_item_id);
      const primaryUsed = Math.min(primaryAvailable, usedQty);
      const fallbackUsed = Math.max(0, usedQty - primaryUsed);
      // A substitution is valid only when it can cover the entire missing quantity.
      if (primaryAvailable + QUANTITY_EPSILON < usedQty
        && fallbackUsed > QUANTITY_EPSILON
        && available(fallback.id) + QUANTITY_EPSILON >= fallbackUsed) {
        const primaryExpected = usedQty > QUANTITY_EPSILON ? expectedQty * (primaryUsed / usedQty) : 0;
        if (primaryUsed > QUANTITY_EPSILON || primaryExpected > QUANTITY_EPSILON) {
          addLine({ inventory_item_id: component.inventory_item_id, quantity_expected: primaryExpected, quantity_used: primaryUsed, unit: item.base_unit });
        }
        addLine({ inventory_item_id: fallback.id, quantity_expected: Math.max(0, expectedQty - primaryExpected), quantity_used: fallbackUsed, unit: fallback.base_unit });
        continue;
      }
    }
    addLine({ inventory_item_id: component.inventory_item_id, quantity_expected: expectedQty, quantity_used: usedQty, unit: item.base_unit });
  }

  const linesByItem = new Map<string, ProductionMaterialLine>();
  for (const component of payload) {
    const line = linesByItem.get(component.inventory_item_id) ?? {
      inventoryItemId: component.inventory_item_id,
      unit: component.unit,
      requiredQty: 0,
      expectedQty: 0,
      availableQty: Math.max(0, normalizeInventoryNumber(onHandByItemId.get(component.inventory_item_id))),
      shortageQty: 0,
    };
    line.requiredQty += component.quantity_used;
    line.expectedQty += component.quantity_expected;
    line.shortageQty = Math.max(0, line.requiredQty - line.availableQty);
    linesByItem.set(component.inventory_item_id, line);
  }
  const lines = [...linesByItem.values()];
  return {
    ...result,
    lines,
    components: payload,
    hasShortages: lines.some((line) => line.shortageQty > 0),
    remainingOnHandByItemId: remaining,
  };
}

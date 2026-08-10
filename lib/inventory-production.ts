import {
  convertInventoryQuantity,
  fixedRecipeCostBreakdownCents,
  fixedRecipeCostCents,
  isWholeCountPackagingComponentRole,
  laborCostCents,
  normalizeInventoryNumber,
  recipeComponentWasteMultiplier,
  roundWholeCountQuantity,
  scaledRecipeCostForQuantity,
  type InventoryUnit,
} from '@/lib/inventory';

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => any;
};

type ProductionRunError =
  | 'insufficient_inventory'
  | 'production_error'
  | 'recipe_error'
  | 'unit_error';

type InventoryItemRow = {
  id: string;
  base_unit: InventoryUnit;
  active?: boolean | null;
  sku?: string | null;
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
  output_qty: number | string;
  waste_percent: number | string;
  labor_minutes: number | string;
  labor_rate_cents: number | string;
  shipping_label_qty: number | string;
  branding_label_qty: number | string;
  product_recipe_components?: RecipeComponentRow[] | null;
};

type ProductCategoryRow = {
  category?: string | null;
  id: string;
};

type ProductionComponentPayload = {
  inventory_item_id: string;
  quantity_expected: number;
  quantity_used: number;
  unit: InventoryUnit;
};

const SAMPLE_BOX_CATEGORY = 'sample_boxes';
const SAMPLE_BOX_PRIMARY_BOX_SKUS = new Set(['BOX-12X7X4', 'MAT-BOX-12X7X4']);
const SAMPLE_BOX_FALLBACK_BOX_SKUS = ['MAT-BOX-12X6X4', 'BOX-12X6X4'];
const QUANTITY_EPSILON = 0.0001;

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeSku(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

function isBoxComponent(component: RecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  const sku = normalizeSku(item?.sku);
  return component.component_role === 'box' || sku.startsWith('BOX-') || sku.startsWith('MAT-BOX-');
}

function isSampleBoxPrimaryBoxComponent(component: RecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  return SAMPLE_BOX_PRIMARY_BOX_SKUS.has(normalizeSku(item?.sku));
}

function isActiveFallbackBoxItem(item: InventoryItemRow | null | undefined) {
  return Boolean(item?.id && item.active !== false && SAMPLE_BOX_FALLBACK_BOX_SKUS.includes(normalizeSku(item.sku)));
}

function preferredFallbackBoxItem(items: InventoryItemRow[]) {
  for (const sku of SAMPLE_BOX_FALLBACK_BOX_SKUS) {
    const item = items.find((candidate) => isActiveFallbackBoxItem(candidate) && normalizeSku(candidate.sku) === sku);
    if (item) return item;
  }
  return null;
}

function splitSampleBoxBoxComponent({
  availableByItem,
  component,
  expectedBaseQty,
  fallbackBoxItem,
  remainingAvailableByItem,
  usedBaseQty,
}: {
  availableByItem: Map<string, number>;
  component: RecipeComponentRow;
  expectedBaseQty: number;
  fallbackBoxItem: InventoryItemRow | null;
  remainingAvailableByItem: Map<string, number>;
  usedBaseQty: number;
}): ProductionComponentPayload[] | null {
  const componentItem = relatedOne(component.inventory_items);
  if (
    !fallbackBoxItem ||
    !isSampleBoxPrimaryBoxComponent(component) ||
    !componentItem?.id ||
    componentItem.base_unit !== fallbackBoxItem.base_unit
  ) {
    return null;
  }

  const primaryAvailable = Math.max(0, remainingAvailableByItem.get(component.inventory_item_id) ?? availableByItem.get(component.inventory_item_id) ?? 0);
  if (primaryAvailable + QUANTITY_EPSILON >= usedBaseQty) {
    remainingAvailableByItem.set(component.inventory_item_id, Math.max(0, primaryAvailable - usedBaseQty));
    return null;
  }

  const primaryUsed = Math.max(0, Math.min(primaryAvailable, usedBaseQty));
  const fallbackUsed = Math.max(0, usedBaseQty - primaryUsed);
  const fallbackAvailable = Math.max(0, remainingAvailableByItem.get(fallbackBoxItem.id) ?? availableByItem.get(fallbackBoxItem.id) ?? 0);

  if (fallbackUsed <= QUANTITY_EPSILON || fallbackAvailable + QUANTITY_EPSILON < fallbackUsed) {
    return null;
  }

  remainingAvailableByItem.set(component.inventory_item_id, Math.max(0, primaryAvailable - primaryUsed));
  remainingAvailableByItem.set(fallbackBoxItem.id, Math.max(0, fallbackAvailable - fallbackUsed));

  const primaryExpected = usedBaseQty > QUANTITY_EPSILON
    ? expectedBaseQty * (primaryUsed / usedBaseQty)
    : 0;
  const fallbackExpected = Math.max(0, expectedBaseQty - primaryExpected);
  const payload: ProductionComponentPayload[] = [];

  if (primaryUsed > QUANTITY_EPSILON || primaryExpected > QUANTITY_EPSILON) {
    payload.push({
      inventory_item_id: component.inventory_item_id,
      quantity_expected: primaryExpected,
      quantity_used: primaryUsed,
      unit: componentItem.base_unit,
    });
  }

  payload.push({
    inventory_item_id: fallbackBoxItem.id,
    quantity_expected: fallbackExpected,
    quantity_used: fallbackUsed,
    unit: fallbackBoxItem.base_unit,
  });

  return payload;
}

export async function recordRecipeProductionRun({
  actualLaborMinutes,
  actualLaborRateCents,
  actualQuantityByComponentId = new Map<string, number>(),
  notes,
  productId,
  quantityProduced,
  supabase,
  wasteQuantity = 0,
}: {
  actualLaborMinutes?: number;
  actualLaborRateCents?: number;
  actualQuantityByComponentId?: Map<string, number>;
  notes?: string;
  productId: string;
  quantityProduced: number;
  supabase: SupabaseLike;
  wasteQuantity?: number;
}) {
  const [recipeResult, productResult] = await Promise.all([
    supabase
      .from('product_recipes')
      .select('id,output_qty,waste_percent,labor_minutes,labor_rate_cents,shipping_label_qty,branding_label_qty,product_recipe_components(id,inventory_item_id,quantity,unit,component_role,inventory_items(id,base_unit,sku))')
      .eq('product_id', productId)
      .single(),
    supabase
      .from('products')
      .select('id,category')
      .eq('id', productId)
      .maybeSingle(),
  ]);

  if (recipeResult.error || !recipeResult.data || quantityProduced <= 0) {
    return { error: 'recipe_error' as const };
  }

  const typedRecipe = recipeResult.data as RecipeRow;
  const product = productResult.data as ProductCategoryRow | null;
  const isSampleBoxProduct = product?.category === SAMPLE_BOX_CATEGORY;
  const components = (typedRecipe.product_recipe_components ?? []) as RecipeComponentRow[];
  const shouldLoadFallbackBox = isSampleBoxProduct && components.some(isSampleBoxPrimaryBoxComponent);
  const fallbackBoxResult = shouldLoadFallbackBox
    ? await supabase
        .from('inventory_items')
        .select('id,base_unit,sku,active')
        .in('sku', SAMPLE_BOX_FALLBACK_BOX_SKUS)
        .eq('active', true)
    : { data: [] as InventoryItemRow[], error: null };

  if (fallbackBoxResult.error) return { error: 'recipe_error' as const };

  const fallbackBoxItem = preferredFallbackBoxItem((fallbackBoxResult.data ?? []) as InventoryItemRow[]);
  const itemIds = [
    ...components.map((component) => component.inventory_item_id),
    ...(fallbackBoxItem ? [fallbackBoxItem.id] : []),
  ];
  const { data: lots } = itemIds.length
    ? await supabase
        .from('inventory_lots')
        .select('inventory_item_id,quantity_remaining,unit_cost_cents')
        .in('inventory_item_id', itemIds)
        .gt('quantity_remaining', 0)
    : { data: [] as any[] };

  const avgCostByItem = new Map<string, number>();
  const uniqueItemIds = [...new Set(itemIds)];
  for (const itemId of uniqueItemIds) {
    const itemLots = (lots ?? []).filter((lot: any) => lot.inventory_item_id === itemId);
    const remaining = itemLots.reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    const value = itemLots.reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining) * normalizeInventoryNumber(lot.unit_cost_cents), 0);
    avgCostByItem.set(itemId, remaining > 0 ? value / remaining : 0);
  }
  const availableByItem = new Map<string, number>();
  for (const lot of lots ?? []) {
    availableByItem.set(
      lot.inventory_item_id,
      (availableByItem.get(lot.inventory_item_id) ?? 0) + normalizeInventoryNumber(lot.quantity_remaining)
    );
  }

  const outputQty = normalizeInventoryNumber(typedRecipe.output_qty) || 1;
  const payload: ProductionComponentPayload[] = [];
  let estimatedMaterialCost = 0;
  const remainingAvailableByItem = new Map(availableByItem);

  try {
    for (const component of components) {
      const item = relatedOne(component.inventory_items);
      const baseUnit = item?.base_unit;
      if (!baseUnit) throw new Error('Missing component base unit.');
      const componentWasteMultiplier = recipeComponentWasteMultiplier(component.component_role, typedRecipe.waste_percent);
      const expectedInRecipeUnit = (normalizeInventoryNumber(component.quantity) / outputQty) * quantityProduced * componentWasteMultiplier;
      const actualInRecipeUnit = actualQuantityByComponentId.has(component.id)
        ? Math.max(0, actualQuantityByComponentId.get(component.id) ?? expectedInRecipeUnit)
        : expectedInRecipeUnit;
      const expectedBaseQtyRaw = convertInventoryQuantity(expectedInRecipeUnit, component.unit, baseUnit);
      const usedBaseQtyRaw = convertInventoryQuantity(actualInRecipeUnit, component.unit, baseUnit);
      const shouldRoundPackaging = isWholeCountPackagingComponentRole(component.component_role) && baseUnit === 'each';
      const expectedBaseQty = shouldRoundPackaging ? roundWholeCountQuantity(expectedBaseQtyRaw) : expectedBaseQtyRaw;
      const usedBaseQty = shouldRoundPackaging ? roundWholeCountQuantity(usedBaseQtyRaw) : usedBaseQtyRaw;
      const fallbackPayload = isSampleBoxProduct
        ? splitSampleBoxBoxComponent({
            availableByItem,
            component,
            expectedBaseQty,
            fallbackBoxItem,
            remainingAvailableByItem,
            usedBaseQty,
          })
        : null;

      if (fallbackPayload) {
        for (const line of fallbackPayload) {
          estimatedMaterialCost += line.quantity_expected * (avgCostByItem.get(line.inventory_item_id) ?? 0);
          payload.push(line);
        }
      } else {
        estimatedMaterialCost += expectedBaseQty * (avgCostByItem.get(component.inventory_item_id) ?? 0);
        payload.push({
          inventory_item_id: component.inventory_item_id,
          quantity_expected: expectedBaseQty,
          quantity_used: usedBaseQty,
          unit: baseUnit,
        });
      }
    }
  } catch {
    return { error: 'unit_error' as const };
  }

  const boxQtyForRecipeOutput = components
    .filter(isBoxComponent)
    .reduce((sum, component) => sum + normalizeInventoryNumber(component.quantity), 0);
  const fixedCostForRecipeOutput = fixedRecipeCostCents({
    boxQty: boxQtyForRecipeOutput,
    shippingLabelQty: typedRecipe.shipping_label_qty,
    brandingLabelQty: typedRecipe.branding_label_qty,
  });
  const fixedBreakdownForRecipeOutput = fixedRecipeCostBreakdownCents({
    boxQty: boxQtyForRecipeOutput,
    shippingLabelQty: typedRecipe.shipping_label_qty,
    brandingLabelQty: typedRecipe.branding_label_qty,
  });
  const fixedCostForRun = scaledRecipeCostForQuantity(fixedCostForRecipeOutput, outputQty, quantityProduced);
  const fixedTapeCostForRun = scaledRecipeCostForQuantity(fixedBreakdownForRecipeOutput.tapeCents, outputQty, quantityProduced);
  const fixedShippingLabelCostForRun = scaledRecipeCostForQuantity(fixedBreakdownForRecipeOutput.shippingLabelCents, outputQty, quantityProduced);
  const fixedBrandingLabelCostForRun = scaledRecipeCostForQuantity(fixedBreakdownForRecipeOutput.brandingLabelCents, outputQty, quantityProduced);
  const expectedLaborMinutes = (normalizeInventoryNumber(typedRecipe.labor_minutes) / outputQty) * quantityProduced;
  const expectedLaborCost = scaledRecipeCostForQuantity(
    laborCostCents(typedRecipe.labor_minutes, typedRecipe.labor_rate_cents),
    outputQty,
    quantityProduced
  );
  const runLaborMinutes = actualLaborMinutes ?? expectedLaborMinutes;
  const runLaborRateCents = actualLaborRateCents ?? normalizeInventoryNumber(typedRecipe.labor_rate_cents);
  const actualLaborCost = laborCostCents(runLaborMinutes, runLaborRateCents);
  const estimatedUnitCost = quantityProduced > 0
    ? (estimatedMaterialCost + fixedCostForRun + expectedLaborCost) / quantityProduced
    : 0;

  const { error } = await supabase.rpc('record_inventory_production_run', {
    p_product_id: productId,
    p_quantity_produced: quantityProduced,
    p_waste_quantity: Math.max(0, wasteQuantity),
    p_notes: notes ?? '',
    p_estimated_unit_cost_cents: estimatedUnitCost,
    p_components: payload,
    p_fixed_cost_cents: fixedCostForRun,
    p_expected_labor_cost_cents: expectedLaborCost,
    p_actual_labor_cost_cents: actualLaborCost,
    p_labor_minutes: runLaborMinutes,
    p_labor_rate_cents: runLaborRateCents,
    p_fixed_tape_cost_cents: fixedTapeCostForRun,
    p_fixed_shipping_label_cost_cents: fixedShippingLabelCostForRun,
    p_fixed_branding_label_cost_cents: fixedBrandingLabelCostForRun,
    p_fixed_other_cost_cents: Math.max(0, fixedCostForRun - fixedTapeCostForRun - fixedShippingLabelCostForRun - fixedBrandingLabelCostForRun),
  });

  if (error) {
    console.error('[production] record_inventory_production_run failed', error);
    const message = String(error.message ?? '');
    const mappedError: ProductionRunError = message.includes('Insufficient inventory')
      ? 'insufficient_inventory'
      : 'production_error';
    return { error: mappedError };
  }

  return { error: null };
}

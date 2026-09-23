import type { Database } from '@/lib/supabase/schema';
import {
  fixedRecipeCostBreakdownCents,
  fixedRecipeCostCents,
  laborCostCents,
  normalizeInventoryNumber,
  scaledRecipeCostForQuantity,
} from '@/lib/inventory';
import {
  buildProductionMaterialPreview,
  isProductionBoxComponent,
  preferredProductionFallbackItem,
  productionNeedsFallbackBoxes,
  SAMPLE_BOX_FALLBACK_BOX_SKUS,
  type ProductionMaterialComponent,
  type ProductionMaterialItem,
} from '@/lib/production-materials';

type SupabaseLike = {
  from: (table: string) => any;
  rpc: (
    name: 'record_inventory_production_run',
    args: Database['public']['Functions']['record_inventory_production_run']['Args'],
  ) => PromiseLike<{ error: { message: string } | null }>;
};

type ProductionRunError =
  | 'insufficient_inventory'
  | 'production_error'
  | 'recipe_error'
  | 'unit_error';

type InventoryItemRow = ProductionMaterialItem;
type RecipeComponentRow = ProductionMaterialComponent;

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

  if (recipeResult.error || !recipeResult.data || productResult.error || !Number.isFinite(quantityProduced) || quantityProduced <= 0) {
    return { error: 'recipe_error' as const };
  }

  const typedRecipe = recipeResult.data as RecipeRow;
  const product = productResult.data as ProductCategoryRow | null;
  const components = (typedRecipe.product_recipe_components ?? []) as RecipeComponentRow[];
  const shouldLoadFallbackBox = productionNeedsFallbackBoxes(typedRecipe, product?.category);
  const fallbackBoxResult = shouldLoadFallbackBox
    ? await supabase
        .from('inventory_items')
        .select('id,base_unit,sku,active')
        .in('sku', SAMPLE_BOX_FALLBACK_BOX_SKUS)
        .eq('active', true)
    : { data: [] as InventoryItemRow[], error: null };

  if (fallbackBoxResult.error) return { error: 'recipe_error' as const };

  const fallbackItems = (fallbackBoxResult.data ?? []) as InventoryItemRow[];
  const fallbackBoxItem = preferredProductionFallbackItem(fallbackItems);
  const itemIds = [
    ...components.map((component) => component.inventory_item_id),
    ...(fallbackBoxItem ? [fallbackBoxItem.id] : []),
  ];
  const { data: lots, error: lotsError } = itemIds.length
    ? await supabase
        .from('inventory_lots')
        .select('inventory_item_id,quantity_remaining,unit_cost_cents')
        .in('inventory_item_id', itemIds)
        .gt('quantity_remaining', 0)
    : { data: [] as any[], error: null };
  if (lotsError) return { error: 'production_error' as const };

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
  const preview = buildProductionMaterialPreview({
    recipe: typedRecipe,
    productCategory: product?.category,
    quantity: quantityProduced,
    onHandByItemId: availableByItem,
    fallbackItems,
    actualQuantityByComponentId,
  });
  if (preview.invalidUnit) return { error: 'unit_error' as const };
  if (preview.missingRecipe || preview.invalidRecipe) return { error: 'recipe_error' as const };
  const payload = preview.components;
  const estimatedMaterialCost = payload.reduce((sum, line) => sum + line.quantity_expected * (avgCostByItem.get(line.inventory_item_id) ?? 0), 0);

  const boxQtyForRecipeOutput = components
    .filter(isProductionBoxComponent)
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

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  INVENTORY_UNITS,
  isWholeCountQuantity,
  roundWholeCountQuantity,
  type InventoryUnit,
  type RecipeComponentRole,
} from '@/lib/inventory';
import type { Database } from '@/lib/supabase/schema';

export const RAW_COFFEE_ROWS = 4;
export const EXTRA_COMPONENT_ROWS = 4;
export const RAW_COFFEE_UNITS: InventoryUnit[] = ['oz', 'lb'];

export type ProductRecipeInput = {
  output_qty: number;
  waste_percent: number;
  labor_minutes: number;
  labor_rate_cents: number;
  shipping_label_qty: number;
  branding_label_qty: number;
  notes: string | null;
};

export type ProductRecipeComponentInput = {
  inventory_item_id: string;
  quantity: number;
  unit: InventoryUnit;
  component_role: RecipeComponentRole;
  sort_order: number;
  notes: string | null;
};

export type ParsedProductRecipe = {
  recipe: ProductRecipeInput;
  components: ProductRecipeComponentInput[];
};

type ProductRecipeParseResult = ({ ok: true } & ParsedProductRecipe) | { ok: false; error: string };

class RecipeValidationError extends Error {}

function nonnegativeNumber(formData: FormData, field: string, label: string, fallback = 0) {
  const value = String(formData.get(field) ?? '').trim();
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new RecipeValidationError(`${label} must be a valid number of zero or more.`);
  }
  return number;
}

export function parseProductRecipe(formData: FormData): ProductRecipeParseResult {
  try {
    const laborRateCents = nonnegativeNumber(formData, 'labor_rate', 'Labor rate') * 100;
    if (!Number.isFinite(laborRateCents)) throw new RecipeValidationError('Labor rate is too large.');

    const recipe: ProductRecipeInput = {
      output_qty: Math.max(1, nonnegativeNumber(formData, 'output_qty', 'Recipe output', 1)),
      waste_percent: nonnegativeNumber(formData, 'waste_percent', 'Waste percentage'),
      labor_minutes: nonnegativeNumber(formData, 'labor_minutes', 'Labor minutes'),
      labor_rate_cents: laborRateCents,
      shipping_label_qty: nonnegativeNumber(formData, 'shipping_label_qty', 'Shipping label quantity'),
      branding_label_qty: nonnegativeNumber(formData, 'branding_label_qty', 'Branding label quantity'),
      notes: String(formData.get('recipe_notes') ?? '').trim() || null,
    };
    const componentMap = new Map<string, ProductRecipeComponentInput>();

    function addComponent({
      itemField,
      quantityField,
      unit,
      role,
      sortOrder,
      label,
      notes,
      allowedUnits = INVENTORY_UNITS.map((inventoryUnit) => inventoryUnit.value),
      wholeCount = false,
    }: {
      itemField: string;
      quantityField: string;
      unit: string;
      role: RecipeComponentRole;
      sortOrder: number;
      label: string;
      notes: string;
      allowedUnits?: InventoryUnit[];
      wholeCount?: boolean;
    }) {
      const itemId = String(formData.get(itemField) ?? '').trim();
      let quantity = nonnegativeNumber(formData, quantityField, `${label} quantity`);
      if (!allowedUnits.includes(unit as InventoryUnit)) {
        throw new RecipeValidationError(`${label} must use ${allowedUnits.join(' or ')}.`);
      }
      if (!itemId && quantity > 0) throw new RecipeValidationError(`Choose an inventory item for ${label.toLowerCase()}.`);
      if (itemId && quantity <= 0) throw new RecipeValidationError(`Enter a quantity greater than zero for ${label.toLowerCase()}.`);
      if (!itemId) return;
      if (wholeCount) {
        if (!isWholeCountQuantity(quantity)) throw new RecipeValidationError(`${label} quantity must be a whole number.`);
        quantity = roundWholeCountQuantity(quantity);
        if (!quantity) throw new RecipeValidationError(`Enter a quantity of at least one for ${label.toLowerCase()}.`);
      }
      const key = `${role}:${itemId}:${unit}`;
      const existing = componentMap.get(key);
      const totalQuantity = (existing?.quantity ?? 0) + quantity;
      if (!Number.isFinite(totalQuantity)) throw new RecipeValidationError(`${label} quantity is too large.`);
      componentMap.set(key, {
        inventory_item_id: itemId,
        quantity: totalQuantity,
        unit: unit as InventoryUnit,
        component_role: role,
        sort_order: Math.min(existing?.sort_order ?? sortOrder, sortOrder),
        notes: notes || existing?.notes || null,
      });
    }

    for (let index = 0; index < RAW_COFFEE_ROWS; index += 1) {
      addComponent({
        itemField: `raw_coffee_item_id_${index}`,
        quantityField: `raw_coffee_qty_${index}`,
        unit: String(formData.get(`raw_coffee_unit_${index}`) ?? 'oz'),
        role: 'raw_coffee',
        sortOrder: index,
        label: `Raw coffee ${index + 1}`,
        notes: 'Raw coffee',
        allowedUnits: RAW_COFFEE_UNITS,
      });
    }

    const packaging = [
      { role: 'fraction_bag', label: 'Fraction bag', sortOrder: 10 },
      { role: 'box', label: 'Box', sortOrder: 20 },
      { role: 'filter_pack', label: 'Filter pack', sortOrder: 30 },
      { role: 'bag', label: 'Bag', sortOrder: 40 },
    ] as const;
    for (const { role, label, sortOrder } of packaging) {
      addComponent({ itemField: `${role}_item_id`, quantityField: `${role}_qty`, unit: 'each', role, sortOrder, label, notes: label, wholeCount: true });
    }

    for (let index = 0; index < EXTRA_COMPONENT_ROWS; index += 1) {
      addComponent({
        itemField: `extra_item_id_${index}`,
        quantityField: `extra_qty_${index}`,
        unit: String(formData.get(`extra_unit_${index}`) ?? 'each'),
        role: 'material_supply',
        sortOrder: 100 + index,
        label: `Extra material ${index + 1}`,
        notes: String(formData.get(`extra_note_${index}`) ?? '').trim(),
      });
    }

    return {
      ok: true,
      recipe,
      components: [...componentMap.values()].sort((a, b) => a.sort_order - b.sort_order)
        .map((component, index) => ({ ...component, sort_order: index })),
    };
  } catch (error) {
    if (error instanceof RecipeValidationError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function saveNewProductRecipe(
  supabase: SupabaseClient<Database>,
  productId: string,
  parsed: ParsedProductRecipe
): Promise<{ error: { message: string } | null }> {
  const { data: recipe, error } = await supabase.from('product_recipes')
    .insert({ product_id: productId, ...parsed.recipe })
    .select('id')
    .single();
  if (error || !recipe?.id) return { error: error ?? { message: 'The product recipe could not be saved.' } };
  if (!parsed.components.length) return { error: null };

  const { error: componentError } = await supabase.from('product_recipe_components').insert(
    parsed.components.map((component, index) => ({ ...component, recipe_id: recipe.id, sort_order: index }))
  );
  return { error: componentError };
}

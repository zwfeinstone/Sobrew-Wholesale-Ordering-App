export const INVENTORY_ITEM_TYPES = [
  { value: 'raw_coffee', label: 'Raw Coffee' },
  { value: 'material_supply', label: 'Materials & Supplies' },
  { value: 'finished_good', label: 'Finished Good' },
] as const;

export const INVENTORY_UNITS = [
  { value: 'lb', label: 'lb' },
  { value: 'oz', label: 'oz' },
  { value: 'each', label: 'each' },
  { value: 'case', label: 'case' },
] as const;

export const COMMON_SUPPLY_SKUS = [
  'SUP-5LB-BAG',
  'SUP-2LB-BAG',
  'SUP-FRACTION-BAG',
  'SUP-KCUP',
  'SUP-FILTER-BAG',
  'BOX-12X7X4',
  'BOX-12X12X10',
  'BOX-14X14X14',
  'BOX-16X16X6',
  'BOX-16X16X16',
] as const;

export const NON_STOCK_EXPENSE_TYPES = [
  { value: 'tape', label: 'Tape' },
  { value: 'shipping_label', label: 'Shipping Labels' },
  { value: 'branding_label', label: 'Branding Labels' },
  { value: 'other', label: 'Other' },
] as const;

export const INVENTORY_ADJUSTMENT_TYPES = [
  { value: 'starting_count', label: 'Starting Count' },
  { value: 'count_correction', label: 'Count Correction' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'sample', label: 'Sample' },
  { value: 'lost', label: 'Lost' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
] as const;

export const RECIPE_COMPONENT_ROLES = [
  { value: 'raw_coffee', label: 'Raw Coffee' },
  { value: 'fraction_bag', label: 'Fraction Bag' },
  { value: 'box', label: 'Box' },
  { value: 'filter_pack', label: 'Filter Packs' },
  { value: 'bag', label: 'Bag' },
  { value: 'material_supply', label: 'Extra Material or Supply' },
] as const;

export const FIXED_TAPE_COST_CENTS = 5;
export const FIXED_SHIPPING_LABEL_COST_CENTS = 2;
export const FIXED_BRANDING_LABEL_COST_CENTS = 4;

export type InventoryItemType = (typeof INVENTORY_ITEM_TYPES)[number]['value'];
export type InventoryUnit = (typeof INVENTORY_UNITS)[number]['value'];
export type NonStockExpenseType = (typeof NON_STOCK_EXPENSE_TYPES)[number]['value'];
export type InventoryAdjustmentType = (typeof INVENTORY_ADJUSTMENT_TYPES)[number]['value'];
export type RecipeComponentRole = (typeof RECIPE_COMPONENT_ROLES)[number]['value'];

export function isInventoryItemType(value: string): value is InventoryItemType {
  return INVENTORY_ITEM_TYPES.some((type) => type.value === value);
}

export function isInventoryUnit(value: string): value is InventoryUnit {
  return INVENTORY_UNITS.some((unit) => unit.value === value);
}

export function inventoryItemTypeLabel(value: string | null | undefined) {
  if (value === 'supply') return 'Materials & Supplies';
  return INVENTORY_ITEM_TYPES.find((type) => type.value === value)?.label ?? 'Inventory Item';
}

export function isNonStockExpenseType(value: string): value is NonStockExpenseType {
  return NON_STOCK_EXPENSE_TYPES.some((type) => type.value === value);
}

export function isInventoryAdjustmentType(value: string): value is InventoryAdjustmentType {
  return INVENTORY_ADJUSTMENT_TYPES.some((type) => type.value === value);
}

export function isRecipeComponentRole(value: string): value is RecipeComponentRole {
  return RECIPE_COMPONENT_ROLES.some((role) => role.value === value);
}

export function normalizeInventoryNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatInventoryQuantity(value: unknown, unit?: string | null) {
  const normalized = normalizeInventoryNumber(value);
  const formatted = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: normalized % 1 === 0 ? 0 : 2,
  }).format(normalized);
  return unit ? `${formatted} ${unit}` : formatted;
}

export function convertInventoryQuantity(quantity: number, fromUnit: string, toUnit: string) {
  if (fromUnit === toUnit) return quantity;
  if (fromUnit === 'lb' && toUnit === 'oz') return quantity * 16;
  if (fromUnit === 'oz' && toUnit === 'lb') return quantity / 16;
  throw new Error(`Cannot convert ${fromUnit} to ${toUnit}.`);
}

export function centsFromDollars(value: string) {
  const parsed = Number.parseFloat(value || '0');
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Invalid dollar amount.');
  return parsed * 100;
}

export function numericInputValue(value: unknown) {
  const normalized = normalizeInventoryNumber(value);
  return normalized ? String(Number(normalized.toFixed(4))) : '';
}

export function dollarsInputValueFromCents(value: unknown) {
  const normalized = normalizeInventoryNumber(value);
  return normalized ? String(Number((normalized / 100).toFixed(4))) : '';
}

export function laborCostCents(laborMinutes: unknown, laborRateCents: unknown) {
  const minutes = Math.max(0, normalizeInventoryNumber(laborMinutes));
  const rateCents = Math.max(0, normalizeInventoryNumber(laborRateCents));
  return (minutes / 60) * rateCents;
}

export function fixedRecipeCostCents({
  boxQty,
  shippingLabelQty,
  brandingLabelQty,
}: {
  boxQty: unknown;
  shippingLabelQty: unknown;
  brandingLabelQty: unknown;
}) {
  return (
    Math.max(0, normalizeInventoryNumber(boxQty)) * FIXED_TAPE_COST_CENTS +
    Math.max(0, normalizeInventoryNumber(shippingLabelQty)) * FIXED_SHIPPING_LABEL_COST_CENTS +
    Math.max(0, normalizeInventoryNumber(brandingLabelQty)) * FIXED_BRANDING_LABEL_COST_CENTS
  );
}

export function fixedRecipeCostBreakdownCents({
  boxQty,
  shippingLabelQty,
  brandingLabelQty,
}: {
  boxQty: unknown;
  shippingLabelQty: unknown;
  brandingLabelQty: unknown;
}) {
  const tapeCents = Math.max(0, normalizeInventoryNumber(boxQty)) * FIXED_TAPE_COST_CENTS;
  const shippingLabelCents = Math.max(0, normalizeInventoryNumber(shippingLabelQty)) * FIXED_SHIPPING_LABEL_COST_CENTS;
  const brandingLabelCents = Math.max(0, normalizeInventoryNumber(brandingLabelQty)) * FIXED_BRANDING_LABEL_COST_CENTS;

  return {
    brandingLabelCents,
    shippingLabelCents,
    tapeCents,
    totalCents: tapeCents + shippingLabelCents + brandingLabelCents,
  };
}

export function scaledRecipeCostForQuantity(costForRecipeOutputCents: number, outputQty: unknown, quantityProduced: unknown) {
  const output = normalizeInventoryNumber(outputQty) || 1;
  const produced = Math.max(0, normalizeInventoryNumber(quantityProduced));
  return (Math.max(0, costForRecipeOutputCents) / output) * produced;
}

export const INVENTORY_ITEM_TYPES = [
  { value: 'raw_coffee', label: 'Raw Coffee' },
  { value: 'supply', label: 'Supply' },
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
  'SUP-TAPE',
  'BOX-12X7X4',
  'BOX-12X12X10',
  'BOX-14X14X14',
  'BOX-16X16X16',
] as const;

export type InventoryItemType = (typeof INVENTORY_ITEM_TYPES)[number]['value'];
export type InventoryUnit = (typeof INVENTORY_UNITS)[number]['value'];

export function isInventoryItemType(value: string): value is InventoryItemType {
  return INVENTORY_ITEM_TYPES.some((type) => type.value === value);
}

export function isInventoryUnit(value: string): value is InventoryUnit {
  return INVENTORY_UNITS.some((unit) => unit.value === value);
}

export function inventoryItemTypeLabel(value: string | null | undefined) {
  return INVENTORY_ITEM_TYPES.find((type) => type.value === value)?.label ?? 'Inventory Item';
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

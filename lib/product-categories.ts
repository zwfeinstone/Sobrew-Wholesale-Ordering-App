export const PRODUCT_CATEGORY_OPTIONS = [
  { value: 'k_cups', label: 'K-Cups' },
  { value: 'fraction_packs', label: 'Fraction Packs' },
  { value: 'whole_bean', label: 'Whole Bean' },
  { value: 'filter_packs', label: 'Filter Packs' },
  { value: 'ground', label: 'Ground' },
  { value: 'retail', label: 'Retail' },
] as const;

export const UNCATEGORIZED_PRODUCT_CATEGORY = 'uncategorized';

export type ProductCategory = (typeof PRODUCT_CATEGORY_OPTIONS)[number]['value'];
export type ProductCategoryGroup = ProductCategory | typeof UNCATEGORIZED_PRODUCT_CATEGORY;

export function isProductCategory(value: string): value is ProductCategory {
  return PRODUCT_CATEGORY_OPTIONS.some((category) => category.value === value);
}

export function productCategoryGroupKey(category: string | null | undefined): ProductCategoryGroup {
  return category && isProductCategory(category) ? category : UNCATEGORIZED_PRODUCT_CATEGORY;
}

export function productCategoryLabel(category: string | null | undefined) {
  const groupKey = productCategoryGroupKey(category);
  if (groupKey === UNCATEGORIZED_PRODUCT_CATEGORY) return 'Needs category';
  return PRODUCT_CATEGORY_OPTIONS.find((option) => option.value === groupKey)?.label ?? 'Needs category';
}

export function productCategorySortRank(category: string | null | undefined) {
  const groupKey = productCategoryGroupKey(category);
  if (groupKey === UNCATEGORIZED_PRODUCT_CATEGORY) return -1;
  return PRODUCT_CATEGORY_OPTIONS.findIndex((option) => option.value === groupKey);
}

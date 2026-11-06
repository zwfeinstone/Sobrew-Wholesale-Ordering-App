import {
  PRODUCT_CATEGORY_OPTIONS,
  productCategoryGroupKey,
  productCategoryLabel,
  type ProductCategoryGroup,
} from '@/lib/product-categories';

export type CatalogProduct = {
  id?: string;
  name?: string | null;
  sku?: string | null;
  category?: string | null;
};

export const CATALOG_ROAST_OPTIONS = [
  'Medium Roast',
  'Dark Roast',
  'Espresso Roast',
  'French Roast',
  'Light Roast',
  'Decaf',
  'Other',
] as const;

type PackInfo = {
  roast: string | null;
  sizeOz: number | null;
  count: number | null;
  withFilters: boolean;
};

const nameCollator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });
const roastPatterns = [
  { label: 'Medium Roast', name: /\bmedium\b/i, sku: /(?:^|[-_])(?:MED|MEDIUM)(?:[-_]|$)/i },
  { label: 'Dark Roast', name: /\bdark\b/i, sku: /(?:^|[-_])(?:DRK|DARK)(?:[-_]|$)/i },
  { label: 'Espresso Roast', name: /\bespresso\b/i, sku: /(?:^|[-_])(?:ESP|ESPRESSO)(?:[-_]|$)/i },
  { label: 'French Roast', name: /\bfrench\b/i, sku: /(?:^|[-_])(?:FR|FRENCH)(?:[-_]|$)/i },
  { label: 'Light Roast', name: /\blight\b/i, sku: /(?:^|[-_])(?:LGT|LIGHT)(?:[-_]|$)/i },
] as const;

export function isPackCategory(category: string | null | undefined) {
  return category === 'fraction_packs' || category === 'filter_packs';
}

function roastFromName(name: string, sku: string) {
  // Decaf remains its own section even when its name also identifies a roast.
  if (/\bdecaf(?:feinated)?\b/i.test(name)) return 'Decaf';
  const named = roastPatterns.filter((pattern) => pattern.name.test(name));
  if (named.length) return named.length === 1 ? named[0].label : null;
  if (/(?:^|[-_])(?:DEC|DECAF)(?:[-_]|$)/i.test(sku)) return 'Decaf';
  const coded = roastPatterns.filter((pattern) => pattern.sku.test(sku));
  return coded.length === 1 ? coded[0].label : null;
}

function packDimensions(value: string) {
  const packs = [...value.matchAll(/(?<![\d.])(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b/gi)];
  if (packs.length === 1) {
    const count = Number(packs[0][1]);
    const sizeOz = Number(packs[0][2]);
    return {
      found: true,
      count: Number.isSafeInteger(count) && count > 0 ? count : null,
      sizeOz: Number.isFinite(sizeOz) && sizeOz > 0 ? sizeOz : null,
    };
  }
  // Multiple pack sizes may describe an assortment. Do not guess its size.
  if (packs.length > 1) return { found: true, count: null, sizeOz: null };
  const sizes = [...value.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(?:oz|ounces?)\b/gi)];
  const sizeOz = sizes.length === 1 ? Number(sizes[0][1]) : null;
  return {
    found: sizes.length > 0,
    count: null,
    sizeOz: sizeOz !== null && Number.isFinite(sizeOz) && sizeOz > 0 ? sizeOz : null,
  };
}

/** Display metadata only: product records, recipes, prices, and IDs are unchanged. */
export function getProductPackInfo(product: CatalogProduct): PackInfo {
  if (!isPackCategory(product.category)) return { roast: null, sizeOz: null, count: null, withFilters: false };
  const name = product.name?.trim() ?? '';
  const sku = product.sku?.trim() ?? '';
  const named = packDimensions(name);
  const coded = packDimensions(sku);
  const dimensions = named.found ? named : coded;
  // A size-only name can use a matching SKU's case count, but not a conflicting one.
  const count = dimensions.count ?? (named.sizeOz !== null && named.sizeOz === coded.sizeOz ? coded.count : null);
  return {
    roast: roastFromName(name, sku),
    sizeOz: dimensions.sizeOz,
    count,
    withFilters: /\b(?:with|w\s*\/)\s*filters?\b/i.test(name) || /(?:^|[-_])FILTERS(?:[-_]|$)/i.test(sku),
  };
}

function categoryRank(category: string | null | undefined) {
  const rank = PRODUCT_CATEGORY_OPTIONS.findIndex((option) => option.value === category);
  return rank === -1 ? PRODUCT_CATEGORY_OPTIONS.length : rank;
}

function roastRank(roast: string | null) {
  const rank = CATALOG_ROAST_OPTIONS.findIndex((option) => option === roast);
  return rank === -1 ? CATALOG_ROAST_OPTIONS.length : rank;
}

function compareOptionalNumber(left: number | null, right: number | null) {
  if (left === null) return right === null ? 0 : 1;
  return right === null ? -1 : left - right;
}

export function compareCatalogProducts(left: CatalogProduct, right: CatalogProduct) {
  const categoryDifference = categoryRank(left.category) - categoryRank(right.category);
  if (categoryDifference) return categoryDifference;
  if (isPackCategory(left.category) && isPackCategory(right.category)) {
    const a = getProductPackInfo(left);
    const b = getProductPackInfo(right);
    const packDifference = roastRank(a.roast) - roastRank(b.roast)
      || compareOptionalNumber(a.sizeOz, b.sizeOz)
      || compareOptionalNumber(a.count, b.count)
      || Number(a.withFilters) - Number(b.withFilters);
    if (packDifference) return packDifference;
  }
  return nameCollator.compare(left.name?.trim() || 'Unnamed product', right.name?.trim() || 'Unnamed product')
    || nameCollator.compare(left.sku ?? '', right.sku ?? '')
    || nameCollator.compare(left.id ?? '', right.id ?? '');
}

export function groupCatalogProducts<T extends CatalogProduct>(products: readonly T[]) {
  const groups: Array<{
    category: ProductCategoryGroup;
    products: T[];
    roasts: Array<{ label: string | null; products: T[] }>;
  }> = [];
  for (const product of [...products].sort(compareCatalogProducts)) {
    const category = productCategoryGroupKey(product.category);
    let group = groups[groups.length - 1];
    if (!group || group.category !== category) {
      group = { category, products: [], roasts: [] };
      groups.push(group);
    }
    group.products.push(product);
    const label = isPackCategory(category) ? getProductPackInfo(product).roast ?? 'Other' : null;
    let roast = group.roasts[group.roasts.length - 1];
    if (!roast || roast.label !== label) {
      roast = { label, products: [] };
      group.roasts.push(roast);
    }
    roast.products.push(product);
  }
  return groups;
}

export function matchesCatalogSearch(product: CatalogProduct, query: string) {
  const terms = query.trim().toLocaleLowerCase('en-US').split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = [product.name, product.sku, product.category, productCategoryLabel(product.category)]
    .filter(Boolean).join(' ').toLocaleLowerCase('en-US');
  return terms.every((term) => text.includes(term));
}

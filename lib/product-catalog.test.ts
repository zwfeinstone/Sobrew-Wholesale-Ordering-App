import { describe, expect, it } from 'vitest';
import {
  compareCatalogProducts,
  getProductPackInfo,
  groupCatalogProducts,
  matchesCatalogSearch,
  type CatalogProduct,
} from './product-catalog';

const fraction = (name: string, extra: Partial<CatalogProduct> = {}) => ({ name, category: 'fraction_packs', ...extra });

describe('catalog pack metadata', () => {
  it.each([
    'Meeting Coffee Medium Roast Fraction Pack - 100 x 1.5 oz',
    'Meeting Coffee Medium Roast Fraction Pack 100x1.5oz',
    'Meeting Coffee Medium Roast Fraction Pack 100 × 1.5 ounces',
  ])('reads case quantity and individual weight from %s', (name) => {
    expect(getProductPackInfo(fraction(name))).toEqual({ roast: 'Medium Roast', sizeOz: 1.5, count: 100, withFilters: false });
  });

  it('uses standardized SKU metadata when the display name has none', () => {
    expect(getProductPackInfo(fraction('Meeting Coffee', { sku: 'MTC-FP-DRK-72X2OZ' })))
      .toEqual({ roast: 'Dark Roast', sizeOz: 2, count: 72, withFilters: false });
  });

  it('prefers explicit display metadata to a conflicting SKU', () => {
    expect(getProductPackInfo(fraction('Medium Roast 100 x 1.5 oz', { sku: 'MTC-FP-DRK-72X2OZ' })))
      .toMatchObject({ roast: 'Medium Roast', sizeOz: 1.5, count: 100 });
  });

  it('keeps a known individual size without inventing a case count', () => {
    expect(getProductPackInfo(fraction('Dark Roast 2 oz'))).toMatchObject({ sizeOz: 2, count: null });
    expect(getProductPackInfo(fraction('Dark Roast 2 oz', { sku: 'MTC-FP-DRK-72X2OZ' })))
      .toMatchObject({ sizeOz: 2, count: 72 });
    expect(getProductPackInfo(fraction('Dark Roast 2 oz', { sku: 'MTC-FP-DRK-100X1.5OZ' })))
      .toMatchObject({ sizeOz: 2, count: null });
  });

  it('separates decaf, French, and espresso from dark roast', () => {
    expect(getProductPackInfo(fraction('Decaf Dark Roast 100 x 1.25 oz')).roast).toBe('Decaf');
    expect(getProductPackInfo(fraction('French Roast 96 x 2 oz')).roast).toBe('French Roast');
    expect(getProductPackInfo(fraction('Espresso Roast 96 x 2 oz')).roast).toBe('Espresso Roast');
    expect(getProductPackInfo(fraction('Coffee', { sku: 'MTC-FP-DEC-100X1.25OZ' })).roast).toBe('Decaf');
  });

  it('does not guess the roast or size of assortments', () => {
    const info = getProductPackInfo(fraction('Medium and Dark Roast 40 x 2 oz + 20 x 3 oz', { sku: 'MTC-FP-MED-40X2OZ' }));
    expect(info).toMatchObject({ roast: null, sizeOz: null, count: null });
  });

  it('distinguishes included filters from the Filter Pack category', () => {
    expect(getProductPackInfo(fraction('Medium Roast 100x1.5oz with Filters')).withFilters).toBe(true);
    expect(getProductPackInfo(fraction('Medium Roast 100x1.5oz w/ Filters')).withFilters).toBe(true);
    expect(getProductPackInfo(fraction('Coffee', { sku: 'MTC-FP-MED-100X1.5OZ-FILTERS' })).withFilters).toBe(true);
    expect(getProductPackInfo({ name: 'Medium Roast Filter Pack - 40 x 2 oz', category: 'filter_packs' }).withFilters).toBe(false);
  });

  it('does not infer pack metadata for unrelated categories or missing names', () => {
    expect(getProductPackInfo({ name: 'Dark Roast 12 oz', category: 'retail' }))
      .toEqual({ roast: null, sizeOz: null, count: null, withFilters: false });
    expect(getProductPackInfo({ name: null, category: 'fraction_packs' }))
      .toEqual({ roast: null, sizeOz: null, count: null, withFilters: false });
  });
});

describe('catalog grouping and sorting', () => {
  it('sorts by roast, then individual weight, then case count, then filter variant', () => {
    const rows = [
      fraction('Dark Roast 40 x 3 oz', { id: 'dark-3' }),
      fraction('Dark Roast 100 x 1.5 oz with Filters', { id: 'dark-1.5-filters' }),
      fraction('Dark Roast 96 x 2 oz', { id: 'dark-2-96' }),
      fraction('Medium Roast 100 x 2.5 oz', { id: 'medium-2.5' }),
      fraction('Dark Roast 100 x 1.5 oz', { id: 'dark-1.5-100' }),
      fraction('Dark Roast 72 x 2 oz', { id: 'dark-2-72' }),
      fraction('Dark Roast 72 x 1.5 oz', { id: 'dark-1.5-72' }),
    ];
    expect([...rows].sort(compareCatalogProducts).map((row) => row.id)).toEqual([
      'medium-2.5', 'dark-1.5-72', 'dark-1.5-100', 'dark-1.5-filters', 'dark-2-72', 'dark-2-96', 'dark-3',
    ]);
  });

  it('keeps incomplete metadata visible after known sizes and roasts', () => {
    const rows = [
      fraction('House Blend 40 x 1 oz', { id: 'unknown-roast' }),
      fraction('Dark Roast', { id: 'unknown-size' }),
      fraction('Dark Roast 2 oz', { id: 'unknown-count' }),
      fraction('Dark Roast 40 x 2 oz', { id: 'known' }),
    ];
    expect([...rows].sort(compareCatalogProducts).map((row) => row.id)).toEqual(['known', 'unknown-count', 'unknown-size', 'unknown-roast']);
  });

  it('preserves all product objects while grouping both pack categories consistently', () => {
    const rows = [
      { id: 'tea', name: 'Breakfast Tea', category: 'tea', price: 100 },
      { id: 'filter-dark', name: 'Dark Roast Filter Pack 40 x 2 oz', category: 'filter_packs', price: 200 },
      { id: 'fraction', name: 'Medium Roast 100 x 1.5 oz', category: 'fraction_packs', price: 300 },
      { id: 'filter-medium', name: 'Medium Roast Filter Pack 40 x 1.4 oz', category: 'filter_packs', price: 400 },
      { id: 'unknown', name: 'House Blend', category: 'fraction_packs', price: 500 },
      { id: 'uncategorized', name: 'A custom product', category: null, price: 600 },
    ];
    const originalOrder = [...rows];
    const groups = groupCatalogProducts(rows);
    expect(groups.map((group) => group.category)).toEqual(['fraction_packs', 'filter_packs', 'tea', 'uncategorized']);
    expect(groups[0].roasts.map((roast) => roast.label)).toEqual(['Medium Roast', 'Other']);
    expect(groups[1].roasts.map((roast) => roast.label)).toEqual(['Medium Roast', 'Dark Roast']);
    expect(groups[2].roasts[0].label).toBeNull();
    expect(groups.flatMap((group) => group.products)).toHaveLength(rows.length);
    expect(groups[0].products[0]).toBe(rows[2]);
    expect(rows).toEqual(originalOrder);
  });

  it('retains natural name ordering for products outside pack categories', () => {
    const rows = [{ name: 'Tea 10', category: 'tea' }, { name: 'Tea 2', category: 'tea' }];
    expect(groupCatalogProducts(rows)[0].products.map((row) => row.name)).toEqual(['Tea 2', 'Tea 10']);
    expect(groupCatalogProducts([])).toEqual([]);
  });
});

describe('catalog search', () => {
  const product = fraction('Meeting Coffee Dark Roast - 100 x 1.5 oz', { sku: 'MTC-FP-DRK-100X1.5OZ' });

  it('matches independent words across product name, SKU, and category', () => {
    expect(matchesCatalogSearch(product, '  DARK   1.5  ')).toBe(true);
    expect(matchesCatalogSearch(product, 'fraction drk')).toBe(true);
    expect(matchesCatalogSearch(product, 'medium 1.5')).toBe(false);
    expect(matchesCatalogSearch(product, 'dark 3 oz')).toBe(false);
  });

  it('accepts an empty query and tolerates missing fields', () => {
    expect(matchesCatalogSearch({}, '   ')).toBe(true);
    expect(matchesCatalogSearch({}, 'dark')).toBe(false);
  });
});

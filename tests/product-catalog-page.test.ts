import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  requireView: vi.fn(async () => ({})),
}));

vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.requireView }));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/quickbooks', () => ({
  getQuickBooksConnectionStatus: async () => ({ connected: true }),
  createMissingQuickBooksProductsFromPortal: vi.fn(),
  QuickBooksConfigurationError: class extends Error {},
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/status-toast', () => ({ default: () => null }));

import ProductsPage from '@/app/admin/products/page';

function product(id: string, name: string, category = 'fraction_packs', sku = id) {
  return {
    id: `product-${id}`, name, category, sku, active: true,
    quickbooks_item_id: null, quickbooks_sync_error: null, quickbooks_sync_status: null,
  };
}

// Deliberately shuffled, with enough rows to exercise more than one data page.
const products = [
  product('dark-3', 'Meeting Coffee Dark Roast Fraction Pack - 40 x 3 oz'),
  product('tea', 'Breakfast Tea', 'tea'),
  product('dark-1.5-100-filters', 'Meeting Coffee Dark Roast Fraction Pack 100x1.5oz with Filters'),
  product('filter-dark', 'Meeting Coffee Dark Roast Filter Pack - 40 x 2 oz', 'filter_packs'),
  product('medium-2.5', 'Meeting Coffee Medium Roast Fraction Pack - 100 x 2.5 oz'),
  product('dark-2-96', 'Meeting Coffee Dark Roast Fraction Pack - 96 x 2 oz'),
  product('unknown', 'House Blend Fraction Pack - 40 x 2 oz'),
  product('filter-medium-2', 'Meeting Coffee Medium Roast Filter Pack - 40 x 2 oz', 'filter_packs'),
  product('dark-1.5-100', 'Meeting Coffee Dark Roast Fraction Pack - 100 x 1.5 oz', 'fraction_packs', 'MTC-FP-DRK-100X1.5OZ'),
  product('medium-1.5', 'Meeting Coffee Medium Roast Fraction Pack - 100 x 1.5 oz'),
  product('dark-2-72', 'Meeting Coffee Dark Roast Fraction Pack - 72 x 2 oz'),
  product('filter-medium-1.4', 'Meeting Coffee Medium Roast Filter Pack - 40 x 1.4 oz', 'filter_packs'),
  product('dark-1.5-72', 'Meeting Coffee Dark Roast Fraction Pack - 72 x 1.5 oz'),
];

const allProductIds = [
  'medium-1.5', 'medium-2.5',
  'dark-1.5-72', 'dark-1.5-100', 'dark-1.5-100-filters', 'dark-2-72', 'dark-2-96', 'dark-3',
  'unknown', 'filter-medium-1.4', 'filter-medium-2', 'filter-dark', 'tea',
];

async function render(params: Record<string, string | string[]> = {}) {
  return renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve(params) }));
}

function productLinks(markup: string) {
  return [...markup.matchAll(/href="\/admin\/products\/product-([^"?]+)"/g)].map((match) => match[1]);
}

function links(markup: string) {
  return [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
}

beforeEach(() => {
  state.requireView.mockClear();
  state.client = supabaseReadStub({ tables: { products }, maxRows: 3 }).client;
});

describe('products catalog page', () => {
  it('renders the complete catalog grouped by category and roast, with pack weights before case counts', async () => {
    const markup = await render();
    expect(state.requireView).toHaveBeenCalledWith('products');
    expect(productLinks(markup)).toEqual(allProductIds);
    const sections = [...markup.matchAll(/<section\b[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
    expect(sections).toEqual([
      'Fraction Packs · Medium Roast', 'Fraction Packs · Dark Roast', 'Fraction Packs · Other',
      'Filter Packs · Medium Roast', 'Filter Packs · Dark Roast', 'Tea',
    ]);
    expect(markup).toContain('100 packs / case');
    expect(markup).toContain('1.5 oz / pack');
    expect(markup).toContain('With filters');
  });

  it('combines category, roast, and multiword search filters without losing product edit links', async () => {
    const markup = await render({ category: 'fraction_packs', roast: 'Dark Roast', q: 'dark 1.5' });
    expect(productLinks(markup)).toEqual(['dark-1.5-72', 'dark-1.5-100', 'dark-1.5-100-filters']);
    expect(links(markup)).toContain('/admin/products?category=filter_packs&q=dark+1.5&roast=Dark+Roast');
    expect(links(markup)).toContain('/admin/products?category=tea&q=dark+1.5');
    expect(links(markup)).toContain('/admin/products?category=fraction_packs');
    const returnValues = [...markup.matchAll(/name="return_to" value="([^"]+)"/g)].map((match) => match[1].replaceAll('&amp;', '&'));
    expect(returnValues).toEqual([
      '/admin/products?category=fraction_packs&q=dark+1.5&roast=Dark+Roast',
      '/admin/products?category=fraction_packs&q=dark+1.5&roast=Dark+Roast',
    ]);
  });

  it('can find a product by its SKU', async () => {
    expect(productLinks(await render({ q: 'MTC-FP-DRK-100X1.5OZ' }))).toEqual(['dark-1.5-100']);
  });

  it('limits Other to pack products with an unknown roast', async () => {
    expect(productLinks(await render({ roast: 'Other' }))).toEqual(['unknown']);
  });

  it('applies roast across pack categories and clears it for non-pack categories', async () => {
    expect(productLinks(await render({ roast: 'Dark Roast' }))).toEqual([
      'dark-1.5-72', 'dark-1.5-100', 'dark-1.5-100-filters', 'dark-2-72', 'dark-2-96', 'dark-3', 'filter-dark',
    ]);
    const teaMarkup = await render({ category: 'tea', roast: 'Dark Roast' });
    expect(productLinks(teaMarkup)).toEqual(['tea']);
    expect(teaMarkup).not.toMatch(/<select\b[^>]*name="roast"/);
  });

  it('falls back to the full catalog for unsupported filters and offers recovery for an empty search', async () => {
    expect(productLinks(await render({ category: 'unknown-category', roast: 'unknown-roast' }))).toEqual(allProductIds);
    const empty = await render({ category: 'filter_packs', q: 'missing-product' });
    expect(productLinks(empty)).toEqual([]);
    expect(empty).toContain('No products match these filters.');
    expect(links(empty)).toContain('/admin/products');
  });

  it('places catalog management after the products and keeps it collapsed by default', async () => {
    const markup = await render();
    const details = [...markup.matchAll(/<details\b([^>]*)>/g)];
    const management = details.at(-1);
    expect(management).toBeDefined();
    expect(management![1]).not.toMatch(/\bopen(?:=|\s|$)/);
    expect(management!.index).toBeGreaterThan(markup.indexOf('href="/admin/products/product-tea"'));
    expect(markup.slice(management!.index)).toMatch(/<summary\b[^>]*>Catalog management/);
  });
});

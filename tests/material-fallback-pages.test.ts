import { Children, createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductionPlanningData } from '@/lib/production-planning-data';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  failTable: '',
  lotRowCap: Infinity,
  failLotFrom: Infinity,
  lotReads: [] as Array<{ from: number; ids: unknown[]; positiveOnly: boolean }>,
  operations: [] as Array<{ table: string; action: string }>,
  from: vi.fn(),
  requireWrite: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: async () => ({ isOwner: true }), requireAdminSectionEdit: vi.fn() }));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.requireWrite }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: state.from }) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/quickbooks', () => ({ createMissingQuickBooksProductsFromPortal: vi.fn() }));
vi.mock('@/lib/product-create', () => ({ syncSavedProductToQuickBooks: vi.fn() }));
vi.mock('@/lib/inventory-production', () => ({ recordRecipeProductionRun: vi.fn() }));
vi.mock('@/app/admin/planning/actions', () => ({ producePlannedInventory: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT FOUND'); },
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
}));

import ProductPage from '@/app/admin/products/[id]/page';
import ProductionPage from '@/app/admin/production/page';
import ProductionPlanningWorkspace from '@/app/admin/planning/workspace';
import { buildProductionPlan } from '@/lib/production-planning';
import { planningView } from '@/lib/production-planning-view';

const roll = { id: 'roll', name: 'Roll Stock Fraction Pack Bag', sku: 'MAT-ROLL', item_type: 'material_supply', base_unit: 'each' as const, active: true, product_id: null };
const old = { ...roll, id: 'old', name: 'Fraction Pack Bag', sku: 'MAT-OLD' };
const product = { id: 'coffee', name: 'Coffee Fraction Packs', sku: 'FR-COFFEE', category: 'fraction_packs', active: true, quickbooks_item_id: '1' };
const fallback = { product_id: product.id, primary_inventory_item_id: roll.id, fallback_inventory_item_id: old.id };
const recipe = {
  id: 'recipe', product_id: product.id, output_qty: 1, waste_percent: 5,
  labor_minutes: 180, labor_rate_cents: 1500, shipping_label_qty: 0, branding_label_qty: 0,
  product_recipe_components: [{ id: 'bag-component', inventory_item_id: roll.id, quantity: 100, unit: 'each' as const, component_role: 'fraction_bag', sort_order: 10, notes: 'Fraction bag', inventory_items: roll }],
};

function clean(markup: string) { return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

function recipeAction(node: ReactNode): ((form: FormData) => Promise<void>) | undefined {
  if (Array.isArray(node)) return node.map(recipeAction).find(Boolean);
  if (!isValidElement<{ children?: ReactNode; action?: (form: FormData) => Promise<void> }>(node)) return undefined;
  if (node.type === 'form' && node.props.action?.name === 'saveRecipe') return node.props.action;
  return Children.toArray(node.props.children).map(recipeAction).find(Boolean);
}

beforeEach(() => {
  state.failTable = '';
  state.lotRowCap = Infinity;
  state.failLotFrom = Infinity;
  state.lotReads = [];
  state.operations = [];
  state.requireWrite.mockClear();
  state.tables = {
    products: [product], product_recipes: [recipe], inventory_items: [roll, old], product_material_fallbacks: [fallback],
    inventory_lots: [
      { id: 'roll-lot', inventory_item_id: roll.id, quantity_remaining: 60, unit_cost_cents: 6 },
      { id: 'old-lot', inventory_item_id: old.id, quantity_remaining: 50, unit_cost_cents: 12 },
    ],
  };
  state.from.mockImplementation((table: string) => {
    let single = false;
    let action = 'select';
    let first = 0;
    let last = Infinity;
    let itemIds: unknown[] = [];
    let positiveOnly = false;
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return query; },
      neq: (column: string, value: unknown) => { filters.push((row) => row[column] !== value); return query; },
      gt: (column: string, value: number) => {
        if (column === 'quantity_remaining' && value === 0) positiveOnly = true;
        filters.push((row) => Number(row[column]) > value); return query;
      },
      in: (column: string, values: unknown[]) => {
        if (column === 'inventory_item_id') itemIds = values;
        filters.push((row) => values.includes(row[column])); return query;
      },
      order: () => query,
      limit: () => query,
      range: (from: number, to: number) => { first = from; last = to; return query; },
      single: () => { single = true; return query; },
      maybeSingle: () => { single = true; return query; },
      upsert: () => { action = 'upsert'; return query; },
      delete: () => { action = 'delete'; return query; },
      insert: () => { action = 'insert'; return query; },
      then: (resolve: (result: unknown) => unknown) => {
        state.operations.push({ table, action });
        if (table === 'inventory_lots') state.lotReads.push({ from: first, ids: itemIds, positiveOnly });
        const rowCap = table === 'inventory_lots' ? state.lotRowCap : Infinity;
        const rows = (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row))).slice(first, Math.min(last + 1, first + rowCap));
        return Promise.resolve(state.failTable === table || (table === 'inventory_lots' && first >= state.failLotFrom)
          ? { data: null, error: { message: 'Unavailable' } }
          : { data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
      },
    };
    return query;
  });
});

async function productionMarkup() {
  return renderToStaticMarkup(await ProductionPage({ searchParams: Promise.resolve({ produce_product: product.id, produce_qty: '1' }) }));
}

describe('packaging fallback screens', () => {
  it('costs every positive material lot across capped pages, excluding deficits and unrelated stock', async () => {
    state.lotRowCap = 1;
    state.tables.inventory_lots = [
      { id: 'unrelated', inventory_item_id: 'finished-product', quantity_remaining: 10000, unit_cost_cents: 100 },
      { id: 'roll-deficit', inventory_item_id: roll.id, quantity_remaining: -1000, unit_cost_cents: 900 },
      { id: 'roll-first', inventory_item_id: roll.id, quantity_remaining: 30, unit_cost_cents: 6 },
      { id: 'roll-next', inventory_item_id: roll.id, quantity_remaining: 30, unit_cost_cents: 10 },
      { id: 'old-stock', inventory_item_id: old.id, quantity_remaining: 50, unit_cost_cents: 12 },
    ];
    const text = clean(renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ id: product.id }) })));
    expect(text).toContain('Estimated unit COGS $54.60 Materials $9.60 - Fixed $0.00 - Labor $45.00');
    expect(state.lotReads.map((read) => read.from)).toEqual([0, 1, 2, 3]);
    expect(state.lotReads.every((read) => read.positiveOnly && read.ids.length === 2 && read.ids.includes(roll.id) && read.ids.includes(old.id))).toBe(true);
  });

  it('withholds product COGS when a later material-lot page fails', async () => {
    state.lotRowCap = 1;
    state.failLotFrom = 1;
    const text = clean(renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ id: product.id }) })));
    expect(text).toContain('Estimated unit COGS Material estimate unavailable.');
    expect(text).not.toContain(' - Fixed ');
    expect(state.lotReads.map((read) => read.from)).toEqual([0, 1]);
  });

  it.each([
    { primaryStock: 100, materialCost: '$3.49', totalCost: '$48.49' },
    { primaryStock: 60, materialCost: '$6.89', totalCost: '$51.89' },
    { primaryStock: 0, materialCost: '$12.00', totalCost: '$57.00' },
  ])('costs the product recipe using $primaryStock primary bags and the fallback for the rest', async ({ primaryStock, materialCost, totalCost }) => {
    state.tables.inventory_lots[0].quantity_remaining = primaryStock;
    state.tables.inventory_lots[0].unit_cost_cents = 3.49;
    state.tables.inventory_lots[1].quantity_remaining = 100;
    const text = clean(renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ id: product.id }) })));
    expect(text).toContain(`Estimated unit COGS ${totalCost} Materials ${materialCost} - Fixed $0.00 - Labor $45.00`);
  });

  it.each(['product_material_fallbacks', 'inventory_items', 'inventory_lots'])('does not show a product COGS estimate when %s cannot be loaded', async (table) => {
    state.failTable = table;
    const text = clean(renderToStaticMarkup(await ProductPage({ params: Promise.resolve({ id: product.id }) })));
    expect(text).toContain('Estimated unit COGS Material estimate unavailable.');
    expect(text).not.toContain(' - Fixed ');
  });

  it('shows the mixed allocation while keeping one total actual-use input', async () => {
    const markup = await productionMarkup();
    const text = clean(markup);
    expect(text).toContain('Materials cover the expected run.');
    expect(text).toContain('Roll Stock Fraction Pack Bag (MAT-ROLL) Need 60 each · On hand 60 each');
    expect(text).toContain('Fraction Pack Bag (MAT-OLD) Need 40 each · On hand 50 each');
    expect(markup).toMatch(/name="actual_bag-component"[^>]*value="100"/);
    expect(markup).not.toContain('name="actual_old"');
    expect(text).toContain('Enter total actual usage below');
  });

  it('shows a shortage only for the remaining fallback demand', async () => {
    state.tables.inventory_lots[1].quantity_remaining = 20;
    const text = clean(await productionMarkup());
    expect(text).toContain('Materials are short for this run.');
    expect(text).toContain('Fraction Pack Bag (MAT-OLD) Need 40 each · On hand 20 each · Short 20 each');
    expect(text).not.toContain('Short 40 each');
  });

  it('uses the same positive consumable lots as the production action', async () => {
    state.tables.inventory_lots.push({ id: 'historical-deficit', inventory_item_id: roll.id, quantity_remaining: -60, unit_cost_cents: 6 });
    const text = clean(await productionMarkup());
    expect(text).toContain('Materials cover the expected run.');
    expect(text).toContain('Roll Stock Fraction Pack Bag (MAT-ROLL) Need 60 each · On hand 60 each');
  });

  it('does not present a primary-only estimate when the saved rule cannot be read', async () => {
    state.failTable = 'product_material_fallbacks';
    const markup = await productionMarkup();
    expect(clean(markup)).toContain('Material estimate unavailable.');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Record production run<\/button>/);
    expect(clean(markup)).not.toContain('Materials cover the expected run.');
  });

  it('keeps product fallback rules intact when normal recipe saving replaces component rows', async () => {
    const page = await ProductPage({ params: Promise.resolve({ id: product.id }) });
    const markup = clean(renderToStaticMarkup(page));
    expect(markup).toContain('Use Roll Stock Fraction Pack Bag first, then Fraction Pack Bag');
    const action = recipeAction(page);
    expect(action).toBeDefined();
    const form = new FormData();
    for (const [key, value] of Object.entries({ product_id: product.id, output_qty: '1', fraction_bag_item_id: roll.id, fraction_bag_qty: '100' })) form.set(key, value);
    await expect(action!(form)).rejects.toThrow('REDIRECT /admin/products/coffee?toast=recipe_saved');
    expect(state.operations).toContainEqual({ table: 'product_recipe_components', action: 'delete' });
    expect(state.operations).toContainEqual({ table: 'product_recipe_components', action: 'insert' });
    expect(state.operations.filter((operation) => operation.table === 'product_material_fallbacks')).toEqual([{ table: 'product_material_fallbacks', action: 'select' }]);
    expect(state.tables.product_material_fallbacks).toEqual([fallback]);
  });

  it('passes fallback rules and stock into the planning completion form', () => {
    const data: ProductionPlanningData = {
      input: { now: '2026-10-12T16:00:00Z', products: [product], stockByProductId: {}, schedules: [], pars: [], orders: [{ id: 'order', status: 'New', created_at: '2026-10-12T15:00:00Z', order_items: [{ product_id: product.id, qty: 1 }] }] },
      items: [roll, old], recipes: [{ ...recipe, material_fallbacks: [fallback] }], centers: [], parLevels: [],
      onHandByItemId: { roll: 60, old: 50 }, materialStockByItemId: { roll: 60, old: 50 },
    };
    const markup = renderToStaticMarkup(createElement(ProductionPlanningWorkspace, { data, plan: buildProductionPlan(data.input), view: planningView({}), canEdit: true, returnTo: '/admin/planning' }));
    const form = [...markup.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([html]) => html).find((html) => html.includes('name="quantity_produced"'));
    expect(form).toBeDefined();
    expect(clean(form!)).toContain('Material estimate covered for this quantity');
    expect(clean(form!)).toContain('Fraction Pack Bag Need 40 each · On hand 50 each');
  });
});

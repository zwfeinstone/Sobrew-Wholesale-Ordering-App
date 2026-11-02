import { describe, expect, it } from 'vitest';
import { recordRecipeProductionRun } from '@/lib/inventory-production';
import { buildProductionMaterialPreview, type ProductionMaterialComponent, type ProductionMaterialRecipe } from '@/lib/production-materials';

const PRODUCT_ID = 'sample-product-1';
const OLD_BOX_ID = 'box-12x7x4';
const NEW_BOX_ID = 'box-12x6x4';

type TableName = 'inventory_items' | 'inventory_lots' | 'product_recipes' | 'products' | 'product_material_fallbacks';
type Row = Record<string, any>;

class Query {
  private filters: Array<{ column: string; op: 'eq' | 'gt' | 'in'; value: any }> = [];

  constructor(private database: FakeSupabase, private table: TableName) {}

  eq(column: string, value: any) {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  gt(column: string, value: any) {
    this.filters.push({ column, op: 'gt', value });
    return this;
  }

  in(column: string, value: any[]) {
    this.filters.push({ column, op: 'in', value });
    return this;
  }

  maybeSingle() {
    return this.execute().then((result) => ({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error,
    }));
  }

  select() {
    return this;
  }

  single() {
    return this.execute().then((result) => ({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error,
    }));
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute() {
    const error = this.database.errors[this.table];
    return { data: error ? null : this.database.tables[this.table].filter((row) => this.matches(row)), error: error ? { message: error } : null };
  }

  private matches(row: Row) {
    return this.filters.every((filter) => {
      if (filter.op === 'eq') return row[filter.column] === filter.value;
      if (filter.op === 'gt') return Number(row[filter.column] ?? 0) > Number(filter.value);
      return filter.value.includes(row[filter.column]);
    });
  }
}

class FakeSupabase {
  errors: Partial<Record<TableName, string>> = {};
  rpcCalls: Array<{ args: Record<string, unknown>; fn: string }> = [];
  tables: Record<TableName, Row[]> = {
    inventory_items: [
      { active: true, base_unit: 'each', id: NEW_BOX_ID, sku: 'MAT-BOX-12X6X4' },
    ],
    inventory_lots: [],
    product_recipes: [],
    product_material_fallbacks: [],
    products: [{ category: 'sample_boxes', id: PRODUCT_ID }],
  };

  constructor(seed: Partial<Record<TableName, Row[]>> = {}) {
    this.tables = { ...this.tables, ...seed };
  }

  from(table: string) {
    return new Query(this, table as TableName);
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ args, fn });
    return { data: 'run-1', error: null };
  }
}

function sampleBoxRecipe() {
  return {
    branding_label_qty: 0,
    id: 'recipe-1',
    labor_minutes: 0,
    labor_rate_cents: 0,
    output_qty: 1,
    product_id: PRODUCT_ID,
    product_recipe_components: [
      {
        component_role: 'box',
        id: 'component-box',
        inventory_item_id: OLD_BOX_ID,
        inventory_items: { base_unit: 'each', id: OLD_BOX_ID, sku: 'MAT-BOX-12X7X4' },
        quantity: 1,
        unit: 'each',
      },
    ],
    shipping_label_qty: 0,
    waste_percent: 0,
  };
}

function productionComponents(supabase: FakeSupabase) {
  return supabase.rpcCalls[0]?.args.p_components as Array<{
    inventory_item_id: string;
    quantity_expected: number;
    quantity_used: number;
    unit: string;
  }>;
}

describe('recordRecipeProductionRun sample box fallback boxes', () => {
  it('uses the 12x6x4 box when 12x7x4 stock is gone', async () => {
    const supabase = new FakeSupabase({
      inventory_lots: [
        { inventory_item_id: NEW_BOX_ID, quantity_remaining: 5, unit_cost_cents: 30 },
      ],
      product_recipes: [sampleBoxRecipe()],
    });

    const result = await recordRecipeProductionRun({
      productId: PRODUCT_ID,
      quantityProduced: 2,
      supabase,
    });

    expect(result.error).toBeNull();
    expect(productionComponents(supabase)).toEqual([
      { inventory_item_id: NEW_BOX_ID, quantity_expected: 2, quantity_used: 2, unit: 'each' },
    ]);
  });

  it('uses remaining 12x7x4 boxes before switching the rest to 12x6x4', async () => {
    const supabase = new FakeSupabase({
      inventory_lots: [
        { inventory_item_id: OLD_BOX_ID, quantity_remaining: 1, unit_cost_cents: 40 },
        { inventory_item_id: NEW_BOX_ID, quantity_remaining: 5, unit_cost_cents: 30 },
      ],
      product_recipes: [sampleBoxRecipe()],
    });

    const result = await recordRecipeProductionRun({
      productId: PRODUCT_ID,
      quantityProduced: 3,
      supabase,
    });

    expect(result.error).toBeNull();
    expect(productionComponents(supabase)).toEqual([
      { inventory_item_id: OLD_BOX_ID, quantity_expected: 1, quantity_used: 1, unit: 'each' },
      { inventory_item_id: NEW_BOX_ID, quantity_expected: 2, quantity_used: 2, unit: 'each' },
    ]);
  });

  it('leaves non-sample recipes on the configured 12x7x4 box', async () => {
    const supabase = new FakeSupabase({
      inventory_lots: [
        { inventory_item_id: NEW_BOX_ID, quantity_remaining: 5, unit_cost_cents: 30 },
      ],
      product_recipes: [sampleBoxRecipe()],
      products: [{ category: 'retail', id: PRODUCT_ID }],
    });

    const result = await recordRecipeProductionRun({
      productId: PRODUCT_ID,
      quantityProduced: 2,
      supabase,
    });

    expect(result.error).toBeNull();
    expect(productionComponents(supabase)).toEqual([
      { inventory_item_id: OLD_BOX_ID, quantity_expected: 2, quantity_used: 2, unit: 'each' },
    ]);
  });
});

describe('recordRecipeProductionRun explicit material fallback loading', () => {
  function bagDatabase(primary = 40, fallbackActive = true) {
    return new FakeSupabase({
      products: [{ id: PRODUCT_ID, category: 'fraction_packs' }],
      product_recipes: [{ ...sampleBoxRecipe(), product_recipe_components: [
        { id: 'bags', component_role: 'fraction_bag', inventory_item_id: 'roll', inventory_items: { id: 'roll', base_unit: 'each', sku: 'MAT-BAG-FRAC-ROLL', active: true, item_type: 'material_supply' }, quantity: 100, unit: 'each' },
      ] }],
      product_material_fallbacks: [
        { product_id: PRODUCT_ID, primary_inventory_item_id: 'roll', fallback_inventory_item_id: 'regular' },
        { product_id: 'another-product', primary_inventory_item_id: 'roll', fallback_inventory_item_id: 'six-oz' },
      ],
      inventory_items: [
        { id: 'regular', base_unit: 'each', active: fallbackActive, item_type: 'material_supply' },
        { id: 'six-oz', base_unit: 'each', active: true, item_type: 'material_supply' },
      ],
      inventory_lots: [
        { inventory_item_id: 'roll', quantity_remaining: primary, unit_cost_cents: 6 },
        { inventory_item_id: 'regular', quantity_remaining: 200, unit_cost_cents: 12 },
        { inventory_item_id: 'six-oz', quantity_remaining: 200, unit_cost_cents: 15 },
      ],
    });
  }

  it.each([
    { primary: 100, expected: [['roll', 100]], cost: 600 },
    { primary: 40, expected: [['roll', 40], ['regular', 60]], cost: 960 },
    { primary: 0, expected: [['regular', 100]], cost: 1200 },
  ])('loads the designated bag and its cost with $primary primary bags', async ({ primary, expected, cost }) => {
    const supabase = bagDatabase(primary);
    expect(await recordRecipeProductionRun({ productId: PRODUCT_ID, quantityProduced: 1, supabase })).toEqual({ error: null });
    expect(productionComponents(supabase).map((line) => [line.inventory_item_id, line.quantity_used])).toEqual(expected);
    expect(supabase.rpcCalls[0].args.p_estimated_unit_cost_cents).toBe(cost);
  });

  it.each([0, 100])('rejects an inactive configured fallback with %d primary bags instead of submitting a run', async (primary) => {
    const supabase = bagDatabase(primary, false);
    expect(await recordRecipeProductionRun({ productId: PRODUCT_ID, quantityProduced: 1, supabase })).toEqual({ error: 'recipe_error' });
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it.each(['product_material_fallbacks', 'inventory_items'] as const)('does not silently omit configured fallbacks when %s fails', async (table) => {
    const supabase = bagDatabase();
    supabase.errors[table] = 'Fallback unavailable';
    expect(await recordRecipeProductionRun({ productId: PRODUCT_ID, quantityProduced: 1, supabase })).toEqual({ error: 'recipe_error' });
    expect(supabase.rpcCalls).toHaveLength(0);
  });
});

describe('recordRecipeProductionRun shared material calculations', () => {
  it('records the same converted and rounded quantities as its planning preview', async () => {
    const recipe: ProductionMaterialRecipe & Record<string, unknown> = {
      ...sampleBoxRecipe(),
      output_qty: 2,
      waste_percent: 10,
      product_recipe_components: [
        ...(sampleBoxRecipe().product_recipe_components as ProductionMaterialComponent[]),
        { id: 'coffee-component', inventory_item_id: 'coffee', inventory_items: { id: 'coffee', base_unit: 'lb' }, quantity: 12, unit: 'oz', component_role: 'raw_coffee' },
      ],
    };
    const supabase = new FakeSupabase({
      inventory_lots: [{ inventory_item_id: NEW_BOX_ID, quantity_remaining: 5, unit_cost_cents: 30 }, { inventory_item_id: 'coffee', quantity_remaining: 5, unit_cost_cents: 100 }],
      product_recipes: [recipe],
    });
    const preview = buildProductionMaterialPreview({
      recipe,
      productCategory: 'sample_boxes',
      quantity: 2,
      onHandByItemId: new Map([[NEW_BOX_ID, 5], ['coffee', 5]]),
      fallbackItems: [{ id: NEW_BOX_ID, base_unit: 'each', active: true, sku: 'MAT-BOX-12X6X4' }],
    });
    expect((await recordRecipeProductionRun({ productId: PRODUCT_ID, quantityProduced: 2, supabase })).error).toBeNull();
    expect(productionComponents(supabase)).toEqual(preview.components);
    expect(productionComponents(supabase)[1].quantity_used).toBeCloseTo(0.825);
  });

  it('does not record production when its material inventory could not be loaded', async () => {
    const supabase = new FakeSupabase({ product_recipes: [sampleBoxRecipe()] });
    supabase.errors.inventory_lots = 'Inventory unavailable';
    expect(await recordRecipeProductionRun({ productId: PRODUCT_ID, quantityProduced: 1, supabase })).toEqual({ error: 'production_error' });
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it('does not silently omit substitutions when the product category query failed', async () => {
    const supabase = new FakeSupabase({ product_recipes: [sampleBoxRecipe()] });
    supabase.errors.products = 'Product unavailable';
    expect(await recordRecipeProductionRun({ productId: PRODUCT_ID, quantityProduced: 1, supabase })).toEqual({ error: 'recipe_error' });
    expect(supabase.rpcCalls).toHaveLength(0);
  });

  it('rejects an empty recipe and incompatible material units before submitting a run', async () => {
    const empty = new FakeSupabase({ product_recipes: [{ ...sampleBoxRecipe(), product_recipe_components: [] }] });
    expect(await recordRecipeProductionRun({ productId: PRODUCT_ID, quantityProduced: 1, supabase: empty })).toEqual({ error: 'recipe_error' });
    expect(empty.rpcCalls).toHaveLength(0);
    const invalid = sampleBoxRecipe();
    invalid.product_recipe_components[0].unit = 'lb';
    const badUnits = new FakeSupabase({ product_recipes: [invalid] });
    expect(await recordRecipeProductionRun({ productId: PRODUCT_ID, quantityProduced: 1, supabase: badUnits })).toEqual({ error: 'unit_error' });
    expect(badUnits.rpcCalls).toHaveLength(0);
  });
});

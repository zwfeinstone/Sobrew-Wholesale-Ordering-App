import { describe, expect, it } from 'vitest';
import { recordRecipeProductionRun } from '@/lib/inventory-production';

const PRODUCT_ID = 'sample-product-1';
const OLD_BOX_ID = 'box-12x7x4';
const NEW_BOX_ID = 'box-12x6x4';

type TableName = 'inventory_items' | 'inventory_lots' | 'product_recipes' | 'products';
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
    return { data: this.database.tables[this.table].filter((row) => this.matches(row)), error: null };
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
  rpcCalls: Array<{ args: Record<string, unknown>; fn: string }> = [];
  tables: Record<TableName, Row[]> = {
    inventory_items: [
      { active: true, base_unit: 'each', id: NEW_BOX_ID, sku: 'MAT-BOX-12X6X4' },
    ],
    inventory_lots: [],
    product_recipes: [],
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

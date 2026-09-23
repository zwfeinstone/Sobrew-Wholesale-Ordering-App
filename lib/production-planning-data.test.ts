import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadProductionPlanningData } from '@/lib/production-planning-data';
import type { Database } from '@/lib/supabase/schema';

type Row = Record<string, string | number | boolean | null>;
type PageCall = { table: string; from: number; to: number; columns: string[] };

class PlanningDatabase {
  calls: PageCall[] = [];
  pageSize = 1000;
  fail?: (call: PageCall) => boolean;

  constructor(readonly tables: Record<string, Row[]> = {}) {}
  from(table: string) { return new PlanningQuery(this, table); }
  client() { return this as unknown as SupabaseClient<Database>; }
}

class PlanningQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private columns: string[] = [];
  private ordering: string[] = [];

  constructor(private readonly database: PlanningDatabase, private readonly table: string) {}
  select(columns: string) {
    if (columns.includes('(')) throw new Error('Embedded child collections cannot guarantee complete results.');
    this.columns = columns.split(',');
    return this;
  }
  eq(column: string, value: string | boolean) { this.filters.push((row) => row[column] === value); return this; }
  is(column: string, value: null) { this.filters.push((row) => row[column] === value); return this; }
  in(column: string, values: string[]) { this.filters.push((row) => values.includes(String(row[column]))); return this; }
  not(column: string, operator: string, value: null) {
    if (operator !== 'is') throw new Error(`Unsupported operator ${operator}`);
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  gte(column: string, value: string) {
    this.filters.push((row) => row[column] !== null && Date.parse(String(row[column])) >= Date.parse(value));
    return this;
  }
  lt(column: string, value: string) {
    this.filters.push((row) => row[column] !== null && Date.parse(String(row[column])) < Date.parse(value));
    return this;
  }
  order(column: string) { this.ordering.push(column); return this; }
  async range(from: number, to: number) {
    const call = { table: this.table, from, to, columns: this.columns };
    this.database.calls.push(call);
    if (this.database.fail?.(call)) return { data: null, error: { message: `${this.table} unavailable`, code: 'TEST_FAILURE' } };
    const rows = (this.database.tables[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)));
    rows.sort((left, right) => {
      for (const column of this.ordering) {
        const comparison = String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
        if (comparison) return comparison;
      }
      return 0;
    });
    return {
      data: rows.slice(from, Math.min(to + 1, from + this.database.pageSize))
        .map((row) => Object.fromEntries(this.columns.map((column) => [column, row[column] ?? null]))),
      error: null,
    };
  }
}

const NOW = new Date('2026-09-23T16:00:00.000Z');
function order(id: string, overrides: Row = {}): Row {
  return {
    id, center_id: 'customer', status: 'New', created_at: '2026-09-23T10:00:00.000Z',
    shipped_at: null, archived_at: null, recurring_order_id: null, recurring_scheduled_for: null, ...overrides,
  };
}

function fixtures(): Record<string, Row[]> {
  return {
    products: [{ id: 'coffee', name: 'House coffee 2 lb', sku: 'COF-2', category: 'coffee', active: true }],
    centers: [{ id: 'customer', name: 'Northside Cafe', is_active: true }],
    orders: [order('open')],
    order_items: [{ id: 'line', order_id: 'open', product_id: 'coffee', qty: 3 }],
    recurring_orders: [{ id: 'weekly', center_id: 'customer', frequency: '1_week', status: 'active', active: true, next_run_at: '2026-09-25T13:00:00.000Z' }],
    recurring_order_items: [{ id: 'recurring-line', recurring_order_id: 'weekly', product_id: 'coffee', qty: 4 }],
    inventory_items: [
      { id: 'finished', product_id: 'coffee', name: 'House coffee 2 lb', sku: 'COF-2', item_type: 'finished_good', base_unit: 'each', active: true },
      { id: 'bean', product_id: null, name: 'Coffee beans', sku: 'BEAN', item_type: 'raw_material', base_unit: 'lb', active: true },
    ],
    inventory_lots: [
      { id: 'lot-finished', inventory_item_id: 'finished', quantity_remaining: 5 },
      { id: 'lot-bean', inventory_item_id: 'bean', quantity_remaining: 0.125 },
    ],
    inventory_movements: [{ id: 'deficit', inventory_item_id: 'finished', quantity_change: -7, movement_type: 'shipment_consume', lot_id: null }],
    product_recipes: [{ id: 'recipe', product_id: 'coffee', output_qty: 1, waste_percent: 0, labor_minutes: 2, labor_rate_cents: 2000, shipping_label_qty: 0, branding_label_qty: 1 }],
    product_recipe_components: [{ id: 'component', recipe_id: 'recipe', inventory_item_id: 'bean', quantity: 2, unit: 'lb', component_role: 'coffee' }],
    inventory_center_par_levels: [{ center_id: 'customer', product_id: 'coffee', par_qty: 10, minimum_qty: 2, notes: 'Weekly shelf target' }],
  };
}

describe('complete production planning snapshot', () => {
  it('paginates parent and child datasets even when the server enforces a small cap', async () => {
    const tables = fixtures();
    tables.products = Array.from({ length: 1005 }, (_, index) => ({
      id: `coffee-${index}`, name: `Coffee ${index}`, sku: null, category: 'coffee', active: true,
    }));
    tables.order_items = Array.from({ length: 1205 }, (_, index) => ({
      id: `line-${index}`, order_id: 'open', product_id: 'coffee', qty: 1,
    }));
    tables.recurring_order_items = Array.from({ length: 1205 }, (_, index) => ({
      id: `schedule-line-${index}`, recurring_order_id: 'weekly', product_id: 'coffee', qty: 1,
    }));
    tables.product_recipe_components = Array.from({ length: 1205 }, (_, index) => ({
      id: `component-${index}`, recipe_id: 'recipe', inventory_item_id: 'bean', quantity: 0.01, unit: 'lb', component_role: 'coffee',
    }));
    tables.orders.push(...Array.from({ length: 1205 }, (_, index) => order(`generated-${index}`, {
      status: 'Cancelled', recurring_order_id: 'weekly',
      recurring_scheduled_for: new Date(Date.UTC(2000, 0, 1 + index * 7)).toISOString(),
    })));
    const database = new PlanningDatabase(tables);
    database.pageSize = 137;
    const result = await loadProductionPlanningData(database.client(), NOW);
    expect(result.error).toBeNull();
    expect(result.data?.input.products).toHaveLength(1005);
    expect(result.data?.input.orders[0].order_items).toHaveLength(1205);
    expect(result.data?.input.schedules[0].recurring_order_items).toHaveLength(1205);
    expect(result.data?.input.generatedOccurrences).toHaveLength(1205);
    expect(result.data?.recipes[0].product_recipe_components).toHaveLength(1205);
    expect(result.data?.recipes[0].product_recipe_components?.[0].inventory_items).toMatchObject({ name: 'Coffee beans', base_unit: 'lb' });
    for (const table of ['products', 'order_items', 'recurring_order_items', 'product_recipe_components']) {
      expect(database.calls.some((call) => call.table === table && call.from === 137)).toBe(true);
    }
    expect(database.calls.every((call) => call.to - call.from === 999)).toBe(true);
  });

  it('loads shipment-date history with legacy fallback and keeps all generated occurrence statuses', async () => {
    const tables = fixtures();
    tables.orders.push(
      order('shipped-now-created-long-ago', { status: 'Shipped', created_at: '2026-01-01T00:00:00.000Z', shipped_at: '2026-09-22T12:00:00.000Z' }),
      order('legacy-shipped', { status: 'Shipped', created_at: '2026-08-20T12:00:00.000Z' }),
      order('history-start', { status: 'Shipped', shipped_at: '2026-07-27T05:00:00.000Z' }),
      order('before-history', { status: 'Shipped', shipped_at: '2026-07-27T04:59:59.999Z' }),
      order('shipped-old-created-now', { status: 'Shipped', shipped_at: '2026-07-01T12:00:00.000Z' }),
      order('after-current-week', { status: 'Shipped', shipped_at: '2026-09-28T05:00:00.000Z' }),
      order('archived-open', { archived_at: '2026-09-22T12:00:00.000Z' }),
      order('canceled-recurring', { status: 'Cancelled', recurring_order_id: 'weekly', recurring_scheduled_for: '2026-09-25T13:00:00.000Z' }),
      order('beyond-outlook-recurring', { status: 'Cancelled', recurring_order_id: 'weekly', recurring_scheduled_for: '2026-10-07T05:00:00.000Z' }),
    );
    const result = await loadProductionPlanningData(new PlanningDatabase(tables).client(), NOW);
    expect(result.error).toBeNull();
    expect(result.data?.input.orders.map((row) => row.id).sort()).toEqual(['history-start', 'legacy-shipped', 'open', 'shipped-now-created-long-ago']);
    expect(result.data?.input.generatedOccurrences).toEqual([{ recurring_order_id: 'weekly', recurring_scheduled_for: '2026-09-25T13:00:00.000Z' }]);
    expect(result.data?.input.orders.find((row) => row.id === 'open')?.customer_name).toBe('Northside Cafe');
  });

  it('separates net finished stock from consumable material lots and flags inactive customers', async () => {
    const tables = fixtures();
    tables.centers.push({ id: 'inactive', name: 'Closed Cafe', is_active: false });
    tables.orders.push(order('inactive-customer-order', { center_id: 'inactive' }));
    tables.recurring_orders.push(
      { ...tables.recurring_orders[0], id: 'inactive-customer-schedule', center_id: 'inactive' },
      { ...tables.recurring_orders[0], id: 'paused', active: false, status: 'paused' },
      { ...tables.recurring_orders[0], id: 'canceled', active: true, status: 'canceled' },
    );
    tables.inventory_center_par_levels.push({ ...tables.inventory_center_par_levels[0], center_id: 'inactive' });
    tables.inventory_movements.push(
      { id: 'lot-consumption', inventory_item_id: 'finished', quantity_change: -100, movement_type: 'shipment_consume', lot_id: 'lot-finished' },
      { id: 'sample-deficit', inventory_item_id: 'bean', quantity_change: -0.1, movement_type: 'sample_box_consume', lot_id: null },
      { id: 'not-a-deficit', inventory_item_id: 'bean', quantity_change: -200, movement_type: 'production_consume', lot_id: null },
    );
    const result = await loadProductionPlanningData(new PlanningDatabase(tables).client(), NOW);
    expect(result.error).toBeNull();
    expect(result.data?.input.stockByProductId).toEqual({ coffee: -2 });
    expect(result.data?.onHandByItemId.bean).toBeCloseTo(0.025);
    expect(result.data?.materialStockByItemId).toEqual({ finished: 5, bean: 0.125 });
    expect(result.data?.input.orders.some((row) => row.id === 'inactive-customer-order')).toBe(true);
    expect(result.data?.input.schedules.map((row) => row.id)).toEqual(['inactive-customer-schedule', 'weekly']);
    expect(result.data?.input.schedules[0].center_active).toBe(false);
    expect(result.data?.input.pars.find((row) => row.center_id === 'inactive')?.center_active).toBe(false);
    expect(result.data?.centers.map((center) => center.id)).toEqual(['customer']);
  });

  it.each(['inventory_lots', 'inventory_movements', 'order_items', 'product_recipe_components'])
    ('rejects the entire snapshot if a later %s page fails', async (table) => {
      const database = new PlanningDatabase(fixtures());
      database.pageSize = 1;
      database.fail = (call) => call.table === table && call.from === 1;
      const result = await loadProductionPlanningData(database.client(), NOW);
      expect(result.data).toBeNull();
      expect(result.error).toMatchObject({ code: 'TEST_FAILURE' });
      expect(result.error?.message).toContain('could not load complete');
      expect(result.error?.message).toContain(`${table} unavailable`);
    });
});

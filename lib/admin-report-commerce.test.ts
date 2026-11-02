import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadReportCommerce } from './admin-report-commerce';
import type { Database } from './supabase/schema';
import { buildRecentOrderGpmRows } from './profitability-reporting';

type Row = Record<string, string | number | null>;
type Table = 'orders' | 'order_items';
type PageCall = { table: Table; from: number; to: number; ids: string[] };

class CommerceDatabase {
  calls: PageCall[] = [];
  fail?: (call: PageCall) => boolean;
  serverPageSize = 1000;

  constructor(readonly tables: Record<Table, Row[]>) {}

  from(table: Table) {
    return new CommerceQuery(this, table);
  }

  client() {
    return this as unknown as SupabaseClient<Database>;
  }
}

class CommerceQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private itemFilters: Array<(row: Row) => boolean> = [];
  private innerItems = false;
  private ordering: Array<{ column: string; ascending: boolean }> = [];
  private columns: string[] = [];

  constructor(private readonly database: CommerceDatabase, private readonly table: Table) {}

  select(columns: string) {
    this.innerItems = columns.includes('order_items!inner(id)');
    this.columns = columns.replace(',order_items!inner(id)', '').split(',');
    return this;
  }
  eq(column: string, value: string) {
    if (column.startsWith('order_items.')) this.itemFilters.push((row) => row[column.slice('order_items.'.length)] === value);
    else this.filters.push((row) => row[column] === value);
    return this;
  }
  gt(column: string, value: number) {
    if (!column.startsWith('order_items.')) throw new Error(`Unsupported test filter: ${column}`);
    this.itemFilters.push((row) => Number(row[column.slice('order_items.'.length)]) > value);
    return this;
  }
  is(column: string, value: null) { this.filters.push((row) => row[column] === value); return this; }
  not(column: string, operator: string, value: null) {
    if (operator !== 'is') throw new Error(`Unsupported test filter: ${operator}`);
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  limit(count: number, options: { referencedTable: string }) {
    if (count !== 1 || options.referencedTable !== 'order_items') throw new Error('Unexpected embedded limit.');
    return this;
  }
  neq(column: string, value: string) { this.filters.push((row) => row[column] !== null && row[column] !== value); return this; }
  in(column: string, values: string[]) {
    this.filters.push((row) => typeof row[column] === 'string' && values.includes(row[column]));
    return this;
  }
  or(expression: string) {
    // Interpret the actual PostgREST OR-of-ANDs, including null fallback and
    // inclusive/exclusive timestamps; do not hard-code the intended window.
    const groups = [...expression.matchAll(/and\(([^()]*)\)/g)].map((match) => match[1].split(','));
    if (!groups.length) throw new Error(`Unsupported test filter: ${expression}`);
    this.filters.push((row) => groups.some((group) => group.every((filter) => {
      const [, column, operator, value] = /^(\w+)\.(\w+)\.(.+)$/.exec(filter) ?? [];
      if (operator === 'is' && value === 'null') return row[column] === null;
      const timestamp = typeof row[column] === 'string' ? Date.parse(row[column]) : Number.NaN;
      if (operator === 'gte') return timestamp >= Date.parse(value);
      if (operator === 'lt') return timestamp < Date.parse(value);
      throw new Error(`Unsupported test filter: ${filter}`);
    })));
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.ordering.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  async range(from: number, to: number) {
    const matches = this.database.tables[this.table]
      .filter((row) => this.filters.every((filter) => filter(row)))
      .filter((row) => !this.innerItems || this.database.tables.order_items.some((item) => item.order_id === row.id && this.itemFilters.every((filter) => filter(item))))
      .sort((left, right) => {
        for (const { column, ascending } of this.ordering) {
          const comparison = String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
          if (comparison) return ascending ? comparison : -comparison;
        }
        return 0;
      });
    const page = matches.slice(from, Math.min(to + 1, from + this.database.serverPageSize));
    const call = { table: this.table, from, to, ids: page.map((row) => String(row.id)) };
    this.database.calls.push(call);
    if (this.database.fail?.(call)) return { data: null, error: { message: `Failed ${this.table} page`, code: 'TEST_FAILURE' } };
    return {
      data: page.map((row) => Object.fromEntries(this.columns.map((column) => [column, row[column] ?? null]))),
      error: null,
    };
  }
}

function order(id: string, overrides: Row = {}): Row {
  return {
    id, center_id: 'allowed', order_kind: 'wholesale', status: 'Shipped', subtotal_cents: 600,
    created_at: '2026-08-15T12:00:00.000Z', shipped_at: '2026-08-16T12:00:00.000Z', ...overrides,
  };
}
function itemsFor(orders: Row[], count = 1) {
  return orders.flatMap((row) => Array.from({ length: count }, (_, index) => ({
    id: `item-${row.id}-${index}`, order_id: row.id, product_id: 'product-1', qty: 1, line_total_cents: 100,
  })));
}

describe('complete report commerce data', () => {
  it('loads more than 1,000 scoped orders and all their line items without unrelated records', async () => {
    const allowed = Array.from({ length: 1205 }, (_, index) => order(`order-${String(index).padStart(4, '0')}`));
    const unrelated = [order('other-center', { center_id: 'other' }), order('sample', { order_kind: 'prospecting_sample' })];
    const database = new CommerceDatabase({ orders: [...allowed, ...unrelated], order_items: itemsFor([...allowed, ...unrelated], 6) });
    const result = await loadReportCommerce(database.client(), { centerScope: ['allowed'] });
    expect(result.orders.error).toBeNull();
    expect(result.orderItems.error).toBeNull();
    expect(result.orders.data).toHaveLength(1205);
    expect(result.orderItems.data).toHaveLength(7230);
    expect(new Set(result.orders.data.map((row) => row.id))).toEqual(new Set(allowed.map((row) => row.id)));
    expect(new Set(result.orderItems.data.map((row) => row.order_id))).toEqual(new Set(allowed.map((row) => row.id)));
    expect(new Set(result.orderItems.data.map((row) => row.id)).size).toBe(7230);
    expect(database.calls.some((call) => call.table === 'order_items' && call.from === 1000)).toBe(true);
  });

  it('advances by actual returned rows when the server imposes a smaller page cap', async () => {
    const orders = Array.from({ length: 1005 }, (_, index) => order(`order-${index}`));
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders, 2) });
    database.serverPageSize = 157;
    const result = await loadReportCommerce(database.client(), { centerScope: null });
    expect(result.orders.data).toHaveLength(1005);
    expect(result.orderItems.data).toHaveLength(2010);
    expect(database.calls.filter((call) => call.table === 'orders').map((call) => call.from)).toEqual([0, 157, 314, 471, 628, 785, 942, 1005]);
  });

  it('preserves comparison-window boundaries, shipment-date priority and legacy creation-date fallback', async () => {
    const start = new Date('2026-07-07T05:00:00.000Z');
    const endExclusive = new Date('2026-09-15T05:00:00.000Z');
    const orders = [
      order('baseline-start', { shipped_at: start.toISOString(), created_at: '2026-01-01T00:00:00.000Z' }),
      order('prior-month', { shipped_at: '2026-08-01T00:00:00.000Z' }),
      order('selected-period', { shipped_at: '2026-09-10T00:00:00.000Z' }),
      order('legacy-fallback', { shipped_at: null, created_at: start.toISOString() }),
      order('at-end', { shipped_at: endExclusive.toISOString() }),
      order('legacy-at-end', { shipped_at: null, created_at: endExclusive.toISOString() }),
      order('before-start', { shipped_at: '2026-07-07T04:59:59.999Z' }),
      order('unshipped', { status: 'Processing' }),
      order('excluded-center', { center_id: 'other' }),
      order('sample', { order_kind: 'prospecting_sample' }),
    ];
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders) });
    const result = await loadReportCommerce(database.client(), { centerScope: ['allowed'], shippedRange: { start, endExclusive } });
    expect(new Set(result.orders.data.map((row) => row.id))).toEqual(new Set(['baseline-start', 'prior-month', 'selected-period', 'legacy-fallback']));
    expect(new Set(result.orderItems.data.map((row) => row.order_id))).toEqual(new Set(['baseline-start', 'prior-month', 'selected-period', 'legacy-fallback']));
  });

  it('retains lifetime and unshipped orders when no period window is requested', async () => {
    const orders = [order('old', { shipped_at: '2020-01-01T00:00:00Z', created_at: '2020-01-01T00:00:00Z' }), order('new', { status: 'New', shipped_at: null })];
    const result = await loadReportCommerce(new CommerceDatabase({ orders, order_items: itemsFor(orders) }).client(), { centerScope: null });
    expect(new Set(result.orders.data.map((row) => row.id))).toEqual(new Set(['old', 'new']));
  });

  it('returns no data and never loads line items for an empty center scope', async () => {
    const orders = [order('not-authorized')];
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders) });
    const result = await loadReportCommerce(database.client(), { centerScope: [] });
    expect(result).toEqual({ orders: { data: [], error: null }, orderItems: { data: [], error: null } });
    expect(database.calls.every((call) => call.table === 'orders')).toBe(true);
  });

  it('discards partial orders after a page failure and does not fetch their line items', async () => {
    const orders = Array.from({ length: 1005 }, (_, index) => order(`order-${index}`));
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders) });
    database.fail = (call) => call.table === 'orders' && call.from > 0;
    const result = await loadReportCommerce(database.client(), { centerScope: null });
    expect(result.orders.data).toEqual([]);
    expect(result.orders.error?.code).toBe('TEST_FAILURE');
    expect(result.orderItems.data).toEqual([]);
    expect(database.calls.every((call) => call.table === 'orders')).toBe(true);
  });

  it.each(['page', 'batch'])('discards all related line items when a later %s fails', async (failure) => {
    const orders = Array.from({ length: 405 }, (_, index) => order(`order-${String(index).padStart(3, '0')}`));
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders, 6) });
    database.fail = (call) => call.table === 'order_items' && (failure === 'page'
      ? call.from > 0
      : call.ids.includes('item-order-200-0'));
    const result = await loadReportCommerce(database.client(), { centerScope: null });
    expect(result.orders.data).toHaveLength(405);
    expect(result.orderItems.data).toEqual([]);
    expect(result.orderItems.error?.code).toBe('TEST_FAILURE');
  });
});

describe('bounded recent order commerce', () => {
  it('loads only ten eligible orders and their complete items from more than 1,000 historical orders', async () => {
    const orders = Array.from({ length: 1205 }, (_, index) => order(`order-${String(index).padStart(4, '0')}`));
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders, 6) });
    const result = await loadReportCommerce(database.client(), { centerScope: null, recentOrders: { limit: 10 } });
    expect(result.orders.error).toBeNull();
    expect(result.orderItems.error).toBeNull();
    expect(result.orders.data.map((row) => row.id)).toEqual(orders.slice(-10).reverse().map((row) => row.id));
    expect(result.orderItems.data).toHaveLength(60);
    expect(database.calls.filter((call) => call.table === 'orders').flatMap((call) => call.ids)).toHaveLength(10);
    expect(new Set(database.calls.filter((call) => call.table === 'order_items').flatMap((call) => call.ids)).size).toBe(60);
  });

  it('merges shipment dates and legacy creation dates with descending ID ties, independent of order creation order', async () => {
    const orders = [
      order('created-newest-shipped-oldest', { created_at: '2026-10-14T00:00:00.000Z', shipped_at: '2026-09-01T00:00:00.000Z' }),
      order('created-oldest-shipped-newest', { created_at: '2020-01-01T00:00:00.000Z', shipped_at: '2026-10-15T00:00:00.000Z' }),
      order('legacy-z', { created_at: '2026-10-14T00:00:00.000Z', shipped_at: null }),
      order('shipment-a', { shipped_at: '2026-10-14T00:00:00.000Z' }),
      order('legacy-older', { created_at: '2026-08-01T00:00:00.000Z', shipped_at: null }),
      order('no-valid-date', { created_at: null, shipped_at: null }),
    ];
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders) });
    const result = await loadReportCommerce(database.client(), { centerScope: null, recentOrders: { limit: 3 } });
    expect(result.orders.data.map((row) => row.id)).toEqual(['created-oldest-shipped-newest', 'shipment-a', 'legacy-z']);
    expect(new Set(result.orderItems.data.map((row) => row.order_id))).toEqual(new Set(['created-oldest-shipped-newest', 'shipment-a', 'legacy-z']));
  });

  it('applies permissions, selected center, shipment status and positive product eligibility before limiting', async () => {
    const orders = [
      order('z-denied', { center_id: 'denied' }),
      order('y-other-allowed-center', { center_id: 'other-allowed' }),
      order('x-sample', { order_kind: 'prospecting_sample' }),
      order('w-unshipped', { status: 'New' }),
      order('v-no-lines'), order('u-zero'), order('t-negative'), order('s-other-product'),
      order('r-zero-selected-product'), order('b-eligible'), order('a-eligible'),
    ];
    const items = itemsFor(orders).filter((item) => item.order_id !== 'v-no-lines').map((item) => ({
      ...item,
      qty: item.order_id === 'u-zero' || item.order_id === 'r-zero-selected-product' ? 0 : item.order_id === 't-negative' ? -1 : 1,
      product_id: item.order_id === 's-other-product' ? 'product-2' : item.product_id,
    }));
    items.push({ id: 'positive-sibling', order_id: 'r-zero-selected-product', product_id: 'product-2', qty: 1, line_total_cents: 100 });
    const database = new CommerceDatabase({ orders, order_items: items });
    const result = await loadReportCommerce(database.client(), {
      centerScope: ['allowed', 'other-allowed'], recentOrders: { limit: 2, centerId: 'allowed', productId: 'product-1' },
    });
    expect(result.orders.data.map((row) => row.id)).toEqual(['b-eligible', 'a-eligible']);
    const denied = await loadReportCommerce(database.client(), { centerScope: ['allowed'], recentOrders: { limit: 10, centerId: 'denied' } });
    expect(denied.orders.data).toEqual([]);
  });

  it('retains sibling lines and historical cost fallbacks so product-filtered financial rows match the complete-history result', async () => {
    const orders = Array.from({ length: 12 }, (_, index) => order(`order-${String(index).padStart(2, '0')}`, {
      subtotal_cents: 1000, shipping_cost_cents: 100, processing_fee_cents: 0, donation_cogs_cents: 0,
    }));
    const items = orders.flatMap((row) => [
      { id: `coffee-${row.id}`, order_id: row.id, product_id: 'coffee', qty: 1, line_total_cents: 600, shipping_boxes_used: 1 },
      { id: `tea-${row.id}`, order_id: row.id, product_id: 'tea', qty: 1, line_total_cents: 400, shipping_boxes_used: 1 },
    ]);
    const database = new CommerceDatabase({ orders, order_items: items });
    const complete = await loadReportCommerce(database.client(), { centerScope: null });
    const recent = await loadReportCommerce(database.client(), { centerScope: null, recentOrders: { limit: 10, productId: 'coffee' } });
    const common = {
      centers: [{ id: 'allowed', name: 'Allowed' }], products: [{ id: 'coffee', name: 'Coffee', sku: 'COFFEE' }], productId: 'coffee',
      productionRuns: [{ id: 'old-run', product_id: 'coffee', produced_at: '2020-01-01T00:00:00Z', quantity_produced: 10,
        quantity_voided: 0, status: 'completed', actual_unit_cost_cents: 200, estimated_unit_cost_cents: 200, actual_labor_cost_cents: 0, fixed_cost_cents: 0 }],
    };
    const expected = buildRecentOrderGpmRows({ ...common, orders: complete.orders.data, orderItems: complete.orderItems.data.map((item) => ({ ...item, order_id: item.order_id! })) });
    const actual = buildRecentOrderGpmRows({ ...common, orders: recent.orders.data, orderItems: recent.orderItems.data.map((item) => ({ ...item, order_id: item.order_id! })) });
    expect(recent.orderItems.data).toHaveLength(20);
    expect(actual).toEqual(expected);
    expect(actual[0]).toMatchObject({ lineCount: 1, revenueCents: 600, totalCogsCents: 250, grossProfitCents: 350, estimatedLineCount: 1 });
  });

  it('continues capped pages until the requested count, including every line-item page', async () => {
    const orders = Array.from({ length: 15 }, (_, index) => order(`order-${String(index).padStart(2, '0')}`));
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders, 6) });
    database.serverPageSize = 3;
    const result = await loadReportCommerce(database.client(), { centerScope: null, recentOrders: { limit: 10 } });
    expect(result.orders.data).toHaveLength(10);
    expect(result.orderItems.data).toHaveLength(60);
    expect(database.calls.filter((call) => call.table === 'orders' && call.ids.length).map((call) => [call.from, call.to])).toEqual([[0, 9], [3, 9], [6, 9], [9, 9]]);
  });

  it.each(['orders', 'order_items'] as const)('does not return partial %s after a capped later page fails', async (table) => {
    const orders = Array.from({ length: 15 }, (_, index) => order(`order-${index}`));
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders, 2) });
    database.serverPageSize = 3;
    database.fail = (call) => call.table === table && call.from > 0;
    const result = await loadReportCommerce(database.client(), { centerScope: null, recentOrders: { limit: 10 } });
    const failed = table === 'orders' ? result.orders : result.orderItems;
    expect(failed.data).toEqual([]);
    expect(failed.error?.code).toBe('TEST_FAILURE');
    if (table === 'orders') expect(database.calls.every((call) => call.table === 'orders')).toBe(true);
  });

  it('discards the successful timestamp stream if the other stream fails', async () => {
    const orders = [order('shipped'), order('legacy', { shipped_at: null })];
    const database = new CommerceDatabase({ orders, order_items: itemsFor(orders) });
    database.fail = (call) => call.ids.includes('legacy');
    const result = await loadReportCommerce(database.client(), { centerScope: null, recentOrders: { limit: 10 } });
    expect(result.orders.data).toEqual([]);
    expect(result.orders.error?.code).toBe('TEST_FAILURE');
    expect(database.calls.every((call) => call.table === 'orders')).toBe(true);
  });

  it('makes no requests for an empty permission scope or a zero limit', async () => {
    const database = new CommerceDatabase({ orders: [order('denied')], order_items: [] });
    for (const options of [{ centerScope: [], recentOrders: { limit: 10 } }, { centerScope: null, recentOrders: { limit: 0 } }]) {
      expect(await loadReportCommerce(database.client(), options)).toEqual({ orders: { data: [], error: null }, orderItems: { data: [], error: null } });
    }
    expect(database.calls).toEqual([]);
  });
});

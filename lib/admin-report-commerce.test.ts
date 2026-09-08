import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadReportCommerce } from './admin-report-commerce';
import type { Database } from './supabase/schema';

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
  private ordering: Array<{ column: string; ascending: boolean }> = [];
  private columns: string[] = [];

  constructor(private readonly database: CommerceDatabase, private readonly table: Table) {}

  select(columns: string) { this.columns = columns.split(','); return this; }
  eq(column: string, value: string) { this.filters.push((row) => row[column] === value); return this; }
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

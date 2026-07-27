import { describe, expect, it } from 'vitest';
import { createProspectingSampleOrder, type ProspectingSampleOrderInput } from '@/lib/prospecting-sample-orders';

const REP_ID = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const SAMPLE_PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_PRODUCT_ID = '44444444-4444-4444-8444-444444444444';

type TableName = 'orders' | 'order_items' | 'products' | 'prospecting_activities' | 'prospecting_leads';
type Row = Record<string, any>;

class Query {
  private filters: Array<{ column: string; op: 'eq' | 'in'; value: any }> = [];
  private operation: 'delete' | 'insert' | 'select' | 'update' = 'select';
  private payload: any = null;

  constructor(private database: FakeSupabase, private table: TableName) {}

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  in(column: string, value: any[]) {
    this.filters.push({ column, op: 'in', value });
    return this;
  }

  insert(payload: any) {
    this.operation = 'insert';
    this.payload = payload;
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

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  update(payload: any) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  private async execute() {
    if (this.database.errors[this.table]) return { data: null, error: this.database.errors[this.table] };
    if (this.operation === 'insert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const inserted = rows.map((row) => ({
        ...row,
        id: row.id ?? this.database.nextId(this.table),
      }));
      this.database.tables[this.table].push(...inserted);
      return { data: Array.isArray(this.payload) ? inserted : inserted[0], error: null };
    }
    if (this.operation === 'update') {
      const rows = this.matchingRows();
      for (const row of rows) Object.assign(row, this.payload);
      return { data: rows, error: null };
    }
    if (this.operation === 'delete') {
      const remaining = this.database.tables[this.table].filter((row) => !this.matches(row));
      this.database.tables[this.table] = remaining;
      return { data: null, error: null };
    }
    return { data: this.matchingRows(), error: null };
  }

  private matchingRows() {
    return this.database.tables[this.table].filter((row) => this.matches(row));
  }

  private matches(row: Row) {
    return this.filters.every((filter) => {
      if (filter.op === 'eq') return row[filter.column] === filter.value;
      return filter.value.includes(row[filter.column]);
    });
  }
}

class FakeSupabase {
  errors: Partial<Record<TableName, { message: string }>> = {};
  tables: Record<TableName, Row[]> = {
    order_items: [],
    orders: [],
    products: [],
    prospecting_activities: [],
    prospecting_leads: [],
  };

  constructor(seed: Partial<Record<TableName, Row[]>> = {}) {
    this.tables = { ...this.tables, ...seed };
  }

  from(table: string) {
    return new Query(this, table as TableName);
  }

  nextId(table: TableName) {
    if (table === 'orders') return '55555555-5555-4555-8555-555555555555';
    return `${table}-${this.tables[table].length + 1}`;
  }
}

function validInput(overrides: Partial<ProspectingSampleOrderInput> = {}): ProspectingSampleOrderInput {
  return {
    address1: '123 Main St',
    attentionName: 'Jane Buyer',
    centerName: 'Sample Center',
    city: 'Chicago',
    items: [{ productId: SAMPLE_PRODUCT_ID, quantity: 1 }],
    state: 'IL',
    zip: '60601',
    ...overrides,
  };
}

function sampleProduct(overrides: Row = {}) {
  return {
    active: true,
    category: 'sample_boxes',
    id: SAMPLE_PRODUCT_ID,
    name: 'Sample Box',
    product_recipes: [{ id: 'recipe-1' }],
    sku: 'SAMPLE-BOX',
    ...overrides,
  };
}

describe('createProspectingSampleOrder', () => {
  it('rejects missing address fields', async () => {
    const supabase = new FakeSupabase({ products: [sampleProduct()] });
    const result = await createProspectingSampleOrder({
      currentProfileId: REP_ID,
      input: validInput({ address1: '' }),
      isOwner: false,
      supabase,
    });

    expect(result.error).toBe('missing_fields');
    expect(supabase.tables.orders).toHaveLength(0);
  });

  it('rejects empty product quantities', async () => {
    const supabase = new FakeSupabase({ products: [sampleProduct()] });
    const result = await createProspectingSampleOrder({
      currentProfileId: REP_ID,
      input: validInput({ items: [{ productId: SAMPLE_PRODUCT_ID, quantity: 0 }] }),
      isOwner: false,
      supabase,
    });

    expect(result.error).toBe('invalid_items');
    expect(supabase.tables.orders).toHaveLength(0);
  });

  it('rejects non-sample-box products', async () => {
    const supabase = new FakeSupabase({ products: [sampleProduct({ category: 'retail' })] });
    const result = await createProspectingSampleOrder({
      currentProfileId: REP_ID,
      input: validInput(),
      isOwner: false,
      supabase,
    });

    expect(result.error).toBe('invalid_product');
    expect(supabase.tables.orders).toHaveLength(0);
  });

  it('rejects sample-box products without recipes', async () => {
    const supabase = new FakeSupabase({ products: [sampleProduct({ product_recipes: [] })] });
    const result = await createProspectingSampleOrder({
      currentProfileId: REP_ID,
      input: validInput(),
      isOwner: false,
      supabase,
    });

    expect(result.error).toBe('invalid_product');
    expect(supabase.tables.orders).toHaveLength(0);
  });

  it('creates a free order and order items', async () => {
    const supabase = new FakeSupabase({ products: [sampleProduct()] });
    const result = await createProspectingSampleOrder({
      currentProfileId: REP_ID,
      input: validInput({ items: [{ productId: SAMPLE_PRODUCT_ID, quantity: 2 }] }),
      isOwner: false,
      now: new Date('2026-07-27T12:00:00.000Z'),
      supabase,
    });

    expect(result).toEqual({ error: null, orderId: '55555555-5555-4555-8555-555555555555' });
    expect(supabase.tables.orders[0]).toMatchObject({
      order_kind: 'prospecting_sample',
      shipping_company: 'Sample Center',
      shipping_name: 'Jane Buyer',
      subtotal_cents: 0,
      user_id: REP_ID,
    });
    expect(supabase.tables.order_items).toEqual([
      expect.objectContaining({
        line_total_cents: 0,
        product_id: SAMPLE_PRODUCT_ID,
        qty: 2,
        unit_price_cents: 0,
      }),
    ]);
  });

  it('updates a linked lead to sample requested', async () => {
    const supabase = new FakeSupabase({
      products: [sampleProduct()],
      prospecting_leads: [{ assigned_profile_id: REP_ID, company_name: 'Sample Center', id: LEAD_ID, stage: 'interested' }],
    });
    const result = await createProspectingSampleOrder({
      currentProfileId: REP_ID,
      input: validInput({ leadId: LEAD_ID }),
      isOwner: false,
      now: new Date('2026-07-27T12:00:00.000Z'),
      supabase,
    });

    expect(result.error).toBeNull();
    expect(supabase.tables.prospecting_leads[0]).toMatchObject({
      last_result: 'Sample order submitted',
      stage: 'sample_requested',
      updated_by: REP_ID,
    });
    expect(supabase.tables.prospecting_activities[0]).toMatchObject({
      activity_type: 'stage_change',
      lead_id: LEAD_ID,
      next_stage: 'sample_requested',
      previous_stage: 'interested',
      result: 'Sample order submitted',
    });
  });

  it('rejects a linked lead assigned to another rep', async () => {
    const supabase = new FakeSupabase({
      products: [sampleProduct()],
      prospecting_leads: [{ assigned_profile_id: OTHER_PRODUCT_ID, company_name: 'Sample Center', id: LEAD_ID, stage: 'interested' }],
    });
    const result = await createProspectingSampleOrder({
      currentProfileId: REP_ID,
      input: validInput({ leadId: LEAD_ID }),
      isOwner: false,
      supabase,
    });

    expect(result.error).toBe('unauthorized');
    expect(supabase.tables.orders).toHaveLength(0);
  });
});

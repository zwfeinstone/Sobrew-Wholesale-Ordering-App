import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: () => { throw new Error('Tests must inject their client.'); } } }));

import {
  isPayrollCommissionMonth,
  loadPayrollCommissions,
  recordPayrollCommissionPaid,
  type PayrollCommissionPayout,
} from '@/lib/payroll-commissions';

type Row = Record<string, any>;
type Call = {
  table: string;
  operation: 'select' | 'insert' | 'update';
  payload?: Row;
  filters: { column: string; value: unknown; operator: 'eq' | 'is' }[];
  orders: string[];
  from: number;
  to: number;
};
type Response = { data: Row | Row[] | null; error: { message: string; code?: string } | null };

function database({
  tables = {},
  cap = 1000,
  intercept,
}: {
  tables?: Record<string, Row[]>;
  cap?: number;
  intercept?: (call: Call, tables: Record<string, Row[]>) => Response | undefined;
} = {}) {
  const saved = structuredClone(tables);
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, operation: 'select', filters: [], orders: [], from: 0, to: Infinity };
      let single = false;
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { call.filters.push({ column, value, operator: 'eq' }); return query; },
        is(column: string, value: unknown) { call.filters.push({ column, value, operator: 'is' }); return query; },
        order(column: string) { call.orders.push(column); return query; },
        range(from: number, to: number) { call.from = from; call.to = to; return query; },
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        insert(payload: Row) { call.operation = 'insert'; call.payload = payload; return query; },
        update(payload: Row) { call.operation = 'update'; call.payload = payload; return query; },
        then(resolve: (response: Response) => unknown) {
          calls.push(structuredClone(call));
          const intercepted = intercept?.(call, saved);
          if (intercepted) return Promise.resolve(intercepted).then(resolve);
          const rows = saved[table] ?? [];
          const matches = (row: Row) => call.filters.every((filter) => row[filter.column] === filter.value);
          let result: Row[];
          if (call.operation === 'insert') {
            const created = { id: 'new-payout', notes: null, ...call.payload };
            saved[table] = [...rows, created];
            result = [created];
          } else if (call.operation === 'update') {
            result = [];
            saved[table] = rows.map((row) => {
              if (!matches(row)) return row;
              const updated = { ...row, ...call.payload };
              result.push(updated);
              return updated;
            });
          } else {
            result = rows.filter(matches).sort((left, right) => {
              for (const column of call.orders) {
                const comparison = String(left[column]).localeCompare(String(right[column]));
                if (comparison) return comparison;
              }
              return 0;
            }).slice(call.from, Math.min(call.to + 1, call.from + cap));
          }
          return Promise.resolve({ data: single ? result[0] ?? null : result, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { client, calls, saved };
}

function snapshot(id: string, overrides: Row = {}) {
  return {
    id, order_id: `order-${id}`, center_id: 'center', sales_profile_id: 'sales-a', commission_month: '2026-08-01',
    shipped_at: '2026-08-15T12:00:00Z', revenue_cents: 10_000, product_cogs_cents: 2000,
    shipping_cogs_cents: 1000, processing_fee_cogs_cents: 300, donation_cogs_cents: 200,
    total_cogs_cents: 3500, gross_profit_cents: 6500, commission_percent: 10, commission_cents: 650,
    cogs_estimated: false, ...overrides,
  };
}

function payout(overrides: Partial<PayrollCommissionPayout> = {}): PayrollCommissionPayout {
  return {
    id: 'payout-a', sales_profile_id: 'sales-a', commission_month: '2026-08-01',
    commission_cents: 325.25, donation_cogs_cents: 100, gross_profit_cents: 3252.5, order_count: 1,
    processing_fee_cogs_cents: 150, product_cogs_cents: 1000, revenue_cents: 5002.5,
    shipping_cogs_cents: 500, total_cogs_cents: 1750, status: 'locked',
    locked_at: '2026-08-31T12:00:00Z', locked_by: 'prior-admin', paid_at: null, paid_by: null,
    notes: 'Agreed adjustment; preserve this note.', updated_at: '2026-08-31T12:00:00Z', ...overrides,
  };
}

const payRequest = { commissionMonth: '2026-08-01', salesProfileId: 'sales-a', actorProfileId: 'admin', now: new Date('2026-09-01T05:00:00Z') };
const writes = (db: ReturnType<typeof database>) => db.calls.filter((call) => call.operation !== 'select');

describe('payroll commission month validation', () => {
  it.each(['2026-08-01', '2024-02-01', '0001-01-01'])('accepts canonical real month %s', (month) => {
    expect(isPayrollCommissionMonth(month)).toBe(true);
  });
  it.each(['2026-08', '2026-00-01', '2026-13-01', '2026-08-02', '0000-01-01', '2026-8-01', ' 2026-08-01'])('rejects %s', (month) => {
    expect(isPayrollCommissionMonth(month)).toBe(false);
  });
});

describe('loadPayrollCommissions', () => {
  it('loads every snapshot and payout page and keeps inactive, unknown, and historical employee rows', async () => {
    const db = database({ cap: 1, tables: {
      order_commission_snapshots: [
        snapshot('b', { commission_cents: 10.4 }), snapshot('a', { commission_cents: 10.4, cogs_estimated: true }),
        snapshot('c', { sales_profile_id: 'inactive-sales', commission_cents: 75 }),
        snapshot('d', { sales_profile_id: null, commission_cents: 25 }),
        snapshot('other-month', { commission_month: '2026-07-01', commission_cents: 9000 }),
      ],
      monthly_commission_payouts: [payout({ id: 'historical', sales_profile_id: 'historical-sales' })],
    } });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-08-01', supabase: db.client });
    expect(result.error).toBeNull();
    expect(result.rows).toHaveLength(4);
    expect(result.rows.find((row) => row.salesProfileId === 'sales-a')).toMatchObject({ amountOwedCents: 21, cogsEstimated: true, summary: { orderCount: 2, commissionCents: 20.8 } });
    expect(result.rows.find((row) => row.salesProfileId === 'inactive-sales')?.amountOwedCents).toBe(75);
    expect(result.rows.find((row) => row.salesProfileId === null)?.amountOwedCents).toBe(25);
    expect(result.rows.find((row) => row.salesProfileId === 'historical-sales')?.summary.commissionCents).toBe(325.25);
    expect(db.calls.filter((call) => call.table === 'order_commission_snapshots')).toHaveLength(5);
    expect(db.calls.every((call) => call.orders.at(-1) === 'id')).toBe(true);
    expect(writes(db)).toEqual([]);
    expect(db.calls.some((call) => call.table === 'profiles')).toBe(false);
  });

  it('uses every stored summary amount for locked payouts instead of recomputing their snapshots', async () => {
    const locked = payout();
    const db = database({ tables: { order_commission_snapshots: [snapshot('live')], monthly_commission_payouts: [locked] } });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-08-01', supabase: db.client });
    expect(result.rows[0]).toMatchObject({ payout: locked, amountOwedCents: 325, summary: {
      commissionCents: 325.25, donationCogsCents: 100, grossProfitCents: 3252.5, orderCount: 1,
      processingFeeCogsCents: 150, productCogsCents: 1000, revenueCents: 5002.5, shippingCogsCents: 500, totalCogsCents: 1750,
    } });
  });

  it.each([
    { status: 'paid', paid_at: null },
    { status: 'locked', paid_at: '2026-09-01T05:00:00Z' },
  ])('never owes an already paid payout again (%j)', async (state) => {
    const db = database({ tables: { monthly_commission_payouts: [payout(state)] } });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-08-01', supabase: db.client });
    expect(result.rows[0].amountOwedCents).toBe(0);
  });

  it.each(['order_commission_snapshots', 'monthly_commission_payouts'])('discards partial data when a later %s page fails', async (table) => {
    const db = database({ cap: 1, tables: {
      order_commission_snapshots: [snapshot('a'), snapshot('b')],
      monthly_commission_payouts: [payout(), payout({ id: 'payout-b', sales_profile_id: 'sales-b' })],
    }, intercept: (call) => call.table === table && call.from > 0 ? { data: null, error: { message: 'Failed page' } } : undefined });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-08-01', supabase: db.client });
    expect(result).toEqual({ rows: [], error: { message: 'Failed page' } });
    expect(writes(db)).toEqual([]);
  });

  it('rejects invalid months without queries', async () => {
    const db = database();
    expect((await loadPayrollCommissions({ commissionMonth: '2026-13-01', supabase: db.client })).error).toBeTruthy();
    expect(db.calls).toEqual([]);
  });
});

describe('recordPayrollCommissionPaid', () => {
  it('builds a new payout from all snapshots at their saved amounts, rounding only the displayed aggregate', async () => {
    const db = database({ cap: 1, tables: { order_commission_snapshots: [
      snapshot('a', { commission_cents: 10.4 }), snapshot('b', { commission_cents: 10.4 }),
      snapshot('unrelated', { sales_profile_id: 'sales-b', commission_cents: 9000 }),
    ] } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(result.error).toBeUndefined();
    expect(result.before).toBeNull();
    expect(result.payout).toMatchObject({
      commission_cents: 20.8, commission_month: '2026-08-01', order_count: 2,
      donation_cogs_cents: 400, gross_profit_cents: 13_000, processing_fee_cogs_cents: 600,
      product_cogs_cents: 4000, revenue_cents: 20_000, shipping_cogs_cents: 2000, total_cogs_cents: 7000,
      sales_profile_id: 'sales-a', status: 'paid', locked_at: payRequest.now.toISOString(), locked_by: 'admin',
      paid_at: payRequest.now.toISOString(), paid_by: 'admin', updated_at: payRequest.now.toISOString(),
    });
    expect(db.calls.filter((call) => call.table === 'order_commission_snapshots')).toHaveLength(3);
    expect(writes(db)).toHaveLength(1);
    expect(writes(db)[0].operation).toBe('insert');
  });

  it('marks a locked payout paid without changing locked amounts, notes, or locking metadata', async () => {
    const locked = payout();
    const db = database({ tables: { monthly_commission_payouts: [locked], order_commission_snapshots: [snapshot('different-live-total')] } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(result.before).toEqual(locked);
    expect(result.payout).toEqual({ ...locked, status: 'paid', paid_at: payRequest.now.toISOString(), paid_by: 'admin', updated_at: payRequest.now.toISOString() });
    expect(writes(db)[0].payload).toEqual({ status: 'paid', paid_at: payRequest.now.toISOString(), paid_by: 'admin', updated_at: payRequest.now.toISOString() });
    expect(writes(db)[0].filters).toEqual(expect.arrayContaining([
      { column: 'status', value: 'locked', operator: 'eq' },
      { column: 'updated_at', value: locked.updated_at, operator: 'eq' },
      { column: 'paid_at', value: null, operator: 'is' },
    ]));
    expect(db.calls.some((call) => call.table === 'order_commission_snapshots')).toBe(false);
  });

  it.each([{ status: 'paid', paid_at: null }, { status: 'locked', paid_at: '2026-09-01T05:00:00Z' }])('is idempotent for paid state %j', async (state) => {
    const paid = payout(state);
    const db = database({ tables: { monthly_commission_payouts: [paid] } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(result).toEqual({ alreadyPaid: true, payout: paid, before: paid });
    expect(writes(db)).toEqual([]);
  });

  it.each([
    { commissionMonth: '2026-13-01' }, { commissionMonth: '2026-08' }, { commissionMonth: '2026-09-01' },
    { commissionMonth: '2027-01-01' }, { salesProfileId: null }, { salesProfileId: ' ' }, { actorProfileId: '' },
    { now: new Date('2026-09-01T04:59:59Z') }, // Still August in Central time.
  ])('rejects invalid or not-yet-due requests before querying: %j', async (changes) => {
    const db = database();
    const result = await recordPayrollCommissionPaid({ ...payRequest, ...changes, supabase: db.client });
    expect(result.error).toBeTruthy();
    expect(db.calls).toEqual([]);
  });

  it.each([0, -100, 0.4])('does not create a nonpayable %s-cent payout', async (commissionCents) => {
    const db = database({ tables: { order_commission_snapshots: [snapshot('a', { commission_cents: commissionCents })] } });
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).error).toBeTruthy();
    expect(writes(db)).toEqual([]);
  });

  it('does not pay a zero locked payout even when live commissions are positive', async () => {
    const db = database({ tables: { monthly_commission_payouts: [payout({ commission_cents: 0 })], order_commission_snapshots: [snapshot('positive')] } });
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).error).toBeTruthy();
    expect(writes(db)).toEqual([]);
  });

  it.each(['monthly_commission_payouts', 'order_commission_snapshots'])('fails closed on %s query errors', async (table) => {
    const db = database({ tables: { order_commission_snapshots: [snapshot('a')] }, intercept: (call) => call.table === table ? { data: null, error: { message: 'Read failed' } } : undefined });
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).error?.message).toBe('Read failed');
    expect(writes(db)).toEqual([]);
  });

  it('does not insert a partial sum when a later snapshot page fails', async () => {
    const db = database({ cap: 1, tables: { order_commission_snapshots: [snapshot('a'), snapshot('b')] },
      intercept: (call) => call.table === 'order_commission_snapshots' && call.from > 0 ? { data: null, error: { message: 'Later page failed' } } : undefined });
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).error?.message).toBe('Later page failed');
    expect(writes(db)).toEqual([]);
  });

  it.each(['paid', 'locked'])('reloads a concurrent %s insert without overwriting it', async (status) => {
    const concurrent = payout({ status, commission_cents: 999, notes: 'Concurrent record' });
    const db = database({ tables: { order_commission_snapshots: [snapshot('a')] }, intercept: (call, tables) => {
      if (call.operation !== 'insert') return;
      tables.monthly_commission_payouts = [concurrent];
      return { data: null, error: { code: '23505', message: 'Duplicate payout' } };
    } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    if (status === 'paid') expect(result).toMatchObject({ alreadyPaid: true, payout: concurrent });
    else expect(result.error?.code).toBe('conflict');
    expect(db.saved.monthly_commission_payouts).toEqual([concurrent]);
    expect(writes(db)).toHaveLength(1);
  });

  it('reloads a payout that another request paid before the conditional update', async () => {
    const concurrent = payout({ status: 'paid', paid_at: '2026-09-01T05:00:01Z', paid_by: 'other-admin' });
    const db = database({ tables: { monthly_commission_payouts: [payout()] }, intercept: (call, tables) => {
      if (call.operation === 'update') tables.monthly_commission_payouts = [concurrent];
      return undefined;
    } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(result).toMatchObject({ alreadyPaid: true, payout: concurrent });
    expect(db.saved.monthly_commission_payouts).toEqual([concurrent]);
  });

  it('rejects a concurrent change to locked amounts instead of paying a stale total', async () => {
    const concurrent = payout({ commission_cents: 999, updated_at: '2026-09-01T05:00:01Z' });
    const db = database({ tables: { monthly_commission_payouts: [payout()] }, intercept: (call, tables) => {
      if (call.operation === 'update') tables.monthly_commission_payouts = [concurrent];
      return undefined;
    } });
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).error?.code).toBe('conflict');
    expect(db.saved.monthly_commission_payouts).toEqual([concurrent]);
  });

  it('returns write errors and never claims a payment succeeded without a saved record', async () => {
    const db = database({ tables: { order_commission_snapshots: [snapshot('a')] }, intercept: (call) => call.operation === 'insert'
      ? { data: null, error: { message: 'Insert failed' } } : undefined });
    expect(await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).toEqual({ error: { message: 'Insert failed' } });
  });
});

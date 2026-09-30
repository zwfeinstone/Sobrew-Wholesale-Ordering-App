import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: () => { throw new Error('Tests must inject their client.'); } } }));
vi.mock('@/lib/commission-invoice-eligibility', () => ({ getCommissionInvoiceEligibility: vi.fn() }));
import { getCommissionInvoiceEligibility } from '@/lib/commission-invoice-eligibility';

import {
  buildPayrollCommissionRow,
  isPayrollCommissionMonth,
  loadPayrollCommissions,
  recordPayrollCommissionPaid,
  requiresInvoiceEligibility,
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
    id, order_id: `order-${id}`, center_id: 'center', sales_profile_id: 'sales-a', commission_month: '2026-10-01',
    shipped_at: '2026-10-15T12:00:00Z', revenue_cents: 10_000, product_cogs_cents: 2000,
    shipping_cogs_cents: 1000, processing_fee_cogs_cents: 300, donation_cogs_cents: 200,
    total_cogs_cents: 3500, gross_profit_cents: 6500, commission_percent: 10, commission_cents: 650,
    cogs_estimated: false, ...overrides,
  };
}

function payout(overrides: Partial<PayrollCommissionPayout> = {}): PayrollCommissionPayout {
  return {
    id: 'payout-a', sales_profile_id: 'sales-a', commission_month: '2026-10-01',
    commission_cents: 325.25, donation_cogs_cents: 100, gross_profit_cents: 3252.5, order_count: 1,
    processing_fee_cogs_cents: 150, product_cogs_cents: 1000, revenue_cents: 5002.5,
    shipping_cogs_cents: 500, total_cogs_cents: 1750, status: 'locked',
    locked_at: '2026-10-31T12:00:00Z', locked_by: 'prior-admin', paid_at: null, paid_by: null,
    paid_order_ids: null, notes: 'Agreed adjustment; preserve this note.', updated_at: '2026-10-31T12:00:00Z', ...overrides,
  };
}

const payRequest = { commissionMonth: '2026-10-01', salesProfileId: 'sales-a', actorProfileId: 'admin', now: new Date('2026-11-01T05:00:00Z') };
const writes = (db: ReturnType<typeof database>) => db.calls.filter((call) => call.operation !== 'select');
const invoiceEligibility = vi.mocked(getCommissionInvoiceEligibility);
beforeEach(() => {
  invoiceEligibility.mockReset();
  invoiceEligibility.mockImplementation(async (orderIds) => ({ paidOrderIds: new Set(orderIds), unpaidOrderIds: new Set(), missingInvoiceOrderIds: new Set(), error: null }));
});

function onlyPaidInvoices(...orderIds: string[]) {
  invoiceEligibility.mockImplementation(async (requestedIds) => ({
    paidOrderIds: new Set(requestedIds.filter((id) => orderIds.includes(id))),
    unpaidOrderIds: new Set(requestedIds.filter((id) => !orderIds.includes(id))),
    missingInvoiceOrderIds: new Set(), error: null,
  }));
}

describe('payroll commission month validation', () => {
  it.each(['2026-10-01', '2024-02-01', '0001-01-01'])('accepts canonical real month %s', (month) => {
    expect(isPayrollCommissionMonth(month)).toBe(true);
  });
  it.each(['2026-08', '2026-00-01', '2026-13-01', '2026-08-02', '0000-01-01', '2026-8-01', ' 2026-08-01'])('rejects %s', (month) => {
    expect(isPayrollCommissionMonth(month)).toBe(false);
  });
});

describe('prospective invoice payment policy', () => {
  const historicalMonth = '2026-08-01';
  const historicalSnapshot = (id: string, overrides: Row = {}) => snapshot(id, { commission_month: historicalMonth, shipped_at: '2026-08-15T12:00:00Z', ...overrides });
  const historicalPayout = (overrides: Partial<PayrollCommissionPayout> = {}) => payout({ commission_month: historicalMonth, locked_at: '2026-08-31T12:00:00Z', updated_at: '2026-08-31T12:00:00Z', ...overrides });

  it('leaves historical unpaid commissions payable without consulting QuickBooks', async () => {
    invoiceEligibility.mockRejectedValue(new Error('Historical invoices must not be checked'));
    const db = database({ tables: { order_commission_snapshots: [historicalSnapshot('a')] } });
    const loaded = await loadPayrollCommissions({ commissionMonth: historicalMonth, supabase: db.client });
    expect(loaded.rows[0]).toMatchObject({ amountOwedCents: 650, pendingInvoiceCount: 0, eligibleOrderIds: ['order-a'] });
    expect(writes(db)).toEqual([]);
    const paid = await recordPayrollCommissionPaid({ ...payRequest, commissionMonth: historicalMonth, supabase: db.client });
    expect(paid).toMatchObject({ paymentAmountCents: 650, payout: { commission_cents: 650, paid_order_ids: ['order-a'] } });
    expect(invoiceEligibility).not.toHaveBeenCalled();
  });

  it('preserves every historical locked amount and adjustment when loading and recording payment', async () => {
    invoiceEligibility.mockRejectedValue(new Error('Historical invoices must not be checked'));
    const locked = historicalPayout();
    const db = database({ tables: { monthly_commission_payouts: [locked], order_commission_snapshots: [historicalSnapshot('a', { commission_cents: 99_900 })] } });
    const loaded = await loadPayrollCommissions({ commissionMonth: historicalMonth, supabase: db.client });
    expect(loaded.rows[0]).toMatchObject({ amountOwedCents: 325, pendingInvoiceCount: 0, summary: {
      commissionCents: 325.25, donationCogsCents: 100, grossProfitCents: 3252.5, orderCount: 1,
      processingFeeCogsCents: 150, productCogsCents: 1000, revenueCents: 5002.5, shippingCogsCents: 500, totalCogsCents: 1750,
    } });
    expect(writes(db)).toEqual([]);
    const paid = await recordPayrollCommissionPaid({ ...payRequest, commissionMonth: historicalMonth, expectedPaymentCents: 325, supabase: db.client });
    expect(paid.payout).toEqual({ ...locked, paid_at: payRequest.now.toISOString(), paid_by: 'admin', status: 'paid', updated_at: payRequest.now.toISOString(), paid_order_ids: ['order-a'] });
    expect(invoiceEligibility).not.toHaveBeenCalled();
  });

  it('does not recalculate a historical zero locked payout from older snapshots', async () => {
    const db = database({ tables: { monthly_commission_payouts: [historicalPayout({ commission_cents: 0 })], order_commission_snapshots: [historicalSnapshot('a')] } });
    const paid = await recordPayrollCommissionPaid({ ...payRequest, commissionMonth: historicalMonth, supabase: db.client });
    expect(paid.error).toBeTruthy();
    expect(writes(db)).toEqual([]);
    expect(invoiceEligibility).not.toHaveBeenCalled();
  });

  it('applies the rule at September 30 midnight Chicago, with missing or invalid shipment dates held', async () => {
    const rows = [
      snapshot('before', { commission_month: '2026-09-01', shipped_at: '2026-09-30T04:59:59.999Z' }),
      snapshot('cutoff', { commission_month: '2026-09-01', shipped_at: '2026-09-30T05:00:00.000Z' }),
      snapshot('missing', { commission_month: '2026-09-01', shipped_at: null }),
      snapshot('invalid', { commission_month: '2026-09-01', shipped_at: 'invalid' }),
    ];
    onlyPaidInvoices();
    const db = database({ tables: { order_commission_snapshots: rows } });
    const loaded = await loadPayrollCommissions({ commissionMonth: '2026-09-01', supabase: db.client });
    expect(loaded.rows[0]).toMatchObject({ amountOwedCents: 650, eligibleOrderIds: ['order-before'], pendingInvoiceCount: 3, pendingInvoiceCents: 1950 });
    expect(invoiceEligibility).toHaveBeenCalledWith(['order-cutoff', 'order-invalid', 'order-missing'], db.client);
    expect(rows.map((row) => requiresInvoiceEligibility(row, null))).toEqual([false, true, true, true]);
  });

  it('keeps the historical September lock as a base and releases post-cutoff invoices once', async () => {
    const month = '2026-09-01';
    const locked = historicalPayout({ commission_month: month, locked_at: '2026-09-29T12:00:00Z', updated_at: '2026-09-29T12:00:00Z' });
    const old = historicalSnapshot('before', { commission_month: month, shipped_at: '2026-09-29T12:00:00Z', commission_cents: 99_900 });
    const current = snapshot('cutoff', { commission_month: month, shipped_at: '2026-09-30T05:00:00Z' });
    onlyPaidInvoices();
    const db = database({ tables: { monthly_commission_payouts: [locked], order_commission_snapshots: [old, current] } });
    const initial = await loadPayrollCommissions({ commissionMonth: month, supabase: db.client });
    expect(initial.rows[0]).toMatchObject({ amountOwedCents: 325, summary: { commissionCents: 325.25, orderCount: 1 }, pendingInvoiceCount: 1 });
    const first = await recordPayrollCommissionPaid({ ...payRequest, commissionMonth: month, supabase: db.client });
    expect(first).toMatchObject({ paymentAmountCents: 325, payout: { commission_cents: 325.25, paid_order_ids: ['order-before'] } });
    onlyPaidInvoices('order-cutoff');
    const second = await recordPayrollCommissionPaid({ ...payRequest, commissionMonth: month, supabase: db.client });
    expect(second).toMatchObject({ paymentAmountCents: 650, payout: { commission_cents: 975.25, order_count: 2, paid_order_ids: ['order-before', 'order-cutoff'] } });
    expect(invoiceEligibility.mock.calls.every(([ids]) => ids.length === 1 && ids[0] === 'order-cutoff')).toBe(true);
    const third = await recordPayrollCommissionPaid({ ...payRequest, commissionMonth: month, supabase: db.client });
    expect(third.alreadyPaid).toBe(true);
    expect(writes(db)).toHaveLength(2);
  });

  it('does not duplicate historical snapshots inside a mixed September lock created after cutoff', () => {
    const result = buildPayrollCommissionRow({ salesProfileId: 'sales-a', payout: payout({ commission_month: '2026-09-01', commission_cents: 1300 }),
      snapshots: [historicalSnapshot('old', { commission_month: '2026-09-01' }), snapshot('new', { commission_month: '2026-09-01' })], paidInvoiceOrderIds: new Set(['order-new']) });
    expect(result).toMatchObject({ amountOwedCents: 1300, summary: { commissionCents: 1300, orderCount: 2 }, eligibleOrderIds: ['order-old', 'order-new'] });
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
      monthly_commission_payouts: [payout({ id: 'historical', sales_profile_id: 'historical-sales', status: 'paid' })],
    } });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-10-01', supabase: db.client });
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

  it('recomputes locked payouts from snapshots so stale unpaid totals cannot bypass eligibility', async () => {
    const locked = payout();
    onlyPaidInvoices('order-live');
    const db = database({ tables: { order_commission_snapshots: [snapshot('live'), snapshot('unpaid')], monthly_commission_payouts: [locked] } });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-10-01', supabase: db.client });
    expect(result.rows[0]).toMatchObject({ payout: locked, amountOwedCents: 650, pendingInvoiceCount: 1, pendingInvoiceCents: 650, summary: {
      commissionCents: 650, donationCogsCents: 200, grossProfitCents: 6500, orderCount: 1,
      processingFeeCogsCents: 300, productCogsCents: 2000, revenueCents: 10_000, shippingCogsCents: 1000, totalCogsCents: 3500,
    } });
  });

  it('withholds unpaid, partially paid and missing invoices and releases fully paid invoices', async () => {
    onlyPaidInvoices('order-paid');
    const db = database({ tables: { order_commission_snapshots: [snapshot('paid'), snapshot('unpaid'), snapshot('partial'), snapshot('missing')] } });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-10-01', supabase: db.client });
    expect(result.rows[0]).toMatchObject({ amountOwedCents: 650, eligibleOrderIds: ['order-paid'], pendingInvoiceCount: 3, pendingInvoiceCents: 1950, summary: { orderCount: 1 } });
  });

  it('keeps earlier paid amounts while owing only invoices paid after the first payroll payment', async () => {
    onlyPaidInvoices('order-late');
    const paid = payout({ status: 'paid', paid_order_ids: ['order-earlier'], commission_cents: 650 });
    const db = database({ tables: { monthly_commission_payouts: [paid], order_commission_snapshots: [snapshot('earlier', { commission_cents: 9900 }), snapshot('late'), snapshot('unpaid')] } });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-10-01', supabase: db.client });
    expect(result.rows[0]).toMatchObject({ amountOwedCents: 650, eligibleOrderIds: ['order-late'], paidOrderIds: ['order-earlier'], pendingInvoiceCount: 1, summary: { commissionCents: 1300, orderCount: 2 } });
    expect(invoiceEligibility).toHaveBeenCalledWith(['order-late', 'order-unpaid'], db.client);
  });

  it('fails closed when live invoice status cannot be verified', async () => {
    invoiceEligibility.mockResolvedValue({ paidOrderIds: new Set(), unpaidOrderIds: new Set(), missingInvoiceOrderIds: new Set(), error: 'QuickBooks is unavailable' });
    const db = database({ tables: { order_commission_snapshots: [snapshot('a')] } });
    expect(await loadPayrollCommissions({ commissionMonth: '2026-10-01', supabase: db.client })).toEqual({ rows: [], error: { message: 'QuickBooks is unavailable' } });
  });

  it.each([
    { status: 'paid', paid_at: null },
    { status: 'locked', paid_at: '2026-11-01T05:00:00Z' },
  ])('never owes an already paid payout again (%j)', async (state) => {
    const db = database({ tables: { monthly_commission_payouts: [payout(state)] } });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-10-01', supabase: db.client });
    expect(result.rows[0].amountOwedCents).toBe(0);
  });

  it.each(['order_commission_snapshots', 'monthly_commission_payouts'])('discards partial data when a later %s page fails', async (table) => {
    const db = database({ cap: 1, tables: {
      order_commission_snapshots: [snapshot('a'), snapshot('b')],
      monthly_commission_payouts: [payout(), payout({ id: 'payout-b', sales_profile_id: 'sales-b' })],
    }, intercept: (call) => call.table === table && call.from > 0 ? { data: null, error: { message: 'Failed page' } } : undefined });
    const result = await loadPayrollCommissions({ commissionMonth: '2026-10-01', supabase: db.client });
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
      commission_cents: 20.8, commission_month: '2026-10-01', order_count: 2,
      donation_cogs_cents: 400, gross_profit_cents: 13_000, processing_fee_cogs_cents: 600,
      product_cogs_cents: 4000, revenue_cents: 20_000, shipping_cogs_cents: 2000, total_cogs_cents: 7000,
      sales_profile_id: 'sales-a', status: 'paid', locked_at: payRequest.now.toISOString(), locked_by: 'admin',
      paid_at: payRequest.now.toISOString(), paid_by: 'admin', updated_at: payRequest.now.toISOString(),
      paid_order_ids: ['order-a', 'order-b'],
    });
    expect(db.calls.filter((call) => call.table === 'order_commission_snapshots')).toHaveLength(3);
    expect(writes(db)).toHaveLength(1);
    expect(writes(db)[0].operation).toBe('insert');
  });

  it('pays only fully settled invoices and subsequently releases late payments once', async () => {
    onlyPaidInvoices('order-a');
    const db = database({ tables: { order_commission_snapshots: [snapshot('a'), snapshot('b'), snapshot('partial')] } });
    const first = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(first).toMatchObject({ paymentAmountCents: 650, payout: { commission_cents: 650, order_count: 1, paid_order_ids: ['order-a'] } });
    onlyPaidInvoices('order-a', 'order-b');
    const second = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(second).toMatchObject({ paymentAmountCents: 650, payout: { commission_cents: 1300, order_count: 2, paid_order_ids: ['order-a', 'order-b'] } });
    expect(writes(db)[1].filters).toContainEqual({ column: 'updated_at', value: first.payout?.updated_at, operator: 'eq' });
    expect(second.payout?.updated_at).not.toBe(first.payout?.updated_at);
    const third = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(third.alreadyPaid).toBe(true);
    expect(writes(db)).toHaveLength(2);
    expect(db.saved.monthly_commission_payouts).toHaveLength(1);
  });

  it('avoids aggregate rounding drift across multiple payments in the same month', async () => {
    onlyPaidInvoices('order-a');
    const db = database({ tables: { order_commission_snapshots: [snapshot('a', { commission_cents: 10.4 }), snapshot('b', { commission_cents: 10.4 })] } });
    const first = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(first.paymentAmountCents).toBe(10);
    onlyPaidInvoices('order-a', 'order-b');
    const second = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(second.paymentAmountCents).toBe(11);
    expect(second.payout?.commission_cents).toBe(20.8);
  });

  it('never pays a stale locked amount while every invoice is unpaid', async () => {
    onlyPaidInvoices();
    const db = database({ tables: { monthly_commission_payouts: [payout({ commission_cents: 100_000 })], order_commission_snapshots: [snapshot('unpaid')] } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(result.error?.message).toBe('There is no positive commission amount on paid invoices to pay.');
    expect(writes(db)).toEqual([]);
  });

  it('rejects a stale submitted payment amount when another invoice became payable', async () => {
    const db = database({ tables: { order_commission_snapshots: [snapshot('a'), snapshot('b')] } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, expectedPaymentCents: 650, supabase: db.client });
    expect(result.error?.code).toBe('conflict');
    expect(writes(db)).toEqual([]);
  });

  it('records a submitted amount matching only the newly payable delta', async () => {
    const paid = payout({ status: 'paid', paid_order_ids: ['order-a'], commission_cents: 650 });
    const db = database({ tables: { monthly_commission_payouts: [paid], order_commission_snapshots: [snapshot('a'), snapshot('b')] } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, expectedPaymentCents: 650, supabase: db.client });
    expect(result).toMatchObject({ paymentAmountCents: 650, payout: { commission_cents: 1300, paid_order_ids: ['order-a', 'order-b'] } });
    expect(writes(db)).toHaveLength(1);
  });

  it('fails closed on live invoice query failure or an unexpected rejection', async () => {
    const db = database({ tables: { order_commission_snapshots: [snapshot('a')] } });
    invoiceEligibility.mockResolvedValueOnce({ paidOrderIds: new Set(), unpaidOrderIds: new Set(), missingInvoiceOrderIds: new Set(), error: 'Invoice query failed' });
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).error?.message).toBe('Invoice query failed');
    invoiceEligibility.mockRejectedValueOnce(new Error('Unexpected outage'));
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).error?.message).toBe('Unexpected outage');
    expect(writes(db)).toEqual([]);
  });

  it('replaces stale locked totals with paid invoice commissions while preserving notes and locking metadata', async () => {
    const locked = payout();
    onlyPaidInvoices('order-different-live-total');
    const db = database({ tables: { monthly_commission_payouts: [locked], order_commission_snapshots: [snapshot('different-live-total'), snapshot('unpaid')] } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(result.before).toEqual(locked);
    expect(result.payout).toMatchObject({ commission_cents: 650, paid_order_ids: ['order-different-live-total'], notes: locked.notes, locked_at: locked.locked_at, locked_by: locked.locked_by, status: 'paid', paid_at: payRequest.now.toISOString(), paid_by: 'admin', updated_at: payRequest.now.toISOString() });
    expect(result.paymentAmountCents).toBe(650);
    expect(writes(db)[0].filters).toEqual(expect.arrayContaining([
      { column: 'status', value: 'locked', operator: 'eq' },
      { column: 'updated_at', value: locked.updated_at, operator: 'eq' },
      { column: 'paid_at', value: null, operator: 'is' },
    ]));
    expect(db.calls.some((call) => call.table === 'order_commission_snapshots')).toBe(true);
  });

  it.each([{ status: 'paid', paid_at: null }, { status: 'locked', paid_at: '2026-11-01T05:00:00Z' }])('is idempotent for paid state %j', async (state) => {
    const paid = payout(state);
    const db = database({ tables: { monthly_commission_payouts: [paid] } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(result).toEqual({ alreadyPaid: true, payout: paid, before: paid });
    expect(writes(db)).toEqual([]);
  });

  it.each([
    { commissionMonth: '2026-13-01' }, { commissionMonth: '2026-08' }, { commissionMonth: '2026-11-01' },
    { commissionMonth: '2027-01-01' }, { salesProfileId: null }, { salesProfileId: ' ' }, { actorProfileId: '' },
    { now: new Date('2026-11-01T04:59:59Z') }, // Still October in Central time.
    { expectedPaymentCents: NaN }, { expectedPaymentCents: -1 }, { expectedPaymentCents: 1.2 },
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

  it('recomputes even zero locked totals when paid invoice commissions exist', async () => {
    const db = database({ tables: { monthly_commission_payouts: [payout({ commission_cents: 0 })], order_commission_snapshots: [snapshot('positive')] } });
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).paymentAmountCents).toBe(650);
    expect(writes(db)).toHaveLength(1);
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
    const concurrent = payout({ status: 'paid', paid_at: '2026-11-01T05:00:01Z', paid_by: 'other-admin' });
    const db = database({ tables: { monthly_commission_payouts: [payout()], order_commission_snapshots: [snapshot('a')] }, intercept: (call, tables) => {
      if (call.operation === 'update') tables.monthly_commission_payouts = [concurrent];
      return undefined;
    } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    expect(result).toMatchObject({ alreadyPaid: true, payout: concurrent });
    expect(db.saved.monthly_commission_payouts).toEqual([concurrent]);
  });

  it('rejects a concurrent change to locked amounts instead of paying a stale total', async () => {
    const concurrent = payout({ commission_cents: 999, updated_at: '2026-11-01T05:00:01Z' });
    const db = database({ tables: { monthly_commission_payouts: [payout()], order_commission_snapshots: [snapshot('a')] }, intercept: (call, tables) => {
      if (call.operation === 'update') tables.monthly_commission_payouts = [concurrent];
      return undefined;
    } });
    expect((await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).error?.code).toBe('conflict');
    expect(db.saved.monthly_commission_payouts).toEqual([concurrent]);
  });

  it.each([true, false])('resolves concurrent tracked payments only when all attempted orders were paid (%s)', async (allIncluded) => {
    const original = payout({ status: 'paid', commission_cents: 650, paid_order_ids: ['order-a'] });
    const concurrent = payout({ status: 'paid', commission_cents: 1300, paid_order_ids: allIncluded ? ['order-a', 'order-b', 'order-c'] : ['order-a', 'order-b'], updated_at: '2026-11-01T05:00:01Z' });
    const db = database({ tables: { monthly_commission_payouts: [original], order_commission_snapshots: [snapshot('a'), snapshot('b'), snapshot('c')] }, intercept: (call, tables) => {
      if (call.operation === 'update') tables.monthly_commission_payouts = [concurrent];
      return undefined;
    } });
    const result = await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client });
    if (allIncluded) expect(result).toMatchObject({ alreadyPaid: true, payout: concurrent });
    else expect(result.error?.code).toBe('conflict');
    expect(db.saved.monthly_commission_payouts).toEqual([concurrent]);
  });

  it('returns write errors and never claims a payment succeeded without a saved record', async () => {
    const db = database({ tables: { order_commission_snapshots: [snapshot('a')] }, intercept: (call) => call.operation === 'insert'
      ? { data: null, error: { message: 'Insert failed' } } : undefined });
    expect(await recordPayrollCommissionPaid({ ...payRequest, supabase: db.client })).toEqual({ error: { message: 'Insert failed' } });
  });
});

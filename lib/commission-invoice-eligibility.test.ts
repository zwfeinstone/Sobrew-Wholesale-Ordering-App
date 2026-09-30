import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCommissionInvoiceEligibility } from '@/lib/commission-invoice-eligibility';
import { getQuickBooksInvoiceReceivables, normalizeQuickBooksInvoiceReceivable, type QuickBooksInvoiceReceivable } from '@/lib/quickbooks';

vi.mock('@/lib/quickbooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/quickbooks')>(),
  getQuickBooksInvoiceReceivables: vi.fn(),
}));

type Order = { id: string; quickbooks_invoice_id: string | null };

class InvoiceLinkDatabase {
  calls: Array<{ ids: string[]; from: number }> = [];
  error: string | null = null;
  pageSize = 1000;
  failAfterPage: number | null = null;

  constructor(readonly orders: Order[] = []) {}

  from(table: string) {
    expect(table).toBe('orders');
    const database = this;
    let ids: string[] = [];
    const query = {
      select(columns: string) { expect(columns).toBe('id,quickbooks_invoice_id'); return query; },
      in(column: string, values: string[]) { expect(column).toBe('id'); ids = values; return query; },
      order(column: string) { expect(column).toBe('id'); return query; },
      async range(from: number, to: number) {
        database.calls.push({ ids, from });
        const error = database.error ?? (database.failAfterPage !== null && database.calls.length > database.failAfterPage ? 'Link query failed' : null);
        if (error) return { data: null, error: { message: error } };
        const rows = database.orders.filter((order) => ids.includes(order.id)).sort((left, right) => left.id.localeCompare(right.id));
        return { data: rows.slice(from, Math.min(to + 1, from + database.pageSize)), error: null };
      },
    };
    return query;
  }
}

function invoice(id: string, balance = 0, amount = 100): QuickBooksInvoiceReceivable {
  return normalizeQuickBooksInvoiceReceivable({ Id: id, Balance: balance, TotalAmt: amount })!;
}

const getReceivables = vi.mocked(getQuickBooksInvoiceReceivables);

beforeEach(() => {
  getReceivables.mockReset();
  getReceivables.mockResolvedValue({ error: null, invoices: [], missingIds: [] });
});

describe('commission invoice eligibility', () => {
  it('only releases fully paid, positive-value invoices and holds partial/unpaid/voided invoices', async () => {
    const database = new InvoiceLinkDatabase([
      { id: 'paid-order', quickbooks_invoice_id: 'paid' },
      { id: 'partial-order', quickbooks_invoice_id: 'partial' },
      { id: 'unpaid-order', quickbooks_invoice_id: 'unpaid' },
      { id: 'voided-order', quickbooks_invoice_id: 'voided' },
    ]);
    getReceivables.mockResolvedValue({
      error: null,
      invoices: [invoice('paid'), invoice('partial', 25), invoice('unpaid', 100), invoice('voided', 0, 0)],
      missingIds: [],
    });

    const result = await getCommissionInvoiceEligibility(database.orders.map((order) => order.id), database);

    expect(result.error).toBeNull();
    expect([...result.paidOrderIds]).toEqual(['paid-order']);
    expect([...result.unpaidOrderIds]).toEqual(['partial-order', 'unpaid-order', 'voided-order']);
    expect(result.missingInvoiceOrderIds.size).toBe(0);
  });

  it('holds missing orders, invoice links, and missing QuickBooks invoices', async () => {
    const database = new InvoiceLinkDatabase([
      { id: 'unlinked', quickbooks_invoice_id: null },
      { id: 'blank-link', quickbooks_invoice_id: ' ' },
      { id: 'missing-invoice', quickbooks_invoice_id: 'deleted' },
    ]);
    getReceivables.mockResolvedValue({ error: null, invoices: [], missingIds: ['deleted'] });

    const result = await getCommissionInvoiceEligibility(['unlinked', 'blank-link', 'missing-invoice', 'missing-order'], database);

    expect(result.error).toBeNull();
    expect(result.paidOrderIds.size).toBe(0);
    expect([...result.missingInvoiceOrderIds]).toEqual(['unlinked', 'blank-link', 'missing-invoice', 'missing-order']);
  });

  it('deduplicates IDs and fetches current balances again when checking a payout', async () => {
    const database = new InvoiceLinkDatabase([{ id: 'order', quickbooks_invoice_id: ' invoice ' }]);
    getReceivables.mockResolvedValueOnce({ error: null, invoices: [invoice('invoice')], missingIds: [] });
    getReceivables.mockResolvedValueOnce({ error: null, invoices: [invoice('invoice', 1)], missingIds: [] });

    expect((await getCommissionInvoiceEligibility([' order ', 'order', ''], database)).paidOrderIds.has('order')).toBe(true);
    expect((await getCommissionInvoiceEligibility(['order'], database)).paidOrderIds.has('order')).toBe(false);
    expect(getReceivables).toHaveBeenNthCalledWith(1, ['invoice']);
    expect(getReceivables).toHaveBeenCalledTimes(2);
  });

  it('returns no eligible orders if QuickBooks reports an error even with partial data', async () => {
    const database = new InvoiceLinkDatabase([{ id: 'order', quickbooks_invoice_id: 'invoice' }]);
    getReceivables.mockResolvedValue({ error: 'QuickBooks disconnected', invoices: [invoice('invoice')], missingIds: [] });

    const result = await getCommissionInvoiceEligibility(['order'], database);

    expect(result.error).toContain('QuickBooks disconnected');
    expect(result.paidOrderIds.size).toBe(0);
  });

  it('fails closed when either database or QuickBooks throws', async () => {
    const brokenDatabase = { from() { throw new Error('Database unavailable'); } };
    expect(await getCommissionInvoiceEligibility(['order'], brokenDatabase)).toMatchObject({ error: expect.stringContaining('Database unavailable'), paidOrderIds: new Set() });

    const database = new InvoiceLinkDatabase([{ id: 'order', quickbooks_invoice_id: 'invoice' }]);
    getReceivables.mockRejectedValue(new Error('QuickBooks timeout'));
    expect(await getCommissionInvoiceEligibility(['order'], database)).toMatchObject({ error: 'QuickBooks timeout', paidOrderIds: new Set() });
  });

  it('loads all invoice links across ID batches and database row caps', async () => {
    const orders = Array.from({ length: 405 }, (_, index) => ({ id: `order-${index}`, quickbooks_invoice_id: `invoice-${index}` }));
    const database = new InvoiceLinkDatabase(orders);
    database.pageSize = 73;
    getReceivables.mockResolvedValue({ error: null, invoices: orders.map((order) => invoice(order.quickbooks_invoice_id)), missingIds: [] });

    const result = await getCommissionInvoiceEligibility(orders.map((order) => order.id), database);

    expect(result.error).toBeNull();
    expect(result.paidOrderIds.size).toBe(405);
    expect(database.calls.every((call) => call.ids.length <= 200)).toBe(true);
    expect(database.calls.some((call) => call.from === 73)).toBe(true);
  });

  it('discards partial links if a later database page fails', async () => {
    const database = new InvoiceLinkDatabase([{ id: 'order', quickbooks_invoice_id: 'invoice' }]);
    database.failAfterPage = 1;

    const result = await getCommissionInvoiceEligibility(['order'], database);

    expect(result.error).toContain('Link query failed');
    expect(result.paidOrderIds.size).toBe(0);
    expect(getReceivables).not.toHaveBeenCalled();
  });

  it('does not initialize services for an empty selection or fetch QuickBooks for unlinked orders', async () => {
    const brokenDatabase = { from() { throw new Error('Should not initialize'); } };
    expect(await getCommissionInvoiceEligibility([], brokenDatabase)).toMatchObject({ error: null, paidOrderIds: new Set() });
    const database = new InvoiceLinkDatabase([{ id: 'unlinked', quickbooks_invoice_id: null }]);
    expect((await getCommissionInvoiceEligibility(['unlinked'], database)).missingInvoiceOrderIds.has('unlinked')).toBe(true);
    expect(getReceivables).not.toHaveBeenCalled();
  });
});

describe('unknown QuickBooks balances', () => {
  it.each([undefined, null, '', ' ', 'invalid', Number.NaN, Number.POSITIVE_INFINITY, false, [], {}])(
    'does not normalize malformed Balance %j as a paid invoice',
    (balance) => {
      expect(normalizeQuickBooksInvoiceReceivable({ Id: 'invoice', Balance: balance, TotalAmt: 100 })).toBeNull();
    },
  );

  it('accepts explicit numeric zero balances', () => {
    expect(normalizeQuickBooksInvoiceReceivable({ Id: 'invoice', Balance: '0.00', TotalAmt: 100 })?.status).toBe('paid');
  });
});

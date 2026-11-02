import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ env: {
  quickBooksClientId: 'test-client', quickBooksClientSecret: 'test-secret',
  quickBooksEnvironment: 'sandbox', quickBooksMinorVersion: '75', siteUrl: 'https://example.com',
} }));

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  from(table: string) {
    if (table !== 'quickbooks_connections') throw new Error(`Unexpected table ${table}`);
    return {
      select() { return this; },
      eq() { return this; },
      maybeSingle: async () => ({ data: {
        access_token: 'test-token', access_token_expires_at: '2099-01-01T00:00:00Z',
        environment: 'sandbox', realm_id: 'test-realm', refresh_token: 'test-refresh',
      }, error: null }),
    };
  },
}) }));

import { getQuickBooksInvoiceReceivables } from '@/lib/quickbooks';

type RecordData = Record<string, any>;

function invoice(overrides: RecordData = {}): RecordData {
  return {
    Id: 'invoice-1', TotalAmt: 100, Balance: 0, TxnDate: '2026-09-30',
    MetaData: { CreateTime: '2026-09-30T15:00:00Z', LastUpdatedTime: '2026-11-15T15:00:00Z' },
    LinkedTxn: [{ TxnId: 'payment-1', TxnType: 'Payment' }],
    ...overrides,
  };
}

function payment(overrides: RecordData = {}): RecordData {
  return {
    Id: 'payment-1', TotalAmt: 100, TxnDate: '2026-10-01',
    Line: [{ Amount: 100, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] }],
    ...overrides,
  };
}

function fixture(invoices: RecordData[] = [invoice()], payments: RecordData[] = [payment()], failPayments = false) {
  const queries: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const query = new URL(input).searchParams.get('query') ?? '';
    queries.push(query);
    const match = /^SELECT \* FROM (Invoice|Payment) WHERE Id IN \((.*?)\) MAXRESULTS (\d+)$/.exec(query);
    if (!match) throw new Error(`Unexpected query ${query}`);
    const [, entity, ids] = match;
    if (entity === 'Payment' && failPayments) {
      return Response.json({ Fault: { Error: [{ Message: 'Payment lookup unavailable' }] } }, { status: 503 });
    }
    const records = (entity === 'Invoice' ? invoices : payments).filter((record) => ids.includes(`'${record.Id}'`));
    return Response.json({ QueryResponse: { [entity]: records } });
  }));
  return queries;
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('QuickBooks invoice payment dates', () => {
  it('uses the payment date when a September invoice is paid in October', async () => {
    fixture();

    const result = await getQuickBooksInvoiceReceivables(['invoice-1'], { includePaymentDates: true });

    expect(result).toMatchObject({ error: null, missingIds: [], invoices: [{
      id: 'invoice-1', status: 'paid', txnDate: '2026-09-30', paidDate: '2026-10-01',
    }] });
  });

  it('keeps default balance reads compatible without requesting payment records', async () => {
    const queries = fixture();

    const result = await getQuickBooksInvoiceReceivables(['invoice-1']);

    expect(result.invoices[0]).not.toHaveProperty('paidDate');
    expect(queries).toHaveLength(1);
  });

  it('does not assign a payment date to an invoice that is still partially paid', async () => {
    const queries = fixture([invoice({ Balance: 60 })], [payment({ TotalAmt: 40 })]);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1'], { includePaymentDates: true });

    expect(result.invoices[0]).toMatchObject({ status: 'unpaid', paidDate: null });
    expect(queries).toHaveLength(1);
  });

  it('uses the final payment date after installments across multiple months', async () => {
    fixture([invoice({ LinkedTxn: [
      { TxnId: 'payment-final', TxnType: 'Payment' },
      { TxnId: 'payment-first', TxnType: 'Payment' },
      { TxnId: 'payment-first', TxnType: 'Payment' },
    ] })], [
      payment({ Id: 'payment-final', TotalAmt: 60, TxnDate: '2026-10-10',
        Line: [{ Amount: 60, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] }] }),
      payment({ Id: 'payment-first', TotalAmt: 40, TxnDate: '2026-09-30',
        Line: [{ Amount: 40, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] }] }),
    ]);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1'], { includePaymentDates: true });

    expect(result.invoices[0]?.paidDate).toBe('2026-10-10');
  });

  it.each([undefined, null, '', '2026-02-30', '2026-10-01T12:00:00Z', 'not-a-date'])('does not guess a missing or invalid payment date: %s', async (date) => {
    fixture([invoice()], [payment({ TxnDate: date })]);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1'], { includePaymentDates: true });

    expect(result.invoices[0]?.paidDate).toBeNull();
  });

  it('leaves paid invoices without linked payments unresolved', async () => {
    const queries = fixture([invoice({ LinkedTxn: [] })]);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1'], { includePaymentDates: true });

    expect(result.invoices[0]).toMatchObject({ status: 'paid', paidDate: null });
    expect(queries).toHaveLength(1);
  });

  it('does not trust a linked payment that is missing or applied to another invoice', async () => {
    fixture([invoice(), invoice({ Id: 'invoice-2', LinkedTxn: [{ TxnId: 'missing', TxnType: 'Payment' }] })], [
      payment({ Line: [{ Amount: 100, LinkedTxn: [{ TxnId: 'different-invoice', TxnType: 'Invoice' }] }] }),
    ]);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1', 'invoice-2'], { includePaymentDates: true });

    expect(result.invoices.map((record) => record.paidDate)).toEqual([null, null]);
  });

  it('does not infer a cash-paid date from credit adjustments', async () => {
    fixture([invoice()], [payment({ TotalAmt: 80, Line: [
      { Amount: 100, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] },
      { Amount: 20, LinkedTxn: [{ TxnId: 'credit-1', TxnType: 'CreditMemo' }] },
    ] })]);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1'], { includePaymentDates: true });

    expect(result.invoices[0]?.paidDate).toBeNull();
  });

  it('requires cash allocations to cover the invoice total exactly', async () => {
    fixture([invoice()], [payment({ TotalAmt: 80,
      Line: [{ Amount: 80, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] }],
    })]);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1'], { includePaymentDates: true });

    expect(result.invoices[0]?.paidDate).toBeNull();
  });

  it('reads a shared payment once and uses each invoice allocation', async () => {
    const queries = fixture([invoice(), invoice({ Id: 'invoice-2', TotalAmt: 50 })], [payment({
      TotalAmt: 175, UnappliedAmt: 25, Line: [
        { Amount: 100, LinkedTxn: [{ TxnId: 'invoice-1', TxnType: 'Invoice' }] },
        { Amount: 50, LinkedTxn: [{ TxnId: 'invoice-2', TxnType: 'Invoice' }] },
      ],
    })]);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1', 'invoice-2'], { includePaymentDates: true });

    expect(result.invoices.map((record) => record.paidDate)).toEqual(['2026-10-01', '2026-10-01']);
    expect(queries.filter((query) => query.includes('FROM Payment'))).toEqual([
      "SELECT * FROM Payment WHERE Id IN ('payment-1') MAXRESULTS 1",
    ]);
  });

  it('does not return partial invoice results if payment-date verification fails', async () => {
    fixture([invoice()], [payment()], true);

    const result = await getQuickBooksInvoiceReceivables(['invoice-1'], { includePaymentDates: true });

    expect(result).toEqual({ error: 'Payment lookup unavailable', invoices: [], missingIds: [] });
  });
});

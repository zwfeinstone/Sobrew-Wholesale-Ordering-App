import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ updates: [] as Array<{ id: string; values: Record<string, unknown> }> }));
vi.mock('@/lib/env', () => ({ env: {
  quickBooksClientId: 'test-client',
  quickBooksClientSecret: 'test-secret',
  quickBooksEnvironment: 'sandbox',
  quickBooksMinorVersion: '75',
  siteUrl: 'https://example.com',
} }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  from: (table: string) => {
    let id = '';
    let values: Record<string, unknown> = {};
    return {
      select() { return this; },
      eq(column: string, value: string) { if (column === 'id') id = value; return this; },
      is() { return this; },
      update(value: Record<string, unknown>) { values = value; return this; },
      async maybeSingle() {
        if (table === 'quickbooks_connections') return { data: {
          access_token: 'test-token', access_token_expires_at: '2099-01-01T00:00:00Z',
          environment: 'sandbox', realm_id: 'test-realm', refresh_token: 'test-refresh',
        }, error: null };
        database.updates.push({ id, values });
        return { data: { id }, error: null };
      },
    };
  },
}) }));

import { getQuickBooksSavedPaymentMethodLookups, reconcileQuickBooksPaidInvoicesForOrders } from './quickbooks';

function order(id: string, customer = 'customer-1') {
  return {
    id, centers: { quickbooks_customer_id: customer }, subtotal_cents: 1200,
    archived_at: '2026-08-05T12:00:00Z', created_at: '2026-08-01T12:00:00Z', shipped_at: '2026-08-03T12:00:00Z',
  };
}
function paidInvoice(id: string) {
  return { Id: `invoice-${id}`, PrivateNote: `Sobrew order ${id}`, TotalAmt: 12, Balance: 0, TxnDate: '2026-08-04', DocNumber: `SO-${id}` };
}
function query(url: string | URL | Request) {
  return new URL(String(url)).searchParams.get('query') ?? '';
}

beforeEach(() => {
  database.updates.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('QuickBooks reconciliation reads', () => {
  it('shares a customer/date-window read without mixing order matches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ QueryResponse: { Invoice: [paidInvoice('one'), paidInvoice('two')] } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await reconcileQuickBooksPaidInvoicesForOrders([order('one'), order('two')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
    expect(result.reconciled.map((item) => [item.orderId, item.invoiceId])).toEqual([['one', 'invoice-one'], ['two', 'invoice-two']]);
    expect(database.updates.map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('keeps different date windows separate and reads all pages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const firstWindow = query(url).includes("TxnDate >= '2026-07-31'");
      const firstPage = query(url).includes('STARTPOSITION 1 ');
      const invoices = firstWindow
        ? firstPage ? Array.from({ length: 100 }, (_, index) => ({ Id: `unpaid-${index}`, TotalAmt: 12, Balance: 12 })) : [paidInvoice('one')]
        : [];
      return Response.json({ QueryResponse: { Invoice: invoices } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const otherWindow = { ...order('later'), created_at: '2026-08-20T12:00:00Z', shipped_at: '2026-08-22T12:00:00Z' };
    const result = await reconcileQuickBooksPaidInvoicesForOrders([order('one'), otherWindow]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.reconciled.map((item) => item.orderId)).toEqual(['one']);
    expect(fetchMock.mock.calls.some(([url]) => query(url).includes('STARTPOSITION 101 '))).toBe(true);
  });

  it('limits independent reads to four and retains successful matches after another customer read fails', async () => {
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => { setImmediate(resolve); });
      active -= 1;
      if (query(url).includes("CustomerRef = 'customer-0'")) {
        return Response.json({ Fault: { Error: [{ Message: 'Read unavailable' }] } }, { status: 503 });
      }
      const id = /CustomerRef = 'customer-(\d+)'/.exec(query(url))?.[1] ?? '';
      return Response.json({ QueryResponse: { Invoice: [paidInvoice(id)] } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await reconcileQuickBooksPaidInvoicesForOrders(Array.from({ length: 9 }, (_, index) => order(String(index), `customer-${index}`)));
    expect(peak).toBe(4);
    expect(result.error).toContain('Read unavailable');
    expect(result.reconciled).toHaveLength(8);
  });

  it('does not keep reconciliation results across invocations', async () => {
    const fetchMock = vi.fn(async () => Response.json({ QueryResponse: { Invoice: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await reconcileQuickBooksPaidInvoicesForOrders([order('one')]);
    await reconcileQuickBooksPaidInvoicesForOrders([order('one')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('QuickBooks saved payment transport', () => {
  it('keeps customer-payment URLs separate from accounting URLs and reports provider errors', async () => {
    const fetchMock = vi.fn(async () => Response.json({ message: 'Unavailable' }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await getQuickBooksSavedPaymentMethodLookups(['customer-1', 'customer-1']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, options] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(url).toContain('/customers/customer-1/');
      expect(url).not.toContain('minorversion=');
      expect(options.headers).toMatchObject({ Authorization: 'Bearer test-token' });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    }
    expect(result).toHaveLength(1);
    expect(result[0].error).toBeTruthy();
  });
});

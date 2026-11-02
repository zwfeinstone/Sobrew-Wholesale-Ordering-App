import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  writes: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({
  from(table: string) {
    if (table !== 'orders') throw new Error(`Prepaid orders must not access ${table}.`);
    const predicates: Array<(row: Record<string, unknown>) => boolean> = [];
    let columns = '';
    let values: Record<string, unknown> | null = null;
    const result = () => {
      if (!predicates.every((predicate) => predicate(database.order))) return { data: null, error: null };
      if (values) database.writes.push(values);
      const data = Object.fromEntries(Object.entries(database.order).filter(([key]) => columns.split(',').includes(key)));
      return { data, error: null };
    };
    return {
      select(value: string) { columns = value; return this; },
      update(value: Record<string, unknown>) { values = value; return this; },
      eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return this; },
      neq(key: string, value: unknown) { predicates.push((row) => row[key] !== value); return this; },
      is(key: string, value: unknown) { predicates.push((row) => (row[key] ?? null) === value); return this; },
      in(key: string, allowed: unknown[]) { predicates.push((row) => allowed.includes(row[key])); return this; },
      single: async () => result(),
      maybeSingle: async () => result(),
    };
  },
}) }));

import {
  buildQuickBooksInvoicePayload,
  createQuickBooksInvoiceForOrder,
  createQuickBooksPaidInvoiceForOrder,
  findQuickBooksPaidInvoiceMatchForOrder,
  fulfillShippedOrderBilling,
  getQuickBooksInvoiceEmailPreviewForOrder,
  getQuickBooksInvoiceEmailRecipientsForOrder,
  getQuickBooksInvoicePdfForOrder,
  reconcileQuickBooksPaidInvoicesForOrders,
} from './quickbooks';

beforeEach(() => {
  database.writes.length = 0;
  database.order = {
    id: 'shopify-order', order_source: 'shopify', shopify_order_id: 'gid://shopify/Order/1001',
    status: 'Shipped', order_kind: 'wholesale', archived_at: null, invoice_status: 'not_invoiced',
    quickbooks_invoice_id: 'accidentally-linked-invoice',
  };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Prepaid order contacted QuickBooks.'); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Shopify prepaid billing exclusion', () => {
  it.each([
    ['create and send invoice', createQuickBooksInvoiceForOrder],
    ['charge saved payment', createQuickBooksPaidInvoiceForOrder],
    ['load invoice recipients', getQuickBooksInvoiceEmailRecipientsForOrder],
    ['preview invoice email', getQuickBooksInvoiceEmailPreviewForOrder],
    ['download order invoice PDF', getQuickBooksInvoicePdfForOrder],
  ])('blocks %s before reading credentials, writing audits, or calling QuickBooks', async (_label, action) => {
    await expect(action('shopify-order')).rejects.toThrow('Shopify order is already paid');
    expect(database.writes).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('also blocks an imported order when only its Shopify ID identifies its source', async () => {
    database.order.order_source = 'portal';
    await expect(createQuickBooksPaidInvoiceForOrder('shopify-order')).rejects.toThrow('Shopify order is already paid');
    expect(database.writes).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not claim an imported order for automatic billing even if it is marked not invoiced', async () => {
    expect(await fulfillShippedOrderBilling('shopify-order')).toEqual({ status: 'skipped' });
    expect(database.writes).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not match or reconcile an unrelated paid QuickBooks invoice to a Shopify order', async () => {
    const order = {
      id: 'shopify-order', order_source: 'shopify', shopify_order_id: 'gid://shopify/Order/1001',
      archived_at: '2026-10-09T12:00:00Z', created_at: '2026-10-07T12:00:00Z', shipped_at: '2026-10-08T12:00:00Z',
      centers: { quickbooks_customer_id: 'customer-1' }, subtotal_cents: 1200,
    };
    const invoice = { Id: 'invoice-1', TotalAmt: 12, Balance: 0, PrivateNote: 'Sobrew order shopify-order' };
    expect(findQuickBooksPaidInvoiceMatchForOrder(order, [invoice])).toBeNull();
    expect(await reconcileQuickBooksPaidInvoicesForOrders([order])).toEqual({ error: null, reconciled: [] });
    expect(database.writes).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses to build an invoice payload for a prepaid Shopify order', () => {
    const order = {
      id: 'shopify-order', order_source: 'shopify', created_at: null, notes: null,
      shipping_address1: null, shipping_address2: null, shipping_city: null,
      shipping_name: null, shipping_state: null, shipping_zip: null,
    };
    expect(() => buildQuickBooksInvoicePayload(order, { value: 'customer-1' })).toThrow('Shopify order is already paid');
  });
});

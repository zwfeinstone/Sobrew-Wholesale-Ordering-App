import { describe, expect, it } from 'vitest';
import { buildQuickBooksInvoicePayload } from '@/lib/quickbooks';

describe('quickbooks invoice payload', () => {
  it('maps Sobrew order lines into QuickBooks invoice lines', () => {
    const payload = buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Lakeview Recovery' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-12345678',
        notes: 'Deliver to front desk.',
        order_items: [
          {
            line_total_cents: 7200,
            product_name_snapshot: 'Cold Brew Case',
            products: { name: 'Cold Brew Case', sku: 'CB-CASE' },
            qty: 3,
            unit_price_cents: 2400,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '123 Main St',
        shipping_address2: null,
        shipping_city: 'Chicago',
        shipping_company: null,
        shipping_name: 'Lakeview Recovery',
        shipping_state: 'IL',
        shipping_zip: '60601',
      },
      { name: 'Lakeview Recovery', value: '42' },
      { name: 'Wholesale Product', value: '9' }
    );

    expect(payload.CustomerRef).toEqual({ name: 'Lakeview Recovery', value: '42' });
    expect(payload.BillEmail).toEqual({ Address: 'buyer@example.com' });
    expect(payload.Line).toEqual([
      {
        Amount: 72,
        Description: 'Cold Brew Case (CB-CASE)',
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { name: 'Wholesale Product', value: '9' },
          Qty: 3,
          UnitPrice: 24,
        },
      },
    ]);
    expect(payload.PrivateNote).toContain('Sobrew order order-12345678');
    expect(payload.PrivateNote).toContain('Deliver to front desk.');
  });
});

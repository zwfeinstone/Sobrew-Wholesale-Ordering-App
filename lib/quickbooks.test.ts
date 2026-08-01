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
          TaxCodeRef: { value: 'NON' },
          UnitPrice: 24,
        },
      },
    ]);
    expect(payload.PrivateNote).toContain('Sobrew order order-12345678');
    expect(payload.PrivateNote).toContain('Deliver to front desk.');
  });

  it('marks invoice lines taxable for for-profit customers in sales tax states', () => {
    const payload = buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Memphis Cafe', customer_tax_status: 'for_profit' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-taxable',
        notes: null,
        order_items: [
          {
            line_total_cents: 2400,
            product_name_snapshot: 'Cold Brew Case',
            products: { name: 'Cold Brew Case', sku: 'CB-CASE' },
            qty: 1,
            unit_price_cents: 2400,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '289 Aurora Circle',
        shipping_address2: null,
        shipping_city: 'Memphis',
        shipping_company: null,
        shipping_name: 'Memphis Cafe',
        shipping_state: 'TN',
        shipping_zip: '38111',
      },
      { name: 'Memphis Cafe', value: '42' },
      { name: 'Wholesale Product', value: '9' },
      { taxableStates: ['TN', 'GA'] }
    );

    expect(payload.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: 'TAX' });
  });

  it('uses mapped product item refs on invoice lines', () => {
    const payload = buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Mapped Center' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-mapped-products',
        notes: null,
        order_items: [
          {
            line_total_cents: 3600,
            product_name_snapshot: 'Sweet Tea Case',
            products: {
              name: 'Sweet Tea Case',
              quickbooks_item_id: '73',
              quickbooks_item_name: 'Sweet Tea Case',
              sku: 'TEA-SWEET',
            },
            qty: 2,
            unit_price_cents: 1800,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '123 Main St',
        shipping_address2: null,
        shipping_city: 'Chicago',
        shipping_company: null,
        shipping_name: 'Mapped Center',
        shipping_state: 'IL',
        shipping_zip: '60601',
      },
      { name: 'Mapped Center', value: '42' },
      { name: 'Fallback Item', value: '9' }
    );

    expect(payload.Line[0].SalesItemLineDetail.ItemRef).toEqual({
      name: 'Sweet Tea Case',
      value: '73',
    });
  });

  it('keeps invoice lines non-taxable for exempt customers in sales tax states', () => {
    const payload = buildQuickBooksInvoicePayload(
      {
        centers: { name: 'Memphis Recovery Nonprofit', customer_tax_status: 'tax_exempt' },
        created_at: '2026-08-01T15:00:00.000Z',
        id: 'order-exempt',
        notes: null,
        order_items: [
          {
            line_total_cents: 2400,
            product_name_snapshot: 'Cold Brew Case',
            products: { name: 'Cold Brew Case', sku: 'CB-CASE' },
            qty: 1,
            unit_price_cents: 2400,
          },
        ],
        profiles: { email: 'buyer@example.com', full_name: 'Buyer Name' },
        shipping_address1: '289 Aurora Circle',
        shipping_address2: null,
        shipping_city: 'Memphis',
        shipping_company: null,
        shipping_name: 'Memphis Recovery Nonprofit',
        shipping_state: 'TN',
        shipping_zip: '38111',
      },
      { name: 'Memphis Recovery Nonprofit', value: '42' },
      { name: 'Wholesale Product', value: '9' },
      { taxableStates: ['TN'] }
    );

    expect(payload.Line[0].SalesItemLineDetail.TaxCodeRef).toEqual({ value: 'NON' });
  });
});

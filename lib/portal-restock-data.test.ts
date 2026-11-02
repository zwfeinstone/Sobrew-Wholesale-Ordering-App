import { describe, expect, it } from 'vitest';
import { buildPortalRestockData, type PortalProductRow } from '@/lib/portal-restock-data';

const catalog: PortalProductRow[] = [
  {
    product_id: 'coffee',
    name: 'Sunrise Blend',
    description: 'Two pound bag',
    image_url: null,
    category: 'coffee',
    current_price_cents: 1500,
  },
];

describe('buildPortalRestockData', () => {
  it('shows the finite allocation and limits reorder quantities to remaining availability', () => {
    const customerStockBalances = [{
      allocation_id: 'batch', product_id: 'coffee', initial_quantity: 1000,
      available_quantity: 900, reserved_quantity: 100, on_hand_quantity: 1000,
    }];
    const result = buildPortalRestockData({
      productRows: [{ ...catalog[0], current_price_cents: 0 }],
      customerStockBalances,
      recurringOrderRows: [],
      recentOrder: {
        id: 'initial-purchase', created_at: null, subtotal_cents: 690000,
        order_items: [{ id: 'batch-line', product_id: 'coffee', product_name_snapshot: 'Custom bags', qty: 1000, unit_price_cents: 690 }],
      },
    });
    expect(result.products[0].customer_stock).toEqual(customerStockBalances[0]);
    expect(result.recentOrder).toMatchObject({ itemCount: 900, unavailableItemCount: 100, reorderSubtotalLabel: '$0.00' });
    expect(result.recentOrder?.items[0].qty).toBe(900);
  });

  it('caps the recent reorder across both variants in the shared allocation', () => {
    const productRows = ['ground', 'whole'].map((id) => ({ ...catalog[0], product_id: id, name: id, current_price_cents: 0 }));
    const result = buildPortalRestockData({
      productRows,
      customerStockBalances: productRows.map((product) => ({ allocation_id: 'batch', product_id: product.product_id, shared_product_count: 2, initial_quantity: 1000, available_quantity: 1000, reserved_quantity: 0, on_hand_quantity: 1000 })),
      recurringOrderRows: [],
      recentOrder: { id: 'mixed', created_at: null, subtotal_cents: 0, order_items: productRows.map((product, i) => ({ id: product.product_id, product_id: product.product_id, product_name_snapshot: product.name, qty: i === 0 ? 600 : 500, unit_price_cents: 0 })) },
    });
    expect(result.recentOrder?.items.map((item) => item.qty)).toEqual([600, 400]);
    expect(result.recentOrder).toMatchObject({ itemCount: 1000, unavailableItemCount: 100 });
  });

  it('keeps exhausted allocations visible but excludes them from one-click reorder', () => {
    const result = buildPortalRestockData({
      productRows: catalog,
      customerStockBalances: [{ allocation_id: 'batch', product_id: 'coffee', initial_quantity: 1000, available_quantity: 0, reserved_quantity: 0, on_hand_quantity: 0 }],
      recurringOrderRows: [],
      recentOrder: { id: 'delivery', created_at: null, subtotal_cents: 0, order_items: [{ id: 'line', product_id: 'coffee', product_name_snapshot: 'Bags', qty: 100, unit_price_cents: 0 }] },
    });
    expect(result.products).toHaveLength(1);
    expect(result.recentOrder?.items).toEqual([]);
  });

  it('uses current catalog pricing for reorder items and reports unavailable quantities', () => {
    const result = buildPortalRestockData({
      productRows: catalog,
      recentOrder: {
        id: 'order-1',
        created_at: '2026-07-10T12:00:00.000Z',
        subtotal_cents: 3300,
        order_items: [
          {
            id: 'item-1',
            product_id: 'coffee',
            product_name_snapshot: 'Old Sunrise Name',
            qty: 2,
            unit_price_cents: 1200,
          },
          {
            id: 'item-2',
            product_id: 'unavailable-filter-pack',
            product_name_snapshot: 'Filter Pack',
            qty: 1,
            unit_price_cents: 900,
          },
        ],
      },
      recurringOrderRows: [],
    });

    expect(result.recentOrder).toMatchObject({
      historicalSubtotalLabel: '$33.00',
      itemCount: 2,
      reorderSubtotalLabel: '$30.00',
      reorderTotalChanged: true,
      unavailableItemCount: 1,
    });
    expect(result.recentOrder?.items).toEqual([
      { product_id: 'coffee', name: 'Sunrise Blend', price_cents: 1500, qty: 2 },
    ]);
  });

  it('keeps a recent-order summary when every previous item is unavailable', () => {
    const result = buildPortalRestockData({
      productRows: catalog,
      recentOrder: {
        id: 'order-2',
        created_at: '2026-07-10T12:00:00.000Z',
        subtotal_cents: 1850,
        order_items: [{
          id: 'item-1',
          product_id: 'no-longer-assigned',
          product_name_snapshot: 'Archived Product',
          qty: 2,
          unit_price_cents: 925,
        }],
      },
      recurringOrderRows: [],
    });

    expect(result.recentOrder).toMatchObject({
      historicalSubtotalLabel: '$18.50',
      itemCount: 0,
      reorderSubtotalLabel: '$0.00',
      unavailableItemCount: 2,
    });
    expect(result.recentOrder?.items).toEqual([]);
  });

  it('summarizes active recurring schedules and selects the earliest next date', () => {
    const result = buildPortalRestockData({
      productRows: catalog,
      recentOrder: null,
      recurringOrderRows: [
        { frequency: '4_weeks', created_at: '2026-07-01T12:00:00.000Z', last_generated_at: null },
        { frequency: '1_week', created_at: '2026-07-05T12:00:00.000Z', last_generated_at: null },
      ],
    });

    expect(result.recentOrder).toBeNull();
    expect(result.recurringSummary).toEqual({ activeCount: 2, nextDateLabel: 'Jul 12' });
  });
});

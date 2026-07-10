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

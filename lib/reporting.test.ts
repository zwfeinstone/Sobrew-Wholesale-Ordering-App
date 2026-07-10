import { describe, expect, it } from 'vitest';
import { buildReportingDashboard } from '@/lib/reporting';

describe('report math', () => {
  it('uses line-item revenue, quantity, and shipping totals for the selected period', () => {
    const dashboard = buildReportingDashboard({
      centers: [{ id: 'center-1', name: 'Recovery Center', is_active: true, created_at: '2026-05-01T12:00:00.000Z' }],
      filters: {
        selectedMonth: new Date('2026-07-01T12:00:00.000Z'),
        rangeStart: new Date('2026-07-01T00:00:00.000Z'),
        rangeEndExclusive: new Date('2026-08-01T00:00:00.000Z'),
      },
      now: new Date('2026-07-10T18:00:00.000Z'),
      orderItems: [
        {
          order_id: 'order-1',
          product_id: 'product-1',
          product_name_snapshot: 'Sunrise Blend',
          qty: 2,
          unit_price_cents: 1299,
          line_total_cents: 2598,
        },
        {
          order_id: 'order-1',
          product_id: 'product-2',
          product_name_snapshot: 'Filter Pack',
          qty: 1,
          unit_price_cents: 925,
          line_total_cents: 925,
        },
      ],
      orders: [
        {
          id: 'order-1',
          center_id: 'center-1',
          status: 'New',
          subtotal_cents: 3523,
          shipping_cost_cents: 600,
          created_at: '2026-07-10T15:00:00.000Z',
        },
      ],
      products: [
        { id: 'product-1', name: 'Sunrise Blend', sku: 'SUN', active: true },
        { id: 'product-2', name: 'Filter Pack', sku: 'FLT', active: true },
      ],
    });

    expect(dashboard.selectedMonthMetrics).toMatchObject({
      revenueCents: 3523,
      shippingCostCents: 600,
      grossAfterShippingCents: 2923,
      orderCount: 1,
      unitsSold: 3,
      quantitySold: 3,
      averageOrderValueCents: 3523,
    });
    expect(dashboard.topSellingProducts[0]).toMatchObject({
      productName: 'Sunrise Blend',
      revenueCents: 2598,
      quantitySold: 2,
    });
  });
});

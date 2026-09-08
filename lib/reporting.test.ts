import { describe, expect, it } from 'vitest';
import { buildReportingDashboard } from '@/lib/reporting';

describe('report math', () => {
  it('keeps customer and inventory results identical when a large mixed history is scoped to one center', () => {
    const centers = Array.from({ length: 20 }, (_, index) => ({
      id: `center-${index}`, name: `Center ${index}`, is_active: index % 4 !== 0, created_at: '2020-01-01T12:00:00Z',
    }));
    const products = [
      { id: 'coffee', name: 'Coffee', sku: 'COF', active: true },
      { id: 'tea', name: 'Tea', sku: 'TEA', active: false },
    ];
    const dates = ['1999-12-31T12:00:00Z', '2026-04-12T12:00:00Z', '2026-06-15T12:00:00Z', '2026-07-01T05:00:00Z', '2026-07-12T12:00:00Z', '2026-08-01T05:00:00Z'];
    const orders = Array.from({ length: 1200 }, (_, index) => ({
      id: `order-${index}`, center_id: centers[index % centers.length].id,
      status: index % 2 ? 'Shipped' : 'New', subtotal_cents: 1234 + index,
      shipping_cost_cents: index % 7 * 10, created_at: dates[Math.floor(index / centers.length) % dates.length],
    }));
    const orderItems = orders.flatMap((order, index) => products.map((product, itemIndex) => ({
      order_id: order.id, product_id: product.id, product_name_snapshot: product.name,
      qty: 1 + (index + itemIndex) % 5, unit_price_cents: 100 + index, line_total_cents: 200 + index,
    })));
    const input = {
      centers, products, orders, orderItems,
      now: new Date('2026-07-18T18:00:00Z'),
      filters: {
        selectedMonth: new Date('2026-07-01T12:00:00Z'),
        rangeStart: new Date('2026-07-01T05:00:00Z'),
        rangeEndExclusive: new Date('2026-08-01T05:00:00Z'),
      },
    };
    const unchangedInput = structuredClone(input);
    const combined = buildReportingDashboard(input);
    expect(combined.customerSalesRows).toHaveLength(20);

    for (const centerId of ['center-0', 'center-7', 'center-19']) {
      const filters = { ...input.filters, centerId, productId: 'tea' };
      const scoped = buildReportingDashboard({ ...input, filters });
      const centerOrders = orders.filter((order) => order.center_id === centerId);
      const centerOrderIds = new Set(centerOrders.map((order) => order.id));
      const isolated = buildReportingDashboard({
        ...input, filters,
        centers: centers.filter((center) => center.id === centerId),
        orders: centerOrders,
        orderItems: orderItems.filter((item) => centerOrderIds.has(item.order_id)),
      });
      expect(scoped).toEqual(isolated);
      const customer = buildReportingDashboard({ ...input, filters: { ...input.filters, centerId } });
      expect(customer.customerSalesRows[0]).toEqual(combined.customerSalesRows.find((row) => row.centerId === centerId));
    }
    expect(input).toEqual(unchangedInput);
  });

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

  it('uses Central time for daily snapshot order counts', () => {
    const dashboard = buildReportingDashboard({
      centers: [{ id: 'center-1', name: 'Recovery Center', is_active: true, created_at: '2026-08-01T12:00:00.000Z' }],
      filters: {
        selectedMonth: new Date('2026-08-10T18:00:00.000Z'),
        rangeStart: new Date('2026-08-01T05:00:00.000Z'),
        rangeEndExclusive: new Date('2026-09-01T05:00:00.000Z'),
      },
      now: new Date('2026-08-10T18:00:00.000Z'),
      orderItems: [],
      orders: [
        {
          id: 'late-yesterday-central',
          center_id: 'center-1',
          status: 'Shipped',
          subtotal_cents: 26480,
          shipping_cost_cents: 0,
          created_at: '2026-08-10T02:28:00.000Z',
        },
        {
          id: 'today-central',
          center_id: 'center-1',
          status: 'New',
          subtotal_cents: 16500,
          shipping_cost_cents: 0,
          created_at: '2026-08-10T18:04:00.000Z',
        },
      ],
      products: [],
    });

    expect(dashboard.dailySnapshot.ordersToday).toBe(1);
    expect(dashboard.dailySnapshot.revenueTodayCents).toBe(16500);
    expect(dashboard.dailySnapshot.ordersMonthToDate).toBe(2);
    expect(dashboard.dailySnapshot.revenueMonthToDateCents).toBe(42980);
  });
});

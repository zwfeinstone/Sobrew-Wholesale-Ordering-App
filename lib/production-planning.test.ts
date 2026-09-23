import { describe, expect, it } from 'vitest';
import {
  addPlanningDays,
  buildProductionPlan,
  planningDateKey,
  productionPlanningQueryWindow,
  sortProductionPlanningProducts,
  subtractPlanningBusinessDays,
  type PlanningOrderInput,
  type PlanningScheduleInput,
  type ProductionPlanningInput,
} from '@/lib/production-planning';

const NOW = '2026-09-23T17:00:00Z'; // Wednesday, Chicago
const product = { id: 'coffee', name: 'House Blend', active: true };
const line = (qty: number, productId = 'coffee') => ({ product_id: productId, qty });
const order = (qty: number, overrides: Partial<PlanningOrderInput> = {}): PlanningOrderInput => ({
  id: 'order-1', status: 'New', created_at: '2026-09-21T15:00:00Z', order_items: [line(qty)], ...overrides,
});
const schedule = (qty: number, overrides: Partial<PlanningScheduleInput> = {}): PlanningScheduleInput => ({
  id: 'schedule-1', status: 'active', active: true, frequency: '1_week',
  next_run_at: '2026-09-25T12:00:00Z', customer_name: 'Main Street Cafe', recurring_order_items: [line(qty)], ...overrides,
});
const input = (overrides: Partial<ProductionPlanningInput> = {}): ProductionPlanningInput => ({
  now: NOW, products: [product], stockByProductId: {}, orders: [], schedules: [], pars: [], ...overrides,
});
const plan = (overrides: Partial<ProductionPlanningInput> = {}) => buildProductionPlan(input(overrides));
const row = (overrides: Partial<ProductionPlanningInput> = {}) => plan(overrides).products[0];

function weeklyShipments(quantities: number[]): PlanningOrderInput[] {
  return quantities.map((qty, index) => order(qty, {
    id: `shipped-${index}`, status: 'Shipped',
    created_at: '2025-01-01T12:00:00Z',
    shipped_at: `${addPlanningDays('2026-07-27', index * 7)}T16:00:00Z`,
  }));
}

describe('production planning calendar', () => {
  it('uses Chicago today and fourteen inclusive calendar dates', () => {
    const result = plan({ now: '2026-09-24T04:59:59Z' });
    expect(result.today).toBe('2026-09-23');
    expect(result.horizonEnd).toBe('2026-10-06');
    expect(planningDateKey('2026-09-24T05:00:00Z')).toBe('2026-09-24');
    expect(planningDateKey('2026-02-30')).toBeNull();
    expect(planningDateKey('invalid')).toBeNull();
  });

  it('subtracts two weekdays through weekends without a holiday calendar', () => {
    expect(subtractPlanningBusinessDays('2026-09-28')).toBe('2026-09-24');
    expect(subtractPlanningBusinessDays('2026-09-29')).toBe('2026-09-25');
    expect(subtractPlanningBusinessDays('2026-09-27')).toBe('2026-09-24');
    expect(subtractPlanningBusinessDays('2026-09-25')).toBe('2026-09-23');
  });

  it('keeps schedule days and query bounds correct across daylight saving time', () => {
    const result = plan({ now: '2026-03-06T18:00:00Z', schedules: [schedule(2, { next_run_at: '2026-03-06T12:00:00Z' })] });
    expect(result.products[0].events.map((event) => event.scheduledDate)).toEqual(['2026-03-06', '2026-03-13']);
    expect(result.products[0].events[1].prepareDate).toBe('2026-03-11');
    expect(productionPlanningQueryWindow('2026-03-06T18:00:00Z')).toEqual({
      historyStart: '2026-01-05T06:00:00.000Z',
      historyEnd: '2026-03-09T05:00:00.000Z',
      outlookEnd: '2026-03-20T05:00:00.000Z',
    });
  });
});

describe('canonical recurring production demand', () => {
  it('uses the saved next date and starts preparation two business days before it', () => {
    const result = row({ schedules: [schedule(6, { next_run_at: '2026-09-28T12:00:00Z', frequency: '2_weeks' })] });
    expect(result.makeNowQty).toBe(0);
    expect(result.outlookQty).toBe(6);
    expect(result.events[0]).toMatchObject({ scheduledDate: '2026-09-28', prepareDate: '2026-09-24', isNow: false });
    expect(row({ schedules: [schedule(6, { frequency: '2_weeks' })] }).makeNowQty).toBe(6);
  });

  it('deduplicates generated occurrences of any status and preserves a recurring badge on open orders', () => {
    const result = row({
      orders: [order(6, { recurring_order_id: 'schedule-1', recurring_scheduled_for: '2026-09-25T12:00:00+00:00' })],
      schedules: [schedule(6)],
      generatedOccurrences: [{ recurring_order_id: 'schedule-1', recurring_scheduled_for: '2026-10-02T12:00:00Z' }],
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ source: 'order', isRecurring: true });
    expect(result.makeNowQty).toBe(6);
    expect(result.recurringNowQty).toBe(0);
    const canceled = row({
      schedules: [schedule(6, { frequency: '2_weeks' })],
      orders: [order(6, { status: 'Canceled', recurring_order_id: 'schedule-1', recurring_scheduled_for: '2026-09-25T12:00:00Z' })],
    });
    expect(canceled.events).toHaveLength(0);
  });

  it('surfaces one overdue occurrence as actionable instead of skipping it', () => {
    const result = row({ schedules: [schedule(4, { next_run_at: '2026-09-21T12:00:00Z', frequency: '2_weeks' })] });
    expect(result.makeNowQty).toBe(4);
    expect(result.events[0]).toMatchObject({ scheduledDate: '2026-09-21', isOverdue: true, needsReview: false });
    expect(result.events[1].scheduledDate).toBe('2026-10-05');
  });

  it('moves all past dates of a missed multi-cycle schedule into Review while retaining future dates', () => {
    const result = plan({ schedules: [schedule(4, { next_run_at: '2026-09-01T12:00:00Z' })] });
    expect(result.scheduleReviews).toEqual([expect.objectContaining({ reason: 'missed_cycles', missedOccurrenceCount: 4 })]);
    const productRow = result.products[0];
    expect(productRow.makeNowQty).toBe(0);
    expect(productRow.reviewRecurringQty).toBe(16);
    expect(productRow.outlookQty).toBe(8);
    expect(productRow.events.filter((event) => event.needsReview).every((event) => !event.isNow)).toBe(true);
    expect(productRow.events.filter((event) => !event.needsReview).map((event) => event.scheduledDate)).toEqual(['2026-09-29', '2026-10-06']);
  });

  it('does not let reviewed catch-up dates consume stock needed by current orders or future occurrences', () => {
    const result = row({ stockByProductId: { coffee: 10 }, orders: [order(5)], schedules: [schedule(4, { next_run_at: '2026-09-01T12:00:00Z' })] });
    expect(result.makeNowQty).toBe(0);
    expect(result.outlookQty).toBe(3);
    expect(result.reviewRecurringQty).toBe(16);
  });

  it('reports missing dates without deriving a replacement and excludes inactive schedules and customers', () => {
    const result = plan({ schedules: [
      schedule(2, { next_run_at: null }),
      schedule(2, { id: 'paused', status: 'paused' }),
      schedule(2, { id: 'canceled', status: 'canceled' }),
      schedule(2, { id: 'inactive', active: false }),
      schedule(2, { id: 'inactive-center', center_active: false }),
    ] });
    expect(result.products[0].events).toHaveLength(0);
    expect(result.scheduleReviews).toEqual([expect.objectContaining({ scheduleId: 'schedule-1', reason: 'missing_date' })]);
  });
});

describe('recorded-stock allocation and overlapping targets', () => {
  it('allocates once to open orders first, then recurring occurrences in date order', () => {
    const result = row({
      stockByProductId: { coffee: 10 },
      orders: [order(3, { id: 'newer', created_at: '2026-09-23T12:00:00Z' }), order(5, { id: 'older' })],
      schedules: [schedule(5, { next_run_at: '2026-09-28T12:00:00Z', frequency: '2_weeks' })],
    });
    expect(result.events.map((event) => [event.orderId, event.shortageQty])).toEqual([['older', 0], ['newer', 0], [null, 3]]);
    expect(result.makeNowQty).toBe(0);
    expect(result.availableAfterOpenOrders).toBe(2);
    expect(result.outlookQty).toBe(3);
  });

  it.each([
    { stock: -5, demand: 8, target: 20, make: 13, replenish: 12 },
    { stock: 0, demand: 8, target: 10, make: 8, replenish: 2 },
    { stock: 10, demand: 8, target: 10, make: 0, replenish: 0 },
    { stock: -5, demand: 0, target: 0, make: 5, replenish: 0 },
  ])('counts inventory debt once and overlaps targets: $stock stock, $demand orders, $target target', ({ stock, demand, target, make, replenish }) => {
    const result = row({ stockByProductId: { coffee: stock }, orders: [order(demand)], pars: [{ product_id: 'coffee', par_qty: target, minimum_qty: 0 }] });
    expect(result.makeNowQty).toBe(make);
    expect(result.replenishmentQty).toBe(replenish);
    expect(result.stockCorrectionQty).toBe(Math.max(0, -stock));
    expect(result.makeNowQty + result.replenishmentQty).toBe(Math.max(0, Math.ceil(Math.max(demand, target) - stock)));
  });

  it('keeps Outlook on recorded stock until a completed run changes stock', () => {
    const baseline = { schedules: [schedule(8, { next_run_at: '2026-09-28T12:00:00Z', frequency: '2_weeks' })], pars: [{ product_id: 'coffee', par_qty: 10, minimum_qty: 0 }] };
    const before = row(baseline);
    expect(before.actionableReplenishmentQty).toBe(10);
    expect(before.outlookQty).toBe(8);
    const after = row({ ...baseline, stockByProductId: { coffee: 10 } });
    expect(after.actionableReplenishmentQty).toBe(0);
    expect(after.outlookQty).toBe(0);
  });

  it('uses explicit active-center targets even with low history confidence', () => {
    const result = row({ pars: [
      { product_id: 'coffee', par_qty: 10, minimum_qty: 3, center_active: true },
      { product_id: 'coffee', par_qty: 100, minimum_qty: 100, center_active: false },
    ] });
    expect(result.confidence).toBe('Low');
    expect(result.actionableReplenishmentQty).toBe(10);
    expect(result.reviewReplenishmentQty).toBe(0);
  });

  it('does not hide committed order production when history confidence is low', () => {
    const result = row({ orders: [order(8)] });
    expect(result.confidence).toBe('Low');
    expect(result.makeNowQty).toBe(8);
  });
});

describe('shipment history and replenishment confidence', () => {
  it('uses shipment dates, eight complete weeks including zero weeks, and this-week subtraction', () => {
    const result = row({ orders: [
      ...weeklyShipments([8, 8, 8, 8, 8]),
      order(2, { id: 'current', status: 'Shipped', created_at: '2026-01-01T12:00:00Z', shipped_at: '2026-09-22T12:00:00Z' }),
    ] });
    expect(result.historyWeeksWithSales).toBe(5);
    expect(result.historyWeeklyAverageQty).toBe(5);
    expect(result.shippedThisWeekQty).toBe(2);
    expect(result.historyRemainingQty).toBe(3);
    expect(result.confidence).toBe('Medium');
    expect(result.actionableReplenishmentQty).toBe(3);
  });

  it('falls back to creation only for missing/invalid shipment timestamps and honors week boundaries', () => {
    const result = row({ orders: [
      order(8, { id: 'legacy', status: 'Shipped', created_at: '2026-09-14T12:00:00Z', shipped_at: null }),
      order(8, { id: 'before-window', status: 'Shipped', created_at: '2026-07-27T04:59:59Z' }),
      order(8, { id: 'first-in-window', status: 'Shipped', created_at: '2026-07-27T05:00:00Z' }),
      order(8, { id: 'future-week', status: 'Shipped', created_at: '2026-09-28T05:00:00Z' }),
    ] });
    expect(result.historyWeeklyAverageQty).toBe(2);
    expect(result.historyWeeksWithSales).toBe(2);
    expect(result.shippedThisWeekQty).toBe(0);
  });

  it('separates low-confidence history increments from explicit target work', () => {
    const result = row({
      orders: weeklyShipments([80]),
      pars: [{ product_id: 'coffee', par_qty: 4, minimum_qty: 0 }],
    });
    expect(result.replenishmentQty).toBe(10);
    expect(result.explicitReplenishmentQty).toBe(4);
    expect(result.actionableReplenishmentQty).toBe(4);
    expect(result.reviewReplenishmentQty).toBe(6);
  });

  it('does not add a weekly estimate on top of an open order already covering it', () => {
    const result = row({ orders: [...weeklyShipments([8, 8, 8, 8, 8, 8, 8, 8]), order(8)] });
    expect(result.makeNowQty).toBe(8);
    expect(result.historyRemainingQty).toBe(8);
    expect(result.replenishmentQty).toBe(0);
    expect(result.confidence).toBe('High');
  });

  it('avoids duplicate order rows and ignores archived open orders and inactive products without orders', () => {
    const result = plan({ products: [product, { id: 'inactive', name: 'Old coffee', active: false }], orders: [order(4), order(4), order(90, { id: 'archived', archived_at: NOW })] });
    expect(result.products).toHaveLength(1);
    expect(result.products[0].makeNowQty).toBe(4);
  });

  it('retains actual inactive-product orders while excluding their replenishment and scheduled forecasts', () => {
    const result = plan({
      products: [{ ...product, active: false }],
      stockByProductId: { coffee: 2 },
      orders: [order(8), ...weeklyShipments([80, 80, 80, 80, 80, 80, 80, 80])],
      schedules: [schedule(10)],
      pars: [{ product_id: 'coffee', par_qty: 100, minimum_qty: 50 }],
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ makeNowQty: 6, openOrderQty: 8, recurringNowQty: 0, outlookQty: 0, replenishmentQty: 0 });
    expect(result.products[0].events).toHaveLength(1);
    expect(result.scheduleReviews).toEqual([expect.objectContaining({ reason: 'missing_items' })]);
  });

  it('flags unavailable recurring items without losing valid active product demand', () => {
    const result = plan({ schedules: [schedule(0, { frequency: '2_weeks', recurring_order_items: [line(3), line(4, 'missing-product'), { product_id: null, qty: 5 }] })] });
    expect(result.products[0].makeNowQty).toBe(3);
    expect(result.scheduleReviews).toEqual([expect.objectContaining({ reason: 'missing_items', affectedProductIds: ['coffee'] })]);
  });

  it('provides stable sorting without mutating the plan', () => {
    const result = plan({ products: [product, { id: 'other', name: 'Another coffee' }], orders: [order(3)] });
    expect(sortProductionPlanningProducts(result.products, 'name').map((entry) => entry.product.id)).toEqual(['other', 'coffee']);
    expect(sortProductionPlanningProducts(result.products, 'quantity')[0].product.id).toBe('coffee');
    expect(result.products[0].product.id).toBe('coffee');
  });
});

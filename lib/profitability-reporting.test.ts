import { describe, expect, it } from 'vitest';
import {
  buildNormalizedMarginBridge,
  buildProfitabilityDashboard,
  buildRecentOrderGpmRows,
  type ProfitabilityOrderItemRow,
  type ProfitabilityOrderRow,
  type ProfitabilityTotals,
} from './profitability-reporting';

function totals(overrides: Partial<ProfitabilityTotals>): ProfitabilityTotals {
  const base: ProfitabilityTotals = {
    brandingLabelCents: 0,
    donationCogsCents: 0,
    estimatedLineCount: 0,
    fixedCents: 0,
    fixedOtherCents: 0,
    grossProfitCents: 0,
    laborCents: 0,
    marginPercent: 0,
    materialCents: 0,
    orderCount: 0,
    processingFeeCogsCents: 0,
    productCogsCents: 0,
    revenueCents: 0,
    shippingCogsCents: 0,
    shippingLabelCents: 0,
    snapshotLineCount: 0,
    tapeCents: 0,
    totalCogsCents: 0,
    unitsSold: 0,
  };
  return { ...base, ...overrides };
}

function shippedOrder(id: string, shippedAt: string): ProfitabilityOrderRow {
  return {
    center_id: 'center-1',
    created_at: shippedAt,
    donation_cogs_cents: 0,
    id,
    processing_fee_cents: 0,
    shipped_at: shippedAt,
    shipping_cost_cents: 0,
    status: 'Shipped',
    subtotal_cents: 0,
  };
}

function shippedLine({
  grossProfitCents,
  id,
  orderId,
  productId,
  productName,
  revenueCents,
}: {
  grossProfitCents: number;
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  revenueCents: number;
}): ProfitabilityOrderItemRow {
  const cogsCents = revenueCents - grossProfitCents;
  return {
    cogs_donation_cents: 0,
    cogs_estimated: false,
    cogs_fixed_cents: 0,
    cogs_labor_cents: 0,
    cogs_material_cents: cogsCents,
    cogs_processing_fee_cents: 0,
    cogs_product_cents: cogsCents,
    cogs_shipping_cents: 0,
    cogs_snapshot_at: '2026-07-02T00:00:00.000Z',
    cogs_total_cents: cogsCents,
    cogs_unit_cents: cogsCents,
    id,
    line_total_cents: revenueCents,
    order_id: orderId,
    product_id: productId,
    product_name_snapshot: productName,
    qty: 1,
    shipping_boxes_used: 1,
    unit_price_cents: revenueCents,
  };
}

describe('normalized margin health bridge', () => {
  it('does not show COGS-rate impact when revenue doubles but rates stay the same', () => {
    const current = totals({
      grossProfitCents: 100000,
      laborCents: 20000,
      marginPercent: 50,
      materialCents: 60000,
      orderCount: 20,
      productCogsCents: 100000,
      revenueCents: 200000,
      totalCogsCents: 100000,
      unitsSold: 20,
    });
    const baseline = totals({
      grossProfitCents: 50000,
      laborCents: 10000,
      marginPercent: 50,
      materialCents: 30000,
      orderCount: 10,
      productCogsCents: 50000,
      revenueCents: 100000,
      totalCogsCents: 50000,
      unitsSold: 10,
    });

    const { unitEconomicsRows } = buildNormalizedMarginBridge(current, baseline, baseline, 7, 7, 7);
    const material = unitEconomicsRows.find((row) => row.id === 'material_rate');
    const labor = unitEconomicsRows.find((row) => row.id === 'labor_rate');

    expect(material?.estimatedImpactCents).toBeCloseTo(0);
    expect(labor?.estimatedImpactCents).toBeCloseTo(0);
  });

  it('shows a negative impact when labor COGS rate worsens', () => {
    const current = totals({
      grossProfitCents: 70000,
      laborCents: 30000,
      marginPercent: 70,
      orderCount: 10,
      productCogsCents: 30000,
      revenueCents: 100000,
      totalCogsCents: 30000,
      unitsSold: 10,
    });
    const baseline = totals({
      grossProfitCents: 80000,
      laborCents: 20000,
      marginPercent: 80,
      orderCount: 10,
      productCogsCents: 20000,
      revenueCents: 100000,
      totalCogsCents: 20000,
      unitsSold: 10,
    });

    const { unitEconomicsRows } = buildNormalizedMarginBridge(current, baseline, baseline);
    const labor = unitEconomicsRows.find((row) => row.id === 'labor_rate');

    expect(labor?.changeValue).toBeCloseTo(10);
    expect(labor?.estimatedImpactCents).toBeCloseTo(-10000);
  });

  it('shows a negative impact when shipping COGS rate rises', () => {
    const current = totals({
      grossProfitCents: 90000,
      marginPercent: 90,
      orderCount: 10,
      revenueCents: 100000,
      shippingCogsCents: 10000,
      totalCogsCents: 10000,
      unitsSold: 10,
    });
    const baseline = totals({
      grossProfitCents: 95000,
      marginPercent: 95,
      orderCount: 10,
      revenueCents: 100000,
      shippingCogsCents: 5000,
      totalCogsCents: 5000,
      unitsSold: 10,
    });

    const { unitEconomicsRows } = buildNormalizedMarginBridge(current, baseline, baseline);
    const shipping = unitEconomicsRows.find((row) => row.id === 'shipping_rate');

    expect(shipping?.changeValue).toBeCloseTo(5);
    expect(shipping?.estimatedImpactCents).toBeCloseTo(-5000);
  });
});

describe('margin leak ranking', () => {
  it('ranks product leaks by estimated dollar impact, not only margin-point decline', () => {
    const products = [
      { id: 'big', name: 'Big product', sku: 'BIG' },
      { id: 'small', name: 'Small product', sku: 'SMALL' },
    ];
    const orders = [
      shippedOrder('baseline-big', '2026-05-20T12:00:00.000Z'),
      shippedOrder('baseline-small', '2026-05-20T12:00:00.000Z'),
      shippedOrder('current-big', '2026-07-02T12:00:00.000Z'),
      shippedOrder('current-small', '2026-07-02T12:00:00.000Z'),
    ];
    const orderItems = [
      shippedLine({ grossProfitCents: 50000, id: 'baseline-big-line', orderId: 'baseline-big', productId: 'big', productName: 'Big product', revenueCents: 100000 }),
      shippedLine({ grossProfitCents: 9000, id: 'baseline-small-line', orderId: 'baseline-small', productId: 'small', productName: 'Small product', revenueCents: 10000 }),
      shippedLine({ grossProfitCents: 80000, id: 'current-big-line', orderId: 'current-big', productId: 'big', productName: 'Big product', revenueCents: 200000 }),
      shippedLine({ grossProfitCents: 6000, id: 'current-small-line', orderId: 'current-small', productId: 'small', productName: 'Small product', revenueCents: 10000 }),
    ];

    const dashboard = buildProfitabilityDashboard({
      centers: [{ id: 'center-1', name: 'Center 1' }],
      inventoryItems: [],
      inventoryLots: [],
      nonInventoryExpenses: [],
      orderItems,
      orders,
      productionRunInputs: [],
      productionRuns: [],
      products,
      rangeEndExclusive: new Date('2026-07-08T00:00:00.000Z'),
      rangeStart: new Date('2026-07-01T00:00:00.000Z'),
      shortageMovements: [],
    });

    expect(dashboard.marginHealth.productLeaks[0]?.id).toBe('big');
    expect(dashboard.marginHealth.productLeaks[0]?.estimatedImpactCents).toBeCloseTo(-20000);
    expect(dashboard.marginHealth.productLeaks[1]?.id).toBe('small');
    expect(dashboard.marginHealth.productLeaks[1]?.estimatedImpactCents).toBeCloseTo(-3000);
  });

  it('labels products without baseline history as new instead of a misleading variance', () => {
    const dashboard = buildProfitabilityDashboard({
      centers: [{ id: 'center-1', name: 'Center 1' }],
      inventoryItems: [],
      inventoryLots: [],
      nonInventoryExpenses: [],
      orderItems: [
        shippedLine({ grossProfitCents: 5000, id: 'new-line', orderId: 'current-new', productId: 'new', productName: 'New product', revenueCents: 10000 }),
      ],
      orders: [shippedOrder('current-new', '2026-07-02T12:00:00.000Z')],
      productionRunInputs: [],
      productionRuns: [],
      products: [{ id: 'new', name: 'New product', sku: 'NEW' }],
      rangeEndExclusive: new Date('2026-07-08T00:00:00.000Z'),
      rangeStart: new Date('2026-07-01T00:00:00.000Z'),
      shortageMovements: [],
    });

    expect(dashboard.marginHealth.productLeaks[0]?.status).toBe('new');
    expect(dashboard.marginHealth.productLeaks[0]?.marginPointChange).toBeNull();
    expect(dashboard.marginHealth.productLeaks[0]?.estimatedImpactCents).toBe(0);
  });
});

describe('recent order GPM rows', () => {
  it('returns the newest shipped orders with gross profit dollars and margin percent', () => {
    const orders = [
      shippedOrder('older', '2026-07-01T12:00:00.000Z'),
      shippedOrder('newer', '2026-07-03T12:00:00.000Z'),
      { ...shippedOrder('unshipped', '2026-07-04T12:00:00.000Z'), shipped_at: null, status: 'New' },
    ];
    const orderItems = [
      shippedLine({ grossProfitCents: 4000, id: 'older-line', orderId: 'older', productId: 'coffee', productName: 'Coffee', revenueCents: 10000 }),
      shippedLine({ grossProfitCents: 15000, id: 'newer-line', orderId: 'newer', productId: 'coffee', productName: 'Coffee', revenueCents: 30000 }),
      shippedLine({ grossProfitCents: 9000, id: 'unshipped-line', orderId: 'unshipped', productId: 'coffee', productName: 'Coffee', revenueCents: 10000 }),
    ];

    const rows = buildRecentOrderGpmRows({
      centers: [{ id: 'center-1', name: 'Center 1' }],
      limit: 10,
      orderItems,
      orders,
      products: [{ id: 'coffee', name: 'Coffee', sku: 'COFFEE' }],
      productionRuns: [],
    });

    expect(rows.map((row) => row.id)).toEqual(['newer', 'older']);
    expect(rows[0]).toMatchObject({
      centerName: 'Center 1',
      estimatedLineCount: 0,
      grossProfitCents: 15000,
      lineCount: 1,
      marginPercent: 50,
      revenueCents: 30000,
      totalCogsCents: 15000,
    });
  });
});

describe('item profitability', () => {
  it('calculates average item price per raw coffee pound sold', () => {
    const dashboard = buildProfitabilityDashboard({
      centers: [{ id: 'center-1', name: 'Center 1' }],
      inventoryItems: [],
      inventoryLots: [],
      nonInventoryExpenses: [],
      orderItems: [
        {
          cogs_donation_cents: 0,
          cogs_estimated: false,
          cogs_fixed_cents: 0,
          cogs_labor_cents: 0,
          cogs_material_cents: 0,
          cogs_processing_fee_cents: 0,
          cogs_product_cents: 0,
          cogs_shipping_cents: 0,
          cogs_snapshot_at: '2026-07-02T00:00:00.000Z',
          cogs_total_cents: 0,
          cogs_unit_cents: 0,
          id: 'coffee-line',
          line_total_cents: 2000,
          order_id: 'coffee-order',
          product_id: 'coffee-product',
          product_name_snapshot: 'Coffee product',
          qty: 2,
          shipping_boxes_used: 1,
          unit_price_cents: 1000,
        },
      ],
      orders: [shippedOrder('coffee-order', '2026-07-02T12:00:00.000Z')],
      productionRunInputs: [],
      productionRuns: [],
      products: [{ id: 'coffee-product', name: 'Coffee product', sku: 'COF' }],
      rangeEndExclusive: new Date('2026-07-08T00:00:00.000Z'),
      rangeStart: new Date('2026-07-01T00:00:00.000Z'),
      recipes: [
        {
          output_qty: 4,
          product_id: 'coffee-product',
          product_recipe_components: [
            {
              component_role: 'raw_coffee',
              inventory_items: { item_type: 'raw_coffee' },
              quantity: 2,
              unit: 'lb',
            },
          ],
        },
      ],
      shortageMovements: [],
    });

    expect(dashboard.itemRows[0]?.coffeePoundsSold).toBeCloseTo(1);
    expect(dashboard.itemRows[0]?.averagePricePerPoundCents).toBeCloseTo(2000);
  });
});

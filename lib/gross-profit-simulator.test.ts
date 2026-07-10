import { describe, expect, it } from 'vitest';
import { buildGrossProfitSimulator } from '@/lib/gross-profit-simulator';
import type { ProfitabilityTotals } from '@/lib/profitability-reporting';

const actualTotals: ProfitabilityTotals = {
  brandingLabelCents: 0,
  donationCogsCents: 0,
  estimatedLineCount: 0,
  fixedCents: 14810,
  fixedOtherCents: 0,
  grossProfitCents: 100000,
  laborCents: 65190,
  marginPercent: 50,
  materialCents: 20000,
  orderCount: 1,
  processingFeeCogsCents: 0,
  productCogsCents: 100000,
  revenueCents: 200000,
  shippingCogsCents: 0,
  shippingLabelCents: 0,
  snapshotLineCount: 1,
  tapeCents: 0,
  totalCogsCents: 100000,
  unitsSold: 1,
};

function buildDashboard(laborPercentDelta: number) {
  return buildGrossProfitSimulator({
    actual: actualTotals,
    centers: [{ id: 'center-1', name: 'Recovery Center' }],
    inventoryItems: [],
    inventoryLots: [],
    orderItems: [
      {
        cogs_fixed_cents: 14810,
        cogs_labor_cents: 65190,
        cogs_material_cents: 20000,
        cogs_product_cents: 100000,
        cogs_snapshot_at: '2026-07-02T15:00:00.000Z',
        cogs_total_cents: 100000,
        id: 'item-1',
        line_total_cents: 200000,
        order_id: 'order-1',
        product_id: 'product-1',
        product_name_snapshot: 'Recovery Roast',
        qty: 1,
        unit_price_cents: 200000,
      },
    ],
    orders: [
      {
        center_id: 'center-1',
        created_at: '2026-07-02T15:00:00.000Z',
        id: 'order-1',
        shipped_at: '2026-07-02T15:00:00.000Z',
        status: 'Shipped',
        subtotal_cents: 200000,
      },
    ],
    params: {
      itemUnitCostOverridesCents: new Map(),
      laborMinutesOverrides: new Map(),
      laborPercentDelta,
      laborRateOverridesCents: new Map(),
      materialSupplyPercentDelta: 0,
      rangeEndExclusive: new Date('2026-08-01T00:00:00.000Z'),
      rangeStart: new Date('2026-07-01T00:00:00.000Z'),
      rawCoffeePercentDelta: 0,
    },
    products: [{ id: 'product-1', name: 'Recovery Roast', sku: 'REC' }],
    recipes: [
      {
        labor_minutes: 60,
        labor_rate_cents: 149940,
        output_qty: 1,
        product_id: 'product-1',
        product_recipe_components: [],
        waste_percent: 0,
      },
    ],
  });
}

describe('gross profit simulator labor math', () => {
  it('scales actual labor COGS when recipe labor is higher than shipped labor', () => {
    const dashboard = buildDashboard(-50);

    expect(dashboard.baselineRecipeLaborCents).toBe(149940);
    expect(dashboard.laborScenarioCents).toBe(74970);
    expect(dashboard.simulatedLaborCents).toBe(32595);
    expect(dashboard.laborImpactCents).toBe(32595);
    expect(dashboard.grossProfitChangeCents).toBe(32595);
    expect(dashboard.simulatedTotalCogsCents).toBe(67405);
    expect(dashboard.laborRows[0]?.grossProfitImpactCents).toBe(32595);
  });

  it('does not let a large negative labor minutes change make labor COGS negative', () => {
    const dashboard = buildDashboard(-200);

    expect(dashboard.laborScenarioCents).toBe(0);
    expect(dashboard.simulatedLaborCents).toBe(0);
    expect(dashboard.laborImpactCents).toBe(65190);
    expect(dashboard.simulatedTotalCogsCents).toBe(34810);
  });
});

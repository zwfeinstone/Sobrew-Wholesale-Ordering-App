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
    expect(dashboard.laborRows[0]?.baselineLaborMinutes).toBe(60);
    expect(dashboard.laborRows[0]?.simulatedLaborMinutes).toBe(30);
  });

  it('does not let a large negative labor minutes change make labor COGS negative', () => {
    const dashboard = buildDashboard(-200);

    expect(dashboard.laborScenarioCents).toBe(0);
    expect(dashboard.simulatedLaborCents).toBe(0);
    expect(dashboard.laborImpactCents).toBe(65190);
    expect(dashboard.simulatedTotalCogsCents).toBe(34810);
  });
});

describe('gross profit simulator material and supply math', () => {
  it('shows active supplies and applies supply changes to recipe materials and shipped box usages', () => {
    const dashboard = buildGrossProfitSimulator({
      actual: {
        brandingLabelCents: 0,
        donationCogsCents: 0,
        estimatedLineCount: 0,
        fixedCents: 3000,
        fixedOtherCents: 3000,
        grossProfitCents: 12000,
        laborCents: 0,
        marginPercent: 60,
        materialCents: 5000,
        orderCount: 1,
        processingFeeCogsCents: 0,
        productCogsCents: 8000,
        revenueCents: 20000,
        shippingCogsCents: 0,
        shippingLabelCents: 0,
        snapshotLineCount: 1,
        tapeCents: 0,
        totalCogsCents: 8000,
        unitsSold: 1,
      },
      centers: [{ id: 'center-1', name: 'Recovery Center' }],
      inventoryItems: [
        { active: true, base_unit: 'lb', id: 'raw-1', item_type: 'raw_coffee', name: 'House Green', sku: 'RAW-HOUSE' },
        { active: true, base_unit: 'each', id: 'bag-1', item_type: 'material_supply', name: '2 lb Bag', sku: 'MAT-BAG-2LB' },
        { active: true, base_unit: 'each', id: 'box-14', item_type: 'material_supply', name: 'Box - 14 x 14 x 14', sku: 'MAT-BOX-14X14X14' },
        { active: true, base_unit: 'each', id: 'mailer-1', item_type: 'material_supply', name: 'Unused Mailer', sku: 'MAT-MAILER' },
      ],
      inventoryLots: [
        { inventory_item_id: 'raw-1', quantity_remaining: 10, unit_cost_cents: 10000, created_at: '2026-07-01T00:00:00.000Z' },
        { inventory_item_id: 'bag-1', quantity_remaining: 10, unit_cost_cents: 5000, created_at: '2026-07-01T00:00:00.000Z' },
        { inventory_item_id: 'box-14', quantity_remaining: 0, unit_cost_cents: 1500, created_at: '2026-07-01T00:00:00.000Z' },
        { inventory_item_id: 'mailer-1', quantity_remaining: 10, unit_cost_cents: 250, created_at: '2026-07-01T00:00:00.000Z' },
      ],
      orderItems: [
        {
          cogs_fixed_cents: 3000,
          cogs_fixed_other_cents: 3000,
          cogs_labor_cents: 0,
          cogs_material_cents: 5000,
          cogs_product_cents: 8000,
          cogs_snapshot_at: '2026-07-02T15:00:00.000Z',
          cogs_total_cents: 8000,
          id: 'item-1',
          line_total_cents: 20000,
          order_id: 'order-1',
          product_id: 'product-1',
          product_name_snapshot: 'Recovery Roast',
          qty: 1,
          unit_price_cents: 20000,
        },
      ],
      orders: [
        {
          center_id: 'center-1',
          created_at: '2026-07-02T15:00:00.000Z',
          id: 'order-1',
          shipped_at: '2026-07-02T15:00:00.000Z',
          status: 'Shipped',
          subtotal_cents: 20000,
        },
      ],
      params: {
        itemUnitCostOverridesCents: new Map(),
        laborMinutesOverrides: new Map(),
        laborPercentDelta: 0,
        laborRateOverridesCents: new Map(),
        materialSupplyPercentDelta: -50,
        rangeEndExclusive: new Date('2026-08-01T00:00:00.000Z'),
        rangeStart: new Date('2026-07-01T00:00:00.000Z'),
        rawCoffeePercentDelta: 0,
      },
      products: [{ id: 'product-1', name: 'Recovery Roast', sku: 'REC' }],
      recipes: [
        {
          labor_minutes: 0,
          labor_rate_cents: 0,
          output_qty: 1,
          product_id: 'product-1',
          product_recipe_components: [
            {
              component_role: 'raw_coffee',
              inventory_item_id: 'raw-1',
              inventory_items: { base_unit: 'lb', id: 'raw-1', item_type: 'raw_coffee', name: 'House Green', sku: 'RAW-HOUSE' },
              quantity: 1,
              unit: 'lb',
            },
            {
              component_role: 'bag',
              inventory_item_id: 'bag-1',
              inventory_items: { base_unit: 'each', id: 'bag-1', item_type: 'material_supply', name: '2 lb Bag', sku: 'MAT-BAG-2LB' },
              quantity: 2,
              unit: 'each',
            },
          ],
          waste_percent: 0,
        },
      ],
      shippingBoxUsages: [
        {
          inventory_item_id: 'box-14',
          inventory_items: { active: true, base_unit: 'each', id: 'box-14', item_type: 'material_supply', name: 'Box - 14 x 14 x 14', sku: 'MAT-BOX-14X14X14' },
          order_item_id: 'item-1',
          quantity: 2,
          total_cost_cents: 3000,
          unit_cost_cents: 1500,
        },
      ],
    });

    const rowsBySku = new Map(dashboard.inputRows.map((row) => [row.sku, row]));

    expect(dashboard.baselineRecipeMaterialCents).toBe(20000);
    expect(dashboard.actualMaterialSupplyCents).toBe(8000);
    expect(dashboard.simulatedMaterialCents).toBe(3750);
    expect(dashboard.simulatedMaterialSupplyCents).toBe(5250);
    expect(dashboard.materialSupplyImpactCents).toBe(2750);
    expect(dashboard.materialSupplyScenarioCents).toBe(2750);
    expect(dashboard.rawCoffeeScenarioCents).toBe(2500);
    expect(dashboard.grossProfitChangeCents).toBe(2750);
    expect(dashboard.simulatedTotalCogsCents).toBe(5250);
    expect(rowsBySku.get('MAT-BOX-14X14X14')).toMatchObject({
      baselineCostCents: 3000,
      grossProfitImpactCents: 1500,
      quantityUsed: 2,
      simulatedCostCents: 1500,
    });
    expect(rowsBySku.get('MAT-MAILER')).toMatchObject({
      baselineCostCents: 0,
      quantityUsed: 0,
      simulatedCostCents: 0,
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  chooseProductCostCents,
  historicalShippingByProduct,
  priceRangeCents,
  projectedShippingByProduct,
  recipeUnitCostEstimateCents,
  roundToNearestQuarterCents,
  targetMarginPriceCents,
} from '@/lib/sales-price-guide';

describe('sales price guide calculations', () => {
  it('calculates target margin prices rounded to the nearest quarter', () => {
    expect(targetMarginPriceCents(1000, 30)).toBe(1425);
    expect(targetMarginPriceCents(1000, 35)).toBe(1550);
    expect(targetMarginPriceCents(1000, 40)).toBe(1675);
    expect(targetMarginPriceCents(1000, 50)).toBe(2000);
    expect(roundToNearestQuarterCents(1543)).toBe(1550);
  });

  it('builds min, median, and max price ranges', () => {
    expect(priceRangeCents([1000, 1600, 1200, 1400])).toEqual({
      maxCents: 1600,
      medianCents: 1300,
      minCents: 1000,
    });
    expect(priceRangeCents([1000, 1200, 1500])).toEqual({
      maxCents: 1500,
      medianCents: 1200,
      minCents: 1000,
    });
    expect(priceRangeCents([0, null, undefined])).toBeNull();
  });

  it('selects product cost by source precedence', () => {
    expect(chooseProductCostCents({
      averageFinishedStockCostCents: 900,
      latestProductionCostCents: 1000,
      recipeEstimateCostCents: 800,
    })).toEqual({ costCents: 1000, source: 'latest_production' });
    expect(chooseProductCostCents({
      averageFinishedStockCostCents: 900,
      latestProductionCostCents: 0,
      recipeEstimateCostCents: 800,
    })).toEqual({ costCents: 900, source: 'finished_stock' });
    expect(chooseProductCostCents({
      averageFinishedStockCostCents: 0,
      latestProductionCostCents: null,
      recipeEstimateCostCents: 800,
    })).toEqual({ costCents: 800, source: 'recipe_estimate' });
    expect(chooseProductCostCents({})).toEqual({ costCents: 0, source: 'missing_cost' });
  });

  it('uses saved line shipping COGS when available', () => {
    const summaries = historicalShippingByProduct({
      orderItems: [
        {
          cogs_shipping_cents: 600,
          cogs_snapshot_at: '2026-07-01T00:00:00.000Z',
          id: 'line-1',
          order_id: 'order-1',
          product_id: 'product-1',
          qty: 3,
        },
      ],
      orders: [{ id: 'order-1', shipping_cost_cents: 999, status: 'Shipped' }],
    });

    expect(summaries.get('product-1')).toMatchObject({
      averageShippingCents: 200,
      lineCount: 1,
      orderCount: 1,
      shippingCents: 600,
      unitsSold: 3,
    });
  });

  it('allocates order shipping by revenue for unsnapshotted historical lines', () => {
    const summaries = historicalShippingByProduct({
      orderItems: [
        {
          id: 'line-1',
          line_total_cents: 3000,
          order_id: 'order-1',
          product_id: 'product-1',
          qty: 3,
        },
        {
          id: 'line-2',
          line_total_cents: 1000,
          order_id: 'order-1',
          product_id: 'product-2',
          qty: 1,
        },
      ],
      orders: [{ id: 'order-1', shipping_cost_cents: 800, status: 'Shipped' }],
    });

    expect(summaries.get('product-1')?.shippingCents).toBe(600);
    expect(summaries.get('product-1')?.averageShippingCents).toBe(200);
    expect(summaries.get('product-2')?.shippingCents).toBe(200);
    expect(summaries.get('product-2')?.averageShippingCents).toBe(200);
  });

  it('projects missing shipping from the closest same-category item by weight and box size', () => {
    const historicalSummaries = new Map([
      ['similar', {
        averageShippingCents: 1200,
        lineCount: 2,
        orderCount: 2,
        shippingCents: 2400,
        source: 'historical' as const,
        unitsSold: 2,
      }],
      ['farther', {
        averageShippingCents: 5000,
        lineCount: 1,
        orderCount: 1,
        shippingCents: 5000,
        source: 'historical' as const,
        unitsSold: 1,
      }],
      ['wrong-category', {
        averageShippingCents: 100,
        lineCount: 1,
        orderCount: 1,
        shippingCents: 100,
        source: 'historical' as const,
        unitsSold: 1,
      }],
    ]);
    const projected = projectedShippingByProduct({
      historicalSummaries,
      products: [
        { category: 'whole_bean', id: 'target', name: 'New 3lb Item' },
        { category: 'whole_bean', id: 'similar', name: 'Similar 2lb Item' },
        { category: 'whole_bean', id: 'farther', name: 'Farther 8lb Item' },
        { category: 'k_cups', id: 'wrong-category', name: 'Wrong Category' },
      ],
      recipes: [
        recipeWithWeightAndBox('target', 3, 'BOX-12X12X10'),
        recipeWithWeightAndBox('similar', 2, 'BOX-12X12X10'),
        recipeWithWeightAndBox('farther', 8, 'BOX-16X16X16'),
        recipeWithWeightAndBox('wrong-category', 3, 'BOX-12X12X10'),
      ],
    });

    expect(projected.get('target')).toMatchObject({
      averageShippingCents: 1800,
      projectedFromProductId: 'similar',
      projectedFromProductName: 'Similar 2lb Item',
      projectedPricePerLbCents: 600,
      projectedWeightLb: 3,
      source: 'projected',
    });
  });

  it('does not project shipping over actual product history', () => {
    const historicalSummaries = new Map([
      ['target', {
        averageShippingCents: 900,
        lineCount: 1,
        orderCount: 1,
        shippingCents: 900,
        source: 'historical' as const,
        unitsSold: 1,
      }],
      ['similar', {
        averageShippingCents: 1200,
        lineCount: 1,
        orderCount: 1,
        shippingCents: 1200,
        source: 'historical' as const,
        unitsSold: 1,
      }],
    ]);

    expect(projectedShippingByProduct({
      historicalSummaries,
      products: [
        { category: 'whole_bean', id: 'target', name: 'Has History' },
        { category: 'whole_bean', id: 'similar', name: 'Similar Item' },
      ],
      recipes: [
        recipeWithWeightAndBox('target', 3, 'BOX-12X12X10'),
        recipeWithWeightAndBox('similar', 2, 'BOX-12X12X10'),
      ],
    }).has('target')).toBe(false);
  });

  it('estimates recipe unit cost from materials, labor, and fixed label costs', () => {
    const estimate = recipeUnitCostEstimateCents({
      branding_label_qty: 2,
      labor_minutes: 30,
      labor_rate_cents: 2000,
      output_qty: 10,
      product_id: 'product-1',
      product_recipe_components: [
        {
          component_role: 'raw_coffee',
          inventory_item_id: 'raw-1',
          inventory_items: { base_unit: 'lb', id: 'raw-1', sku: 'RAW' },
          quantity: 16,
          unit: 'oz',
        },
        {
          component_role: 'box',
          inventory_item_id: 'box-1',
          inventory_items: { base_unit: 'each', id: 'box-1', sku: 'BOX-TEST' },
          quantity: 1,
          unit: 'each',
        },
      ],
      shipping_label_qty: 1,
      waste_percent: 0,
    }, new Map([
      ['raw-1', 1000],
      ['box-1', 200],
    ]));

    expect(estimate).toBe(221.5);
  });
});

function recipeWithWeightAndBox(productId: string, weightLb: number, boxSku: string) {
  return {
    branding_label_qty: 0,
    labor_minutes: 0,
    labor_rate_cents: 0,
    output_qty: 1,
    product_id: productId,
    product_recipe_components: [
      {
        component_role: 'raw_coffee',
        inventory_item_id: `${productId}-coffee`,
        inventory_items: { base_unit: 'lb' as const, id: `${productId}-coffee`, item_type: 'raw_coffee', sku: 'RAW' },
        quantity: weightLb,
        unit: 'lb' as const,
      },
      {
        component_role: 'box',
        inventory_item_id: `${productId}-box`,
        inventory_items: { base_unit: 'each' as const, id: `${productId}-box`, item_type: 'material_supply', sku: boxSku },
        quantity: 1,
        unit: 'each' as const,
      },
    ],
    shipping_label_qty: 0,
    waste_percent: 0,
  };
}

import { describe, expect, it } from 'vitest';
import {
  chooseProductCostCents,
  historicalShippingByProduct,
  priceRangeCents,
  recipeUnitCostEstimateCents,
  roundToNearestQuarterCents,
  targetMarginPriceCents,
} from '@/lib/sales-price-guide';

describe('sales price guide calculations', () => {
  it('calculates target margin prices rounded to the nearest quarter', () => {
    expect(targetMarginPriceCents(1000, 30)).toBe(1425);
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

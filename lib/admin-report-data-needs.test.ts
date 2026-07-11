import { describe, expect, it } from 'vitest';
import { dataNeedsForReport } from './admin-report-data-needs';

describe('dataNeedsForReport', () => {
  it('loads only prospecting sources for the prospecting report', () => {
    expect(dataNeedsForReport('prospecting')).toEqual({
      coreCommerce: false,
      inventoryValuation: false,
      nonInventoryExpenses: false,
      productionInputs: false,
      productionRuns: false,
      productRecipes: false,
      prospecting: true,
      reorderSettings: false,
      sampleBoxes: false,
      salesDashboard: false,
      shortageMovements: false,
    });
  });

  it('does not load profitability and production sources for sales', () => {
    const needs = dataNeedsForReport('sales');
    expect(needs.salesDashboard).toBe(true);
    expect(needs.productionRuns).toBe(false);
    expect(needs.productionInputs).toBe(false);
    expect(needs.productRecipes).toBe(false);
    expect(needs.reorderSettings).toBe(true);
  });

  it('loads production inputs and recipes only for production detail', () => {
    const needs = dataNeedsForReport('production');
    expect(needs.coreCommerce).toBe(true);
    expect(needs.productionRuns).toBe(true);
    expect(needs.productionInputs).toBe(true);
    expect(needs.productRecipes).toBe(true);
    expect(needs.inventoryValuation).toBe(false);
  });

  it('loads inventory valuation and shortage movements for margin health', () => {
    const needs = dataNeedsForReport('margin');
    expect(needs.coreCommerce).toBe(true);
    expect(needs.productionRuns).toBe(true);
    expect(needs.inventoryValuation).toBe(true);
    expect(needs.shortageMovements).toBe(true);
  });
});

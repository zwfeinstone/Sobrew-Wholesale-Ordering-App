export type AdminReportId =
  | 'overview'
  | 'centers'
  | 'items'
  | 'margin'
  | 'recent_order_gpm'
  | 'labor_paid_gpm'
  | 'simulator'
  | 'production'
  | 'inventory'
  | 'inventory_adjustments'
  | 'sales'
  | 'sample_spend'
  | 'prospecting'
  | 'ai_qa'
  | 'ai_overview';

export type ReportDataNeeds = {
  coreCommerce: boolean;
  inventoryAdjustments: boolean;
  inventoryValuation: boolean;
  laborPaidGpm: boolean;
  nonInventoryExpenses: boolean;
  productionInputs: boolean;
  productionRuns: boolean;
  productRecipes: boolean;
  prospecting: boolean;
  reorderSettings: boolean;
  sampleBoxes: boolean;
  sampleOrders: boolean;
  salesDashboard: boolean;
  shortageMovements: boolean;
};

export function dataNeedsForReport(report: AdminReportId): ReportDataNeeds {
  const prospecting = report === 'prospecting';
  const salesDashboard = report === 'sales';
  const sampleSpend = report === 'sample_spend';
  const inventoryAdjustments = report === 'inventory_adjustments';
  const inventory = report === 'inventory';
  const items = report === 'items';
  const margin = report === 'margin';
  const laborPaidGpm = report === 'labor_paid_gpm';
  const production = report === 'production';
  const simulator = report === 'simulator';
  const aiReport = report === 'ai_overview' || report === 'ai_qa';
  const profitability = !prospecting && !salesDashboard && !sampleSpend && !aiReport && !inventoryAdjustments;

  return {
    coreCommerce: !prospecting && !sampleSpend && !aiReport && !inventoryAdjustments,
    inventoryAdjustments,
    inventoryValuation: inventoryAdjustments || inventory || margin || simulator || salesDashboard,
    laborPaidGpm,
    nonInventoryExpenses: inventory,
    productionInputs: production,
    productionRuns: profitability,
    productRecipes: items || production || simulator,
    prospecting,
    reorderSettings: salesDashboard,
    sampleBoxes: inventory,
    sampleOrders: sampleSpend,
    salesDashboard,
    shortageMovements: inventory || margin || salesDashboard,
  };
}

export type AdminReportId =
  | 'overview'
  | 'centers'
  | 'items'
  | 'margin'
  | 'simulator'
  | 'production'
  | 'inventory'
  | 'sales'
  | 'prospecting'
  | 'ai_overview';

export type ReportDataNeeds = {
  coreCommerce: boolean;
  inventoryValuation: boolean;
  nonInventoryExpenses: boolean;
  productionInputs: boolean;
  productionRuns: boolean;
  productRecipes: boolean;
  prospecting: boolean;
  reorderSettings: boolean;
  sampleBoxes: boolean;
  salesDashboard: boolean;
  shortageMovements: boolean;
};

export function dataNeedsForReport(report: AdminReportId): ReportDataNeeds {
  const prospecting = report === 'prospecting';
  const salesDashboard = report === 'sales';
  const inventory = report === 'inventory';
  const items = report === 'items';
  const margin = report === 'margin';
  const production = report === 'production';
  const simulator = report === 'simulator';
  const aiOverview = report === 'ai_overview';
  const profitability = !prospecting && !salesDashboard && !aiOverview;

  return {
    coreCommerce: !prospecting && !aiOverview,
    inventoryValuation: inventory || margin || simulator || salesDashboard,
    nonInventoryExpenses: inventory,
    productionInputs: production,
    productionRuns: profitability,
    productRecipes: items || production || simulator,
    prospecting,
    reorderSettings: salesDashboard,
    sampleBoxes: inventory,
    salesDashboard,
    shortageMovements: inventory || margin || salesDashboard,
  };
}

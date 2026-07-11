export type AdminReportId =
  | 'overview'
  | 'centers'
  | 'items'
  | 'margin'
  | 'simulator'
  | 'production'
  | 'inventory'
  | 'sales'
  | 'prospecting';

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
  const margin = report === 'margin';
  const production = report === 'production';
  const simulator = report === 'simulator';
  const profitability = !prospecting && !salesDashboard;

  return {
    coreCommerce: !prospecting,
    inventoryValuation: inventory || margin || simulator || salesDashboard,
    nonInventoryExpenses: inventory,
    productionInputs: production,
    productionRuns: profitability,
    productRecipes: production || simulator,
    prospecting,
    reorderSettings: salesDashboard,
    sampleBoxes: inventory,
    salesDashboard,
    shortageMovements: inventory || margin || salesDashboard,
  };
}

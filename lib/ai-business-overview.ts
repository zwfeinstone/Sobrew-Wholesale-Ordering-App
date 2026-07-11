import {
  buildProfitabilityDashboard,
  type ProfitabilityOrderItemRow,
  type ProfitabilityOrderRow,
} from '@/lib/profitability-reporting';
import type { ProspectingReportAggregate } from '@/lib/prospecting-reporting';
import {
  addDays,
  buildReportingDashboard,
  formatDateInput,
  startOfDay,
  startOfMonth,
  type ReportingCenterRow,
  type ReportingInventoryItemRow,
  type ReportingInventoryLotRow,
  type ReportingInventoryMovementRow,
  type ReportingOrderItemRow,
  type ReportingOrderRow,
  type ReportingProductRow,
  type ReportingReorderSettingRow,
} from '@/lib/reporting';

export const AI_BUSINESS_OVERVIEW_PROMPT_VERSION = 'ai-business-overview-v1';
export const AI_BUSINESS_OVERVIEW_DEFAULT_MODEL = 'gpt-5.5';

type MoneyMetric = {
  cents: number;
  dollars: number;
};

type RateMetric = {
  rate: number | null;
  percent: number | null;
};

type MetricSummary = {
  revenue: MoneyMetric;
  gross_profit?: MoneyMetric;
  order_count: number;
  units_sold: number;
  revenue_per_day: MoneyMetric;
  orders_per_day: number;
  average_order_value: MoneyMetric;
  revenue_per_unit: MoneyMetric;
  units_per_order: number;
  gross_margin?: RateMetric;
  profit_per_1000_revenue?: MoneyMetric;
};

export type BusinessHealthSnapshot = {
  prompt_version: string;
  as_of_date: string;
  as_of_end_exclusive: string;
  period: {
    today: { start: string; end_exclusive: string };
    month_to_date: { start: string; end_exclusive: string; days: number };
    trailing_8_weeks: { start: string; end_exclusive: string; days: number };
    prior_equal_range: { start: string; end_exclusive: string; days: number };
  };
  sales: {
    today: MetricSummary;
    month_to_date: MetricSummary;
    trailing_8_weeks: MetricSummary;
    prior_equal_range: MetricSummary;
    month_end_forecast: {
      revenue: MoneyMetric;
      orders: number;
      confidence: string;
      method: string;
      caveat: string | null;
    };
    top_products: Array<{
      product_id: string;
      product_name: string;
      units_sold: number;
      revenue: MoneyMetric;
      percent_of_revenue: number;
      order_count: number;
    }>;
  };
  customer_health: {
    active_customers: number;
    new_customers: number;
    returning_customers: number;
    reorder_risk: {
      high_risk: number;
      medium_risk: number;
      due_or_overdue: number;
    };
    concentration: {
      top_center_revenue_share_percent: number | null;
      top_five_center_revenue_share_percent: number | null;
    };
    top_centers: Array<{
      center_id: string;
      center_name: string;
      revenue: MoneyMetric;
      order_count: number;
      average_order_value: MoneyMetric;
      status: string;
    }>;
  };
  margin_health: {
    month_to_date: MetricSummary;
    cogs_rates: {
      product_cogs: RateMetric;
      material: RateMetric;
      labor: RateMetric;
      fixed_packaging: RateMetric;
      shipping: RateMetric;
      processing_fee: RateMetric;
      donation: RateMetric;
    };
    normalized_bridge: Array<{
      label: string;
      current_rate_or_value: number;
      baseline_rate_or_value: number;
      previous_rate_or_value: number;
      margin_point_or_value_change: number;
      estimated_impact: MoneyMetric;
      detail: string;
    }>;
    top_product_margin_leaks: Array<{
      product_id: string;
      product_name: string;
      current_revenue: MoneyMetric;
      current_margin_percent: number;
      baseline_margin_percent: number | null;
      margin_point_change: number | null;
      estimated_profit_impact: MoneyMetric;
      status: string;
    }>;
    top_center_margin_leaks: Array<{
      center_id: string;
      center_name: string;
      current_revenue: MoneyMetric;
      current_margin_percent: number;
      baseline_margin_percent: number | null;
      margin_point_change: number | null;
      estimated_profit_impact: MoneyMetric;
      status: string;
    }>;
  };
  cogs_timing: {
    shipped_product_cogs: MoneyMetric;
    shipped_total_cogs: MoneyMetric;
    shipped_labor_cogs: MoneyMetric;
    production_actual_cogs_created: MoneyMetric;
    production_labor_cogs_created: MoneyMetric;
    finished_good_inventory_value_current_or_estimated: MoneyMetric;
    finished_good_inventory_labor_current_or_estimated: MoneyMetric;
    positive_finished_units: number;
    net_finished_units: number;
    lotless_shortage_units: number;
    estimated_inventory_labor: boolean;
  };
  inventory_and_working_capital: {
    finished_goods_value: MoneyMetric;
    raw_coffee_value: MoneyMetric;
    material_supply_value: MoneyMetric;
    negative_finished_good_items: number;
    low_or_negative_stock_warnings: Array<{
      product_name: string;
      inventory_item_name: string | null;
      current_available_qty: number | null;
      warning: string;
      estimated_runout_date: string | null;
      recommended_reorder_qty: number;
    }>;
  };
  production_health: {
    run_count: number;
    quantity_produced: number;
    actual_cogs: MoneyMetric;
    estimated_cogs: MoneyMetric;
    labor_cogs: MoneyMetric;
    material_cogs: MoneyMetric;
    fixed_cogs: MoneyMetric;
    variance: MoneyMetric;
    recent_runs: Array<{
      product_name: string;
      produced_at: string | null;
      quantity_produced: number;
      actual_cogs: MoneyMetric;
      estimated_cogs: MoneyMetric;
      variance: MoneyMetric;
      unit_cost: MoneyMetric;
      material_usage_variance_qty: number;
    }>;
  };
  prospecting_and_pipeline: ProspectingReportAggregate | null;
  data_coverage_notes: string[];
  missing_data: string[];
};

export type BuildBusinessHealthSnapshotInput = {
  asOfDate: Date;
  centers: ReportingCenterRow[];
  currentDate?: Date;
  inventoryItems?: ReportingInventoryItemRow[];
  inventoryLots?: ReportingInventoryLotRow[];
  nonInventoryExpenses?: unknown[];
  orderItems: Array<ReportingOrderItemRow & ProfitabilityOrderItemRow>;
  orders: Array<ReportingOrderRow & ProfitabilityOrderRow>;
  products: ReportingProductRow[];
  productionRunInputs?: unknown[];
  productionRuns?: unknown[];
  prospectingAggregate?: ProspectingReportAggregate | null;
  reorderSettings?: ReportingReorderSettingRow[];
  shortageMovements?: ReportingInventoryMovementRow[];
};

type OpenAiPromptMessage = {
  role: 'developer' | 'user';
  content: Array<{ type: 'input_text'; text: string }>;
};

function cents(value: number): MoneyMetric {
  const safeValue = Number.isFinite(value) ? Math.round(value) : 0;
  return {
    cents: safeValue,
    dollars: Math.round((safeValue / 100) * 100) / 100,
  };
}

function rate(numerator: number, denominator: number): RateMetric {
  if (!denominator) return { rate: null, percent: null };
  const safeRate = numerator / denominator;
  return {
    rate: safeRate,
    percent: Math.round(safeRate * 10000) / 100,
  };
}

function round(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function daysInRange(start: Date, endExclusive: Date) {
  return Math.max(1, Math.round((startOfDay(endExclusive).getTime() - startOfDay(start).getTime()) / (24 * 60 * 60 * 1000)));
}

function metricSummary({
  days,
  grossProfitCents,
  orderCount,
  revenueCents,
  unitsSold,
}: {
  days: number;
  grossProfitCents?: number;
  orderCount: number;
  revenueCents: number;
  unitsSold: number;
}): MetricSummary {
  const summary: MetricSummary = {
    average_order_value: cents(orderCount ? revenueCents / orderCount : 0),
    order_count: orderCount,
    orders_per_day: round(orderCount / Math.max(1, days)),
    revenue: cents(revenueCents),
    revenue_per_day: cents(revenueCents / Math.max(1, days)),
    revenue_per_unit: cents(unitsSold ? revenueCents / unitsSold : 0),
    units_per_order: round(orderCount ? unitsSold / orderCount : 0),
    units_sold: unitsSold,
  };

  if (typeof grossProfitCents === 'number') {
    summary.gross_profit = cents(grossProfitCents);
    summary.gross_margin = rate(grossProfitCents, revenueCents);
    summary.profit_per_1000_revenue = cents(revenueCents ? (grossProfitCents / revenueCents) * 100_000 : 0);
  }

  return summary;
}

function rangeLabel(start: Date, endExclusive: Date) {
  return {
    days: daysInRange(start, endExclusive),
    end_exclusive: formatDateInput(endExclusive),
    start: formatDateInput(start),
  };
}

function hasRows(rows: unknown[] | undefined) {
  return Array.isArray(rows) && rows.length > 0;
}

const AI_BUSINESS_OVERVIEW_BASE_PROMPT = `
You are a world-class business analyst writing Sobrew's AI Business Overview and Health Report.

Use only the structured JSON snapshot provided by the application. Do not invent missing metrics, database rows, or causes. If data is incomplete, say so plainly and explain how that limits confidence.

Write in markdown with these exact sections:

1. Executive Diagnosis
2. Story Behind the Numbers
3. Revenue Quality and Customer Economics
4. Margin and Unit-Economic Health
5. Operational Health
6. Sales and Market Position
7. Financial Resilience
8. Strengths
9. Risks
10. Strategic Inflection Point
11. Recommended Priorities
12. Management Questions
13. Final Perspective

Focus on business health as of the selected as-of date. Separate revenue strength, unit economics, operating timing, inventory pressure, and sales pipeline health. Prefer specific numbers from the JSON when they matter. Keep the report decisive, candid, owner-friendly, and operationally useful.
`.trim();

export function buildBusinessHealthSnapshot({
  asOfDate,
  centers,
  currentDate = new Date(),
  inventoryItems = [],
  inventoryLots = [],
  nonInventoryExpenses = [],
  orderItems,
  orders,
  products,
  productionRunInputs = [],
  productionRuns = [],
  prospectingAggregate = null,
  reorderSettings = [],
  shortageMovements = [],
}: BuildBusinessHealthSnapshotInput): BusinessHealthSnapshot {
  const asOfStart = startOfDay(asOfDate);
  const asOfEndExclusive = addDays(asOfStart, 1);
  const monthStart = startOfMonth(asOfStart);
  const trailingStart = addDays(asOfEndExclusive, -56);
  const selectedRangeDays = daysInRange(monthStart, asOfEndExclusive);
  const priorEqualEndExclusive = monthStart;
  const priorEqualStart = addDays(priorEqualEndExclusive, -selectedRangeDays);

  const reporting = buildReportingDashboard({
    centers,
    filters: {
      rangeEndExclusive: asOfEndExclusive,
      rangeStart: monthStart,
      selectedMonth: monthStart,
    },
    inventoryItems,
    inventoryLots,
    now: asOfStart,
    orderItems,
    orders,
    products,
    reorderSettings,
    shortageMovements,
  });

  const monthProfitability = buildProfitabilityDashboard({
    centers,
    inventoryItems,
    inventoryLots,
    nonInventoryExpenses: nonInventoryExpenses as never[],
    orderItems,
    orders,
    productionRunInputs: productionRunInputs as never[],
    productionRuns: productionRuns as never[],
    products,
    rangeEndExclusive: asOfEndExclusive,
    rangeStart: monthStart,
    shortageMovements,
  });

  const trailingProfitability = buildProfitabilityDashboard({
    centers,
    inventoryItems,
    inventoryLots,
    nonInventoryExpenses: nonInventoryExpenses as never[],
    orderItems,
    orders,
    productionRunInputs: productionRunInputs as never[],
    productionRuns: productionRuns as never[],
    products,
    rangeEndExclusive: asOfEndExclusive,
    rangeStart: trailingStart,
    shortageMovements,
  });

  const priorProfitability = buildProfitabilityDashboard({
    centers,
    inventoryItems,
    inventoryLots,
    nonInventoryExpenses: nonInventoryExpenses as never[],
    orderItems,
    orders,
    productionRunInputs: productionRunInputs as never[],
    productionRuns: productionRuns as never[],
    products,
    rangeEndExclusive: priorEqualEndExclusive,
    rangeStart: priorEqualStart,
    shortageMovements,
  });

  const current = monthProfitability.current;
  const trailing = trailingProfitability.current;
  const prior = priorProfitability.current;
  const dataCoverageNotes: string[] = [
    `As-of date is treated as the end of ${formatDateInput(asOfStart)} in Central time.`,
    'Sales and margin are built from saved order and order-item COGS snapshots where available.',
  ];
  const missingData: string[] = [];

  if (!hasRows(orders)) missingData.push('No commerce orders were available in the loaded reporting window.');
  if (!hasRows(orderItems)) missingData.push('No order-item rows were available, so product/unit economics may be incomplete.');
  if (!hasRows(inventoryItems)) missingData.push('Inventory item details were unavailable for this snapshot.');
  if (!hasRows(inventoryLots)) missingData.push('Inventory lot valuation was unavailable or empty; inventory value may be understated.');
  if (!hasRows(productionRuns)) missingData.push('Production run rows were unavailable or empty for this snapshot.');
  if (!prospectingAggregate) missingData.push('Prospecting/pipeline data was unavailable for this snapshot.');
  if (formatDateInput(asOfStart) < formatDateInput(currentDate)) {
    missingData.push('Historical inventory is estimated/current-state-derived because exact finished-good inventory as of a past date cannot be fully reconstructed from the loaded data.');
  }
  if (monthProfitability.marginHealth.cogsTiming.hasEstimatedInventoryLabor) {
    missingData.push('Finished-good inventory labor is estimated because some shortage movements are not tied to specific production lots.');
  }

  const topCenterRevenue = reporting.customerSalesRows[0]?.revenueThisMonthCents ?? 0;
  const topFiveCenterRevenue = reporting.customerSalesRows
    .slice(0, 5)
    .reduce((total, row) => total + row.revenueThisMonthCents, 0);

  return {
    as_of_date: formatDateInput(asOfStart),
    as_of_end_exclusive: formatDateInput(asOfEndExclusive),
    cogs_timing: {
      estimated_inventory_labor: monthProfitability.marginHealth.cogsTiming.hasEstimatedInventoryLabor,
      finished_good_inventory_labor_current_or_estimated: cents(monthProfitability.marginHealth.cogsTiming.inventoryFinishedLaborCents),
      finished_good_inventory_value_current_or_estimated: cents(monthProfitability.marginHealth.cogsTiming.inventoryFinishedValueCents),
      lotless_shortage_units: monthProfitability.marginHealth.cogsTiming.lotlessShortageUnits,
      net_finished_units: monthProfitability.marginHealth.cogsTiming.netFinishedUnits,
      positive_finished_units: monthProfitability.marginHealth.cogsTiming.positiveFinishedUnits,
      production_actual_cogs_created: cents(monthProfitability.marginHealth.cogsTiming.productionActualCogsCents),
      production_labor_cogs_created: cents(monthProfitability.marginHealth.cogsTiming.productionLaborCogsCents),
      shipped_labor_cogs: cents(monthProfitability.marginHealth.cogsTiming.shippedLaborCogsCents),
      shipped_product_cogs: cents(monthProfitability.marginHealth.cogsTiming.shippedProductCogsCents),
      shipped_total_cogs: cents(monthProfitability.marginHealth.cogsTiming.shippedTotalCogsCents),
    },
    customer_health: {
      active_customers: reporting.mtdComparison.current.customerCount,
      concentration: {
        top_center_revenue_share_percent: current.revenueCents ? round((topCenterRevenue / current.revenueCents) * 100) : null,
        top_five_center_revenue_share_percent: current.revenueCents ? round((topFiveCenterRevenue / current.revenueCents) * 100) : null,
      },
      new_customers: reporting.mtdComparison.current.newCustomers,
      reorder_risk: {
        due_or_overdue: reporting.dailySnapshot.customersDueOrOverdue,
        high_risk: reporting.reorderRiskRows.filter((row) => row.riskLevel === 'High risk').length,
        medium_risk: reporting.reorderRiskRows.filter((row) => row.riskLevel === 'Medium risk').length,
      },
      returning_customers: reporting.mtdComparison.current.returningCustomers,
      top_centers: reporting.customerSalesRows.slice(0, 8).map((row) => ({
        average_order_value: cents(row.averageOrderValueCents),
        center_id: row.centerId,
        center_name: row.centerName,
        order_count: row.orderCount,
        revenue: cents(row.revenueThisMonthCents),
        status: row.status,
      })),
    },
    data_coverage_notes: dataCoverageNotes,
    inventory_and_working_capital: {
      finished_goods_value: cents(monthProfitability.inventorySummary.sellableValueCents),
      low_or_negative_stock_warnings: reporting.inventoryPlanningRows
        .filter((row) => row.warningLabel !== 'Healthy')
        .slice(0, 10)
        .map((row) => ({
          current_available_qty: row.currentAvailableQty,
          estimated_runout_date: row.estimatedRunoutDate ? formatDateInput(row.estimatedRunoutDate) : null,
          inventory_item_name: row.inventoryItemName,
          product_name: row.productName,
          recommended_reorder_qty: row.recommendedReorderQty,
          warning: row.warningLabel,
        })),
      material_supply_value: cents(monthProfitability.inventorySummary.materialSupplyValueCents),
      negative_finished_good_items: monthProfitability.inventorySummary.negativeSellableCount,
      raw_coffee_value: cents(monthProfitability.inventorySummary.rawCoffeeValueCents),
    },
    margin_health: {
      cogs_rates: {
        donation: rate(current.donationCogsCents, current.revenueCents),
        fixed_packaging: rate(current.fixedCents, current.revenueCents),
        labor: rate(current.laborCents, current.revenueCents),
        material: rate(current.materialCents, current.revenueCents),
        processing_fee: rate(current.processingFeeCogsCents, current.revenueCents),
        product_cogs: rate(current.productCogsCents, current.revenueCents),
        shipping: rate(current.shippingCogsCents, current.revenueCents),
      },
      month_to_date: metricSummary({
        days: selectedRangeDays,
        grossProfitCents: current.grossProfitCents,
        orderCount: current.orderCount,
        revenueCents: current.revenueCents,
        unitsSold: current.unitsSold,
      }),
      normalized_bridge: [
        ...monthProfitability.marginHealth.salesMetrics,
        ...monthProfitability.marginHealth.unitEconomicsRows,
      ].map((row) => ({
        baseline_rate_or_value: row.baselineValue,
        current_rate_or_value: row.currentValue,
        detail: row.detail,
        estimated_impact: cents(row.estimatedImpactCents),
        label: row.label,
        margin_point_or_value_change: row.changeValue,
        previous_rate_or_value: row.previousValue,
      })),
      top_center_margin_leaks: monthProfitability.marginHealth.centerLeaks.slice(0, 8).map((row) => ({
        baseline_margin_percent: row.baselineMarginPercent,
        center_id: row.id,
        center_name: row.label,
        current_margin_percent: row.currentMarginPercent,
        current_revenue: cents(row.currentRevenueCents),
        estimated_profit_impact: cents(row.estimatedImpactCents),
        margin_point_change: row.marginPointChange,
        status: row.status,
      })),
      top_product_margin_leaks: monthProfitability.marginHealth.productLeaks.slice(0, 8).map((row) => ({
        baseline_margin_percent: row.baselineMarginPercent,
        current_margin_percent: row.currentMarginPercent,
        current_revenue: cents(row.currentRevenueCents),
        estimated_profit_impact: cents(row.estimatedImpactCents),
        margin_point_change: row.marginPointChange,
        product_id: row.id,
        product_name: row.label,
        status: row.status,
      })),
    },
    missing_data: missingData,
    period: {
      month_to_date: rangeLabel(monthStart, asOfEndExclusive),
      prior_equal_range: rangeLabel(priorEqualStart, priorEqualEndExclusive),
      today: { end_exclusive: formatDateInput(asOfEndExclusive), start: formatDateInput(asOfStart) },
      trailing_8_weeks: rangeLabel(trailingStart, asOfEndExclusive),
    },
    production_health: {
      actual_cogs: cents(monthProfitability.productionSummary.actualCostCents),
      estimated_cogs: cents(monthProfitability.productionSummary.estimatedCostCents),
      fixed_cogs: cents(monthProfitability.productionSummary.fixedCostCents),
      labor_cogs: cents(monthProfitability.productionSummary.laborCostCents),
      material_cogs: cents(monthProfitability.productionSummary.materialCostCents),
      quantity_produced: monthProfitability.productionSummary.quantityProduced,
      recent_runs: monthProfitability.productionRows.slice(0, 8).map((row) => ({
        actual_cogs: cents(row.actualCostCents),
        estimated_cogs: cents(row.estimatedCostCents),
        material_usage_variance_qty: row.materialUsageVarianceQty,
        produced_at: row.producedAt ? formatDateInput(row.producedAt) : null,
        product_name: row.productName,
        quantity_produced: row.quantityProduced,
        unit_cost: cents(row.unitCostCents),
        variance: cents(row.varianceCents),
      })),
      run_count: monthProfitability.productionSummary.runCount,
      variance: cents(monthProfitability.productionSummary.varianceCents),
    },
    prompt_version: AI_BUSINESS_OVERVIEW_PROMPT_VERSION,
    prospecting_and_pipeline: prospectingAggregate,
    sales: {
      month_end_forecast: {
        caveat: reporting.forecast.fallbackMessage,
        confidence: reporting.forecast.confidence,
        method: reporting.forecast.method,
        orders: reporting.forecast.forecastOrderCount,
        revenue: cents(reporting.forecast.forecastRevenueCents),
      },
      month_to_date: metricSummary({
        days: selectedRangeDays,
        orderCount: reporting.mtdComparison.current.orderCount,
        revenueCents: reporting.mtdComparison.current.revenueCents,
        unitsSold: reporting.mtdComparison.current.unitsSold,
      }),
      prior_equal_range: metricSummary({
        days: daysInRange(priorEqualStart, priorEqualEndExclusive),
        grossProfitCents: prior.grossProfitCents,
        orderCount: prior.orderCount,
        revenueCents: prior.revenueCents,
        unitsSold: prior.unitsSold,
      }),
      today: metricSummary({
        days: 1,
        orderCount: reporting.dailySnapshot.ordersToday,
        revenueCents: reporting.dailySnapshot.revenueTodayCents,
        unitsSold: 0,
      }),
      top_products: reporting.topSellingProducts.slice(0, 8).map((row) => ({
        order_count: row.orderCount,
        percent_of_revenue: row.percentOfRevenue,
        product_id: row.productId,
        product_name: row.productName,
        revenue: cents(row.revenueCents),
        units_sold: row.unitsSold,
      })),
      trailing_8_weeks: metricSummary({
        days: daysInRange(trailingStart, asOfEndExclusive),
        grossProfitCents: trailing.grossProfitCents,
        orderCount: trailing.orderCount,
        revenueCents: trailing.revenueCents,
        unitsSold: trailing.unitsSold,
      }),
    },
  };
}

export function buildAiBusinessOverviewPrompt(snapshot: BusinessHealthSnapshot): { input: OpenAiPromptMessage[] } {
  return {
    input: [
      {
        content: [{ type: 'input_text', text: AI_BUSINESS_OVERVIEW_BASE_PROMPT }],
        role: 'developer',
      },
      {
        content: [
          {
            type: 'input_text',
            text: `BusinessHealthSnapshot JSON:\n${JSON.stringify(snapshot, null, 2)}`,
          },
        ],
        role: 'user',
      },
    ],
  };
}

export function cleanAiBusinessOverviewMarkdown(value: string) {
  return value
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function extractOpenAiResponseText(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'output_text' in payload) {
    const outputText = (payload as { output_text?: unknown }).output_text;
    if (typeof outputText === 'string') return outputText;
  }

  const output = payload && typeof payload === 'object' && 'output' in payload
    ? (payload as { output?: unknown }).output
    : null;
  if (!Array.isArray(output)) return '';

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object' || !('content' in item)) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') chunks.push(text);
    }
  }

  return chunks.join('\n').trim();
}

export async function generateAiBusinessOverviewMarkdown({
  apiKey,
  fetchImpl = fetch,
  model = AI_BUSINESS_OVERVIEW_DEFAULT_MODEL,
  snapshot,
}: {
  apiKey: string | undefined;
  fetchImpl?: typeof fetch;
  model?: string;
  snapshot: BusinessHealthSnapshot;
}): Promise<{ markdown: string; model: string }> {
  if (!apiKey) throw new Error('missing_openai_api_key');

  const prompt = buildAiBusinessOverviewPrompt(snapshot);
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    body: JSON.stringify({
      input: prompt.input,
      model,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) throw new Error('openai_request_failed');

  const payload = await response.json();
  const markdown = cleanAiBusinessOverviewMarkdown(extractOpenAiResponseText(payload));
  if (!markdown) throw new Error('empty_openai_response');

  return { markdown, model };
}

import {
  recommendInventoryAction,
  type PlanningConfidence,
} from '@/lib/inventory-planning';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const FORECAST_HISTORY_MONTHS = 3;
const USAGE_LOOKBACK_DAYS = 56;

export const CUSTOMER_STATUS_RULES = {
  growingRevenuePercent: 20,
  decliningRevenuePercent: -20,
  reactivationQuietDays: 60,
  atRiskMinimumQuietDays: 45,
  atRiskAverageGapMultiplier: 1.3,
  lostQuietDays: 90,
  fallbackReorderDays: 30,
  mediumRiskUpcomingDays: 7,
  highRiskOverdueDays: 7,
  highRiskAverageGapMultiplier: 1.5,
} as const;

export type ReportingOrderRow = {
  id: string;
  center_id: string | null;
  status: string | null;
  subtotal_cents: number | string | null;
  shipping_cost_cents?: number | string | null;
  created_at: string | null;
};

export type ReportingOrderItemRow = {
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string | null;
  qty: number | string | null;
  unit_price_cents: number | string | null;
  line_total_cents: number | string | null;
};

export type ReportingCenterRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

export type ReportingProductRow = {
  id: string;
  name: string | null;
  sku: string | null;
  active: boolean | null;
  category?: string | null;
};

export type ReportingInventoryItemRow = {
  id: string;
  name: string;
  sku: string | null;
  item_type: string;
  base_unit: string;
  product_id: string | null;
  active: boolean | null;
};

export type ReportingInventoryLotRow = {
  inventory_item_id: string;
  quantity_remaining: number | string | null;
};

export type ReportingInventoryMovementRow = {
  inventory_item_id: string;
  quantity_change: number | string | null;
};

export type ReportingReorderSettingRow = {
  inventory_item_id: string;
  reorder_point: number | string | null;
  target_stock: number | string | null;
  lead_time_days: number | string | null;
};

export type ReportingFilters = {
  selectedMonth: Date;
  rangeStart: Date;
  rangeEndExclusive: Date;
  productId?: string;
  centerId?: string;
};

export type SalesMetricSummary = {
  revenueCents: number;
  shippingCostCents: number;
  grossAfterShippingCents: number;
  orderCount: number;
  unitsSold: number;
  quantitySold: number;
  averageOrderValueCents: number;
  newCustomers: number;
  returningCustomers: number;
  customerCount: number;
};

export type MetricComparisonRow = {
  id: keyof SalesMetricSummary;
  label: string;
  current: number;
  previous: number;
  change: number;
  percentChange: number;
  format: 'currency' | 'number';
};

export type MtdComparison = {
  current: SalesMetricSummary;
  previous: SalesMetricSummary;
  revenuePercentAhead: number;
  orderPercentAhead: number;
  projectedRevenueCents: number;
  projectedOrderCount: number;
  elapsedDays: number;
  selectedPeriodEndDay: number;
  previousPeriodEndDay: number;
};

export type ForecastProductRow = {
  productId: string;
  productName: string;
  forecastQty: number;
  recommendedQty: number;
  currentMonthPaceQty: number;
  historicalMonthlyAvgQty: number;
  priorMonthQty: number;
  confidence: PlanningConfidence;
};

export type SalesForecast = {
  forecastRevenueCents: number;
  forecastOrderCount: number;
  confidence: PlanningConfidence;
  method: string;
  fallbackMessage: string | null;
  historicalMonthsUsed: number;
  currentPaceRevenueCents: number;
  historicalAverageRevenueCents: number;
  productDemand: ForecastProductRow[];
};

export type ProductSalesRow = {
  productId: string;
  productName: string;
  unitsSold: number;
  quantitySold: number;
  revenueCents: number;
  percentOfRevenue: number;
  previousRevenueCents: number;
  revenueChangeCents: number;
  growthPercent: number;
  orderCount: number;
};

export type CustomerStatus = 'New' | 'Active' | 'Growing' | 'Declining' | 'At risk' | 'Lost' | 'Reactivated';

export type CustomerSalesRow = {
  centerId: string;
  centerName: string;
  revenueThisMonthCents: number;
  revenueLastMonthCents: number;
  changeCents: number;
  changePercent: number;
  orderCount: number;
  averageOrderValueCents: number;
  lastOrderDate: Date | null;
  firstOrderDate: Date | null;
  lifetimeRevenueCents: number;
  status: CustomerStatus;
};

export type ReorderRiskLevel = 'Low risk' | 'Medium risk' | 'High risk';

export type ReorderRiskRow = {
  centerId: string;
  centerName: string;
  averageDaysBetweenOrders: number | null;
  lastOrderDate: Date | null;
  expectedNextOrderDate: Date | null;
  daysSinceLastOrder: number | null;
  daysPastExpected: number | null;
  riskLevel: ReorderRiskLevel;
  suggestedAction: string;
};

export type InventoryPlanningRow = {
  productId: string;
  productName: string;
  inventoryItemName: string | null;
  currentAvailableQty: number | null;
  averageWeeklyUsageQty: number;
  forecastedMonthlyDemandQty: number;
  estimatedRunoutDate: Date | null;
  recommendedReorderQty: number;
  warningLabel: string;
  unitLabel: string;
};

export type DailySalesSnapshot = {
  revenueTodayCents: number;
  ordersToday: number;
  revenueMonthToDateCents: number;
  ordersMonthToDate: number;
  revenueComparedToSameDayLastMonthCents: number;
  orderComparedToSameDayLastMonth: number;
  projectedMonthEndRevenueCents: number;
  projectedMonthEndOrders: number;
  topProductThisMonth: string;
  customersDueOrOverdue: number;
};

export type ReportingDashboard = {
  monthStart: Date;
  previousMonthStart: Date;
  monthEndExclusive: Date;
  rangeStart: Date;
  rangeEndExclusive: Date;
  monthComparisonRows: MetricComparisonRow[];
  selectedMonthMetrics: SalesMetricSummary;
  previousMonthMetrics: SalesMetricSummary;
  mtdComparison: MtdComparison;
  forecast: SalesForecast;
  productSalesRows: ProductSalesRow[];
  topSellingProducts: ProductSalesRow[];
  slowMovingProducts: ProductSalesRow[];
  customerSalesRows: CustomerSalesRow[];
  reorderRiskRows: ReorderRiskRow[];
  inventoryPlanningRows: InventoryPlanningRow[];
  dailySnapshot: DailySalesSnapshot;
  hasOrders: boolean;
};

type NormalizedOrder = {
  id: string;
  centerId: string | null;
  status: string | null;
  subtotalCents: number;
  shippingCostCents: number;
  createdAt: Date;
};

type NormalizedLine = {
  orderId: string;
  productId: string | null;
  productName: string;
  centerId: string | null;
  createdAt: Date;
  qty: number;
  revenueCents: number;
};

type MetricScope = {
  productId?: string;
  centerId?: string;
};

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function formatDateInput(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatMonthInput(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

export function parseDateInput(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
}

export function parseMonthInput(value: string | string[] | undefined, now: Date) {
  if (typeof value !== 'string') return startOfMonth(now);
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return startOfMonth(now);
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10) - 1;
  const date = new Date(year, month, 1);
  return date.getFullYear() === year && date.getMonth() === month ? date : startOfMonth(now);
}

export function defaultRangeForMonth(monthStart: Date) {
  return {
    rangeStart: monthStart,
    rangeEndExclusive: addMonths(monthStart, 1),
  };
}

function numericValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(later: Date, earlier: Date) {
  return Math.floor((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / DAY_IN_MS);
}

function daysInMonth(monthStart: Date) {
  return addMonths(monthStart, 1).getDate() === 1
    ? Math.round((addMonths(monthStart, 1).getTime() - monthStart.getTime()) / DAY_IN_MS)
    : new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function centerName(center: ReportingCenterRow | undefined) {
  return center?.name?.trim() || 'Unnamed center';
}

function productName(product: ReportingProductRow | undefined, snapshot?: string | null) {
  return product?.name?.trim() || snapshot?.trim() || 'Unknown product';
}

function sortedOrderDates(orders: NormalizedOrder[]) {
  return orders.map((order) => order.createdAt).sort((a, b) => a.getTime() - b.getTime());
}

function averageDaysBetweenDates(dates: Date[]) {
  if (dates.length < 2) return null;
  let total = 0;
  let count = 0;
  for (let index = 1; index < dates.length; index += 1) {
    const gap = daysBetween(dates[index], dates[index - 1]);
    if (gap > 0) {
      total += gap;
      count += 1;
    }
  }
  return count ? total / count : null;
}

function orderMatchesScope(order: NormalizedOrder, scope: MetricScope) {
  return !scope.centerId || order.centerId === scope.centerId;
}

function lineMatchesScope(line: NormalizedLine, scope: MetricScope) {
  if (scope.centerId && line.centerId !== scope.centerId) return false;
  if (scope.productId && line.productId !== scope.productId) return false;
  return true;
}

function lineRevenue(item: ReportingOrderItemRow) {
  const explicitLineTotal = numericValue(item.line_total_cents);
  if (explicitLineTotal > 0) return explicitLineTotal;
  return numericValue(item.qty) * numericValue(item.unit_price_cents);
}

function metricForPeriod({
  end,
  firstOrderDateByCenterId,
  lines,
  orders,
  scope,
  start,
}: {
  end: Date;
  firstOrderDateByCenterId: Map<string, Date>;
  lines: NormalizedLine[];
  orders: NormalizedOrder[];
  scope: MetricScope;
  start: Date;
}): SalesMetricSummary {
  const scopedOrders = orders.filter((order) => order.createdAt >= start && order.createdAt < end && orderMatchesScope(order, scope));
  const scopedLines = lines.filter((line) => line.createdAt >= start && line.createdAt < end && lineMatchesScope(line, scope));
  const orderIds = new Set(scope.productId ? scopedLines.map((line) => line.orderId) : scopedOrders.map((order) => order.id));
  const centerIds = new Set<string>();

  for (const order of scopedOrders) {
    if (orderIds.has(order.id) && order.centerId) centerIds.add(order.centerId);
  }
  for (const line of scopedLines) {
    if (line.centerId) centerIds.add(line.centerId);
  }

  const revenueCents = scope.productId
    ? scopedLines.reduce((sum, line) => sum + line.revenueCents, 0)
    : scopedOrders.reduce((sum, order) => sum + order.subtotalCents, 0);
  const shippingCostCents = scope.productId
    ? 0
    : scopedOrders.reduce((sum, order) => sum + order.shippingCostCents, 0);
  const unitsSold = scopedLines.reduce((sum, line) => sum + line.qty, 0);
  let newCustomers = 0;

  for (const centerId of centerIds) {
    const firstOrderDate = firstOrderDateByCenterId.get(centerId);
    if (firstOrderDate && firstOrderDate >= start && firstOrderDate < end) newCustomers += 1;
  }

  const orderCount = orderIds.size;

  return {
    revenueCents: Math.round(revenueCents),
    shippingCostCents: Math.round(shippingCostCents),
    grossAfterShippingCents: Math.round(revenueCents - shippingCostCents),
    orderCount,
    unitsSold,
    quantitySold: unitsSold,
    averageOrderValueCents: orderCount ? Math.round(revenueCents / orderCount) : 0,
    newCustomers,
    returningCustomers: Math.max(0, centerIds.size - newCustomers),
    customerCount: centerIds.size,
  };
}

function buildComparisonRows(current: SalesMetricSummary, previous: SalesMetricSummary): MetricComparisonRow[] {
  const rows: Array<{ id: keyof SalesMetricSummary; label: string; format: 'currency' | 'number' }> = [
    { id: 'revenueCents', label: 'Total revenue', format: 'currency' },
    { id: 'shippingCostCents', label: 'Shipping COGS', format: 'currency' },
    { id: 'grossAfterShippingCents', label: 'Gross after shipping', format: 'currency' },
    { id: 'orderCount', label: 'Total orders', format: 'number' },
    { id: 'unitsSold', label: 'Units sold', format: 'number' },
    { id: 'quantitySold', label: 'Quantity sold', format: 'number' },
    { id: 'averageOrderValueCents', label: 'Average order value', format: 'currency' },
    { id: 'newCustomers', label: 'New customers', format: 'number' },
    { id: 'returningCustomers', label: 'Returning customers', format: 'number' },
  ];

  return rows.map((row) => {
    const currentValue = current[row.id];
    const previousValue = previous[row.id];
    return {
      ...row,
      current: currentValue,
      previous: previousValue,
      change: currentValue - previousValue,
      percentChange: percentChange(currentValue, previousValue),
    };
  });
}

function selectedMtdBounds(selectedMonthStart: Date, now: Date) {
  const selectedDays = daysInMonth(selectedMonthStart);
  const previousMonthStart = addMonths(selectedMonthStart, -1);
  const previousDays = daysInMonth(previousMonthStart);
  const anchorDay = Math.max(1, now.getDate());
  const selectedPeriodEndDay = Math.min(anchorDay, selectedDays);
  const previousPeriodEndDay = Math.min(anchorDay, previousDays);

  return {
    selectedEndExclusive: addDays(selectedMonthStart, selectedPeriodEndDay),
    previousEndExclusive: addDays(previousMonthStart, previousPeriodEndDay),
    selectedPeriodEndDay,
    previousPeriodEndDay,
  };
}

function forecastConfidence(historicalMonthsUsed: number, currentOrderCount: number, elapsedDays: number): PlanningConfidence {
  if (historicalMonthsUsed >= 3 && currentOrderCount >= 5 && elapsedDays >= 7) return 'High';
  if (historicalMonthsUsed >= 2 || currentOrderCount >= 2) return 'Medium';
  return 'Low';
}

function buildForecast({
  firstOrderDateByCenterId,
  lines,
  monthStart,
  orders,
  products,
  scope,
  selectedMtdEndExclusive,
  selectedPeriodEndDay,
}: {
  firstOrderDateByCenterId: Map<string, Date>;
  lines: NormalizedLine[];
  monthStart: Date;
  orders: NormalizedOrder[];
  products: ReportingProductRow[];
  scope: MetricScope;
  selectedMtdEndExclusive: Date;
  selectedPeriodEndDay: number;
}): SalesForecast {
  const monthDayCount = daysInMonth(monthStart);
  const elapsedDays = Math.max(1, selectedPeriodEndDay);
  const currentMtd = metricForPeriod({
    end: selectedMtdEndExclusive,
    firstOrderDateByCenterId,
    lines,
    orders,
    scope,
    start: monthStart,
  });
  const historicalMetrics = Array.from({ length: FORECAST_HISTORY_MONTHS }, (_, index) => {
    const start = addMonths(monthStart, -(index + 1));
    const end = addMonths(start, 1);
    return metricForPeriod({ end, firstOrderDateByCenterId, lines, orders, scope, start });
  });
  const historicalMonthsUsed = historicalMetrics.filter((metric) => metric.orderCount > 0).length;
  const historicalAverageRevenueCents = Math.round(historicalMetrics.reduce((sum, metric) => sum + metric.revenueCents, 0) / FORECAST_HISTORY_MONTHS);
  const historicalAverageOrderCount = historicalMetrics.reduce((sum, metric) => sum + metric.orderCount, 0) / FORECAST_HISTORY_MONTHS;
  const currentPaceRevenueCents = Math.round((currentMtd.revenueCents / elapsedDays) * monthDayCount);
  const currentPaceOrderCount = (currentMtd.orderCount / elapsedDays) * monthDayCount;
  const confidence = forecastConfidence(historicalMonthsUsed, currentMtd.orderCount, elapsedDays);
  const hasCurrentPace = currentMtd.orderCount > 0 || currentMtd.revenueCents > 0;
  const canBlend = historicalMonthsUsed >= 2 && hasCurrentPace;
  const forecastRevenueCents = canBlend
    ? Math.round(currentPaceRevenueCents * 0.6 + historicalAverageRevenueCents * 0.4)
    : hasCurrentPace
      ? currentPaceRevenueCents
      : historicalAverageRevenueCents;
  const forecastOrderCount = Math.round(
    canBlend
      ? currentPaceOrderCount * 0.6 + historicalAverageOrderCount * 0.4
      : hasCurrentPace
        ? currentPaceOrderCount
        : historicalAverageOrderCount
  );
  const fallbackMessage = !hasCurrentPace && historicalMonthsUsed < 2
    ? 'Not enough current or historical order volume yet to build a reliable forecast.'
    : null;
  const method = canBlend
    ? 'Blends current month-to-date pace at 60% with the prior three-month average at 40%.'
    : hasCurrentPace
      ? 'Uses current month-to-date daily pace because historical data is limited.'
      : 'Uses the prior three-month average because the selected month has no order pace yet.';

  const productIds = new Set<string>();
  for (const product of products) {
    if (product.active !== false) productIds.add(product.id);
  }
  for (const line of lines) {
    if (line.productId) productIds.add(line.productId);
  }
  if (scope.productId) {
    for (const productId of [...productIds]) {
      if (productId !== scope.productId) productIds.delete(productId);
    }
  }
  const productById = new Map(products.map((product) => [product.id, product]));

  const productDemand = [...productIds].map((productId) => {
    const productScope = { ...scope, productId };
    const currentProductMtd = metricForPeriod({
      end: selectedMtdEndExclusive,
      firstOrderDateByCenterId,
      lines,
      orders,
      scope: productScope,
      start: monthStart,
    });
    const priorMonthStart = addMonths(monthStart, -1);
    const priorMonth = metricForPeriod({
      end: monthStart,
      firstOrderDateByCenterId,
      lines,
      orders,
      scope: productScope,
      start: priorMonthStart,
    });
    const historicalQty = Array.from({ length: FORECAST_HISTORY_MONTHS }, (_, index) => {
      const start = addMonths(monthStart, -(index + 1));
      const end = addMonths(start, 1);
      return metricForPeriod({ end, firstOrderDateByCenterId, lines, orders, scope: productScope, start }).quantitySold;
    });
    const productHistoricalMonths = historicalQty.filter((qty) => qty > 0).length;
    const historicalMonthlyAvgQty = historicalQty.reduce((sum, qty) => sum + qty, 0) / FORECAST_HISTORY_MONTHS;
    const currentMonthPaceQty = (currentProductMtd.quantitySold / elapsedDays) * monthDayCount;
    const forecastQty = productHistoricalMonths >= 2 && currentProductMtd.quantitySold > 0
      ? currentMonthPaceQty * 0.6 + historicalMonthlyAvgQty * 0.4
      : currentProductMtd.quantitySold > 0
        ? currentMonthPaceQty
        : historicalMonthlyAvgQty;

    return {
      productId,
      productName: productName(productById.get(productId)),
      forecastQty,
      recommendedQty: forecastQty >= 0.5 ? Math.ceil(forecastQty) : 0,
      currentMonthPaceQty,
      historicalMonthlyAvgQty,
      priorMonthQty: priorMonth.quantitySold,
      confidence: forecastConfidence(productHistoricalMonths, currentProductMtd.orderCount, elapsedDays),
    };
  })
    .filter((row) => row.forecastQty > 0 || row.priorMonthQty > 0)
    .sort((a, b) => b.recommendedQty - a.recommendedQty || b.forecastQty - a.forecastQty || a.productName.localeCompare(b.productName));

  return {
    forecastRevenueCents,
    forecastOrderCount,
    confidence,
    method,
    fallbackMessage,
    historicalMonthsUsed,
    currentPaceRevenueCents,
    historicalAverageRevenueCents,
    productDemand,
  };
}

function buildProductSalesRows({
  firstOrderDateByCenterId,
  lines,
  monthStart,
  orders,
  products,
  rangeEndExclusive,
  rangeStart,
  scope,
}: {
  firstOrderDateByCenterId: Map<string, Date>;
  lines: NormalizedLine[];
  monthStart: Date;
  orders: NormalizedOrder[];
  products: ReportingProductRow[];
  rangeEndExclusive: Date;
  rangeStart: Date;
  scope: MetricScope;
}) {
  const productIds = new Set<string>();
  for (const product of products) {
    if (product.active !== false) productIds.add(product.id);
  }
  for (const line of lines) {
    if (line.productId) productIds.add(line.productId);
  }
  if (scope.productId) {
    for (const productId of [...productIds]) {
      if (productId !== scope.productId) productIds.delete(productId);
    }
  }

  const productById = new Map(products.map((product) => [product.id, product]));
  const rangeLines = lines.filter((line) => line.createdAt >= rangeStart && line.createdAt < rangeEndExclusive && lineMatchesScope(line, scope));
  const totalRevenue = rangeLines.reduce((sum, line) => sum + line.revenueCents, 0);
  const previousMonthStart = addMonths(monthStart, -1);

  return [...productIds].map((productId) => {
    const productScope = { ...scope, productId };
    const currentLines = rangeLines.filter((line) => line.productId === productId);
    const currentMetric = metricForPeriod({
      end: addMonths(monthStart, 1),
      firstOrderDateByCenterId,
      lines,
      orders,
      scope: productScope,
      start: monthStart,
    });
    const previousMetric = metricForPeriod({
      end: monthStart,
      firstOrderDateByCenterId,
      lines,
      orders,
      scope: productScope,
      start: previousMonthStart,
    });
    const revenueCents = currentLines.reduce((sum, line) => sum + line.revenueCents, 0);
    const quantitySold = currentLines.reduce((sum, line) => sum + line.qty, 0);
    const orderCount = new Set(currentLines.map((line) => line.orderId)).size;

    return {
      productId,
      productName: productName(productById.get(productId), currentLines[0]?.productName),
      unitsSold: quantitySold,
      quantitySold,
      revenueCents: Math.round(revenueCents),
      percentOfRevenue: totalRevenue > 0 ? (revenueCents / totalRevenue) * 100 : 0,
      previousRevenueCents: previousMetric.revenueCents,
      revenueChangeCents: currentMetric.revenueCents - previousMetric.revenueCents,
      growthPercent: percentChange(currentMetric.revenueCents, previousMetric.revenueCents),
      orderCount,
    };
  })
    .sort((a, b) => b.revenueCents - a.revenueCents || b.quantitySold - a.quantitySold || a.productName.localeCompare(b.productName));
}

function customerStatusFor({
  averageDaysBetweenOrders,
  firstOrderDate,
  lastOrderDate,
  monthEndExclusive,
  monthStart,
  now,
  orderCountThisMonth,
  previousOrderBeforeMonth,
  revenueLastMonthCents,
  revenueThisMonthCents,
}: {
  averageDaysBetweenOrders: number | null;
  firstOrderDate: Date | null;
  lastOrderDate: Date | null;
  monthEndExclusive: Date;
  monthStart: Date;
  now: Date;
  orderCountThisMonth: number;
  previousOrderBeforeMonth: Date | null;
  revenueLastMonthCents: number;
  revenueThisMonthCents: number;
}): CustomerStatus {
  if (firstOrderDate && firstOrderDate >= monthStart && firstOrderDate < monthEndExclusive && orderCountThisMonth > 0) return 'New';

  if (
    orderCountThisMonth > 0 &&
    previousOrderBeforeMonth &&
    daysBetween(monthStart, previousOrderBeforeMonth) >= CUSTOMER_STATUS_RULES.reactivationQuietDays &&
    revenueLastMonthCents === 0
  ) {
    return 'Reactivated';
  }

  if (lastOrderDate) {
    const daysSinceLastOrder = daysBetween(now, lastOrderDate);
    if (daysSinceLastOrder >= CUSTOMER_STATUS_RULES.lostQuietDays) return 'Lost';
    if (
      daysSinceLastOrder >= CUSTOMER_STATUS_RULES.atRiskMinimumQuietDays ||
      (averageDaysBetweenOrders !== null && daysSinceLastOrder > averageDaysBetweenOrders * CUSTOMER_STATUS_RULES.atRiskAverageGapMultiplier)
    ) {
      return 'At risk';
    }
  }

  if (revenueLastMonthCents > 0) {
    const changePercent = percentChange(revenueThisMonthCents, revenueLastMonthCents);
    if (changePercent >= CUSTOMER_STATUS_RULES.growingRevenuePercent) return 'Growing';
    if (changePercent <= CUSTOMER_STATUS_RULES.decliningRevenuePercent) return 'Declining';
  }

  return 'Active';
}

function buildCustomerSalesRows({
  centers,
  firstOrderDateByCenterId,
  lines,
  monthEndExclusive,
  monthStart,
  now,
  orders,
  previousMonthStart,
  scope,
}: {
  centers: ReportingCenterRow[];
  firstOrderDateByCenterId: Map<string, Date>;
  lines: NormalizedLine[];
  monthEndExclusive: Date;
  monthStart: Date;
  now: Date;
  orders: NormalizedOrder[];
  previousMonthStart: Date;
  scope: MetricScope;
}) {
  const centerById = new Map(centers.map((center) => [center.id, center]));
  const centerIds = new Set<string>();
  for (const center of centers) {
    if (center.is_active !== false) centerIds.add(center.id);
  }
  for (const order of orders) {
    if (order.centerId) centerIds.add(order.centerId);
  }
  if (scope.centerId) {
    for (const centerId of [...centerIds]) {
      if (centerId !== scope.centerId) centerIds.delete(centerId);
    }
  }

  return [...centerIds].map((centerId) => {
    const centerScope = { ...scope, centerId };
    const centerOrders = orders.filter((order) => order.centerId === centerId);
    const dates = sortedOrderDates(centerOrders);
    const firstOrderDate = dates[0] ?? firstOrderDateByCenterId.get(centerId) ?? null;
    const lastOrderDate = dates[dates.length - 1] ?? null;
    const averageDaysBetweenOrders = averageDaysBetweenDates(dates);
    const thisMonth = metricForPeriod({
      end: monthEndExclusive,
      firstOrderDateByCenterId,
      lines,
      orders,
      scope: centerScope,
      start: monthStart,
    });
    const lastMonth = metricForPeriod({
      end: monthStart,
      firstOrderDateByCenterId,
      lines,
      orders,
      scope: centerScope,
      start: previousMonthStart,
    });
    const lifetime = metricForPeriod({
      end: addMonths(startOfMonth(now), 1200),
      firstOrderDateByCenterId,
      lines,
      orders,
      scope: centerScope,
      start: new Date(2000, 0, 1),
    });
    const previousOrderBeforeMonth = dates.filter((date) => date < monthStart).at(-1) ?? null;

    return {
      centerId,
      centerName: centerName(centerById.get(centerId)),
      revenueThisMonthCents: thisMonth.revenueCents,
      revenueLastMonthCents: lastMonth.revenueCents,
      changeCents: thisMonth.revenueCents - lastMonth.revenueCents,
      changePercent: percentChange(thisMonth.revenueCents, lastMonth.revenueCents),
      orderCount: thisMonth.orderCount,
      averageOrderValueCents: thisMonth.averageOrderValueCents,
      lastOrderDate,
      firstOrderDate,
      lifetimeRevenueCents: lifetime.revenueCents,
      status: customerStatusFor({
        averageDaysBetweenOrders,
        firstOrderDate,
        lastOrderDate,
        monthEndExclusive,
        monthStart,
        now,
        orderCountThisMonth: thisMonth.orderCount,
        previousOrderBeforeMonth,
        revenueLastMonthCents: lastMonth.revenueCents,
        revenueThisMonthCents: thisMonth.revenueCents,
      }),
    };
  })
    .filter((row) => row.lifetimeRevenueCents > 0 || row.revenueThisMonthCents > 0 || row.revenueLastMonthCents > 0)
    .sort((a, b) => b.revenueThisMonthCents - a.revenueThisMonthCents || b.lifetimeRevenueCents - a.lifetimeRevenueCents || a.centerName.localeCompare(b.centerName));
}

function buildReorderRiskRows({
  centers,
  now,
  orders,
  scope,
}: {
  centers: ReportingCenterRow[];
  now: Date;
  orders: NormalizedOrder[];
  scope: MetricScope;
}) {
  const centerById = new Map(centers.map((center) => [center.id, center]));
  const ordersByCenter = new Map<string, NormalizedOrder[]>();
  for (const order of orders) {
    if (!order.centerId || (scope.centerId && order.centerId !== scope.centerId)) continue;
    const existing = ordersByCenter.get(order.centerId) ?? [];
    existing.push(order);
    ordersByCenter.set(order.centerId, existing);
  }

  return [...ordersByCenter.entries()].map(([centerId, centerOrders]) => {
    const dates = sortedOrderDates(centerOrders);
    const lastOrderDate = dates.at(-1) ?? null;
    const averageDaysBetweenOrders = averageDaysBetweenDates(dates);
    const reorderWindowDays = Math.max(1, Math.round(averageDaysBetweenOrders ?? CUSTOMER_STATUS_RULES.fallbackReorderDays));
    const expectedNextOrderDate = lastOrderDate ? addDays(lastOrderDate, reorderWindowDays) : null;
    const daysSinceLastOrder = lastOrderDate ? daysBetween(now, lastOrderDate) : null;
    const daysPastExpected = expectedNextOrderDate ? daysBetween(now, expectedNextOrderDate) : null;
    const highRisk =
      daysPastExpected !== null &&
      (
        daysPastExpected >= CUSTOMER_STATUS_RULES.highRiskOverdueDays ||
        (averageDaysBetweenOrders !== null && daysSinceLastOrder !== null && daysSinceLastOrder >= averageDaysBetweenOrders * CUSTOMER_STATUS_RULES.highRiskAverageGapMultiplier)
      );
    const mediumRisk = !highRisk && daysPastExpected !== null && daysPastExpected >= -CUSTOMER_STATUS_RULES.mediumRiskUpcomingDays;
    const riskLevel: ReorderRiskLevel = highRisk ? 'High risk' : mediumRisk ? 'Medium risk' : 'Low risk';
    const suggestedAction = highRisk
      ? 'Prioritize outreach and confirm the next order.'
      : mediumRisk
        ? 'Check in before the normal reorder window slips.'
        : 'No immediate action needed.';

    return {
      centerId,
      centerName: centerName(centerById.get(centerId)),
      averageDaysBetweenOrders,
      lastOrderDate,
      expectedNextOrderDate,
      daysSinceLastOrder,
      daysPastExpected,
      riskLevel,
      suggestedAction,
    };
  })
    .sort((a, b) => {
      const riskRank: Record<ReorderRiskLevel, number> = { 'High risk': 0, 'Medium risk': 1, 'Low risk': 2 };
      return riskRank[a.riskLevel] - riskRank[b.riskLevel] || (b.daysPastExpected ?? -9999) - (a.daysPastExpected ?? -9999) || a.centerName.localeCompare(b.centerName);
    });
}

function buildInventoryPlanningRows({
  forecast,
  inventoryItems,
  inventoryLots,
  shortageMovements,
  lines,
  now,
  products,
  reorderSettings,
  scope,
}: {
  forecast: SalesForecast;
  inventoryItems: ReportingInventoryItemRow[];
  inventoryLots: ReportingInventoryLotRow[];
  shortageMovements: ReportingInventoryMovementRow[];
  lines: NormalizedLine[];
  now: Date;
  products: ReportingProductRow[];
  reorderSettings: ReportingReorderSettingRow[];
  scope: MetricScope;
}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const forecastByProductId = new Map(forecast.productDemand.map((row) => [row.productId, row]));
  const finishedItemByProductId = new Map(
    inventoryItems
      .filter((item) => item.item_type === 'finished_good' && item.product_id)
      .map((item) => [item.product_id as string, item])
  );
  const settingByItemId = new Map(reorderSettings.map((setting) => [setting.inventory_item_id, setting]));
  const availableByItemId = new Map<string, number>();

  for (const lot of inventoryLots) {
    availableByItemId.set(lot.inventory_item_id, (availableByItemId.get(lot.inventory_item_id) ?? 0) + numericValue(lot.quantity_remaining));
  }
  for (const movement of shortageMovements) {
    availableByItemId.set(
      movement.inventory_item_id,
      (availableByItemId.get(movement.inventory_item_id) ?? 0) + numericValue(movement.quantity_change)
    );
  }

  const usageStart = addDays(startOfDay(now), -USAGE_LOOKBACK_DAYS);
  const productIds = new Set<string>();
  for (const product of products) {
    if (product.active !== false) productIds.add(product.id);
  }
  for (const row of forecast.productDemand) productIds.add(row.productId);
  if (scope.productId) {
    for (const productId of [...productIds]) {
      if (productId !== scope.productId) productIds.delete(productId);
    }
  }

  return [...productIds].map((productId) => {
    const usageLines = lines.filter((line) => line.productId === productId && line.createdAt >= usageStart && lineMatchesScope(line, scope));
    const averageWeeklyUsageQty = usageLines.reduce((sum, line) => sum + line.qty, 0) / (USAGE_LOOKBACK_DAYS / 7);
    const forecastRow = forecastByProductId.get(productId);
    const forecastedMonthlyDemandQty = forecastRow?.forecastQty ?? averageWeeklyUsageQty * 4.345;
    const item = finishedItemByProductId.get(productId);
    const setting = item ? settingByItemId.get(item.id) : undefined;
    const currentAvailableQty = item ? (availableByItemId.get(item.id) ?? 0) : null;
    const averageDailyUsageQty = averageWeeklyUsageQty / 7;
    const estimatedRunoutDate =
      currentAvailableQty !== null && averageDailyUsageQty > 0
        ? addDays(startOfDay(now), Math.floor(currentAvailableQty / averageDailyUsageQty))
        : null;
    const recommendation = recommendInventoryAction({
      availableQty: currentAvailableQty ?? 0,
      confidence: forecastRow?.confidence ?? forecast.confidence,
      expectedDemandQty: forecastedMonthlyDemandQty,
      likelyCustomerCount: forecastRow && forecastRow.recommendedQty > 0 ? 1 : 0,
      rules: {
        actionVerb: 'Make',
        actionThresholdQty: 0.75,
        minimumActionQty: 1,
        orderMultiple: 1,
        safetyStockQty: numericValue(setting?.reorder_point),
        unitLabel: item?.base_unit ?? 'each',
      },
    });
    const reorderPoint = numericValue(setting?.reorder_point);
    const warningLabel = !item || currentAvailableQty === null
      ? 'Not tracked'
      : currentAvailableQty <= reorderPoint && reorderPoint > 0
        ? 'Low stock'
        : estimatedRunoutDate && estimatedRunoutDate <= addDays(startOfDay(now), 14)
          ? 'Expected stockout'
          : recommendation.recommendedQty > 0
            ? 'Reorder suggested'
            : 'On pace';

    return {
      productId,
      productName: productName(productById.get(productId), forecastRow?.productName),
      inventoryItemName: item?.name ?? null,
      currentAvailableQty,
      averageWeeklyUsageQty,
      forecastedMonthlyDemandQty,
      estimatedRunoutDate,
      recommendedReorderQty: recommendation.recommendedQty,
      warningLabel,
      unitLabel: item?.base_unit ?? 'each',
    };
  })
    .filter((row) => row.forecastedMonthlyDemandQty > 0 || row.currentAvailableQty !== null || row.averageWeeklyUsageQty > 0)
    .sort((a, b) => b.recommendedReorderQty - a.recommendedReorderQty || b.forecastedMonthlyDemandQty - a.forecastedMonthlyDemandQty || a.productName.localeCompare(b.productName));
}

function buildDailySnapshot({
  firstOrderDateByCenterId,
  lines,
  now,
  orders,
  reorderRiskRows,
  scope,
}: {
  firstOrderDateByCenterId: Map<string, Date>;
  lines: NormalizedLine[];
  now: Date;
  orders: NormalizedOrder[];
  reorderRiskRows: ReorderRiskRow[];
  scope: MetricScope;
}) {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const currentMonthStart = startOfMonth(now);
  const previousMonthStart = addMonths(currentMonthStart, -1);
  const previousSameDayEnd = addDays(previousMonthStart, Math.min(now.getDate(), daysInMonth(previousMonthStart)));
  const todayMetric = metricForPeriod({ end: tomorrow, firstOrderDateByCenterId, lines, orders, scope, start: today });
  const monthToDateMetric = metricForPeriod({ end: tomorrow, firstOrderDateByCenterId, lines, orders, scope, start: currentMonthStart });
  const previousSameDayMetric = metricForPeriod({ end: previousSameDayEnd, firstOrderDateByCenterId, lines, orders, scope, start: previousMonthStart });
  const elapsedDays = Math.max(1, now.getDate());
  const currentMonthDays = daysInMonth(currentMonthStart);
  const productTotals = new Map<string, { name: string; qty: number; revenueCents: number }>();
  for (const line of lines) {
    if (line.createdAt < currentMonthStart || line.createdAt >= tomorrow || !lineMatchesScope(line, scope)) continue;
    const key = line.productId ?? line.productName;
    const existing = productTotals.get(key) ?? { name: line.productName, qty: 0, revenueCents: 0 };
    existing.qty += line.qty;
    existing.revenueCents += line.revenueCents;
    productTotals.set(key, existing);
  }
  const topProduct = [...productTotals.values()].sort((a, b) => b.revenueCents - a.revenueCents || b.qty - a.qty)[0];

  return {
    revenueTodayCents: todayMetric.revenueCents,
    ordersToday: todayMetric.orderCount,
    revenueMonthToDateCents: monthToDateMetric.revenueCents,
    ordersMonthToDate: monthToDateMetric.orderCount,
    revenueComparedToSameDayLastMonthCents: monthToDateMetric.revenueCents - previousSameDayMetric.revenueCents,
    orderComparedToSameDayLastMonth: monthToDateMetric.orderCount - previousSameDayMetric.orderCount,
    projectedMonthEndRevenueCents: Math.round((monthToDateMetric.revenueCents / elapsedDays) * currentMonthDays),
    projectedMonthEndOrders: Math.round((monthToDateMetric.orderCount / elapsedDays) * currentMonthDays),
    topProductThisMonth: topProduct?.name ?? 'No product sales yet',
    customersDueOrOverdue: reorderRiskRows.filter((row) => (row.daysPastExpected ?? -1) >= 0).length,
  };
}

export function buildReportingDashboard({
  centers,
  filters,
  inventoryItems = [],
  inventoryLots = [],
  shortageMovements = [],
  now,
  orderItems,
  orders,
  products,
  reorderSettings = [],
}: {
  centers: ReportingCenterRow[];
  filters: ReportingFilters;
  inventoryItems?: ReportingInventoryItemRow[];
  inventoryLots?: ReportingInventoryLotRow[];
  shortageMovements?: ReportingInventoryMovementRow[];
  now: Date;
  orderItems: ReportingOrderItemRow[];
  orders: ReportingOrderRow[];
  products: ReportingProductRow[];
  reorderSettings?: ReportingReorderSettingRow[];
}): ReportingDashboard {
  const monthStart = startOfMonth(filters.selectedMonth);
  const previousMonthStart = addMonths(monthStart, -1);
  const monthEndExclusive = addMonths(monthStart, 1);
  const scope: MetricScope = {
    productId: filters.productId,
    centerId: filters.centerId,
  };
  const productById = new Map(products.map((product) => [product.id, product]));
  const normalizedOrders = orders
    .map((order): NormalizedOrder | null => {
      const createdAt = validDate(order.created_at);
      if (!createdAt) return null;
      return {
        id: order.id,
        centerId: order.center_id,
        status: order.status,
        subtotalCents: numericValue(order.subtotal_cents),
        shippingCostCents: numericValue(order.shipping_cost_cents),
        createdAt,
      };
    })
    .filter((order): order is NormalizedOrder => Boolean(order))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const orderById = new Map(normalizedOrders.map((order) => [order.id, order]));
  const normalizedLines = orderItems
    .map((item): NormalizedLine | null => {
      const order = orderById.get(item.order_id);
      if (!order) return null;
      const qty = numericValue(item.qty);
      const product = item.product_id ? productById.get(item.product_id) : undefined;
      return {
        orderId: item.order_id,
        productId: item.product_id,
        productName: productName(product, item.product_name_snapshot),
        centerId: order.centerId,
        createdAt: order.createdAt,
        qty,
        revenueCents: lineRevenue(item),
      };
    })
    .filter((line): line is NormalizedLine => Boolean(line));

  const firstOrderDateByCenterId = new Map<string, Date>();
  for (const order of normalizedOrders) {
    if (order.centerId && !firstOrderDateByCenterId.has(order.centerId)) {
      firstOrderDateByCenterId.set(order.centerId, order.createdAt);
    }
  }

  const selectedMonthMetrics = metricForPeriod({
    end: monthEndExclusive,
    firstOrderDateByCenterId,
    lines: normalizedLines,
    orders: normalizedOrders,
    scope,
    start: monthStart,
  });
  const previousMonthMetrics = metricForPeriod({
    end: monthStart,
    firstOrderDateByCenterId,
    lines: normalizedLines,
    orders: normalizedOrders,
    scope,
    start: previousMonthStart,
  });
  const mtdBounds = selectedMtdBounds(monthStart, now);
  const currentMtd = metricForPeriod({
    end: mtdBounds.selectedEndExclusive,
    firstOrderDateByCenterId,
    lines: normalizedLines,
    orders: normalizedOrders,
    scope,
    start: monthStart,
  });
  const previousMtd = metricForPeriod({
    end: mtdBounds.previousEndExclusive,
    firstOrderDateByCenterId,
    lines: normalizedLines,
    orders: normalizedOrders,
    scope,
    start: previousMonthStart,
  });
  const mtdComparison: MtdComparison = {
    current: currentMtd,
    previous: previousMtd,
    revenuePercentAhead: percentChange(currentMtd.revenueCents, previousMtd.revenueCents),
    orderPercentAhead: percentChange(currentMtd.orderCount, previousMtd.orderCount),
    projectedRevenueCents: Math.round((currentMtd.revenueCents / Math.max(1, mtdBounds.selectedPeriodEndDay)) * daysInMonth(monthStart)),
    projectedOrderCount: Math.round((currentMtd.orderCount / Math.max(1, mtdBounds.selectedPeriodEndDay)) * daysInMonth(monthStart)),
    elapsedDays: Math.max(1, mtdBounds.selectedPeriodEndDay),
    selectedPeriodEndDay: mtdBounds.selectedPeriodEndDay,
    previousPeriodEndDay: mtdBounds.previousPeriodEndDay,
  };
  const forecast = buildForecast({
    firstOrderDateByCenterId,
    lines: normalizedLines,
    monthStart,
    orders: normalizedOrders,
    products,
    scope,
    selectedMtdEndExclusive: mtdBounds.selectedEndExclusive,
    selectedPeriodEndDay: mtdBounds.selectedPeriodEndDay,
  });
  const productSalesRows = buildProductSalesRows({
    firstOrderDateByCenterId,
    lines: normalizedLines,
    monthStart,
    orders: normalizedOrders,
    products,
    rangeEndExclusive: filters.rangeEndExclusive,
    rangeStart: filters.rangeStart,
    scope,
  });
  const topSellingProducts = productSalesRows.filter((row) => row.revenueCents > 0 || row.quantitySold > 0).slice(0, 5);
  const slowMovingProducts = [...productSalesRows]
    .sort((a, b) => a.quantitySold - b.quantitySold || a.revenueCents - b.revenueCents || a.productName.localeCompare(b.productName))
    .slice(0, 5);
  const customerSalesRows = buildCustomerSalesRows({
    centers,
    firstOrderDateByCenterId,
    lines: normalizedLines,
    monthEndExclusive,
    monthStart,
    now: startOfDay(now),
    orders: normalizedOrders,
    previousMonthStart,
    scope,
  });
  const reorderRiskRows = buildReorderRiskRows({
    centers,
    now: startOfDay(now),
    orders: normalizedOrders,
    scope,
  });
  const inventoryPlanningRows = buildInventoryPlanningRows({
    forecast,
    inventoryItems,
    inventoryLots,
    shortageMovements,
    lines: normalizedLines,
    now,
    products,
    reorderSettings,
    scope,
  });
  const dailySnapshot = buildDailySnapshot({
    firstOrderDateByCenterId,
    lines: normalizedLines,
    now,
    orders: normalizedOrders,
    reorderRiskRows,
    scope,
  });

  return {
    monthStart,
    previousMonthStart,
    monthEndExclusive,
    rangeStart: filters.rangeStart,
    rangeEndExclusive: filters.rangeEndExclusive,
    monthComparisonRows: buildComparisonRows(selectedMonthMetrics, previousMonthMetrics),
    selectedMonthMetrics,
    previousMonthMetrics,
    mtdComparison,
    forecast,
    productSalesRows,
    topSellingProducts,
    slowMovingProducts,
    customerSalesRows,
    reorderRiskRows,
    inventoryPlanningRows,
    dailySnapshot,
    hasOrders: normalizedOrders.length > 0,
  };
}

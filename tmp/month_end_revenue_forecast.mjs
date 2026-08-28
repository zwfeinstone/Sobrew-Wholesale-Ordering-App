import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase environment variables.');

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PAGE = 1000;
const TZ = 'America/Chicago';
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

async function all(table, columns, orderColumn = 'id') {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).order(orderColumn, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

function c(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function dollars(value) {
  return Math.round(value) / 100;
}

function centralDate(iso) {
  if (!iso) return null;
  const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(later, earlier) {
  return Math.round((new Date(`${later}T12:00:00Z`) - new Date(`${earlier}T12:00:00Z`)) / 86400000);
}

function isBusinessDay(dateString) {
  const weekday = new Date(`${dateString}T12:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

function monthEndDate(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function lastBusinessDates(year, month, count) {
  const dates = [];
  for (let cursor = monthEndDate(year, month); dates.length < count; cursor = addDays(cursor, -1)) {
    if (isBusinessDay(cursor)) dates.unshift(cursor);
  }
  return dates;
}

const [rawOrders, items, centers, recurringOrders, recurringItems] = await Promise.all([
  all('orders', 'id,center_id,status,subtotal_cents,created_at,shipped_at,order_kind,recurring_order_id,recurring_scheduled_for', 'created_at'),
  all('order_items', 'id,order_id,product_id,qty,unit_price_cents,line_total_cents', 'id'),
  all('centers', 'id,name,is_active,created_at', 'created_at'),
  all('recurring_orders', 'id,center_id,source_order_id,frequency,amount_cents,status,active,created_at,last_generated_at,next_run_at', 'created_at'),
  all('recurring_order_items', 'id,recurring_order_id,product_id,qty,unit_price_cents,line_total_cents', 'id'),
]);

const centerName = new Map(centers.map((center) => [center.id, center.name?.trim() || 'Unnamed center']));
const itemsByOrder = new Map();
for (const item of items) {
  const list = itemsByOrder.get(item.order_id) ?? [];
  list.push(item);
  itemsByOrder.set(item.order_id, list);
}
const recurringItemsByOrder = new Map();
for (const item of recurringItems) {
  const list = recurringItemsByOrder.get(item.recurring_order_id) ?? [];
  list.push(item);
  recurringItemsByOrder.set(item.recurring_order_id, list);
}

const orders = rawOrders
  .filter((order) => order.order_kind !== 'prospecting_sample')
  .map((order) => ({
    ...order,
    revenue: c(order.subtotal_cents),
    createdDate: centralDate(order.created_at),
    shippedDate: order.status === 'Shipped' ? centralDate(order.shipped_at || order.created_at) : null,
  }));
const orderById = new Map(orders.map((order) => [order.id, order]));
const shipped = orders.filter((order) => order.shippedDate);

function inRange(date, start, endExclusive) {
  return Boolean(date && date >= start && date < endExclusive);
}

function selected(start, endExclusive, source = shipped, field = 'shippedDate') {
  return source.filter((order) => inRange(order[field], start, endExclusive));
}

function totalRevenue(source) {
  return source.reduce((sum, order) => sum + order.revenue, 0);
}

function recurringSubtotal(schedule) {
  const savedItems = recurringItemsByOrder.get(schedule.id) ?? [];
  const sourceItems = itemsByOrder.get(schedule.source_order_id) ?? [];
  const chosen = savedItems.length ? savedItems : sourceItems;
  const itemSubtotal = chosen.reduce((sum, item) => sum + (c(item.line_total_cents) || c(item.qty) * c(item.unit_price_cents)), 0);
  return itemSubtotal || c(schedule.amount_cents) || c(orderById.get(schedule.source_order_id)?.subtotal_cents);
}

const asOfDate = '2026-08-26';
const remainingStart = '2026-08-27';
const septemberStart = '2026-09-01';
const augustStart = '2026-08-01';
const currentAugust = selected(augustStart, remainingStart);
const currentRevenue = totalRevenue(currentAugust);
const upcomingRecurring = recurringOrders
  .filter((schedule) => schedule.status === 'active' && schedule.active !== false)
  .map((schedule) => ({
    ...schedule,
    nextRunDate: centralDate(schedule.next_run_at),
    expectedRevenue: recurringSubtotal(schedule),
  }))
  .filter((schedule) => inRange(schedule.nextRunDate, remainingStart, septemberStart))
  .sort((a, b) => a.nextRunDate.localeCompare(b.nextRunDate) || b.expectedRevenue - a.expectedRevenue);

const upcomingRecurringRows = upcomingRecurring.map((schedule) => ({
  date: schedule.nextRunDate,
  center: centerName.get(schedule.center_id) ?? 'Unnamed center',
  frequency: schedule.frequency,
  revenue: dollars(schedule.expectedRevenue),
  last_generated_date: centralDate(schedule.last_generated_at),
}));
const recurringRevenue = upcomingRecurring.reduce((sum, schedule) => sum + schedule.expectedRevenue, 0);
const upcomingRecurringCenterIds = new Set(upcomingRecurring.map((schedule) => schedule.center_id));

const createdButUnshipped = orders.filter((order) => inRange(order.createdDate, augustStart, septemberStart) && order.status !== 'Shipped');
const createdButUnshippedRows = createdButUnshipped.map((order) => ({
  center: centerName.get(order.center_id) ?? 'Unnamed center',
  created_date: order.createdDate,
  status: order.status,
  revenue: dollars(order.revenue),
  recurring: Boolean(order.recurring_order_id),
  recurring_scheduled_date: centralDate(order.recurring_scheduled_for),
}));
const pendingRevenue = totalRevenue(createdButUnshipped);
const historicalRecurringOrders = orders.filter((order) => order.recurring_order_id && order.createdDate < remainingStart);
const shippedHistoricalRecurring = historicalRecurringOrders.filter((order) => order.shippedDate);
const recurringShipLags = shippedHistoricalRecurring.map((order) => Math.max(0, (new Date(order.shipped_at || order.created_at) - new Date(order.created_at)) / 86400000));

// Compare revenue shipped on the final three business days of recent months.
const historicalFinalThree = [];
for (const month of [4, 5, 6, 7]) {
  const dates = lastBusinessDates(2026, month, 3);
  const dateSet = new Set(dates);
  const monthOrders = shipped.filter((order) => dateSet.has(order.shippedDate));
  const recurringPart = monthOrders.filter((order) => order.recurring_order_id);
  const manualPart = monthOrders.filter((order) => !order.recurring_order_id);
  historicalFinalThree.push({
    month: `2026-${String(month).padStart(2, '0')}`,
    dates,
    total_revenue: dollars(totalRevenue(monthOrders)),
    recurring_revenue: dollars(totalRevenue(recurringPart)),
    manual_revenue: dollars(totalRevenue(manualPart)),
    order_count: monthOrders.length,
  });
}

// Current manual run rate: last four completed business weeks through Aug 26.
const recentManual = selected('2026-07-30', remainingStart).filter((order) => !order.recurring_order_id && isBusinessDay(order.shippedDate));
const recentManualBusinessDays = [];
for (let cursor = '2026-07-30'; cursor < remainingStart; cursor = addDays(cursor, 1)) {
  if (isBusinessDay(cursor)) recentManualBusinessDays.push(cursor);
}
const recentManualPerBusinessDay = totalRevenue(recentManual) / recentManualBusinessDays.length;

// Center-level cadence check for non-recurring/manual orders.
const manualByCenter = new Map();
for (const order of shipped.filter((row) => !row.recurring_order_id && row.center_id)) {
  const list = manualByCenter.get(order.center_id) ?? [];
  list.push(order);
  manualByCenter.set(order.center_id, list);
}
const likelyManual = [];
for (const [centerId, centerOrders] of manualByCenter) {
  if (upcomingRecurringCenterIds.has(centerId) || centerOrders.length < 2) continue;
  const sorted = [...centerOrders].sort((a, b) => a.shippedDate.localeCompare(b.shippedDate));
  const uniqueDates = [...new Set(sorted.map((order) => order.shippedDate))];
  if (uniqueDates.length < 2) continue;
  const gaps = uniqueDates.slice(1).map((date, index) => daysBetween(date, uniqueDates[index])).filter((gap) => gap > 0 && gap <= 90);
  if (!gaps.length) continue;
  const typicalGap = median(gaps);
  const lastDate = uniqueDates.at(-1);
  const expectedDate = addDays(lastDate, Math.round(typicalGap));
  if (!inRange(expectedDate, remainingStart, septemberStart)) continue;
  const lastThreeAmounts = sorted.slice(-3).map((order) => order.revenue);
  const expectedRevenue = median(lastThreeAmounts);
  const gapSpread = median(gaps.map((gap) => Math.abs(gap - typicalGap)));
  likelyManual.push({
    center: centerName.get(centerId) ?? 'Unnamed center',
    expected_date: expectedDate,
    last_order_date: lastDate,
    typical_gap_days: round(typicalGap, 1),
    gap_spread_days: round(gapSpread, 1),
    historical_order_dates: uniqueDates.length,
    expected_revenue: dollars(expectedRevenue),
  });
}
likelyManual.sort((a, b) => a.expected_date.localeCompare(b.expected_date) || b.expected_revenue - a.expected_revenue);

const historicalManualValues = historicalFinalThree.map((row) => row.manual_revenue * 100);
const historicalManualMean = mean(historicalManualValues);
const historicalManualMedian = median(historicalManualValues);
const currentRunRateManual = recentManualPerBusinessDay * 3;
const cadenceManualTotal = likelyManual.reduce((sum, row) => sum + row.expected_revenue * 100, 0);

// Manual revenue estimate emphasizes actual recent run rate, then historical
// month-end behavior, with cadence candidates used as a smaller cross-check.
const manualForecast = 0.50 * currentRunRateManual + 0.35 * historicalManualMedian + 0.15 * cadenceManualTotal;
const pointForecast = currentRevenue + pendingRevenue + recurringRevenue + manualForecast;

const output = {
  as_of_date: asOfDate,
  current_shipped_revenue: dollars(currentRevenue),
  already_created_unshipped: {
    revenue: dollars(pendingRevenue),
    orders: createdButUnshipped.length,
    details: createdButUnshippedRows,
  },
  upcoming_recurring: {
    revenue: dollars(recurringRevenue),
    schedules: upcomingRecurringRows,
    historical_fulfillment: {
      generated_orders: historicalRecurringOrders.length,
      shipped_orders: shippedHistoricalRecurring.length,
      shipped_percent: historicalRecurringOrders.length ? round(shippedHistoricalRecurring.length / historicalRecurringOrders.length * 100, 1) : 0,
      median_created_to_shipped_days: round(median(recurringShipLags), 2),
    },
  },
  historical_final_three_business_days: historicalFinalThree,
  manual_forecast_inputs: {
    recent_manual_business_days: recentManualBusinessDays.length,
    recent_manual_revenue: dollars(totalRevenue(recentManual)),
    recent_manual_per_business_day: dollars(recentManualPerBusinessDay),
    current_run_rate_three_day_revenue: dollars(currentRunRateManual),
    historical_final_three_manual_mean: dollars(historicalManualMean),
    historical_final_three_manual_median: dollars(historicalManualMedian),
    cadence_candidate_total: dollars(cadenceManualTotal),
    likely_manual_orders: likelyManual,
    blended_manual_forecast: dollars(manualForecast),
  },
  forecast: {
    current_revenue: dollars(currentRevenue),
    already_created_pending_revenue: dollars(pendingRevenue),
    upcoming_recurring_revenue: dollars(recurringRevenue),
    manual_revenue_forecast: dollars(manualForecast),
    point_forecast: dollars(pointForecast),
    july_revenue: 15215.59,
    forecast_vs_july: round(dollars(pointForecast) - 15215.59, 2),
    forecast_vs_july_percent: round((dollars(pointForecast) / 15215.59 - 1) * 100, 1),
  },
};

console.log(JSON.stringify(output, null, 2));

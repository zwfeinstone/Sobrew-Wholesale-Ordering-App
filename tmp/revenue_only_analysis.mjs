import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing Supabase environment variables.');

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE_SIZE = 1000;
const TZ = 'America/Chicago';
const AS_OF_DATE = '2026-08-26';
const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

async function fetchAll(table, columns, orderColumn = 'created_at') {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function cents(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function money(c) {
  return Math.round(c) / 100;
}

function pct(current, prior) {
  if (!prior) return current ? 100 : 0;
  return ((current - prior) / prior) * 100;
}

function round(value, decimals = 1) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function centralDate(iso) {
  if (!iso) return null;
  const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function inDates(date, start, endExclusive) {
  return Boolean(date && date >= start && date < endExclusive);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function monthStart(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function nextMonth(year, month) {
  return month === 12 ? `${year + 1}-01-01` : monthStart(year, month + 1);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nthBusinessDate(year, month, n) {
  let seen = 0;
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) seen += 1;
    if (seen === n) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return nextMonth(year, month);
}

function addOneDay(dateString) {
  const d = new Date(`${dateString}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const [rawOrders, centers, items, products] = await Promise.all([
  fetchAll('orders', 'id,center_id,status,subtotal_cents,created_at,shipped_at,order_kind', 'created_at'),
  fetchAll('centers', 'id,name,is_active,created_at', 'created_at'),
  fetchAll('order_items', 'id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents', 'id'),
  fetchAll('products', 'id,name,sku,category,active', 'id'),
]);

const centerById = new Map(centers.map((c) => [c.id, c.name?.trim() || 'Unnamed center']));
const productById = new Map(products.map((p) => [p.id, p.name?.trim() || p.sku || 'Unknown product']));
const orders = rawOrders
  .filter((o) => o.order_kind !== 'prospecting_sample')
  .map((o) => ({
    ...o,
    revenueCents: cents(o.subtotal_cents),
    createdDate: centralDate(o.created_at),
    shippedDate: o.status === 'Shipped' ? centralDate(o.shipped_at || o.created_at) : null,
  }));
const orderById = new Map(orders.map((o) => [o.id, o]));
const shippedOrders = orders.filter((o) => o.status === 'Shipped' && o.shippedDate);
const firstShippedDateByCenter = new Map();
for (const o of shippedOrders) {
  if (!o.center_id) continue;
  const prior = firstShippedDateByCenter.get(o.center_id);
  if (!prior || o.shippedDate < prior) firstShippedDateByCenter.set(o.center_id, o.shippedDate);
}

function periodOrders(start, endExclusive, dateField = 'shippedDate', source = shippedOrders) {
  return source.filter((o) => inDates(o[dateField], start, endExclusive));
}

function mapByCenter(selectedOrders) {
  const map = new Map();
  for (const o of selectedOrders) {
    if (!o.center_id) continue;
    const row = map.get(o.center_id) ?? { revenueCents: 0, orderCount: 0 };
    row.revenueCents += o.revenueCents;
    row.orderCount += 1;
    map.set(o.center_id, row);
  }
  return map;
}

function summarize(selectedOrders, start) {
  const revenueCents = selectedOrders.reduce((sum, o) => sum + o.revenueCents, 0);
  const byCenter = mapByCenter(selectedOrders);
  const centerRevenue = [...byCenter.values()].map((v) => v.revenueCents);
  const sortedCenterRevenue = [...centerRevenue].sort((a, b) => b - a);
  const newCenters = [...byCenter.keys()].filter((id) => firstShippedDateByCenter.get(id) >= start).length;
  return {
    revenue: money(revenueCents),
    order_count: selectedOrders.length,
    ordering_centers: byCenter.size,
    new_centers: newCenters,
    returning_centers: Math.max(0, byCenter.size - newCenters),
    average_order_value: selectedOrders.length ? money(revenueCents / selectedOrders.length) : 0,
    revenue_per_center: byCenter.size ? money(revenueCents / byCenter.size) : 0,
    median_center_revenue: money(median(centerRevenue)),
    top_center_share_percent: revenueCents ? round((sortedCenterRevenue[0] ?? 0) / revenueCents * 100) : 0,
    top_five_share_percent: revenueCents ? round(sortedCenterRevenue.slice(0, 5).reduce((a, b) => a + b, 0) / revenueCents * 100) : 0,
  };
}

function centerBridge(currentOrders, priorOrders) {
  const current = mapByCenter(currentOrders);
  const prior = mapByCenter(priorOrders);
  const ids = new Set([...current.keys(), ...prior.keys()]);
  const rows = [...ids].map((id) => {
    const cur = current.get(id) ?? { revenueCents: 0, orderCount: 0 };
    const pre = prior.get(id) ?? { revenueCents: 0, orderCount: 0 };
    return {
      center: centerById.get(id) ?? 'Unnamed center',
      current_revenue: money(cur.revenueCents),
      prior_revenue: money(pre.revenueCents),
      change: money(cur.revenueCents - pre.revenueCents),
      current_orders: cur.orderCount,
      prior_orders: pre.orderCount,
      cohort: pre.revenueCents === 0 ? 'Added' : cur.revenueCents === 0 ? 'Missing' : 'Shared',
    };
  });
  const added = rows.filter((r) => r.cohort === 'Added');
  const missing = rows.filter((r) => r.cohort === 'Missing');
  const shared = rows.filter((r) => r.cohort === 'Shared');
  return {
    bridge: {
      added_center_revenue: round(added.reduce((s, r) => s + r.current_revenue, 0), 2),
      missing_center_revenue: round(-missing.reduce((s, r) => s + r.prior_revenue, 0), 2),
      shared_center_change: round(shared.reduce((s, r) => s + r.change, 0), 2),
      total_change: round(rows.reduce((s, r) => s + r.change, 0), 2),
      added_center_count: added.length,
      missing_center_count: missing.length,
      shared_center_count: shared.length,
    },
    largest_positive_drivers: [...rows].sort((a, b) => b.change - a.change).slice(0, 12),
    largest_negative_drivers: [...rows].sort((a, b) => a.change - b.change).slice(0, 12),
    added_centers: [...added].sort((a, b) => b.current_revenue - a.current_revenue),
    missing_centers: [...missing].sort((a, b) => b.prior_revenue - a.prior_revenue),
    shared_centers: [...shared].sort((a, b) => a.change - b.change),
  };
}

function productMap(selectedOrders) {
  const ids = new Set(selectedOrders.map((o) => o.id));
  const map = new Map();
  for (const item of items) {
    if (!ids.has(item.order_id)) continue;
    const productId = item.product_id || item.product_name_snapshot || 'unknown';
    const lineRevenue = cents(item.line_total_cents) || cents(item.qty) * cents(item.unit_price_cents);
    const row = map.get(productId) ?? { revenueCents: 0, quantity: 0, name: productById.get(item.product_id) || item.product_name_snapshot || 'Unknown product' };
    row.revenueCents += lineRevenue;
    row.quantity += Number(item.qty ?? 0);
    map.set(productId, row);
  }
  return map;
}

function productBridge(currentOrders, priorOrders) {
  const current = productMap(currentOrders);
  const prior = productMap(priorOrders);
  const keys = new Set([...current.keys(), ...prior.keys()]);
  return [...keys].map((id) => {
    const cur = current.get(id) ?? { revenueCents: 0, quantity: 0, name: prior.get(id)?.name || 'Unknown product' };
    const pre = prior.get(id) ?? { revenueCents: 0, quantity: 0, name: cur.name };
    return {
      product: cur.name,
      current_revenue: money(cur.revenueCents),
      prior_revenue: money(pre.revenueCents),
      change: money(cur.revenueCents - pre.revenueCents),
      current_quantity: cur.quantity,
      prior_quantity: pre.quantity,
    };
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

const augStart = '2026-08-01';
const augMtdEnd = addOneDay(AS_OF_DATE);
const sepStart = '2026-09-01';
const julStart = '2026-07-01';
const julMtdEnd = '2026-07-27';
const augMtdOrders = periodOrders(augStart, augMtdEnd);
const julMtdOrders = periodOrders(julStart, julMtdEnd);
const julFullOrders = periodOrders(julStart, augStart);

const monthly = [];
for (let month = 1; month <= 8; month += 1) {
  const start = monthStart(2026, month);
  const end = month === 8 ? augMtdEnd : nextMonth(2026, month);
  monthly.push({ month: start.slice(0, 7), ...summarize(periodOrders(start, end), start) });
}

const augSummary = summarize(augMtdOrders, augStart);
const julMtdSummary = summarize(julMtdOrders, julStart);
const julySummary = summarize(julFullOrders, julStart);
const calendarPace = augSummary.revenue / 26 * 31;
const businessPace = augSummary.revenue / 18 * 21;
const historyAverage = monthly.filter((m) => ['2026-05', '2026-06', '2026-07'].includes(m.month)).reduce((s, m) => s + m.revenue, 0) / 3;
const appForecast = calendarPace * 0.6 + historyAverage * 0.4;
const appHistoryAverageCreated = [5, 6, 7]
  .map((month) => summarize(periodOrders(monthStart(2026, month), nextMonth(2026, month), 'createdDate', orders), monthStart(2026, month)).revenue)
  .reduce((sum, revenue) => sum + revenue, 0) / 3;
const exactAppForecastCreated = calendarPace * 0.6 + appHistoryAverageCreated * 0.4;

const completionHistory = [];
for (const month of [4, 5, 6, 7]) {
  const start = monthStart(2026, month);
  const end = nextMonth(2026, month);
  const cutoffEnd = addOneDay(nthBusinessDate(2026, month, 18));
  const full = summarize(periodOrders(start, end), start).revenue;
  const partial = summarize(periodOrders(start, cutoffEnd), start).revenue;
  completionHistory.push({ month: start.slice(0, 7), partial_revenue: partial, full_revenue: full, completion_percent: full ? round(partial / full * 100, 1) : 0 });
}
const medianCompletion = median(completionHistory.map((m) => m.completion_percent)) / 100;
const historyShapeForecast = medianCompletion ? augSummary.revenue / medianCompletion : 0;

const placedAugMtd = periodOrders(augStart, augMtdEnd, 'createdDate', orders);
const placedJulMtd = periodOrders(julStart, julMtdEnd, 'createdDate', orders);
const placedAugSummary = summarize(placedAugMtd, augStart);
const placedJulSummary = summarize(placedJulMtd, julStart);
const unshippedAug = placedAugMtd.filter((o) => o.status !== 'Shipped');
const unshippedByStatus = Object.entries(unshippedAug.reduce((acc, o) => {
  const status = o.status || 'Unknown';
  acc[status] = acc[status] ?? { revenue: 0, orders: 0, centers: new Set() };
  acc[status].revenue += o.revenueCents;
  acc[status].orders += 1;
  if (o.center_id) acc[status].centers.add(o.center_id);
  return acc;
}, {})).map(([status, row]) => ({ status, revenue: money(row.revenue), orders: row.orders, centers: row.centers.size }));

function shipLagDays(selectedOrders) {
  const lags = selectedOrders
    .filter((o) => o.shipped_at && o.created_at)
    .map((o) => Math.max(0, (new Date(o.shipped_at) - new Date(o.created_at)) / 86400000));
  return {
    mean_days: lags.length ? round(lags.reduce((a, b) => a + b, 0) / lags.length, 1) : 0,
    median_days: round(median(lags), 1),
  };
}

const currentProductMap = productMap(augMtdOrders);
const currentLineRevenue = [...currentProductMap.values()].reduce((s, r) => s + r.revenueCents, 0);
const priorProductMap = productMap(julMtdOrders);
const priorLineRevenue = [...priorProductMap.values()].reduce((s, r) => s + r.revenueCents, 0);

const currentCenters = mapByCenter(augMtdOrders);
const sizeBands = { under_100: 0, from_100_to_249: 0, from_250_to_499: 0, from_500_to_999: 0, at_least_1000: 0 };
for (const row of currentCenters.values()) {
  const value = money(row.revenueCents);
  if (value < 100) sizeBands.under_100 += 1;
  else if (value < 250) sizeBands.from_100_to_249 += 1;
  else if (value < 500) sizeBands.from_250_to_499 += 1;
  else if (value < 1000) sizeBands.from_500_to_999 += 1;
  else sizeBands.at_least_1000 += 1;
}

const sameDayBridge = centerBridge(augMtdOrders, julMtdOrders);
const fullJulyBridge = centerBridge(augMtdOrders, julFullOrders);
const sameDaySharedPriorRevenue = julMtdSummary.revenue + sameDayBridge.bridge.missing_center_revenue;
const sameDaySharedCurrentRevenue = augSummary.revenue - sameDayBridge.bridge.added_center_revenue;
const augustNewCenterIds = new Set([...firstShippedDateByCenter.entries()].filter(([, date]) => date >= augStart && date < augMtdEnd).map(([id]) => id));
const augustNewCenterRevenue = augMtdOrders.filter((o) => augustNewCenterIds.has(o.center_id)).reduce((sum, o) => sum + o.revenueCents, 0);
const exactPriorAov = julMtdOrders.length ? julMtdOrders.reduce((sum, o) => sum + o.revenueCents, 0) / julMtdOrders.length : 0;
const exactCurrentAov = augMtdOrders.length ? augMtdOrders.reduce((sum, o) => sum + o.revenueCents, 0) / augMtdOrders.length : 0;
const orderVolumeEffect = (augMtdOrders.length - julMtdOrders.length) * exactPriorAov;
const averageOrderValueEffect = augMtdOrders.length * (exactCurrentAov - exactPriorAov);
const revenueNeededToMatchJuly = Math.max(0, julySummary.revenue - augSummary.revenue);
const output = {
  as_of_date: AS_OF_DATE,
  revenue_definition: 'Standard wholesale orders only; order subtotal recognized when status is Shipped, using shipped_at with created_at fallback.',
  current_mtd: augSummary,
  prior_month_same_day: julMtdSummary,
  prior_month_full: julySummary,
  same_day_changes_percent: {
    revenue: round(pct(augSummary.revenue, julMtdSummary.revenue), 1),
    ordering_centers: round(pct(augSummary.ordering_centers, julMtdSummary.ordering_centers), 1),
    orders: round(pct(augSummary.order_count, julMtdSummary.order_count), 1),
    average_order_value: round(pct(augSummary.average_order_value, julMtdSummary.average_order_value), 1),
    revenue_per_center: round(pct(augSummary.revenue_per_center, julMtdSummary.revenue_per_center), 1),
  },
  projection: {
    calendar_day_pace: round(calendarPace, 2),
    business_day_pace: round(businessPace, 2),
    app_forecast_60pct_pace_40pct_three_month_average: round(appForecast, 2),
    exact_app_created_date_forecast: round(exactAppForecastCreated, 2),
    exact_app_created_date_three_month_average: round(appHistoryAverageCreated, 2),
    three_month_average: round(historyAverage, 2),
    historical_month_shape_forecast: round(historyShapeForecast, 2),
    median_completion_percent_after_18_business_days: round(medianCompletion * 100, 1),
    july_full_revenue: julySummary.revenue,
    projection_vs_july_percent: {
      calendar_day_pace: round(pct(calendarPace, julySummary.revenue), 1),
      business_day_pace: round(pct(businessPace, julySummary.revenue), 1),
      app_forecast: round(pct(appForecast, julySummary.revenue), 1),
      historical_month_shape: round(pct(historyShapeForecast, julySummary.revenue), 1),
    },
  },
  monthly_history: monthly,
  completion_history: completionHistory,
  center_bridge_same_day: sameDayBridge,
  center_bridge_vs_full_july: fullJulyBridge,
  august_center_revenue_bands: sizeBands,
  product_bridge_same_day: productBridge(augMtdOrders, julMtdOrders).slice(0, 20),
  product_reconciliation: {
    august_order_subtotals: augSummary.revenue,
    august_line_revenue: money(currentLineRevenue),
    august_difference: money(Math.round(augSummary.revenue * 100) - currentLineRevenue),
    july_mtd_order_subtotals: julMtdSummary.revenue,
    july_mtd_line_revenue: money(priorLineRevenue),
    july_mtd_difference: money(Math.round(julMtdSummary.revenue * 100) - priorLineRevenue),
  },
  placed_order_timing_lens: {
    august_mtd: placedAugSummary,
    july_same_day: placedJulSummary,
    change_percent: {
      revenue_booked: round(pct(placedAugSummary.revenue, placedJulSummary.revenue), 1),
      centers_placing_orders: round(pct(placedAugSummary.ordering_centers, placedJulSummary.ordering_centers), 1),
    },
    august_created_but_unshipped: {
      revenue: money(unshippedAug.reduce((s, o) => s + o.revenueCents, 0)),
      orders: unshippedAug.length,
      centers: new Set(unshippedAug.map((o) => o.center_id).filter(Boolean)).size,
      by_status: unshippedByStatus,
    },
    ship_lag: {
      august_shipped: shipLagDays(augMtdOrders),
      july_shipped: shipLagDays(julFullOrders),
    },
  },
  decision_summary: {
    same_day_revenue_change: round(augSummary.revenue - julMtdSummary.revenue, 2),
    order_volume_effect_at_prior_aov: money(orderVolumeEffect),
    average_order_value_effect: money(averageOrderValueEffect),
    shared_center_current_revenue: round(sameDaySharedCurrentRevenue, 2),
    shared_center_prior_revenue: round(sameDaySharedPriorRevenue, 2),
    shared_center_change_percent: round(pct(sameDaySharedCurrentRevenue, sameDaySharedPriorRevenue), 1),
    august_new_center_revenue: money(augustNewCenterRevenue),
    august_new_center_revenue_share_percent: augSummary.revenue ? round(money(augustNewCenterRevenue) / augSummary.revenue * 100, 1) : 0,
    revenue_needed_to_match_july: round(revenueNeededToMatchJuly, 2),
    remaining_business_days_after_as_of: 3,
    revenue_per_remaining_business_day_to_match_july: round(revenueNeededToMatchJuly / 3, 2),
    august_revenue_per_completed_business_day: round(augSummary.revenue / 18, 2),
    revenue_needed_to_hit_app_forecast: round(Math.max(0, appForecast - augSummary.revenue), 2),
    revenue_per_remaining_business_day_to_hit_app_forecast: round(Math.max(0, appForecast - augSummary.revenue) / 3, 2),
  },
  row_counts: { orders: orders.length, shipped_orders: shippedOrders.length, centers: centers.length, items: items.length },
};

if (process.env.FORECAST_ONLY === '1') {
  console.log(JSON.stringify({ projection: output.projection, decision_summary: output.decision_summary }, null, 2));
} else if (process.env.SUMMARY_ONLY === '1') {
  console.log(JSON.stringify({
    as_of_date: output.as_of_date,
    current_mtd: output.current_mtd,
    prior_month_same_day: output.prior_month_same_day,
    prior_month_full: output.prior_month_full,
    same_day_changes_percent: output.same_day_changes_percent,
    projection: output.projection,
    decision_summary: output.decision_summary,
    same_day_center_bridge: output.center_bridge_same_day.bridge,
    full_july_center_bridge: output.center_bridge_vs_full_july.bridge,
    top_positive_same_day: output.center_bridge_same_day.largest_positive_drivers.slice(0, 10),
    top_negative_same_day: output.center_bridge_same_day.largest_negative_drivers.slice(0, 10),
    top_products_same_day: output.product_bridge_same_day.slice(0, 15),
    center_revenue_bands: output.august_center_revenue_bands,
    placed_order_timing_lens: output.placed_order_timing_lens,
    reconciliation: output.product_reconciliation,
  }, null, 2));
} else {
  console.log(JSON.stringify(output, null, 2));
}

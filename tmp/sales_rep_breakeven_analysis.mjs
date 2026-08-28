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

function n(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function centralDate(iso) {
  if (!iso) return null;
  const parts = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function dollars(cents) {
  return Math.round(cents) / 100;
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const [ordersRaw, items, centers] = await Promise.all([
  all('orders', 'id,center_id,status,subtotal_cents,created_at,shipped_at,order_kind', 'created_at'),
  all('order_items', 'id,order_id,line_total_cents,qty,unit_price_cents,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_snapshot_at,cogs_estimated', 'id'),
  all('centers', 'id,name,is_active,created_at', 'created_at'),
]);

const centerName = new Map(centers.map((center) => [center.id, center.name?.trim() || 'Unnamed center']));
const orders = ordersRaw
  .filter((order) => order.order_kind !== 'prospecting_sample' && order.status === 'Shipped')
  .map((order) => ({ ...order, date: centralDate(order.shipped_at || order.created_at) }));
const orderById = new Map(orders.map((order) => [order.id, order]));

const lines = items.flatMap((item) => {
  const order = orderById.get(item.order_id);
  if (!order?.date || !order.center_id) return [];
  const revenue = n(item.line_total_cents) || n(item.qty) * n(item.unit_price_cents);
  const componentCogs = n(item.cogs_product_cents) + n(item.cogs_shipping_cents) + n(item.cogs_processing_fee_cents) + n(item.cogs_donation_cents);
  const totalCogs = n(item.cogs_total_cents) || componentCogs;
  return [{
    centerId: order.center_id,
    center: centerName.get(order.center_id) ?? 'Unnamed center',
    orderId: order.id,
    date: order.date,
    revenue,
    cogs: totalCogs,
    grossProfit: revenue - totalCogs,
    snapshotted: Boolean(item.cogs_snapshot_at),
    estimated: Boolean(item.cogs_estimated),
  }];
});

const firstOrderDate = new Map();
for (const order of orders) {
  if (!order.center_id || !order.date) continue;
  const current = firstOrderDate.get(order.center_id);
  if (!current || order.date < current) firstOrderDate.set(order.center_id, order.date);
}

function aggregate(selectedLines) {
  const revenue = selectedLines.reduce((sum, line) => sum + line.revenue, 0);
  const grossProfit = selectedLines.reduce((sum, line) => sum + line.grossProfit, 0);
  const orderIds = new Set(selectedLines.map((line) => line.orderId));
  const centerIds = new Set(selectedLines.map((line) => line.centerId));
  return {
    revenue,
    grossProfit,
    margin: revenue ? grossProfit / revenue : 0,
    orders: orderIds.size,
    centers: centerIds.size,
  };
}

function period(start, endExclusive) {
  return lines.filter((line) => line.date >= start && line.date < endExclusive);
}

const asOfExclusive = '2026-08-28';
const trailing90Start = addDays(asOfExclusive, -90);
const trailing90Lines = period(trailing90Start, asOfExclusive);
const trailing90 = aggregate(trailing90Lines);
const trailingByCenter = new Map();
for (const line of trailing90Lines) {
  const list = trailingByCenter.get(line.centerId) ?? [];
  list.push(line);
  trailingByCenter.set(line.centerId, list);
}
const center90 = [...trailingByCenter.entries()].map(([centerId, centerLines]) => {
  const summary = aggregate(centerLines);
  return {
    center: centerName.get(centerId) ?? 'Unnamed center',
    revenue: summary.revenue,
    grossProfit: summary.grossProfit,
    orders: summary.orders,
  };
});

// New-account cohorts with a full 60-day observation window.
const cohortCenterIds = [...firstOrderDate.entries()]
  .filter(([, first]) => first >= '2026-04-01' && first < addDays(asOfExclusive, -60))
  .map(([centerId]) => centerId);
const first60ByCenter = cohortCenterIds.map((centerId) => {
  const start = firstOrderDate.get(centerId);
  const end = addDays(start, 60);
  const selectedLines = lines.filter((line) => line.centerId === centerId && line.date >= start && line.date < end);
  const summary = aggregate(selectedLines);
  return {
    center: centerName.get(centerId) ?? 'Unnamed center',
    firstOrder: start,
    revenue: summary.revenue,
    grossProfit: summary.grossProfit,
    margin: summary.margin,
    orders: summary.orders,
    reordered: summary.orders >= 2,
  };
});

const first60AverageGp = mean(first60ByCenter.map((row) => row.grossProfit));
const first60MedianGp = median(first60ByCenter.map((row) => row.grossProfit));
const observedMargin = trailing90.margin;
const average90GpPerCenter = trailing90.centers ? trailing90.grossProfit / trailing90.centers : 0;
const median90GpPerCenter = median(center90.map((row) => row.grossProfit));
const annualizedAverageCenterGp = average90GpPerCenter * (365 / 90);
const annualizedMedianCenterGp = median90GpPerCenter * (365 / 90);
const annualizedFirst60AverageGp = first60AverageGp * (365 / 60);
const annualizedFirst60MedianGp = first60MedianGp * (365 / 60);

// Blend portfolio economics with observed new-account economics; the mean is
// weighted more because break-even is a total-dollar question, while the
// median tempers sensitivity to a few large centers.
const expectedAnnualGpPerDeal =
  0.45 * annualizedAverageCenterGp +
  0.20 * annualizedMedianCenterGp +
  0.25 * annualizedFirst60AverageGp +
  0.10 * annualizedFirst60MedianGp;
const baseSalary = 50000;
const fullyLoadedCost = 60000;
const steadyStateDealsSalaryOnly = baseSalary / expectedAnnualGpPerDeal;
const steadyStateDealsFullyLoaded = fullyLoadedCost / expectedAnnualGpPerDeal;
// If wins are spread evenly through the year, the average deal contributes
// for roughly half a year in year one.
const firstYearDealsSalaryOnly = steadyStateDealsSalaryOnly * 2;
const firstYearDealsFullyLoaded = steadyStateDealsFullyLoaded * 2;

const output = {
  as_of_date: '2026-08-27',
  profitability_coverage: {
    total_lines: lines.length,
    snapshotted_lines: lines.filter((line) => line.snapshotted).length,
    estimated_lines: lines.filter((line) => line.estimated).length,
  },
  trailing_90_days: {
    start: trailing90Start,
    revenue: dollars(trailing90.revenue),
    gross_profit: dollars(trailing90.grossProfit),
    gross_margin_percent: round(trailing90.margin * 100, 1),
    ordering_centers: trailing90.centers,
    orders: trailing90.orders,
    average_90_day_revenue_per_center: dollars(trailing90.revenue / trailing90.centers),
    average_90_day_gross_profit_per_center: dollars(average90GpPerCenter),
    median_90_day_gross_profit_per_center: dollars(median90GpPerCenter),
    annualized_average_gross_profit_per_center: dollars(annualizedAverageCenterGp),
    annualized_median_gross_profit_per_center: dollars(annualizedMedianCenterGp),
  },
  new_center_first_60_days: {
    cohort_size: first60ByCenter.length,
    reorder_rate_percent: round(first60ByCenter.filter((row) => row.reordered).length / first60ByCenter.length * 100, 1),
    average_revenue: dollars(mean(first60ByCenter.map((row) => row.revenue))),
    median_revenue: dollars(median(first60ByCenter.map((row) => row.revenue))),
    average_gross_profit: dollars(first60AverageGp),
    median_gross_profit: dollars(first60MedianGp),
    average_margin_percent: round(mean(first60ByCenter.map((row) => row.margin)) * 100, 1),
    annualized_average_gross_profit: dollars(annualizedFirst60AverageGp),
    annualized_median_gross_profit: dollars(annualizedFirst60MedianGp),
  },
  unit_economics: {
    expected_annual_gross_profit_per_closed_center: dollars(expectedAnnualGpPerDeal),
    implied_annual_revenue_per_closed_center_at_observed_margin: dollars(expectedAnnualGpPerDeal / observedMargin),
  },
  break_even: {
    salary_only_steady_state_deals: round(steadyStateDealsSalaryOnly, 1),
    salary_only_first_year_deals_if_evenly_closed: round(firstYearDealsSalaryOnly, 1),
    fully_loaded_cost_assumption: fullyLoadedCost,
    fully_loaded_steady_state_deals: round(steadyStateDealsFullyLoaded, 1),
    fully_loaded_first_year_deals_if_evenly_closed: round(firstYearDealsFullyLoaded, 1),
  },
};

console.log(JSON.stringify(output, null, 2));

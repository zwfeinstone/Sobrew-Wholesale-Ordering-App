import Link from 'next/link';
import { getSalesScopedCenterIdsForAdmin, scopeCenterRelatedQueryForAdmin, scopeCentersForAdmin } from '@/lib/admin-center-scope';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MONTHS = 6;
const LOOKBACK_OPTIONS = [3, 6, 12] as const;
const SALES_TABS = [
  { id: 'overview', label: 'Overview', description: 'Weekly volume and revenue' },
  { id: 'followup', label: 'Follow-up', description: 'Centers off cadence' },
  { id: 'accounts', label: 'Accounts', description: 'Best monthly accounts' },
  { id: 'report', label: 'Report', description: 'Full center revenue table' },
] as const;
const DAILY_METRIC_OPTIONS = [
  { id: 'orders', label: 'Orders' },
  { id: 'revenue', label: 'Revenue' },
] as const;

type SalesTab = (typeof SALES_TABS)[number]['id'];
type DailyMetric = (typeof DAILY_METRIC_OPTIONS)[number]['id'];

type CenterRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
  created_at: string | null;
};

type AdminRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

type SalesOrderRow = {
  id: string;
  center_id: string | null;
  status: string | null;
  subtotal_cents: number | null;
  created_at: string | null;
};

type CenterSalesReport = {
  id: string;
  name: string;
  isActive: boolean;
  lastOrderAt: Date | null;
  daysSinceLastOrder: number | null;
  averageDaysBetweenOrders: number | null;
  daysPastAverageOrderGap: number | null;
  ordersThisWeek: number;
  ordersInRange: number;
  revenueCents: number;
  averageMonthlyRevenueCents: number;
  revenueLast30DaysCents: number;
};

type QuietCenterGroup = {
  id: string;
  label: string;
  description: string;
  centers: CenterSalesReport[];
};

function isSalesTab(value: string | string[] | undefined): value is SalesTab {
  return typeof value === 'string' && SALES_TABS.some((tab) => tab.id === value);
}

function normalizeLookback(value: string | string[] | undefined) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : DEFAULT_LOOKBACK_MONTHS;
  return LOOKBACK_OPTIONS.includes(parsed as (typeof LOOKBACK_OPTIONS)[number]) ? parsed : DEFAULT_LOOKBACK_MONTHS;
}

function normalizeDailyMetric(value: string | string[] | undefined): DailyMetric {
  return typeof value === 'string' && DAILY_METRIC_OPTIONS.some((option) => option.id === value) ? value as DailyMetric : 'orders';
}

function formatDateInput(value: Date) {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function parseDateInput(value: string | string[] | undefined) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return date;
}

function normalizeWeekStart(value: string | string[] | undefined, fallback: Date) {
  const parsed = parseDateInput(value);
  return parsed ? startOfWeek(parsed) : fallback;
}

function salesTabHref(tab: SalesTab, months: number, weekStart?: Date, dailyMetric: DailyMetric = 'orders', salesRepId = '') {
  const query = new URLSearchParams();
  query.set('tab', tab);
  query.set('months', String(months));
  if (weekStart) query.set('week', formatDateInput(weekStart));
  query.set('daily_metric', dailyMetric);
  if (salesRepId) query.set('sales_rep', salesRepId);
  return `/admin/sales?${query.toString()}`;
}

function salesWeekHref(tab: SalesTab, months: number, weekStart: Date, dailyMetric: DailyMetric, salesRepId = '') {
  return salesTabHref(tab, months, weekStart, dailyMetric, salesRepId);
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfWeek(date: Date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function formatDate(value: Date | null) {
  if (!value) return 'Never ordered';
  return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDayValue(value: number | null) {
  if (value === null) return 'Not enough history';
  if (value < 1) return 'Less than 1 day';

  const rounded = Math.round(value * 10) / 10;
  const display = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return `${display} day${rounded === 1 ? '' : 's'}`;
}

function formatDaysSinceLastOrder(value: number | null) {
  if (value === null) return 'Never ordered';
  return `${value} day${value === 1 ? '' : 's'}`;
}

function formatShortDate(value: Date) {
  return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDayLabel(value: Date) {
  return value.toLocaleDateString('en-US', { weekday: 'short' });
}

function getOrderDate(order: SalesOrderRow) {
  if (!order.created_at) return null;
  const date = new Date(order.created_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getOrderDatesDescending(orders: SalesOrderRow[]) {
  return orders
    .map(getOrderDate)
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime());
}

function getAverageDaysBetweenOrders(orderDatesDescending: Date[]) {
  if (orderDatesDescending.length < 2) return null;

  let totalGapDays = 0;
  let gapCount = 0;

  for (let index = 0; index < orderDatesDescending.length - 1; index += 1) {
    const newerOrderDate = startOfDay(orderDatesDescending[index]);
    const olderOrderDate = startOfDay(orderDatesDescending[index + 1]);
    const gapDays = (newerOrderDate.getTime() - olderOrderDate.getTime()) / DAY_IN_MS;
    if (gapDays >= 0) {
      totalGapDays += gapDays;
      gapCount += 1;
    }
  }

  return gapCount ? totalGapDays / gapCount : null;
}

function getCenterName(center: CenterRow) {
  return center.name?.trim() || 'Unnamed center';
}

function getAdminLabel(admin: AdminRow | undefined) {
  return admin?.full_name || admin?.email || 'Unknown admin';
}

function getStatusTone(daysSinceLastOrder: number | null) {
  if (daysSinceLastOrder === null || daysSinceLastOrder >= 45) return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (daysSinceLastOrder >= 30) return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
}

function getStatusLabel(daysSinceLastOrder: number | null) {
  if (daysSinceLastOrder === null) return 'No orders yet';
  if (daysSinceLastOrder >= 45) return `${daysSinceLastOrder} days quiet`;
  if (daysSinceLastOrder >= 30) return `${daysSinceLastOrder} days`;
  return 'Active';
}

function moneyCompact(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

function metricChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? '+100%' : '0%';
  const change = ((current - previous) / previous) * 100;
  return `${change >= 0 ? '+' : ''}${change.toFixed(0)}%`;
}

function MiniBarList({ rows }: { rows: { label: string; value: number; display: string }[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[3.25rem_minmax(0,1fr)_6rem] items-center gap-3 text-sm">
          <span className="font-semibold text-slate-700">{row.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-teal-700" style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 8 : 0)}%` }} />
          </div>
          <span className="text-right font-semibold text-slate-950">{row.display}</span>
        </div>
      ))}
    </div>
  );
}

function ReportStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const currentAccess = await requireAdminSectionView('sales');
  const supabase = await createClient();
  const salesRepSettingsResult = currentAccess.isOwner
    ? await supabase.from('admin_commission_settings').select('profile_id').eq('is_sales_rep', true)
    : { data: [], error: null };
  const salesRepProfileIds = [...new Set((salesRepSettingsResult.data ?? []).map((row: { profile_id: string | null }) => row.profile_id).filter(Boolean))] as string[];
  const salesRepsResult = currentAccess.isOwner && salesRepProfileIds.length
    ? await supabase
      .from('profiles')
      .select('id,email,full_name,is_active')
      .in('id', salesRepProfileIds)
      .eq('is_admin', true)
      .order('full_name', { ascending: true })
    : { data: [], error: null };
  const salesReps = ((salesRepsResult.data ?? []) as AdminRow[]).sort((a, b) => getAdminLabel(a).localeCompare(getAdminLabel(b)));
  const requestedSalesRepId = typeof searchParams?.sales_rep === 'string' ? searchParams.sales_rep : '';
  const selectedSalesRepId = currentAccess.isOwner && salesReps.some((admin) => admin.id === requestedSalesRepId) ? requestedSalesRepId : '';
  const centerScope = await getSalesScopedCenterIdsForAdmin({ current: currentAccess, selectedSalesProfileId: selectedSalesRepId, supabase });
  const now = new Date();
  const today = startOfDay(now);
  const currentWeekStart = startOfWeek(now);
  const selectedWeekStart = normalizeWeekStart(searchParams?.week, currentWeekStart);
  const selectedWeekEnd = addDays(selectedWeekStart, 7);
  const previousCurrentWeekStart = addDays(currentWeekStart, -7);
  const monthStart = startOfMonth(now);
  const previousMonthStart = addMonths(monthStart, -1);
  const quietCutoff = addDays(today, -30);
  const lookbackMonths = normalizeLookback(searchParams?.months);
  const activeTab: SalesTab = isSalesTab(searchParams?.tab) ? searchParams.tab : 'overview';
  const activeDailyMetric = normalizeDailyMetric(searchParams?.daily_metric);
  const rangeStart = addMonths(monthStart, -(lookbackMonths - 1));

  const centersQuery = scopeCentersForAdmin(
    supabase.from('centers').select('id,name,is_active,created_at').order('name', { ascending: true }),
    centerScope
  );
  const ordersQuery = scopeCenterRelatedQueryForAdmin(
    supabase
      .from('orders')
      .select('id,center_id,status,subtotal_cents,created_at')
      .order('created_at', { ascending: false })
      .limit(10000),
    'center_id',
    centerScope
  );
  const selectedWeekOrdersQuery = scopeCenterRelatedQueryForAdmin(
    supabase
      .from('orders')
      .select('id,center_id,status,subtotal_cents,created_at')
      .gte('created_at', selectedWeekStart.toISOString())
      .lt('created_at', selectedWeekEnd.toISOString())
      .order('created_at', { ascending: false }),
    'center_id',
    centerScope
  );
  const ordersThisWeekQuery = scopeCenterRelatedQueryForAdmin(
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', currentWeekStart.toISOString()),
    'center_id',
    centerScope
  );
  const previousWeekOrdersQuery = scopeCenterRelatedQueryForAdmin(
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', previousCurrentWeekStart.toISOString())
      .lt('created_at', currentWeekStart.toISOString()),
    'center_id',
    centerScope
  );

  const [
    { data: centers },
    { data: orders },
    { data: selectedWeekOrders },
    { count: ordersThisWeekCount },
    { count: previousWeekOrdersCount },
  ] = await Promise.all([
    centersQuery,
    ordersQuery,
    selectedWeekOrdersQuery,
    ordersThisWeekQuery,
    previousWeekOrdersQuery,
  ]);

  const activeCenters = ((centers ?? []) as CenterRow[]).filter((center) => center.is_active !== false);
  const orderRows = ((orders ?? []) as SalesOrderRow[]).filter((order) => order.center_id);
  const selectedWeekOrderRows = ((selectedWeekOrders ?? []) as SalesOrderRow[]).filter((order) => order.center_id);

  const lastOrderByCenter = new Map<string, Date>();
  const centerOrders = new Map<string, SalesOrderRow[]>();
  const weeklyBuckets = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(selectedWeekStart, index);
    return { key: date.toDateString(), label: formatDayLabel(date), orders: 0, revenueCents: 0 };
  });
  const weeklyBucketByKey = new Map(weeklyBuckets.map((bucket) => [bucket.key, bucket]));
  const statusCountsSelectedWeek = new Map<string, number>();

  let revenueThisMonthCents = 0;
  let revenuePreviousMonthCents = 0;
  let revenueLast30DaysCents = 0;
  let revenueInRangeCents = 0;
  let ordersInRangeCount = 0;
  let selectedWeekOrderCount = 0;
  let selectedWeekRevenueCents = 0;

  for (const order of orderRows) {
    const centerId = order.center_id;
    const orderDate = getOrderDate(order);
    if (!centerId || !orderDate) continue;

    if (!lastOrderByCenter.has(centerId)) {
      lastOrderByCenter.set(centerId, orderDate);
    }

    const groupedOrders = centerOrders.get(centerId) ?? [];
    groupedOrders.push(order);
    centerOrders.set(centerId, groupedOrders);

    const subtotal = order.subtotal_cents ?? 0;
    if (orderDate >= rangeStart) {
      revenueInRangeCents += subtotal;
      ordersInRangeCount += 1;
    }
    if (orderDate >= monthStart) revenueThisMonthCents += subtotal;
    if (orderDate >= previousMonthStart && orderDate < monthStart) revenuePreviousMonthCents += subtotal;
    if (orderDate >= quietCutoff) revenueLast30DaysCents += subtotal;
  }

  for (const order of selectedWeekOrderRows) {
    const orderDate = getOrderDate(order);
    if (!orderDate || orderDate < selectedWeekStart || orderDate >= selectedWeekEnd) continue;

    const bucket = weeklyBucketByKey.get(startOfDay(orderDate).toDateString());
    const subtotal = order.subtotal_cents ?? 0;
    if (bucket) {
      bucket.orders += 1;
      bucket.revenueCents += subtotal;
    }
    selectedWeekOrderCount += 1;
    selectedWeekRevenueCents += subtotal;
    const status = order.status || 'Unknown';
    statusCountsSelectedWeek.set(status, (statusCountsSelectedWeek.get(status) ?? 0) + 1);
  }

  const centerReports: CenterSalesReport[] = activeCenters.map((center) => {
    const reportOrders = centerOrders.get(center.id) ?? [];
    const orderDatesDescending = getOrderDatesDescending(reportOrders);
    const lastOrderAt = orderDatesDescending[0] ?? lastOrderByCenter.get(center.id) ?? null;
    const daysSinceLastOrder = lastOrderAt ? Math.floor((today.getTime() - startOfDay(lastOrderAt).getTime()) / DAY_IN_MS) : null;
    const averageDaysBetweenOrders = getAverageDaysBetweenOrders(orderDatesDescending);
    const daysPastAverageOrderGap =
      daysSinceLastOrder !== null && averageDaysBetweenOrders !== null && daysSinceLastOrder > averageDaysBetweenOrders
        ? daysSinceLastOrder - averageDaysBetweenOrders
        : null;
    let revenueCents = 0;
    let revenue30Cents = 0;
    let ordersThisWeek = 0;
    let ordersInRange = 0;

    for (const order of reportOrders) {
      const orderDate = getOrderDate(order);
      if (!orderDate) continue;
      const subtotal = order.subtotal_cents ?? 0;
      if (orderDate >= rangeStart) {
        revenueCents += subtotal;
        ordersInRange += 1;
      }
      if (orderDate >= quietCutoff) revenue30Cents += subtotal;
      if (orderDate >= currentWeekStart) ordersThisWeek += 1;
    }

    return {
      id: center.id,
      name: getCenterName(center),
      isActive: center.is_active !== false,
      lastOrderAt,
      daysSinceLastOrder,
      averageDaysBetweenOrders,
      daysPastAverageOrderGap,
      ordersThisWeek,
      ordersInRange,
      revenueCents,
      revenueLast30DaysCents: revenue30Cents,
      averageMonthlyRevenueCents: Math.round(revenueCents / lookbackMonths),
    };
  });

  const quietCenters = centerReports
    .filter((center) => !center.lastOrderAt || center.lastOrderAt < quietCutoff)
    .sort((a, b) => {
      if (!a.lastOrderAt && !b.lastOrderAt) return a.name.localeCompare(b.name);
      if (!a.lastOrderAt) return -1;
      if (!b.lastOrderAt) return 1;
      return a.lastOrderAt.getTime() - b.lastOrderAt.getTime();
    });
  const quietCenterGroups: QuietCenterGroup[] = [
    {
      id: 'never-ordered',
      label: 'No orders yet',
      description: 'Active centers that have not placed their first order.',
      centers: quietCenters.filter((center) => !center.lastOrderAt),
    },
    {
      id: 'very-quiet',
      label: '45+ days quiet',
      description: 'Highest-priority follow-up list.',
      centers: quietCenters.filter((center) => (center.daysSinceLastOrder ?? 0) >= 45),
    },
    {
      id: 'quiet',
      label: '30-44 days quiet',
      description: 'Centers just crossing the follow-up threshold.',
      centers: quietCenters.filter((center) => {
        const days = center.daysSinceLastOrder ?? 0;
        return days >= 30 && days < 45;
      }),
    },
  ].filter((group) => group.centers.length);
  const cadenceOverdueCenters = centerReports
    .filter((center) => center.daysPastAverageOrderGap !== null)
    .sort((a, b) => {
      const daysPastAverageDiff = (b.daysPastAverageOrderGap ?? 0) - (a.daysPastAverageOrderGap ?? 0);
      if (daysPastAverageDiff !== 0) return daysPastAverageDiff;
      return a.name.localeCompare(b.name);
    });

  const sortedCenterReports = [...centerReports].sort((a, b) => b.averageMonthlyRevenueCents - a.averageMonthlyRevenueCents || a.name.localeCompare(b.name));
  const topCenters = sortedCenterReports.slice(0, 5);
  const activeCentersWithOrders = activeCenters.filter((center) => lastOrderByCenter.has(center.id));
  const averageMonthlyRevenuePerCenterCents = activeCentersWithOrders.length ? Math.round(revenueInRangeCents / lookbackMonths / activeCentersWithOrders.length) : 0;
  const monthRevenueChange = metricChange(revenueThisMonthCents, revenuePreviousMonthCents);
  const statusRows = ['New', 'Processing', 'Shipped']
    .map((status) => ({ label: status, value: statusCountsSelectedWeek.get(status) ?? 0, display: String(statusCountsSelectedWeek.get(status) ?? 0) }))
    .filter((row) => row.value > 0);
  const weeklyRows = weeklyBuckets.map((bucket) => (
    activeDailyMetric === 'revenue'
      ? { label: bucket.label, value: bucket.revenueCents, display: usd(bucket.revenueCents) }
      : { label: bucket.label, value: bucket.orders, display: String(bucket.orders) }
  ));
  const selectedWeekLabel = selectedWeekStart.getTime() === currentWeekStart.getTime() ? 'This Week' : 'Selected Week';
  const selectedWeekDailyTitle = activeDailyMetric === 'revenue' ? 'Revenue by day' : 'Orders by day';
  const nextSelectedWeekStart = addDays(selectedWeekStart, 7);
  const canMoveToNextWeek = selectedWeekStart.getTime() < currentWeekStart.getTime();
  const salesTabCounts: Record<SalesTab, string> = {
    overview: `${(ordersThisWeekCount ?? 0).toLocaleString()} this week`,
    followup: `${cadenceOverdueCenters.length.toLocaleString()} off cadence`,
    accounts: `${topCenters.length.toLocaleString()} top`,
    report: `${activeCenters.length.toLocaleString()} centers`,
  };

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <span className="eyebrow">Sales Dashboard</span>
            <h1 className="page-title mt-4">Know who is buying, who went quiet, and where revenue is trending.</h1>
            <p className="page-subtitle mt-3">
              Track center activity, weekly order volume, and average monthly revenue without digging through order history.
            </p>
          </div>
          <form className="rounded-2xl border border-slate-200/70 bg-white/60 p-4">
            <input type="hidden" name="tab" value={activeTab} />
            <input type="hidden" name="week" value={formatDateInput(selectedWeekStart)} />
            <input type="hidden" name="daily_metric" value={activeDailyMetric} />
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-slate-700" htmlFor="months">
                Report window
                <select id="months" className="input" name="months" defaultValue={lookbackMonths}>
                  {LOOKBACK_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option} months</option>
                  ))}
                </select>
              </label>
              {currentAccess.isOwner ? (
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Sales rep
                  <select className="input" name="sales_rep" defaultValue={selectedSalesRepId}>
                    <option value="">All sales reps</option>
                    {salesReps.map((admin) => (
                      <option key={admin.id} value={admin.id}>{getAdminLabel(admin)}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="mt-3">
              <button className="btn-primary shrink-0" type="submit">Update</button>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Center revenue averages use {formatShortDate(rangeStart)} through today.
            </p>
          </form>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <ReportStat
          label="Orders This Week"
          value={(ordersThisWeekCount ?? 0).toLocaleString()}
          detail={`${metricChange(ordersThisWeekCount ?? 0, previousWeekOrdersCount ?? 0)} vs last week.`}
        />
        <ReportStat
          label="Revenue This Month"
          value={usd(revenueThisMonthCents)}
          detail={`${monthRevenueChange} vs last month. Includes all order statuses.`}
        />
        <ReportStat
          label="Avg Monthly / Center"
          value={usd(averageMonthlyRevenuePerCenterCents)}
          detail={`Average across ${activeCentersWithOrders.length.toLocaleString()} active centers with at least one order over ${lookbackMonths} months.`}
        />
        <ReportStat
          label="Off Cadence"
          value={cadenceOverdueCenters.length.toLocaleString()}
          detail="Centers whose current time since last order is longer than their own average gap."
        />
        <ReportStat
          label="30-Day Follow-Up"
          value={quietCenters.length.toLocaleString()}
          detail="Active centers with no order in the last 30 days."
        />
      </section>

      <nav aria-label="Sales sections" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {SALES_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <Link
              key={tab.id}
              aria-current={isActive ? 'page' : undefined}
              href={salesTabHref(tab.id, lookbackMonths, selectedWeekStart, activeDailyMetric, selectedSalesRepId)}
              className={`rounded-2xl border px-4 py-3 transition-all duration-200 ${
                isActive
                  ? 'border-teal-200 bg-teal-50/80 text-teal-900 shadow-sm'
                  : 'border-slate-200/70 bg-white/60 text-slate-700 hover:-translate-y-0.5 hover:border-teal-200 hover:bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{tab.label}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isActive ? 'bg-white/80 text-teal-800' : 'bg-slate-100 text-slate-600'}`}>
                  {salesTabCounts[tab.id]}
                </span>
              </div>
              <p className="mt-1 text-sm opacity-75">{tab.description}</p>
            </Link>
          );
        })}
      </nav>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]" style={activeTab !== 'overview' ? { display: 'none' } : undefined}>
        <div className="card space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{selectedWeekLabel}</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{selectedWeekDailyTitle}</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">
                  Week orders: {selectedWeekOrderCount.toLocaleString()}
                </span>
                <span className="rounded-full bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-800">
                  Week revenue: {usd(selectedWeekRevenueCents)}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <p className="text-sm text-slate-500">{formatShortDate(selectedWeekStart)} - {formatShortDate(addDays(selectedWeekStart, 6))}</p>
              <div className="inline-flex w-fit rounded-full bg-slate-100 p-1" aria-label="Daily chart view">
                {DAILY_METRIC_OPTIONS.map((option) => {
                  const isActiveMetric = activeDailyMetric === option.id;
                  return (
                    <Link
                      key={option.id}
                      aria-current={isActiveMetric ? 'true' : undefined}
                      href={salesTabHref(activeTab, lookbackMonths, selectedWeekStart, option.id, selectedSalesRepId)}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-all ${
                        isActiveMetric ? 'bg-white text-teal-800 shadow-sm' : 'text-slate-600 hover:text-slate-950'
                      }`}
                    >
                      {option.label}
                    </Link>
                  );
                })}
              </div>
              <form className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <input type="hidden" name="tab" value="overview" />
                <input type="hidden" name="months" value={lookbackMonths} />
                <input type="hidden" name="daily_metric" value={activeDailyMetric} />
                <input type="hidden" name="sales_rep" value={selectedSalesRepId} />
                <label className="text-sm font-medium text-slate-700" htmlFor="orders-week">Week of</label>
                <input id="orders-week" className="input sm:w-44" name="week" type="date" defaultValue={formatDateInput(selectedWeekStart)} />
                <button className="btn-secondary w-full sm:w-auto" type="submit">View</button>
              </form>
              <div className="flex flex-wrap gap-2">
                <Link className="btn-secondary inline-flex" href={salesWeekHref(activeTab, lookbackMonths, addDays(selectedWeekStart, -7), activeDailyMetric, selectedSalesRepId)}>
                  Previous week
                </Link>
                {selectedWeekStart.getTime() !== currentWeekStart.getTime() ? (
                  <Link className="btn-secondary inline-flex" href={salesWeekHref(activeTab, lookbackMonths, currentWeekStart, activeDailyMetric, selectedSalesRepId)}>
                    Current week
                  </Link>
                ) : null}
                {canMoveToNextWeek ? (
                  <Link className="btn-secondary inline-flex" href={salesWeekHref(activeTab, lookbackMonths, nextSelectedWeekStart, activeDailyMetric, selectedSalesRepId)}>
                    Next week
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
          <MiniBarList rows={weeklyRows} />
        </div>

        <div className="card space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pipeline</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{selectedWeekLabel} by status</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Use this to see whether new sales are turning into shipped orders.</p>
          </div>
          {statusRows.length ? (
            <MiniBarList rows={statusRows} />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center text-sm text-slate-500">
              No orders placed for the selected week.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5" style={!['followup', 'accounts'].includes(activeTab) ? { display: 'none' } : undefined}>
        <div className="card space-y-4" style={activeTab !== 'followup' ? { display: 'none' } : undefined}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Needs Follow-Up</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Centers outside their average order cadence</h2>
            </div>
            <span className="rounded-full bg-rose-50 px-3 py-1 text-sm font-semibold text-rose-700">{cadenceOverdueCenters.length} centers</span>
          </div>
          <div className="space-y-3">
            {cadenceOverdueCenters.length ? cadenceOverdueCenters.map((center) => (
              <Link
                key={center.id}
                href={`/admin/users/${center.id}`}
                className="grid gap-3 rounded-2xl border border-rose-100 bg-rose-50/35 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-rose-200 hover:bg-white sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{center.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Last order: {formatDate(center.lastOrderAt)} - Current gap: {formatDaysSinceLastOrder(center.daysSinceLastOrder)} - Avg gap: {formatDayValue(center.averageDaysBetweenOrders)}
                  </p>
                </div>
                <span className="inline-flex w-fit rounded-full bg-white px-3 py-1 text-sm font-semibold text-rose-700 ring-1 ring-rose-100">
                  {formatDayValue(center.daysPastAverageOrderGap)} over average
                </span>
              </Link>
            )) : (
              <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-8 text-center text-sm text-emerald-800">
                No active center with enough order history is outside its average order cadence.
              </div>
            )}
          </div>
        </div>

        <div className="card space-y-4" style={activeTab !== 'followup' ? { display: 'none' } : undefined}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">30-Day Quiet List</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Centers quiet for 30+ days</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{quietCenters.length} centers</span>
          </div>
          <div className="space-y-4">
            {quietCenterGroups.length ? quietCenterGroups.map((group, index) => (
              <details key={group.id} className="rounded-2xl border border-slate-200/70 bg-white/50" open={index === 0}>
                <summary className="cursor-pointer px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-slate-950">{group.label}</p>
                      <p className="mt-1 text-sm text-slate-500">{group.description}</p>
                    </div>
                    <span className="w-fit rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                      {group.centers.length} center{group.centers.length === 1 ? '' : 's'}
                    </span>
                  </div>
                </summary>
                <div className="space-y-3 border-t border-slate-200/70 px-4 pb-4 pt-3">
                  {group.centers.map((center) => (
                    <Link
                      key={center.id}
                      href={`/admin/users/${center.id}`}
                      className="grid gap-3 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:bg-white sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950">{center.name}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          Last order: {formatDate(center.lastOrderAt)} - Current gap: {formatDaysSinceLastOrder(center.daysSinceLastOrder)} - Avg gap: {formatDayValue(center.averageDaysBetweenOrders)}
                        </p>
                      </div>
                      <span className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ring-1 ${getStatusTone(center.daysSinceLastOrder)}`}>
                        {getStatusLabel(center.daysSinceLastOrder)}
                      </span>
                    </Link>
                  ))}
                </div>
              </details>
            )) : (
              <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/40 px-4 py-8 text-center text-sm text-emerald-800">
                Every active center has ordered within the last 30 days.
              </div>
            )}
          </div>
        </div>

        <div className="card space-y-4" style={activeTab !== 'accounts' ? { display: 'none' } : undefined}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Top Accounts</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Highest average monthly revenue</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Based on the selected {lookbackMonths}-month window.</p>
          </div>
          <div className="space-y-3">
            {topCenters.map((center, index) => (
              <Link
                key={center.id}
                href={`/admin/users/${center.id}`}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/60 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:bg-white"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{index + 1}</span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{center.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{center.ordersInRange} orders - {usd(center.revenueCents)} total</p>
                </div>
                <p className="text-right font-semibold text-slate-950">{usd(center.averageMonthlyRevenueCents)}</p>
              </Link>
            ))}
          </div>
          {sortedCenterReports.length > topCenters.length ? (
            <details className="rounded-2xl border border-slate-200/70 bg-white/50">
              <summary className="cursor-pointer px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">Show all accounts</p>
                    <p className="mt-1 text-sm text-slate-500">Ranked by average monthly revenue for the selected window.</p>
                  </div>
                  <span className="w-fit rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                    {sortedCenterReports.length} accounts
                  </span>
                </div>
              </summary>
              <div className="space-y-3 border-t border-slate-200/70 px-4 pb-4 pt-3">
                {sortedCenterReports.map((center, index) => (
                  <Link
                    key={center.id}
                    href={`/admin/users/${center.id}`}
                    className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:bg-white"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{center.name}</p>
                      <p className="mt-1 text-sm text-slate-500">{center.ordersInRange} orders - {usd(center.revenueCents)} total</p>
                    </div>
                    <p className="text-right font-semibold text-slate-950">{usd(center.averageMonthlyRevenueCents)}</p>
                  </Link>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </section>

      <section className="card space-y-4" style={activeTab !== 'report' ? { display: 'none' } : undefined}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Center Report</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Average monthly revenue by center</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Sorted by average monthly revenue so your best accounts and quiet accounts are easy to spot.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-2xl bg-white/60 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Revenue</p>
              <p className="mt-1 font-semibold text-slate-950">{usd(revenueInRangeCents)}</p>
            </div>
            <div className="rounded-2xl bg-white/60 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Orders</p>
              <p className="mt-1 font-semibold text-slate-950">{ordersInRangeCount.toLocaleString()}</p>
            </div>
            <div className="rounded-2xl bg-white/60 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">30-Day Rev</p>
              <p className="mt-1 font-semibold text-slate-950">{moneyCompact(revenueLast30DaysCents)}</p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[70rem] border-separate border-spacing-y-2 text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-4 py-2">Center</th>
                <th className="px-4 py-2">Last order</th>
                <th className="px-4 py-2 text-right">Since last</th>
                <th className="px-4 py-2 text-right">Avg gap</th>
                <th className="px-4 py-2 text-right">This week</th>
                <th className="px-4 py-2 text-right">Orders</th>
                <th className="px-4 py-2 text-right">Revenue</th>
                <th className="px-4 py-2 text-right">Avg / month</th>
                <th className="px-4 py-2 text-right">30-day revenue</th>
              </tr>
            </thead>
            <tbody>
              {sortedCenterReports.map((center) => (
                <tr key={center.id} className="bg-white/65">
                  <td className="rounded-l-2xl px-4 py-3">
                    <Link href={`/admin/users/${center.id}`} className="font-semibold text-slate-950 hover:text-teal-700">{center.name}</Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${getStatusTone(center.daysSinceLastOrder)}`}>
                      {formatDate(center.lastOrderAt)}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${center.daysPastAverageOrderGap !== null ? 'text-rose-700' : 'text-slate-700'}`}>
                    {formatDaysSinceLastOrder(center.daysSinceLastOrder)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700">{formatDayValue(center.averageDaysBetweenOrders)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-950">{center.ordersThisWeek}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{center.ordersInRange}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-950">{usd(center.revenueCents)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-teal-800">{usd(center.averageMonthlyRevenueCents)}</td>
                  <td className="rounded-r-2xl px-4 py-3 text-right text-slate-700">{usd(center.revenueLast30DaysCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

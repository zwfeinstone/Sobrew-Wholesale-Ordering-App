import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_MONTHS = 6;
const LOOKBACK_OPTIONS = [3, 6, 12] as const;
const SALES_TABS = [
  { id: 'overview', label: 'Overview', description: 'Weekly volume and revenue' },
  { id: 'followup', label: 'Follow-up', description: 'Centers quiet 30+ days' },
  { id: 'accounts', label: 'Accounts', description: 'Best monthly accounts' },
  { id: 'report', label: 'Report', description: 'Full center revenue table' },
] as const;

type SalesTab = (typeof SALES_TABS)[number]['id'];

type CenterRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
  created_at: string | null;
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
  ordersThisWeek: number;
  ordersInRange: number;
  revenueCents: number;
  averageMonthlyRevenueCents: number;
  revenueLast30DaysCents: number;
};

function isSalesTab(value: string | string[] | undefined): value is SalesTab {
  return typeof value === 'string' && SALES_TABS.some((tab) => tab.id === value);
}

function normalizeLookback(value: string | string[] | undefined) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : DEFAULT_LOOKBACK_MONTHS;
  return LOOKBACK_OPTIONS.includes(parsed as (typeof LOOKBACK_OPTIONS)[number]) ? parsed : DEFAULT_LOOKBACK_MONTHS;
}

function salesTabHref(tab: SalesTab, months: number) {
  const query = new URLSearchParams();
  query.set('tab', tab);
  query.set('months', String(months));
  return `/admin/sales?${query.toString()}`;
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

function getCenterName(center: CenterRow) {
  return center.name?.trim() || 'Unnamed center';
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
        <div key={row.label} className="grid grid-cols-[3.25rem_minmax(0,1fr)_4rem] items-center gap-3 text-sm">
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
  const supabase = await createClient();
  const now = new Date();
  const today = startOfDay(now);
  const weekStart = startOfWeek(now);
  const previousWeekStart = addDays(weekStart, -7);
  const monthStart = startOfMonth(now);
  const previousMonthStart = addMonths(monthStart, -1);
  const quietCutoff = addDays(today, -30);
  const lookbackMonths = normalizeLookback(searchParams?.months);
  const activeTab: SalesTab = isSalesTab(searchParams?.tab) ? searchParams.tab : 'overview';
  const rangeStart = addMonths(monthStart, -(lookbackMonths - 1));

  const [{ data: centers }, { data: orders }, { count: ordersThisWeekCount }, { count: previousWeekOrdersCount }] = await Promise.all([
    supabase.from('centers').select('id,name,is_active,created_at').order('name', { ascending: true }),
    supabase
      .from('orders')
      .select('id,center_id,status,subtotal_cents,created_at')
      .order('created_at', { ascending: false })
      .limit(10000),
    supabase.from('orders').select('id', { count: 'exact', head: true }).gte('created_at', weekStart.toISOString()),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', previousWeekStart.toISOString())
      .lt('created_at', weekStart.toISOString()),
  ]);

  const activeCenters = ((centers ?? []) as CenterRow[]).filter((center) => center.is_active !== false);
  const orderRows = ((orders ?? []) as SalesOrderRow[]).filter((order) => order.center_id);

  const lastOrderByCenter = new Map<string, Date>();
  const centerOrders = new Map<string, SalesOrderRow[]>();
  const weeklyBuckets = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    return { key: date.toDateString(), label: formatDayLabel(date), value: 0, display: '0' };
  });
  const weeklyBucketByKey = new Map(weeklyBuckets.map((bucket) => [bucket.key, bucket]));
  const statusCountsThisWeek = new Map<string, number>();

  let revenueThisMonthCents = 0;
  let revenuePreviousMonthCents = 0;
  let revenueLast30DaysCents = 0;
  let revenueInRangeCents = 0;
  let ordersInRangeCount = 0;

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

    if (orderDate >= weekStart) {
      const bucket = weeklyBucketByKey.get(startOfDay(orderDate).toDateString());
      if (bucket) {
        bucket.value += 1;
        bucket.display = String(bucket.value);
      }
      const status = order.status || 'Unknown';
      statusCountsThisWeek.set(status, (statusCountsThisWeek.get(status) ?? 0) + 1);
    }
  }

  const centerReports: CenterSalesReport[] = activeCenters.map((center) => {
    const reportOrders = centerOrders.get(center.id) ?? [];
    const lastOrderAt = lastOrderByCenter.get(center.id) ?? null;
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
      if (orderDate >= weekStart) ordersThisWeek += 1;
    }

    return {
      id: center.id,
      name: getCenterName(center),
      isActive: center.is_active !== false,
      lastOrderAt,
      daysSinceLastOrder: lastOrderAt ? Math.floor((today.getTime() - startOfDay(lastOrderAt).getTime()) / DAY_IN_MS) : null,
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

  const sortedCenterReports = [...centerReports].sort((a, b) => b.averageMonthlyRevenueCents - a.averageMonthlyRevenueCents || a.name.localeCompare(b.name));
  const topCenters = sortedCenterReports.slice(0, 5);
  const averageMonthlyRevenuePerCenterCents = activeCenters.length ? Math.round(revenueInRangeCents / lookbackMonths / activeCenters.length) : 0;
  const monthRevenueChange = metricChange(revenueThisMonthCents, revenuePreviousMonthCents);
  const statusRows = ['New', 'Processing', 'Shipped']
    .map((status) => ({ label: status, value: statusCountsThisWeek.get(status) ?? 0, display: String(statusCountsThisWeek.get(status) ?? 0) }))
    .filter((row) => row.value > 0);
  const salesTabCounts: Record<SalesTab, string> = {
    overview: `${(ordersThisWeekCount ?? 0).toLocaleString()} this week`,
    followup: `${quietCenters.length.toLocaleString()} quiet`,
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
            <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500" htmlFor="months">Report window</label>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <select id="months" className="input" name="months" defaultValue={lookbackMonths}>
                {LOOKBACK_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option} months</option>
                ))}
              </select>
              <button className="btn-primary shrink-0" type="submit">Update</button>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Center revenue averages use {formatShortDate(rangeStart)} through today.
            </p>
          </form>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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
          detail={`Average across ${activeCenters.length.toLocaleString()} active centers over ${lookbackMonths} months.`}
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
              href={salesTabHref(tab.id, lookbackMonths)}
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">This Week</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Orders by day</h2>
            </div>
            <p className="text-sm text-slate-500">{formatShortDate(weekStart)} - {formatShortDate(addDays(weekStart, 6))}</p>
          </div>
          <MiniBarList rows={weeklyBuckets} />
        </div>

        <div className="card space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Pipeline</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">This week by status</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Use this to see whether new sales are turning into shipped orders.</p>
          </div>
          {statusRows.length ? (
            <MiniBarList rows={statusRows} />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center text-sm text-slate-500">
              No orders placed this week yet.
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-5" style={!['followup', 'accounts'].includes(activeTab) ? { display: 'none' } : undefined}>
        <div className="card space-y-4" style={activeTab !== 'followup' ? { display: 'none' } : undefined}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Needs Follow-Up</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Centers quiet for 30+ days</h2>
            </div>
            <span className="rounded-full bg-rose-50 px-3 py-1 text-sm font-semibold text-rose-700">{quietCenters.length} centers</span>
          </div>
          <div className="space-y-3">
            {quietCenters.length ? quietCenters.slice(0, 10).map((center) => (
              <Link
                key={center.id}
                href={`/admin/users/${center.id}`}
                className="grid gap-3 rounded-2xl border border-slate-200/70 bg-white/60 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:bg-white sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-950">{center.name}</p>
                  <p className="mt-1 text-sm text-slate-500">Last order: {formatDate(center.lastOrderAt)}</p>
                </div>
                <span className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ring-1 ${getStatusTone(center.daysSinceLastOrder)}`}>
                  {getStatusLabel(center.daysSinceLastOrder)}
                </span>
              </Link>
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
          <table className="w-full min-w-[58rem] border-separate border-spacing-y-2 text-left text-sm">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="px-4 py-2">Center</th>
                <th className="px-4 py-2">Last order</th>
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

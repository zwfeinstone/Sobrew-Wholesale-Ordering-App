import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const TIME_RANGE_OPTIONS = [
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'previous_years', label: 'Previous years' },
  { value: 'lifetime', label: 'Lifetime' },
] as const;

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 8;

type TimeRange = (typeof TIME_RANGE_OPTIONS)[number]['value'];

type MetricRow = {
  created_at: string | null;
  subtotal_cents?: number | null;
};

type Bucket = {
  key: string;
  label: string;
  value: number;
};

type ChartBucket = Bucket & {
  displayValue: string;
};

function normalizeTimeRange(value: string | string[] | undefined): TimeRange {
  return TIME_RANGE_OPTIONS.some((option) => option.value === value) ? (value as TimeRange) : 'month';
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

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function formatBucketLabel(date: Date, range: TimeRange) {
  if (range === 'week') return date.toLocaleDateString('en-US', { weekday: 'short' });
  if (range === 'month') return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return date.toLocaleDateString('en-US', { month: 'short' });
}

function keyForDate(date: Date, range: TimeRange) {
  if (range === 'week' || range === 'month') {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }
  if (range === 'year') {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }
  return String(date.getFullYear());
}

function getRangeBounds(range: TimeRange, now: Date) {
  if (range === 'week') return { start: startOfWeek(now), end: null as Date | null };
  if (range === 'month') return { start: startOfMonth(now), end: null as Date | null };
  if (range === 'year') return { start: startOfYear(now), end: null as Date | null };
  if (range === 'previous_years') return { start: null as Date | null, end: startOfYear(now) };
  return { start: null as Date | null, end: null as Date | null };
}

function applyRangeToQuery(query: any, column: string, range: TimeRange, now: Date) {
  const { start, end } = getRangeBounds(range, now);
  let nextQuery = query;
  if (start) nextQuery = nextQuery.gte(column, start.toISOString());
  if (end) nextQuery = nextQuery.lt(column, end.toISOString());
  return nextQuery;
}

function buildPredefinedBuckets(range: TimeRange, now: Date): Bucket[] | null {
  if (range === 'week') {
    const start = startOfWeek(now);
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return { key: keyForDate(date, range), label: formatBucketLabel(date, range), value: 0 };
    });
  }

  if (range === 'month') {
    const start = startOfMonth(now);
    const today = startOfDay(now);
    const dayCount = Math.floor((today.getTime() - start.getTime()) / DAY_IN_MS) + 1;
    return Array.from({ length: dayCount }, (_, index) => {
      const date = addDays(start, index);
      return { key: keyForDate(date, range), label: formatBucketLabel(date, range), value: 0 };
    });
  }

  if (range === 'year') {
    return Array.from({ length: now.getMonth() + 1 }, (_, monthIndex) => {
      const date = new Date(now.getFullYear(), monthIndex, 1);
      return { key: keyForDate(date, range), label: formatBucketLabel(date, range), value: 0 };
    });
  }

  return null;
}

function buildBuckets(rows: MetricRow[], range: TimeRange, now: Date, getValue: (row: MetricRow) => number) {
  const predefined = buildPredefinedBuckets(range, now);
  if (predefined) {
    const bucketMap = new Map(predefined.map((bucket) => [bucket.key, bucket]));
    for (const row of rows) {
      if (!row.created_at) continue;
      const date = new Date(row.created_at);
      if (Number.isNaN(date.getTime())) continue;
      const bucket = bucketMap.get(keyForDate(date, range));
      if (bucket) bucket.value += getValue(row);
    }
    return predefined;
  }

  const yearMap = new Map<number, number>();
  for (const row of rows) {
    if (!row.created_at) continue;
    const date = new Date(row.created_at);
    if (Number.isNaN(date.getTime())) continue;
    yearMap.set(date.getFullYear(), (yearMap.get(date.getFullYear()) ?? 0) + getValue(row));
  }

  return [...yearMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, value]) => ({ key: String(year), label: String(year), value }));
}

function buildPath(values: number[], width: number, height: number) {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - (value / max) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function formatCompactCurrency(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

function StatChart({ buckets, color }: { buckets: ChartBucket[]; color: string }) {
  if (!buckets.length) {
    return <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white/40 px-4 py-8 text-center text-sm text-slate-500">No data for this range yet.</div>;
  }

  const values = buckets.map((bucket) => bucket.value);
  const max = Math.max(...values, 1);
  const width = 320;
  const height = 120;
  const path = buildPath(values, width, height);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white/55 p-3 sm:p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" preserveAspectRatio="none" aria-hidden="true">
          {values.map((value, index) => {
            const barWidth = width / values.length;
            const x = index * barWidth + barWidth * 0.15;
            const barHeight = (value / max) * height;
            const y = height - barHeight;
            return <rect key={buckets[index].key} x={x} y={y} width={barWidth * 0.7} height={Math.max(barHeight, 4)} rx="10" fill={color} opacity="0.18" />;
          })}
          <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {values.map((value, index) => {
            const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
            const y = height - (value / max) * height;
            return <circle key={`${buckets[index].key}-point`} cx={x} cy={y} r="4" fill={color} />;
          })}
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-3 xl:grid-cols-6">
        {buckets.slice(-6).map((bucket) => (
          <div key={bucket.key} className="rounded-xl bg-white/50 px-3 py-2 text-center">
            <div className="font-semibold text-slate-700">{bucket.label}</div>
            <div className="mt-1">{bucket.displayValue}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterForm({
  label,
  field,
  value,
  otherFilters,
}: {
  label: string;
  field: string;
  value: TimeRange;
  otherFilters: Record<string, string>;
}) {
  return (
    <form className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {Object.entries(otherFilters).map(([name, hiddenValue]) => (
        <input key={name} type="hidden" name={name} value={hiddenValue} />
      ))}
      <label className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</label>
      <select className="input w-full sm:max-w-[12rem]" name={field} defaultValue={value}>
        {TIME_RANGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <button className="btn-secondary w-full sm:w-auto" type="submit">Apply</button>
    </form>
  );
}

function StatCard({
  title,
  value,
  tone,
  description,
  buckets,
  filterField,
  filterValue,
  otherFilters,
  bucketFormatter,
}: {
  title: string;
  value: string;
  tone: string;
  description: string;
  buckets: Bucket[];
  filterField: string;
  filterValue: TimeRange;
  otherFilters: Record<string, string>;
  bucketFormatter?: (value: number) => string;
}) {
  const chartBuckets: ChartBucket[] = buckets.map((bucket) => ({
    ...bucket,
    displayValue: bucketFormatter ? bucketFormatter(bucket.value) : bucket.value.toLocaleString(),
  }));

  return (
    <section className="card space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
          <p className="mt-3 text-3xl font-semibold text-slate-950 sm:text-4xl">{value}</p>
          <p className="mt-2 text-sm text-slate-500">{description}</p>
        </div>
        <FilterForm label="Range" field={filterField} value={filterValue} otherFilters={otherFilters} />
      </div>
      <StatChart buckets={chartBuckets} color={tone} />
    </section>
  );
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const now = new Date();

  const ordersRange = normalizeTimeRange(searchParams?.ordersRange);
  const revenueRange = normalizeTimeRange(searchParams?.revenueRange);
  const usersRange = normalizeTimeRange(searchParams?.usersRange);

  const ordersMetricQuery = applyRangeToQuery(supabase.from('orders').select('created_at'), 'created_at', ordersRange, now);
  const revenueMetricQuery = applyRangeToQuery(supabase.from('orders').select('created_at,subtotal_cents'), 'created_at', revenueRange, now);
  const usersMetricQuery = applyRangeToQuery(supabase.from('profiles').select('created_at'), 'created_at', usersRange, now);

  const [{ count: newOrders }, { data: recent }, { data: orderMetricRows }, { data: revenueMetricRows }, { data: userMetricRows }] = await Promise.all([
    supabase.from('orders').select('id', { head: true, count: 'exact' }).eq('status', 'New').is('archived_at', null),
    supabase.from('orders').select('id,status,created_at,profiles(email),centers(name)').is('archived_at', null).order('created_at', { ascending: false }).limit(PAGE_SIZE),
    ordersMetricQuery,
    revenueMetricQuery,
    usersMetricQuery,
  ]);

  const orderIds = (recent ?? []).map((order: any) => order.id);
  const { data: items } = orderIds.length
    ? await supabase.from('order_items').select('order_id,product_id,product_name_snapshot').in('order_id', orderIds)
    : { data: [] as any[] };

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const productNameById = new Map((products ?? []).map((product: any) => [product.id, product.name]));

  const firstNameByOrderId = new Map<string, string>();
  for (const item of items ?? []) {
    if (!firstNameByOrderId.has(item.order_id)) {
      firstNameByOrderId.set(item.order_id, productNameById.get(item.product_id) || item.product_name_snapshot || 'Unknown product');
    }
  }

  const orderBuckets = buildBuckets((orderMetricRows ?? []) as MetricRow[], ordersRange, now, () => 1);
  const revenueBuckets = buildBuckets((revenueMetricRows ?? []) as MetricRow[], revenueRange, now, (row) => row.subtotal_cents ?? 0);
  const userBuckets = buildBuckets((userMetricRows ?? []) as MetricRow[], usersRange, now, () => 1);

  const totalRevenueCents = ((revenueMetricRows ?? []) as MetricRow[]).reduce((sum, row) => sum + (row.subtotal_cents ?? 0), 0);

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="space-y-4">
            <span className="eyebrow">Operations Snapshot</span>
            <div>
              <h1 className="page-title">Keep wholesale fulfillment moving with less friction.</h1>
              <p className="page-subtitle mt-3">Track order volume, revenue, and customer growth from one dashboard without leaving the admin workspace.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">New Orders</p>
              <p className="mt-2 text-4xl font-semibold text-slate-950">{newOrders ?? 0}</p>
              <p className="mt-2 text-sm text-slate-500">Orders currently waiting for review.</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Recent Activity</p>
              <p className="mt-2 text-4xl font-semibold text-slate-950">{recent?.length ?? 0}</p>
              <p className="mt-2 text-sm text-slate-500">Most recent active orders shown below.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <StatCard
          title="Orders"
          value={(orderMetricRows?.length ?? 0).toLocaleString()}
          tone="#0f766e"
          description="Total orders placed in the selected time range."
          buckets={orderBuckets}
          filterField="ordersRange"
          filterValue={ordersRange}
          otherFilters={{ revenueRange, usersRange }}
        />
        <StatCard
          title="Revenue"
          value={usd(totalRevenueCents)}
          tone="#ca8a04"
          description="Gross order revenue captured across the selected time range."
          buckets={revenueBuckets}
          filterField="revenueRange"
          filterValue={revenueRange}
          otherFilters={{ ordersRange, usersRange }}
          bucketFormatter={formatCompactCurrency}
        />
        <StatCard
          title="New Users"
          value={(userMetricRows?.length ?? 0).toLocaleString()}
          tone="#2563eb"
          description="New customer accounts created in the selected time range."
          buckets={userBuckets}
          filterField="usersRange"
          filterValue={usersRange}
          otherFilters={{ ordersRange, revenueRange }}
        />
      </section>

      <section className="card space-y-4">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">Recent orders</h2>
            <p className="mt-1 text-sm text-slate-500">Open any order to update status, check items, or confirm shipment progress.</p>
          </div>
          <Link href="/admin/orders" className="btn-secondary w-full sm:w-auto">View all orders</Link>
        </div>
        {recent?.map((order: any) => (
          <Link
            key={order.id}
            href={`/admin/orders/${order.id}`}
            className="flex flex-col gap-3 rounded-[1.5rem] border border-slate-200/70 bg-white/70 px-4 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-200 hover:bg-white sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold text-slate-950">{firstNameByOrderId.get(order.id) ?? 'Unknown product'}</p>
              <p className="mt-1 text-sm font-medium text-slate-700">{order.centers?.name || 'Unknown center'}</p>
              <p className="mt-1 break-all text-sm text-slate-500">{order.profiles?.email || 'No login email on file'}</p>
            </div>
            <div className="self-start text-left sm:self-auto sm:text-right">
              <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{order.status}</p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

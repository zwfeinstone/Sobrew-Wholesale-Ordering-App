import Link from 'next/link';
import {
  addDays,
  buildReportingDashboard,
  defaultRangeForMonth,
  formatDateInput,
  formatMonthInput,
  parseDateInput,
  parseMonthInput,
  type CustomerSalesRow,
  type CustomerStatus,
  type InventoryPlanningRow,
  type MetricComparisonRow,
  type ProductSalesRow,
  type ReorderRiskLevel,
  type ReorderRiskRow,
  type ReportingCenterRow,
  type ReportingInventoryItemRow,
  type ReportingInventoryLotRow,
  type ReportingOrderItemRow,
  type ReportingOrderRow,
  type ReportingProductRow,
  type ReportingReorderSettingRow,
} from '@/lib/reporting';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const ROW_LIMIT = 12;

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function money(value: number) {
  return usd(Math.round(value));
}

function signedMoney(value: number) {
  if (value === 0) return '$0.00';
  return `${value > 0 ? '+' : '-'}${usd(Math.abs(Math.round(value)))}`;
}

function number(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value);
}

function quantity(value: number) {
  return number(value, value % 1 === 0 ? 0 : 1);
}

function percent(value: number) {
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}%`;
}

function dateLabel(value: Date | null, fallback = 'Not enough history') {
  if (!value) return fallback;
  return value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function monthLabel(value: Date) {
  return value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shortMonthLabel(value: Date) {
  return value.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function daysLabel(value: number | null) {
  if (value === null) return 'Not enough history';
  const rounded = Math.round(value * 10) / 10;
  return `${number(rounded, Number.isInteger(rounded) ? 0 : 1)} day${rounded === 1 ? '' : 's'}`;
}

function riskTone(risk: ReorderRiskLevel) {
  if (risk === 'High risk') return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (risk === 'Medium risk') return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
}

function statusTone(status: CustomerStatus) {
  if (status === 'Growing' || status === 'Active' || status === 'New' || status === 'Reactivated') return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  if (status === 'At risk' || status === 'Declining') return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-rose-50 text-rose-700 ring-rose-100';
}

function inventoryTone(label: string) {
  if (label === 'Expected stockout' || label === 'Low stock') return 'bg-rose-50 text-rose-700 ring-rose-100';
  if (label === 'Reorder suggested' || label === 'Not tracked') return 'bg-amber-50 text-amber-700 ring-amber-100';
  return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
}

function valueForMetric(row: MetricComparisonRow, key: 'current' | 'previous' | 'change') {
  if (row.format === 'currency') {
    return key === 'change' ? signedMoney(row[key]) : money(row[key]);
  }
  return key === 'change' ? `${row.change > 0 ? '+' : ''}${number(row.change, 1)}` : number(row[key], 1);
}

function StatTile({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function SectionHeading({
  action,
  eyebrow,
  subtitle,
  title,
}: {
  action?: React.ReactNode;
  eyebrow: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/55 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function MetricComparisonTable({ rows }: { rows: MetricComparisonRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Metric</th>
            <th className="px-4 py-2 text-right">Selected month</th>
            <th className="px-4 py-2 text-right">Previous month</th>
            <th className="px-4 py-2 text-right">Change</th>
            <th className="px-4 py-2 text-right">Percent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.label}</td>
              <td className="px-4 py-3 text-right text-slate-700">{valueForMetric(row, 'current')}</td>
              <td className="px-4 py-3 text-right text-slate-700">{valueForMetric(row, 'previous')}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.change >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{valueForMetric(row, 'change')}</td>
              <td className={`rounded-r-xl px-4 py-3 text-right font-semibold ${row.percentChange >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{percent(row.percentChange)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductTable({ rows }: { rows: ProductSalesRow[] }) {
  if (!rows.length) return <EmptyState message="No product sales found for the selected filters." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[62rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Product</th>
            <th className="px-4 py-2 text-right">Units</th>
            <th className="px-4 py-2 text-right">Quantity</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Share</th>
            <th className="px-4 py-2 text-right">Orders</th>
            <th className="px-4 py-2 text-right">MoM</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.productId} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.productName}</td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.unitsSold)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.quantitySold)}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{money(row.revenueCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{percent(row.percentOfRevenue).replace('+', '')}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.orderCount)}</td>
              <td className={`rounded-r-xl px-4 py-3 text-right font-semibold ${row.growthPercent >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{percent(row.growthPercent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerTable({ rows }: { rows: CustomerSalesRow[] }) {
  if (!rows.length) return <EmptyState message="No customer sales found for the selected filters." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[78rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Customer</th>
            <th className="px-4 py-2 text-right">This month</th>
            <th className="px-4 py-2 text-right">Last month</th>
            <th className="px-4 py-2 text-right">Change</th>
            <th className="px-4 py-2 text-right">Orders</th>
            <th className="px-4 py-2 text-right">AOV</th>
            <th className="px-4 py-2">First order</th>
            <th className="px-4 py-2">Last order</th>
            <th className="px-4 py-2 text-right">Lifetime</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.centerId} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3">
                <Link href={`/admin/users/${row.centerId}`} className="font-semibold text-slate-950 hover:text-teal-700">{row.centerName}</Link>
              </td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{money(row.revenueThisMonthCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.revenueLastMonthCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.changeCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{signedMoney(row.changeCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.orderCount)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.averageOrderValueCents)}</td>
              <td className="px-4 py-3 text-slate-700">{dateLabel(row.firstOrderDate, 'Never')}</td>
              <td className="px-4 py-3 text-slate-700">{dateLabel(row.lastOrderDate, 'Never')}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{money(row.lifetimeRevenueCents)}</td>
              <td className="rounded-r-xl px-4 py-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(row.status)}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReorderTable({ rows }: { rows: ReorderRiskRow[] }) {
  if (!rows.length) return <EmptyState message="No customer reorder history found yet." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[70rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Customer</th>
            <th className="px-4 py-2 text-right">Avg gap</th>
            <th className="px-4 py-2">Last order</th>
            <th className="px-4 py-2">Expected next</th>
            <th className="px-4 py-2 text-right">Since last</th>
            <th className="px-4 py-2">Risk</th>
            <th className="px-4 py-2">Suggested action</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.centerId} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3">
                <Link href={`/admin/users/${row.centerId}`} className="font-semibold text-slate-950 hover:text-teal-700">{row.centerName}</Link>
              </td>
              <td className="px-4 py-3 text-right text-slate-700">{daysLabel(row.averageDaysBetweenOrders)}</td>
              <td className="px-4 py-3 text-slate-700">{dateLabel(row.lastOrderDate, 'Never')}</td>
              <td className="px-4 py-3 text-slate-700">{dateLabel(row.expectedNextOrderDate)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{daysLabel(row.daysSinceLastOrder)}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${riskTone(row.riskLevel)}`}>{row.riskLevel}</span>
              </td>
              <td className="rounded-r-xl px-4 py-3 text-slate-700">{row.suggestedAction}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryTable({ rows, unavailable }: { rows: InventoryPlanningRow[]; unavailable: boolean }) {
  if (unavailable) {
    return <EmptyState message="Inventory planning data is unavailable until the inventory migrations are applied." />;
  }
  if (!rows.length) return <EmptyState message="No inventory demand could be forecast from the selected data." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[74rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Product or item</th>
            <th className="px-4 py-2 text-right">Available</th>
            <th className="px-4 py-2 text-right">Avg weekly usage</th>
            <th className="px-4 py-2 text-right">Forecast demand</th>
            <th className="px-4 py-2">Runout</th>
            <th className="px-4 py-2 text-right">Recommended qty</th>
            <th className="px-4 py-2">Warning</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.productId} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3">
                <p className="font-semibold text-slate-950">{row.productName}</p>
                <p className="mt-1 text-xs text-slate-500">{row.inventoryItemName ?? 'No linked inventory item'}</p>
              </td>
              <td className="px-4 py-3 text-right text-slate-700">
                {row.currentAvailableQty === null ? 'Not tracked' : `${quantity(row.currentAvailableQty)} ${row.unitLabel}`}
              </td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.averageWeeklyUsageQty)}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{quantity(row.forecastedMonthlyDemandQty)}</td>
              <td className="px-4 py-3 text-slate-700">{dateLabel(row.estimatedRunoutDate, 'No runout estimate')}</td>
              <td className="px-4 py-3 text-right font-semibold text-teal-800">{quantity(row.recommendedReorderQty)}</td>
              <td className="rounded-r-xl px-4 py-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${inventoryTone(row.warningLabel)}`}>{row.warningLabel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductRankList({ emptyLabel, rows }: { emptyLabel: string; rows: ProductSalesRow[] }) {
  if (!rows.length) return <EmptyState message={emptyLabel} />;
  const max = Math.max(...rows.map((row) => row.revenueCents), 1);

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.productId} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 rounded-xl border border-slate-200/70 bg-white/60 px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-950">{row.productName}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-teal-700" style={{ width: `${Math.max((row.revenueCents / max) * 100, row.revenueCents > 0 ? 8 : 0)}%` }} />
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold text-slate-950">{money(row.revenueCents)}</p>
            <p className="mt-1 text-xs text-slate-500">{quantity(row.quantitySold)} sold</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function CriticalReportError({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Reports</span>
        <h1 className="page-title mt-4">Reporting dashboard</h1>
        <p className="page-subtitle mt-3">The report data could not be loaded.</p>
      </section>
      <section className="card border-rose-200 bg-rose-50/70 text-sm leading-6 text-rose-800">
        <p className="font-semibold">Unable to load reporting data.</p>
        <p className="mt-1">{message}</p>
      </section>
    </div>
  );
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const now = new Date();
  const selectedMonth = parseMonthInput(searchParams?.month, now);
  const defaultRange = defaultRangeForMonth(selectedMonth);
  const parsedRangeStart = parseDateInput(searchParams?.rangeStart);
  const parsedRangeEnd = parseDateInput(searchParams?.rangeEnd);
  const rangeStart = parsedRangeStart ?? defaultRange.rangeStart;
  const rangeEndExclusive =
    parsedRangeEnd && parsedRangeEnd >= rangeStart
      ? addDays(parsedRangeEnd, 1)
      : defaultRange.rangeEndExclusive;

  const [
    ordersResult,
    orderItemsResult,
    centersResult,
    productsResult,
    inventoryItemsResult,
    inventoryLotsResult,
    reorderSettingsResult,
  ] = await Promise.all([
    supabase.from('orders').select('id,center_id,status,subtotal_cents,created_at').order('created_at', { ascending: false }).limit(20000),
    supabase.from('order_items').select('order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents').limit(50000),
    supabase.from('centers').select('id,name,is_active,created_at').order('name', { ascending: true }),
    supabase.from('products').select('id,name,sku,category,active').order('name', { ascending: true }),
    supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,product_id,active').order('name', { ascending: true }),
    supabase.from('inventory_lots').select('inventory_item_id,quantity_remaining').limit(50000),
    supabase.from('inventory_reorder_settings').select('inventory_item_id,reorder_point,target_stock,lead_time_days'),
  ]);

  if (ordersResult.error || orderItemsResult.error || centersResult.error || productsResult.error) {
    return (
      <CriticalReportError
        message={ordersResult.error?.message || orderItemsResult.error?.message || centersResult.error?.message || productsResult.error?.message || 'Unknown reporting query error.'}
      />
    );
  }

  const centers = (centersResult.data ?? []) as ReportingCenterRow[];
  const products = (productsResult.data ?? []) as ReportingProductRow[];
  const selectedProductId = stringParam(searchParams?.product);
  const selectedCenterId = stringParam(searchParams?.center);
  const productId = products.some((product) => product.id === selectedProductId) ? selectedProductId : undefined;
  const centerId = centers.some((center) => center.id === selectedCenterId) ? selectedCenterId : undefined;
  const inventoryUnavailable = Boolean(inventoryItemsResult.error || inventoryLotsResult.error);
  const dashboard = buildReportingDashboard({
    centers,
    filters: {
      selectedMonth,
      rangeStart,
      rangeEndExclusive,
      productId,
      centerId,
    },
    inventoryItems: inventoryUnavailable ? [] : ((inventoryItemsResult.data ?? []) as ReportingInventoryItemRow[]),
    inventoryLots: inventoryUnavailable ? [] : ((inventoryLotsResult.data ?? []) as ReportingInventoryLotRow[]),
    now,
    orderItems: (orderItemsResult.data ?? []) as ReportingOrderItemRow[],
    orders: (ordersResult.data ?? []) as ReportingOrderRow[],
    products,
    reorderSettings: reorderSettingsResult.error ? [] : ((reorderSettingsResult.data ?? []) as ReportingReorderSettingRow[]),
  });
  const rangeEndInput = formatDateInput(addDays(rangeEndExclusive, -1));
  const activeFilterCount = [productId, centerId, parsedRangeStart, parsedRangeEnd].filter(Boolean).length;

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <span className="eyebrow">Reports</span>
            <h1 className="page-title mt-4">Sales, customer, product, and inventory planning dashboard.</h1>
            <p className="page-subtitle mt-3">
              Focused reporting for wholesale order performance, reorder risk, product demand, and practical inventory planning.
            </p>
          </div>
          <form className="rounded-xl border border-slate-200/70 bg-white/60 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Report month
                <input className="input" name="month" type="month" defaultValue={formatMonthInput(selectedMonth)} />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Range start
                <input className="input" name="rangeStart" type="date" defaultValue={formatDateInput(rangeStart)} />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Range end
                <input className="input" name="rangeEnd" type="date" defaultValue={rangeEndInput} />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Product
                <select className="input" name="product" defaultValue={productId ?? ''}>
                  <option value="">All products</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>{product.name || product.sku || 'Unnamed product'}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                Customer
                <select className="input" name="center" defaultValue={centerId ?? ''}>
                  <option value="">All customers</option>
                  {centers.map((center) => (
                    <option key={center.id} value={center.id}>{center.name || 'Unnamed center'}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button className="btn-primary w-full sm:w-auto" type="submit">Update reports</button>
              <Link href="/admin/reports" className="btn-secondary w-full sm:w-auto">Reset</Link>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {monthLabel(selectedMonth)} compared with {monthLabel(dashboard.previousMonthStart)}. Product tables use {dateLabel(rangeStart)} through {dateLabel(addDays(rangeEndExclusive, -1))}.
            </p>
          </form>
        </div>
      </section>

      {!dashboard.hasOrders ? (
        <section className="card">
          <EmptyState message="No orders found yet. Reports will populate as wholesale orders are placed." />
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Revenue Today" value={money(dashboard.dailySnapshot.revenueTodayCents)} detail={`${number(dashboard.dailySnapshot.ordersToday)} order${dashboard.dailySnapshot.ordersToday === 1 ? '' : 's'} today.`} />
        <StatTile label="MTD Revenue" value={money(dashboard.dailySnapshot.revenueMonthToDateCents)} detail={`${signedMoney(dashboard.dailySnapshot.revenueComparedToSameDayLastMonthCents)} vs same day last month.`} />
        <StatTile label="MTD Orders" value={number(dashboard.dailySnapshot.ordersMonthToDate)} detail={`${dashboard.dailySnapshot.orderComparedToSameDayLastMonth >= 0 ? '+' : ''}${number(dashboard.dailySnapshot.orderComparedToSameDayLastMonth)} vs same day last month.`} />
        <StatTile label="Projected Revenue" value={money(dashboard.dailySnapshot.projectedMonthEndRevenueCents)} detail={`${number(dashboard.dailySnapshot.projectedMonthEndOrders)} projected month-end orders.`} />
        <StatTile label="Due Customers" value={number(dashboard.dailySnapshot.customersDueOrOverdue)} detail={`Top product this month: ${dashboard.dailySnapshot.topProductThisMonth}.`} />
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Month over month"
          title={`${shortMonthLabel(dashboard.monthStart)} versus ${shortMonthLabel(dashboard.previousMonthStart)}`}
          subtitle="Calendar-month sales comparison with revenue, order volume, product quantity, order value, and customer movement."
          action={activeFilterCount ? <span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">{activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}</span> : null}
        />
        <MetricComparisonTable rows={dashboard.monthComparisonRows} />
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="card space-y-5">
          <SectionHeading
            eyebrow="Month to date"
            title={`Through day ${dashboard.mtdComparison.selectedPeriodEndDay}`}
            subtitle={`Compares ${shortMonthLabel(dashboard.monthStart)} through day ${dashboard.mtdComparison.selectedPeriodEndDay} with ${shortMonthLabel(dashboard.previousMonthStart)} through day ${dashboard.mtdComparison.previousPeriodEndDay}.`}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile label="Current MTD Revenue" value={money(dashboard.mtdComparison.current.revenueCents)} detail={`${percent(dashboard.mtdComparison.revenuePercentAhead)} versus same day last month.`} />
            <StatTile label="Last Month Same Day" value={money(dashboard.mtdComparison.previous.revenueCents)} detail={`${number(dashboard.mtdComparison.previous.orderCount)} orders through the comparison day.`} />
            <StatTile label="Current MTD Orders" value={number(dashboard.mtdComparison.current.orderCount)} detail={`${percent(dashboard.mtdComparison.orderPercentAhead)} versus same day last month.`} />
            <StatTile label="Projected Orders" value={number(dashboard.mtdComparison.projectedOrderCount)} detail={`${money(dashboard.mtdComparison.projectedRevenueCents)} projected revenue at current pace.`} />
          </div>
        </div>

        <div className="card space-y-5">
          <SectionHeading
            eyebrow="Forecast"
            title={`${monthLabel(dashboard.monthStart)} month-end forecast`}
            subtitle={dashboard.forecast.method}
            action={<span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{dashboard.forecast.confidence} confidence</span>}
          />
          {dashboard.forecast.fallbackMessage ? (
            <EmptyState message={dashboard.forecast.fallbackMessage} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Forecast Revenue" value={money(dashboard.forecast.forecastRevenueCents)} detail={`${money(dashboard.forecast.currentPaceRevenueCents)} from current pace.`} />
              <StatTile label="Forecast Orders" value={number(dashboard.forecast.forecastOrderCount)} detail={`${dashboard.forecast.historicalMonthsUsed} historical month${dashboard.forecast.historicalMonthsUsed === 1 ? '' : 's'} with orders.`} />
              <StatTile label="Historical Average" value={money(dashboard.forecast.historicalAverageRevenueCents)} detail="Prior three-month average revenue." />
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] border-separate border-spacing-y-2 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-4 py-2">Product demand</th>
                  <th className="px-4 py-2 text-right">Forecast qty</th>
                  <th className="px-4 py-2 text-right">Recommended qty</th>
                  <th className="px-4 py-2 text-right">Prior month</th>
                  <th className="px-4 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.forecast.productDemand.slice(0, 6).map((row) => (
                  <tr key={row.productId} className="bg-white/65">
                    <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.productName}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{quantity(row.forecastQty)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-teal-800">{number(row.recommendedQty)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{quantity(row.priorMonthQty)}</td>
                    <td className="rounded-r-xl px-4 py-3 text-slate-700">{row.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!dashboard.forecast.productDemand.length ? <EmptyState message="No product demand forecast is available for the selected filters." /> : null}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
        <div className="card space-y-5">
          <SectionHeading
            eyebrow="Product sales"
            title="Product-level revenue and demand"
            subtitle="Range-based product sales with month-over-month product growth and decline."
          />
          <ProductTable rows={dashboard.productSalesRows} />
        </div>
        <div className="grid gap-5">
          <div className="card space-y-4">
            <SectionHeading eyebrow="Top selling" title="Top products" subtitle="Highest revenue in the selected range." />
            <ProductRankList rows={dashboard.topSellingProducts} emptyLabel="No top products yet for this range." />
          </div>
          <div className="card space-y-4">
            <SectionHeading eyebrow="Slow moving" title="Lowest movement" subtitle="Products with the least selected-range sales activity." />
            <ProductRankList rows={dashboard.slowMovingProducts} emptyLabel="No slow-moving product data yet." />
          </div>
        </div>
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Customer sales"
          title="Customer revenue and status"
          subtitle="Customer-level revenue, order count, lifetime revenue, first and last order dates, and automatically calculated status."
        />
        <CustomerTable rows={dashboard.customerSalesRows} />
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Reorder risk"
          title="Customers due or overdue for another order"
          subtitle="Order history estimates each customer's normal cadence and highlights accounts past their reorder window."
        />
        <ReorderTable rows={dashboard.reorderRiskRows} />
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Inventory planning"
          title="Product demand and stock coverage"
          subtitle="Forecasted product demand, current available finished goods when tracked, runout timing, and rounded whole-unit recommendations."
        />
        <InventoryTable rows={dashboard.inventoryPlanningRows} unavailable={inventoryUnavailable} />
      </section>
    </div>
  );
}

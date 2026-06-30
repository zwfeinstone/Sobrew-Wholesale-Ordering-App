import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import { getSalesScopedCenterIdsForAdmin, scopeCenterRelatedQueryForAdmin, scopeCentersForAdmin } from '@/lib/admin-center-scope';
import { adminCanView, getCurrentAdminAccess } from '@/lib/admin-permissions';
import {
  buildGrossProfitSimulator,
  type GrossProfitSimulatorDashboard,
  type GrossProfitSimulatorInputRow,
  type GrossProfitSimulatorLaborRow,
  type GrossProfitSimulatorProductRow,
} from '@/lib/gross-profit-simulator';
import {
  buildProfitabilityDashboard,
  type ProfitabilityOrderItemRow,
  type ProfitabilityOrderRow,
} from '@/lib/profitability-reporting';
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
  type ReportingInventoryMovementRow,
  type ReportingOrderItemRow,
  type ReportingOrderRow,
  type ReportingProductRow,
  type ReportingReorderSettingRow,
} from '@/lib/reporting';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

const ROW_LIMIT = 12;
const REPORTS = [
  { id: 'overview', label: 'Profitability Overview' },
  { id: 'centers', label: 'Center Profitability' },
  { id: 'items', label: 'Item Profitability' },
  { id: 'margin', label: 'Where Did Margin Go' },
  { id: 'simulator', label: 'Gross Profit Simulator' },
  { id: 'production', label: 'Production & COGS' },
  { id: 'inventory', label: 'Inventory Value & Expenses' },
  { id: 'sales', label: 'Sales & Customers' },
] as const;

type ReportId = (typeof REPORTS)[number]['id'];
type SimulatorTab = 'labor' | 'raw' | 'supplies';

type AdminRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

type ProfitabilityCenterRows = ReturnType<typeof buildProfitabilityDashboard>['centerRows'];

function reportIsProfitability(reportId: ReportId) {
  return reportId !== 'sales';
}

function paramsFromRecord(searchParams: Record<string, string | string[] | undefined> | undefined) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry));
    } else if (typeof value === 'string') {
      params.set(key, value);
    }
  }
  return params;
}

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function adminLabel(admin: AdminRow | undefined) {
  return admin?.full_name || admin?.email || 'Unknown admin';
}

function reportParam(value: string | string[] | undefined): ReportId {
  return REPORTS.some((report) => report.id === value) ? value as ReportId : 'overview';
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

function normalizeReportNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function simulatorPercentParam(value: string | string[] | undefined) {
  const parsed = Number.parseFloat(stringParam(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function simulatorUnitCostOverrides(searchParams: Record<string, string | string[] | undefined> | undefined) {
  const overrides = new Map<string, number>();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (!key.startsWith('sim_item_')) continue;
    const rawValue = stringParam(value).trim();
    if (!rawValue) continue;
    const parsed = Number.parseFloat(rawValue);
    if (Number.isFinite(parsed) && parsed >= 0) {
      overrides.set(key.replace('sim_item_', ''), parsed * 100);
    }
  }
  return overrides;
}

function simulatorLaborOverrides(searchParams: Record<string, string | string[] | undefined> | undefined) {
  const laborMinutesOverrides = new Map<string, number>();
  const laborRateOverridesCents = new Map<string, number>();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    const rawValue = stringParam(value).trim();
    if (!rawValue) continue;
    const parsed = Number.parseFloat(rawValue);
    if (!Number.isFinite(parsed) || parsed < 0) continue;

    if (key.startsWith('sim_labor_minutes_')) {
      laborMinutesOverrides.set(key.replace('sim_labor_minutes_', ''), parsed);
    }
    if (key.startsWith('sim_labor_rate_')) {
      laborRateOverridesCents.set(key.replace('sim_labor_rate_', ''), parsed * 100);
    }
  }

  return { laborMinutesOverrides, laborRateOverridesCents };
}

function simulatorTabParam(value: string | string[] | undefined): SimulatorTab {
  const raw = stringParam(value);
  if (raw === 'raw' || raw === 'supplies') return raw;
  return 'labor';
}

function unitCostInputValue(overrides: Map<string, number>, itemId: string) {
  const override = overrides.get(itemId);
  return typeof override === 'number' && Number.isFinite(override) ? String(Number((override / 100).toFixed(4))) : '';
}

function laborMinutesInputValue(overrides: Map<string, number>, productId: string) {
  const override = overrides.get(productId);
  return typeof override === 'number' && Number.isFinite(override) ? String(Number(override.toFixed(4))) : '';
}

function laborRateInputValue(overrides: Map<string, number>, productId: string) {
  const override = overrides.get(productId);
  return typeof override === 'number' && Number.isFinite(override) ? String(Number((override / 100).toFixed(4))) : '';
}

function unitMoney(value: number) {
  return `$${(Math.max(0, value) / 100).toFixed(4)}`;
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

function ReportNav({
  activeReport,
  reports,
  searchParams,
}: {
  activeReport: ReportId;
  reports: (typeof REPORTS)[number][];
  searchParams: URLSearchParams;
}) {
  return (
    <section className="card">
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {reports.map((report) => {
          const params = new URLSearchParams(searchParams);
          params.set('report', report.id);
          return (
            <Link
              key={report.id}
              href={`/admin/reports?${params.toString()}`}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                activeReport === report.id
                  ? 'border-teal-200 bg-teal-50 text-teal-900'
                  : 'border-slate-200 bg-white/70 text-slate-700 hover:border-teal-200 hover:text-teal-800'
              }`}
            >
              {report.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function MarginValue({ value }: { value: number }) {
  return <span className={value >= 0 ? 'text-teal-800' : 'text-rose-700'}>{percent(value).replace('+', '')}</span>;
}

function CogsSplitGrid({ current }: { current: ReturnType<typeof buildProfitabilityDashboard>['current'] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <StatTile label="Material COGS" value={money(current.materialCents)} detail="Coffee, bags, boxes, and tracked recipe inputs." />
      <StatTile label="Labor COGS" value={money(current.laborCents)} detail="Production labor snapshotted into finished goods." />
      <StatTile label="Fixed Packaging" value={money(current.fixedCents)} detail="Tape, labels, and legacy fixed recipe costs." />
      <StatTile label="Shipping COGS" value={money(current.shippingCogsCents)} detail="Required shipping cost allocated from shipped orders." />
      <StatTile label="Processing Fees" value={money(current.processingFeeCogsCents)} detail="2.99% plus 30 cents per shipped order." />
      <StatTile label="Donation COGS" value={money(current.donationCogsCents)} detail="Fixed 1% of shipped order revenue." />
    </div>
  );
}

function CenterProfitabilityTableHead() {
  return (
    <thead>
      <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        <th className="px-4 py-2">Center</th>
        <th className="px-4 py-2 text-right">Revenue</th>
        <th className="px-4 py-2 text-right">Material</th>
        <th className="px-4 py-2 text-right">Labor</th>
        <th className="px-4 py-2 text-right">Fixed</th>
        <th className="px-4 py-2 text-right">Shipping</th>
        <th className="px-4 py-2 text-right">Fees</th>
        <th className="px-4 py-2 text-right">Donation</th>
        <th className="px-4 py-2 text-right">Gross profit</th>
        <th className="px-4 py-2 text-right">Margin</th>
        <th className="px-4 py-2 text-right">Orders</th>
        <th className="px-4 py-2 text-right">AOV</th>
        <th className="px-4 py-2 text-right">Estimated lines</th>
      </tr>
    </thead>
  );
}

function CenterProfitabilityRows({ rows }: { rows: ProfitabilityCenterRows }) {
  return (
    <>
      {rows.map((row) => (
        <tr key={row.id} className="bg-white/65">
          <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.name}</td>
          <td className="px-4 py-3 text-right text-slate-700">{money(row.revenueCents)}</td>
          <td className="px-4 py-3 text-right text-slate-700">{money(row.materialCents)}</td>
          <td className="px-4 py-3 text-right text-slate-700">{money(row.laborCents)}</td>
          <td className="px-4 py-3 text-right text-slate-700">{money(row.fixedCents)}</td>
          <td className="px-4 py-3 text-right text-slate-700">{money(row.shippingCogsCents)}</td>
          <td className="px-4 py-3 text-right text-slate-700">{money(row.processingFeeCogsCents)}</td>
          <td className="px-4 py-3 text-right text-slate-700">{money(row.donationCogsCents)}</td>
          <td className={`px-4 py-3 text-right font-semibold ${row.grossProfitCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{money(row.grossProfitCents)}</td>
          <td className="px-4 py-3 text-right font-semibold"><MarginValue value={row.marginPercent} /></td>
          <td className="px-4 py-3 text-right text-slate-700">{number(row.orderCount)}</td>
          <td className="px-4 py-3 text-right text-slate-700">{money(row.averageOrderValueCents)}</td>
          <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{number(row.estimatedLineCount)}</td>
        </tr>
      ))}
    </>
  );
}

function CenterProfitabilityTable({ rows }: { rows: ProfitabilityCenterRows }) {
  if (!rows.length) return <EmptyState message="No shipped center profitability found for the selected range." />;

  const previewRows = rows.slice(0, ROW_LIMIT);
  const remainingRows = rows.slice(ROW_LIMIT);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[94rem] border-separate border-spacing-y-2 text-left text-sm">
          <CenterProfitabilityTableHead />
          <tbody>
            <CenterProfitabilityRows rows={previewRows} />
          </tbody>
        </table>
      </div>
      {remainingRows.length ? (
        <details className="rounded-xl border border-slate-200/70 bg-white/50">
          <summary className="cursor-pointer px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-950">Show all centers</p>
                <p className="mt-1 text-sm text-slate-500">
                  Showing the top {number(previewRows.length)} by gross profit. Expand to review {number(remainingRows.length)} more center{remainingRows.length === 1 ? '' : 's'}.
                </p>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                {number(rows.length)} centers
              </span>
            </div>
          </summary>
          <div className="border-t border-slate-200/70 px-4 pb-4 pt-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[94rem] border-separate border-spacing-y-2 text-left text-sm">
                <CenterProfitabilityTableHead />
                <tbody>
                  <CenterProfitabilityRows rows={remainingRows} />
                </tbody>
              </table>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ItemProfitabilityTable({ rows }: { rows: ReturnType<typeof buildProfitabilityDashboard>['itemRows'] }) {
  if (!rows.length) return <EmptyState message="No shipped item profitability found for the selected range." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[90rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Item</th>
            <th className="px-4 py-2 text-right">Units</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Rev/unit</th>
            <th className="px-4 py-2 text-right">Product COGS/unit</th>
            <th className="px-4 py-2 text-right">Shipping</th>
            <th className="px-4 py-2 text-right">Fees</th>
            <th className="px-4 py-2 text-right">Donation</th>
            <th className="px-4 py-2 text-right">Profit before order costs</th>
            <th className="px-4 py-2 text-right">Profit after COGS</th>
            <th className="px-4 py-2 text-right">Margin after COGS</th>
            <th className="px-4 py-2 text-right">Orders</th>
            <th className="px-4 py-2 text-right">Estimated lines</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.name}</td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.unitsSold)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.revenueCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.revenuePerUnitCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.productCogsPerUnitCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.shippingCogsCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.processingFeeCogsCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.donationCogsCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.grossProfitBeforeShippingCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{money(row.grossProfitBeforeShippingCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.grossProfitAfterShippingCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{money(row.grossProfitAfterShippingCents)}</td>
              <td className="px-4 py-3 text-right font-semibold"><MarginValue value={row.marginAfterShippingPercent} /></td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.orderCount)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{number(row.estimatedLineCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarginBridgeTable({ rows }: { rows: ReturnType<typeof buildProfitabilityDashboard>['marginBridgeRows'] }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="grid gap-3 rounded-xl border border-slate-200/70 bg-white/65 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
          <div>
            <p className="font-semibold text-slate-950">{row.label}</p>
            <p className="mt-1 text-slate-500">{row.detail}</p>
          </div>
          <p className={`text-right text-lg font-semibold ${row.effectCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{signedMoney(row.effectCents)}</p>
        </div>
      ))}
    </div>
  );
}

function ProductionCogsTable({ rows }: { rows: ReturnType<typeof buildProfitabilityDashboard>['productionRows'] }) {
  if (!rows.length) return <EmptyState message="No production runs found for the selected range." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[72rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Product</th>
            <th className="px-4 py-2">Produced</th>
            <th className="px-4 py-2 text-right">Qty</th>
            <th className="px-4 py-2 text-right">Actual cost</th>
            <th className="px-4 py-2 text-right">Estimated cost</th>
            <th className="px-4 py-2 text-right">Variance</th>
            <th className="px-4 py-2 text-right">Material</th>
            <th className="px-4 py-2 text-right">Labor</th>
            <th className="px-4 py-2 text-right">Fixed</th>
            <th className="px-4 py-2 text-right">Usage variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.productName}</td>
              <td className="px-4 py-3 text-slate-700">{dateLabel(row.producedAt, 'Unknown')}</td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.quantityProduced)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.actualCostCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.estimatedCostCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.varianceCents <= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{signedMoney(row.varianceCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.materialCostCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.laborCostCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.fixedCostCents)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{quantity(row.materialUsageVarianceQty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InventoryValueTable({ rows }: { rows: ReturnType<typeof buildProfitabilityDashboard>['inventoryRows'] }) {
  if (!rows.length) return <EmptyState message="No inventory value data found." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[62rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Item</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2 text-right">Qty on hand</th>
            <th className="px-4 py-2 text-right">Inventory value</th>
            <th className="px-4 py-2 text-right">Avg cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.name}</td>
              <td className="px-4 py-3 text-slate-700">{row.itemType.replaceAll('_', ' ')}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.quantityOnHand < 0 ? 'text-rose-700' : 'text-slate-700'}`}>{quantity(row.quantityOnHand)} {row.unitLabel}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.valueCents < 0 ? 'text-rose-700' : 'text-slate-950'}`}>{money(row.valueCents)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{money(row.averageUnitCostCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FixedExpenseTable({ rows }: { rows: ReturnType<typeof buildProfitabilityDashboard>['fixedExpenseComparisonRows'] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Expense</th>
            <th className="px-4 py-2 text-right">Recipe COGS used</th>
            <th className="px-4 py-2 text-right">Spend recorded</th>
            <th className="px-4 py-2 text-right">Spend variance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.label}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.imputedCogsCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.expenseSpendCents)}</td>
              <td className={`rounded-r-xl px-4 py-3 text-right font-semibold ${row.varianceCents <= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{signedMoney(row.varianceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function simulatorItemTypeLabel(value: string) {
  if (value === 'raw_coffee') return 'Raw coffee';
  if (value === 'material_supply' || value === 'supply') return 'Materials & supplies';
  return value.replaceAll('_', ' ');
}

function SimulatorInputTable({
  emptyMessage = 'No recipe material inputs were found for the selected shipped orders.',
  overrides,
  rows,
}: {
  emptyMessage?: string;
  overrides: Map<string, number>;
  rows: GrossProfitSimulatorInputRow[];
}) {
  if (!rows.length) return <EmptyState message={emptyMessage} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[84rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Input</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2 text-right">Usage</th>
            <th className="px-4 py-2 text-right">Current unit cost</th>
            <th className="px-4 py-2 text-right">Scenario unit cost</th>
            <th className="px-4 py-2 text-right">Override unit cost</th>
            <th className="px-4 py-2 text-right">Scenario COGS</th>
            <th className="px-4 py-2 text-right">Profit impact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3">
                <p className="font-semibold text-slate-950">{row.name}</p>
                <p className="mt-1 text-xs text-slate-500">{row.sku || `${number(row.productCount)} product${row.productCount === 1 ? '' : 's'}`}</p>
              </td>
              <td className="px-4 py-3 text-slate-700">{simulatorItemTypeLabel(row.itemType)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.quantityUsed)} {row.baseUnit}</td>
              <td className="px-4 py-3 text-right text-slate-700">{unitMoney(row.actualUnitCostCents)}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{unitMoney(row.simulatedUnitCostCents)}</td>
              <td className="px-4 py-3 text-right">
                <input
                  className="input ml-auto w-32 text-right"
                  name={`sim_item_${row.id}`}
                  placeholder={(row.actualUnitCostCents / 100).toFixed(4)}
                  step="0.0001"
                  min="0"
                  type="number"
                  defaultValue={unitCostInputValue(overrides, row.id)}
                />
              </td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.simulatedCostCents)}</td>
              <td className={`rounded-r-xl px-4 py-3 text-right font-semibold ${row.grossProfitImpactCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{signedMoney(row.grossProfitImpactCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimulatorLaborTable({
  laborMinutesOverrides,
  laborRateOverrides,
  rows,
}: {
  laborMinutesOverrides: Map<string, number>;
  laborRateOverrides: Map<string, number>;
  rows: GrossProfitSimulatorLaborRow[];
}) {
  if (!rows.length) return <EmptyState message="No products with shipped order lines were found for the selected simulator range." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[92rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Product</th>
            <th className="px-4 py-2 text-right">Units</th>
            <th className="px-4 py-2 text-right">Current minutes</th>
            <th className="px-4 py-2 text-right">Scenario minutes</th>
            <th className="px-4 py-2 text-right">Current rate/hr</th>
            <th className="px-4 py-2 text-right">Scenario rate/hr</th>
            <th className="px-4 py-2 text-right">Scenario labor COGS</th>
            <th className="px-4 py-2 text-right">Profit impact</th>
            <th className="px-4 py-2 text-right">Unpriced lines</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3">
                <p className="font-semibold text-slate-950">{row.name}</p>
                <p className="mt-1 text-xs text-slate-500">{number(row.lineCount)} shipped line{row.lineCount === 1 ? '' : 's'} - {money(row.revenueCents)} revenue</p>
              </td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.unitsSold)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{row.hasRecipe ? quantity(row.baselineLaborMinutes) : 'No recipe'}</td>
              <td className="px-4 py-3 text-right">
                <input
                  className="input ml-auto w-32 text-right"
                  disabled={!row.hasRecipe}
                  min="0"
                  name={`sim_labor_minutes_${row.id}`}
                  placeholder={row.hasRecipe ? String(Number(row.baselineLaborMinutes.toFixed(4))) : ''}
                  step="0.01"
                  type="number"
                  defaultValue={laborMinutesInputValue(laborMinutesOverrides, row.id)}
                />
              </td>
              <td className="px-4 py-3 text-right text-slate-700">{row.hasRecipe ? money(row.baselineLaborRateCents) : 'No recipe'}</td>
              <td className="px-4 py-3 text-right">
                <input
                  className="input ml-auto w-32 text-right"
                  disabled={!row.hasRecipe}
                  min="0"
                  name={`sim_labor_rate_${row.id}`}
                  placeholder={row.hasRecipe ? String(Number((row.baselineLaborRateCents / 100).toFixed(4))) : ''}
                  step="0.01"
                  type="number"
                  defaultValue={laborRateInputValue(laborRateOverrides, row.id)}
                />
              </td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.simulatedLaborCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.grossProfitImpactCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{signedMoney(row.grossProfitImpactCents)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{number(row.unresolvedLineCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimulatorProductTable({ rows }: { rows: GrossProfitSimulatorProductRow[] }) {
  if (!rows.length) return <EmptyState message="No simulated product rows found for the selected month." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[86rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Product</th>
            <th className="px-4 py-2 text-right">Units</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Actual GP</th>
            <th className="px-4 py-2 text-right">Scenario material</th>
            <th className="px-4 py-2 text-right">Scenario labor</th>
            <th className="px-4 py-2 text-right">Simulated GP</th>
            <th className="px-4 py-2 text-right">Profit impact</th>
            <th className="px-4 py-2 text-right">Unpriced lines</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.name}</td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.unitsSold)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.revenueCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.actualGrossProfitCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{money(row.actualGrossProfitCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.simulatedMaterialCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.simulatedLaborCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.simulatedGrossProfitCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{money(row.simulatedGrossProfitCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.grossProfitImpactCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{signedMoney(row.grossProfitImpactCents)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{number(row.unresolvedLineCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GrossProfitSimulatorReport({
  activeTab,
  centerId,
  dashboard,
  laborMinutesOverrides,
  laborRateOverrides,
  materialSupplyPercentDelta,
  monthValue,
  overrides,
  productId,
  rangeEndInput,
  rangeStartInput,
  rawCoffeePercentDelta,
  resetHref,
  salesRepId,
}: {
  activeTab: SimulatorTab;
  centerId?: string;
  dashboard: GrossProfitSimulatorDashboard;
  laborMinutesOverrides: Map<string, number>;
  laborRateOverrides: Map<string, number>;
  materialSupplyPercentDelta: number;
  monthValue: string;
  overrides: Map<string, number>;
  productId?: string;
  rangeEndInput: string;
  rangeStartInput: string;
  rawCoffeePercentDelta: number;
  resetHref: string;
  salesRepId?: string;
}) {
  const rawCoffeeRows = dashboard.inputRows.filter((row) => row.itemType === 'raw_coffee');
  const materialSupplyRows = dashboard.inputRows.filter((row) => row.itemType === 'material_supply' || row.itemType === 'supply');

  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Total Revenue" value={money(dashboard.revenueCents)} detail="Revenue stays fixed while scenario COGS move." />
        <StatTile label="Actual Gross Profit" value={money(dashboard.actualGrossProfitCents)} detail={`${percent(dashboard.actualMarginPercent).replace('+', '')} actual margin.`} />
        <StatTile label="Simulated Gross Profit" value={money(dashboard.simulatedGrossProfitCents)} detail={`${percent(dashboard.simulatedMarginPercent).replace('+', '')} simulated margin.`} />
        <StatTile label="Profit Change" value={signedMoney(dashboard.grossProfitChangeCents)} detail={`${number(dashboard.orderCount)} shipped order${dashboard.orderCount === 1 ? '' : 's'} in scenario.`} />
        <StatTile label="Material COGS" value={money(dashboard.simulatedMaterialCents)} detail={`${signedMoney(dashboard.simulatedMaterialCents - dashboard.actualMaterialCents)} versus actual material COGS.`} />
        <StatTile label="Labor COGS" value={money(dashboard.simulatedLaborCents)} detail={`${signedMoney(dashboard.simulatedLaborCents - dashboard.actualLaborCents)} versus actual labor COGS.`} />
        <StatTile label="Unpriced Lines" value={number(dashboard.unresolvedLineCount)} detail="Lines without a usable recipe remain unchanged." />
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Gross profit simulator"
          title="Labor and material what-if"
          subtitle="Revenue, fixed packaging, shipping, processing, and donation stay actual; the scenario changes recipe labor and material costs."
          action={dashboard.appliedOverrideCount ? <span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">{dashboard.appliedOverrideCount} override{dashboard.appliedOverrideCount === 1 ? '' : 's'}</span> : null}
        />
        <form>
          <input type="hidden" name="report" value="simulator" />
          <input type="hidden" name="month" value={monthValue} />
          <input type="hidden" name="rangeStart" value={rangeStartInput} />
          <input type="hidden" name="rangeEnd" value={rangeEndInput} />
          {productId ? <input type="hidden" name="product" value={productId} /> : null}
          {centerId ? <input type="hidden" name="center" value={centerId} /> : null}
          {salesRepId ? <input type="hidden" name="sales_rep" value={salesRepId} /> : null}

          <div className="space-y-5 [&:has(#sim-tab-labor:checked)_.sim-tab-label-labor]:border-teal-200 [&:has(#sim-tab-labor:checked)_.sim-tab-label-labor]:bg-teal-50 [&:has(#sim-tab-labor:checked)_.sim-tab-label-labor]:text-teal-900 [&:has(#sim-tab-raw:checked)_.sim-tab-label-raw]:border-teal-200 [&:has(#sim-tab-raw:checked)_.sim-tab-label-raw]:bg-teal-50 [&:has(#sim-tab-raw:checked)_.sim-tab-label-raw]:text-teal-900 [&:has(#sim-tab-supplies:checked)_.sim-tab-label-supplies]:border-teal-200 [&:has(#sim-tab-supplies:checked)_.sim-tab-label-supplies]:bg-teal-50 [&:has(#sim-tab-supplies:checked)_.sim-tab-label-supplies]:text-teal-900">
            <input className="peer/labor sr-only" id="sim-tab-labor" name="sim_tab" type="radio" value="labor" defaultChecked={activeTab === 'labor'} />
            <input className="peer/raw sr-only" id="sim-tab-raw" name="sim_tab" type="radio" value="raw" defaultChecked={activeTab === 'raw'} />
            <input className="peer/supplies sr-only" id="sim-tab-supplies" name="sim_tab" type="radio" value="supplies" defaultChecked={activeTab === 'supplies'} />

            <div className="grid gap-2 sm:grid-cols-3" role="tablist" aria-label="Simulator categories">
              <label
                className="sim-tab-label-labor cursor-pointer rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-center text-sm font-semibold text-slate-700 transition-colors hover:border-teal-200 hover:text-teal-800 peer-checked/labor:border-teal-200 peer-checked/labor:bg-teal-50 peer-checked/labor:text-teal-900"
                htmlFor="sim-tab-labor"
              >
                Labor
              </label>
              <label
                className="sim-tab-label-raw cursor-pointer rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-center text-sm font-semibold text-slate-700 transition-colors hover:border-teal-200 hover:text-teal-800 peer-checked/raw:border-teal-200 peer-checked/raw:bg-teal-50 peer-checked/raw:text-teal-900"
                htmlFor="sim-tab-raw"
              >
                Raw Materials
              </label>
              <label
                className="sim-tab-label-supplies cursor-pointer rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-center text-sm font-semibold text-slate-700 transition-colors hover:border-teal-200 hover:text-teal-800 peer-checked/supplies:border-teal-200 peer-checked/supplies:bg-teal-50 peer-checked/supplies:text-teal-900"
                htmlFor="sim-tab-supplies"
              >
                Materials & Supplies
              </label>
            </div>

            <div className="hidden space-y-5 peer-checked/labor:block">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <StatTile label="Labor Impact" value={signedMoney(dashboard.laborImpactCents)} detail={`${money(dashboard.laborScenarioCents)} scenario recipe labor COGS.`} />
                <StatTile label="Scenario Labor COGS" value={money(dashboard.simulatedLaborCents)} detail={`${signedMoney(dashboard.simulatedLaborCents - dashboard.actualLaborCents)} versus actual labor COGS.`} />
                <StatTile label="Labor Products" value={number(dashboard.laborRows.length)} detail="Products with shipped lines in this simulator scope." />
              </div>
              <SimulatorLaborTable rows={dashboard.laborRows} laborMinutesOverrides={laborMinutesOverrides} laborRateOverrides={laborRateOverrides} />
            </div>

            <div className="hidden space-y-5 peer-checked/raw:block">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Raw coffee change
                  <div className="relative">
                    <input className="input pr-9 text-right" name="sim_raw_delta" type="number" step="0.01" defaultValue={String(rawCoffeePercentDelta)} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
                  </div>
                </label>
                <StatTile label="Raw Coffee Impact" value={signedMoney(dashboard.rawCoffeeImpactCents)} detail={`${money(dashboard.rawCoffeeScenarioCents)} scenario raw coffee COGS.`} />
                <StatTile label="Raw Inputs" value={number(rawCoffeeRows.length)} detail="Raw coffee inputs used by selected shipped products." />
              </div>
              <SimulatorInputTable
                emptyMessage="No raw coffee inputs were found for the selected shipped orders."
                rows={rawCoffeeRows}
                overrides={overrides}
              />
            </div>

            <div className="hidden space-y-5 peer-checked/supplies:block">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Materials & supplies change
                  <div className="relative">
                    <input className="input pr-9 text-right" name="sim_material_delta" type="number" step="0.01" defaultValue={String(materialSupplyPercentDelta)} />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
                  </div>
                </label>
                <StatTile label="Supply Impact" value={signedMoney(dashboard.materialSupplyImpactCents)} detail={`${money(dashboard.materialSupplyScenarioCents)} scenario material COGS.`} />
                <StatTile label="Supply Inputs" value={number(materialSupplyRows.length)} detail="Materials and supplies used by selected shipped products." />
              </div>
              <SimulatorInputTable
                emptyMessage="No materials or supplies were found for the selected shipped orders."
                rows={materialSupplyRows}
                overrides={overrides}
              />
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Run simulation" pendingLabel="Running..." />
            <Link href={resetHref} className="btn-secondary w-full sm:w-auto">Clear simulation</Link>
          </div>
        </form>
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Product impact"
          title="Which products move gross profit"
          subtitle="Product rows keep actual revenue and non-simulated COGS, then apply labor and material scenarios from current recipes."
        />
        <SimulatorProductTable rows={dashboard.productRows} />
      </section>
    </>
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
  const currentAccess = await getCurrentAdminAccess();
  const canViewSalesReports = adminCanView(currentAccess.access, 'reports_sales');
  const canViewProfitabilityReports = adminCanView(currentAccess.access, 'reports_profitability');
  const allowedReports = REPORTS.filter((report) => (reportIsProfitability(report.id) ? canViewProfitabilityReports : canViewSalesReports));
  if (!allowedReports.length) {
    redirect('/admin/access-denied?section=reports');
  }

  const requestedReport = reportParam(searchParams?.report);
  const fallbackReport = allowedReports[0].id;
  const activeReport = allowedReports.some((report) => report.id === requestedReport) ? requestedReport : fallbackReport;
  if (activeReport !== requestedReport) {
    const redirectParams = paramsFromRecord(searchParams);
    redirectParams.set('report', activeReport);
    redirect(`/admin/reports?${redirectParams.toString()}`);
  }

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
  const salesReps = ((salesRepsResult.data ?? []) as AdminRow[]).sort((a, b) => adminLabel(a).localeCompare(adminLabel(b)));
  const requestedSalesRepId = stringParam(searchParams?.sales_rep);
  const selectedSalesRepId = currentAccess.isOwner && salesReps.some((admin) => admin.id === requestedSalesRepId) ? requestedSalesRepId : '';
  const centerScope = await getSalesScopedCenterIdsForAdmin({ current: currentAccess, selectedSalesProfileId: selectedSalesRepId, supabase });

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

  const ordersQuery = scopeCenterRelatedQueryForAdmin(
    supabase.from('orders').select('id,center_id,status,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,shipped_at').order('created_at', { ascending: false }).limit(20000),
    'center_id',
    centerScope
  );
  const centersQuery = scopeCentersForAdmin(
    supabase.from('centers').select('id,name,is_active,created_at').order('name', { ascending: true }),
    centerScope
  );

  const [
    ordersResult,
    orderItemsResult,
    centersResult,
    productsResult,
    inventoryItemsResult,
    inventoryLotsResult,
    reorderSettingsResult,
    productionRunsResult,
    productionRunInputsResult,
    shortageMovementsResult,
    nonInventoryExpensesResult,
    sampleBoxRunsResult,
    recipeResult,
  ] = await Promise.all([
    ordersQuery,
    supabase.from('order_items').select('id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents,shipping_boxes_used,cogs_material_cents,cogs_labor_cents,cogs_fixed_cents,cogs_tape_cents,cogs_shipping_label_cents,cogs_branding_label_cents,cogs_fixed_other_cents,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_unit_cents,cogs_source,cogs_estimated,cogs_snapshot_at').limit(50000),
    centersQuery,
    supabase.from('products').select('id,name,sku,category,active').order('name', { ascending: true }),
    supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,product_id,active').order('name', { ascending: true }),
    supabase.from('inventory_lots').select('inventory_item_id,quantity_remaining,unit_cost_cents,received_at,created_at').limit(50000),
    supabase.from('inventory_reorder_settings').select('inventory_item_id,reorder_point,target_stock,lead_time_days'),
    supabase.from('production_runs').select('id,product_id,quantity_produced,estimated_unit_cost_cents,actual_unit_cost_cents,actual_labor_cost_cents,fixed_cost_cents,fixed_tape_cost_cents,fixed_shipping_label_cost_cents,fixed_branding_label_cost_cents,fixed_other_cost_cents,produced_at').order('produced_at', { ascending: false }).limit(50000),
    supabase.from('production_run_inputs').select('production_run_id,quantity_expected,quantity_used,cost_cents').limit(50000),
    supabase.from('inventory_movements').select('inventory_item_id,quantity_change,unit_cost_cents').in('movement_type', ['shipment_consume', 'sample_box_consume']).is('lot_id', null).limit(50000),
    supabase.from('non_inventory_expenses').select('expense_type,amount_cents,spent_at').limit(50000),
    supabase
      .from('sample_box_runs')
      .select('id,center_id,sales_profile_id,quantity_boxes,inventory_cogs_cents,product_cogs_cents,fixed_shipping_cents,fixed_misc_cents,total_cogs_cents,cogs_estimated,sent_at')
      .gte('sent_at', rangeStart.toISOString())
      .lt('sent_at', rangeEndExclusive.toISOString())
      .limit(50000),
    supabase
      .from('product_recipes')
      .select('product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,product_recipe_components(inventory_item_id,quantity,unit,component_role,inventory_items(id,name,sku,item_type,base_unit))')
      .limit(50000),
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
    shortageMovements: shortageMovementsResult.error ? [] : ((shortageMovementsResult.data ?? []) as ReportingInventoryMovementRow[]),
    now,
    orderItems: (orderItemsResult.data ?? []) as ReportingOrderItemRow[],
    orders: (ordersResult.data ?? []) as ReportingOrderRow[],
    products,
    reorderSettings: reorderSettingsResult.error ? [] : ((reorderSettingsResult.data ?? []) as ReportingReorderSettingRow[]),
  });
  const profitabilityDashboard = buildProfitabilityDashboard({
    centerId,
    centers,
    inventoryItems: inventoryUnavailable ? [] : ((inventoryItemsResult.data ?? []) as any[]),
    inventoryLots: inventoryUnavailable ? [] : ((inventoryLotsResult.data ?? []) as any[]),
    nonInventoryExpenses: nonInventoryExpensesResult.error ? [] : ((nonInventoryExpensesResult.data ?? []) as any[]),
    orderItems: (orderItemsResult.data ?? []) as ProfitabilityOrderItemRow[],
    orders: (ordersResult.data ?? []) as ProfitabilityOrderRow[],
    productId,
    productionRunInputs: productionRunInputsResult.error ? [] : ((productionRunInputsResult.data ?? []) as any[]),
    productionRuns: productionRunsResult.error ? [] : ((productionRunsResult.data ?? []) as any[]),
    products,
    rangeEndExclusive,
    rangeStart,
    shortageMovements: shortageMovementsResult.error ? [] : ((shortageMovementsResult.data ?? []) as any[]),
  });
  const rawCoffeePercentDelta = simulatorPercentParam(searchParams?.sim_raw_delta);
  const materialSupplyPercentDelta = simulatorPercentParam(searchParams?.sim_material_delta);
  const itemUnitCostOverrides = simulatorUnitCostOverrides(searchParams);
  const { laborMinutesOverrides, laborRateOverridesCents } = simulatorLaborOverrides(searchParams);
  const simulatorTab = simulatorTabParam(searchParams?.sim_tab);
  const simulatorDashboard = buildGrossProfitSimulator({
    actual: profitabilityDashboard.current,
    centers,
    inventoryItems: inventoryUnavailable ? [] : ((inventoryItemsResult.data ?? []) as any[]),
    inventoryLots: inventoryUnavailable ? [] : ((inventoryLotsResult.data ?? []) as any[]),
    orderItems: (orderItemsResult.data ?? []) as ProfitabilityOrderItemRow[],
    orders: (ordersResult.data ?? []) as ProfitabilityOrderRow[],
    params: {
      centerId,
      itemUnitCostOverridesCents: itemUnitCostOverrides,
      laborMinutesOverrides,
      laborRateOverridesCents,
      materialSupplyPercentDelta,
      productId,
      rangeEndExclusive,
      rangeStart,
      rawCoffeePercentDelta,
    },
    products,
    recipes: recipeResult.error ? [] : ((recipeResult.data ?? []) as any[]),
  });
  const sampleBoxRuns = (sampleBoxRunsResult.error ? [] : (sampleBoxRunsResult.data ?? []) as Array<{
    center_id: string | null;
    cogs_estimated: boolean | null;
    fixed_misc_cents: number | string | null;
    fixed_shipping_cents: number | string | null;
    inventory_cogs_cents: number | string | null;
    product_cogs_cents: number | string | null;
    quantity_boxes: number | string;
    sales_profile_id: string | null;
    total_cogs_cents: number | string | null;
  }>).filter((run) => {
    if (selectedSalesRepId && run.sales_profile_id !== selectedSalesRepId) return false;
    if (!currentAccess.isOwner && run.sales_profile_id !== currentAccess.profile.id) return false;
    if (centerScope !== null && run.center_id && !centerScope.includes(run.center_id)) return false;
    return true;
  });
  const sampleBoxSummary = sampleBoxRuns.reduce(
    (summary, run) => {
      summary.boxes += normalizeReportNumber(run.quantity_boxes);
      summary.inventoryCents += normalizeReportNumber(run.inventory_cogs_cents);
      summary.productCents += normalizeReportNumber(run.product_cogs_cents);
      summary.fixedCents += normalizeReportNumber(run.fixed_shipping_cents) + normalizeReportNumber(run.fixed_misc_cents);
      summary.totalCents += normalizeReportNumber(run.total_cogs_cents);
      if (run.cogs_estimated) summary.estimatedCount += 1;
      return summary;
    },
    { boxes: 0, estimatedCount: 0, fixedCents: 0, inventoryCents: 0, productCents: 0, totalCents: 0 }
  );
  const rangeEndInput = formatDateInput(addDays(rangeEndExclusive, -1));
  const activeFilterCount = [productId, centerId, selectedSalesRepId, parsedRangeStart, parsedRangeEnd].filter(Boolean).length;
  const navParams = new URLSearchParams();
  navParams.set('report', activeReport);
  navParams.set('month', formatMonthInput(selectedMonth));
  navParams.set('rangeStart', formatDateInput(rangeStart));
  navParams.set('rangeEnd', rangeEndInput);
  if (productId) navParams.set('product', productId);
  if (centerId) navParams.set('center', centerId);
  if (selectedSalesRepId) navParams.set('sales_rep', selectedSalesRepId);
  const simulatorResetParams = new URLSearchParams(navParams);
  simulatorResetParams.set('report', 'simulator');
  const simulatorResetHref = `/admin/reports?${simulatorResetParams.toString()}`;
  const reportsTitle = canViewProfitabilityReports
    ? 'Profitability, COGS, sales, and inventory reporting.'
    : 'Sales and customer reporting.';
  const reportsSubtitle = canViewProfitabilityReports
    ? 'Start with margin by center and item, then drill into production costs, inventory value, expenses, and customer sales history.'
    : 'Track revenue, order pace, product movement, customer activity, reorder timing, and demand planning.';

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-end">
          <div>
            <span className="eyebrow">Reports</span>
            <h1 className="page-title mt-4">{reportsTitle}</h1>
            <p className="page-subtitle mt-3">{reportsSubtitle}</p>
          </div>
          <form className="rounded-xl border border-slate-200/70 bg-white/60 p-4">
            <input type="hidden" name="report" value={activeReport} />
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
              {currentAccess.isOwner ? (
                <label className="space-y-2 text-sm font-medium text-slate-700 sm:col-span-2">
                  Sales rep
                  <select className="input" name="sales_rep" defaultValue={selectedSalesRepId}>
                    <option value="">All sales reps</option>
                    {salesReps.map((admin) => (
                      <option key={admin.id} value={admin.id}>{adminLabel(admin)}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Update reports" pendingLabel="Updating..." />
              <Link href={`/admin/reports?report=${activeReport}`} className="btn-secondary w-full sm:w-auto">Reset</Link>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              {REPORTS.find((report) => report.id === activeReport)?.label}. Using {dateLabel(rangeStart)} through {dateLabel(addDays(rangeEndExclusive, -1))}; sales comparisons still compare {monthLabel(selectedMonth)} with {monthLabel(dashboard.previousMonthStart)}.
            </p>
          </form>
        </div>
      </section>

      <ReportNav activeReport={activeReport} reports={allowedReports} searchParams={navParams} />

      {!dashboard.hasOrders ? (
        <section className="card">
          <EmptyState message="No orders found yet. Reports will populate as wholesale orders are placed." />
        </section>
      ) : null}

      {activeReport === 'overview' ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Revenue" value={money(profitabilityDashboard.current.revenueCents)} detail={`${number(profitabilityDashboard.current.orderCount)} shipped order${profitabilityDashboard.current.orderCount === 1 ? '' : 's'} in range.`} />
            <StatTile label="Product COGS" value={money(profitabilityDashboard.current.productCogsCents)} detail="Material, labor, and fixed production COGS." />
            <StatTile label="Shipping COGS" value={money(profitabilityDashboard.current.shippingCogsCents)} detail="Order shipping cost allocated to lines." />
            <StatTile label="Processing Fees" value={money(profitabilityDashboard.current.processingFeeCogsCents)} detail="Payment processing COGS on shipped orders." />
            <StatTile label="Donation COGS" value={money(profitabilityDashboard.current.donationCogsCents)} detail="Fixed 1% of shipped order revenue." />
            <StatTile label="Gross Profit" value={money(profitabilityDashboard.current.grossProfitCents)} detail={`${profitabilityDashboard.current.estimatedLineCount} estimated line${profitabilityDashboard.current.estimatedLineCount === 1 ? '' : 's'} in this range.`} />
            <StatTile label="Margin" value={`${percent(profitabilityDashboard.current.marginPercent).replace('+', '')}`} detail={`${signedMoney(profitabilityDashboard.current.grossProfitCents - profitabilityDashboard.previous.grossProfitCents)} vs previous range.`} />
          </section>
          <section className="card space-y-5">
            <SectionHeading
              eyebrow="COGS split"
              title="Where product cost is landing"
              subtitle="COGS comes from shipped order item snapshots; older shipped lines without snapshots are marked as estimated."
            />
            <CogsSplitGrid current={profitabilityDashboard.current} />
          </section>
          <section className="grid gap-5 xl:grid-cols-2">
            <div className="card space-y-5">
              <SectionHeading eyebrow="Best centers" title="Top center profit" subtitle="Highest gross profit after product, shipping, processing, and donation COGS." />
              <CenterProfitabilityTable rows={profitabilityDashboard.centerRows.slice(0, 6)} />
            </div>
            <div className="card space-y-5">
              <SectionHeading eyebrow="Best items" title="Top item profit" subtitle="Highest gross profit after allocated shipping." />
              <ItemProfitabilityTable rows={profitabilityDashboard.itemRows.slice(0, 6)} />
            </div>
          </section>
        </>
      ) : null}

      {activeReport === 'centers' ? (
        <section className="card space-y-5">
          <SectionHeading
            eyebrow="Center profitability"
            title="Profit by customer or center"
            subtitle="Revenue, COGS split, shipping COGS, gross profit, margin, order count, and estimated line visibility."
          />
          <CenterProfitabilityTable rows={profitabilityDashboard.centerRows} />
        </section>
      ) : null}

      {activeReport === 'items' ? (
        <section className="card space-y-5">
          <SectionHeading
            eyebrow="Item profitability"
            title="Profit by product"
            subtitle="Item-level revenue, product COGS before shipping, allocated shipping COGS, profit, and margin."
          />
          <ItemProfitabilityTable rows={profitabilityDashboard.itemRows} />
        </section>
      ) : null}

      {activeReport === 'margin' ? (
        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="card space-y-5">
            <SectionHeading
              eyebrow="Margin bridge"
              title="Where did margin go?"
              subtitle="Compares this selected range against the immediately previous range of the same length."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile label="Current Profit" value={money(profitabilityDashboard.current.grossProfitCents)} detail={`${percent(profitabilityDashboard.current.marginPercent).replace('+', '')} current margin.`} />
              <StatTile label="Previous Profit" value={money(profitabilityDashboard.previous.grossProfitCents)} detail={`${percent(profitabilityDashboard.previous.marginPercent).replace('+', '')} previous margin.`} />
            </div>
          </div>
          <div className="card space-y-5">
            <SectionHeading eyebrow="Profit movement" title={signedMoney(profitabilityDashboard.current.grossProfitCents - profitabilityDashboard.previous.grossProfitCents)} subtitle="Positive numbers helped gross profit; negative numbers pulled it down." />
            <MarginBridgeTable rows={profitabilityDashboard.marginBridgeRows} />
          </div>
        </section>
      ) : null}

      {activeReport === 'simulator' ? (
        <GrossProfitSimulatorReport
          activeTab={simulatorTab}
          centerId={centerId}
          dashboard={simulatorDashboard}
          laborMinutesOverrides={laborMinutesOverrides}
          laborRateOverrides={laborRateOverridesCents}
          materialSupplyPercentDelta={materialSupplyPercentDelta}
          monthValue={formatMonthInput(selectedMonth)}
          overrides={itemUnitCostOverrides}
          productId={productId}
          rangeEndInput={rangeEndInput}
          rangeStartInput={formatDateInput(rangeStart)}
          rawCoffeePercentDelta={rawCoffeePercentDelta}
          resetHref={simulatorResetHref}
          salesRepId={selectedSalesRepId}
        />
      ) : null}

      {activeReport === 'production' ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Runs" value={number(profitabilityDashboard.productionSummary.runCount)} detail={`${quantity(profitabilityDashboard.productionSummary.quantityProduced)} finished units produced.`} />
            <StatTile label="Actual COGS" value={money(profitabilityDashboard.productionSummary.actualCostCents)} detail="Total actual cost snapshotted into production lots." />
            <StatTile label="Estimated COGS" value={money(profitabilityDashboard.productionSummary.estimatedCostCents)} detail="Expected recipe cost before actual usage." />
            <StatTile label="Variance" value={signedMoney(profitabilityDashboard.productionSummary.varianceCents)} detail="Actual production cost minus estimate." />
            <StatTile label="Labor" value={money(profitabilityDashboard.productionSummary.laborCostCents)} detail={`${money(profitabilityDashboard.productionSummary.fixedCostCents)} fixed packaging in runs.`} />
          </section>
          <section className="card space-y-5">
            <SectionHeading
              eyebrow="Production & COGS"
              title="Expected versus actual run cost"
              subtitle="Shows actual production cost, estimated recipe cost, labor, fixed packaging, and material usage variance."
            />
            <ProductionCogsTable rows={profitabilityDashboard.productionRows} />
          </section>
        </>
      ) : null}

      {activeReport === 'inventory' ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Raw Coffee Value" value={money(profitabilityDashboard.inventorySummary.rawCoffeeValueCents)} detail="Remaining raw coffee lot value." />
            <StatTile label="Materials Value" value={money(profitabilityDashboard.inventorySummary.materialSupplyValueCents)} detail="Tracked materials and supplies on hand." />
            <StatTile label="Sellable Value" value={money(profitabilityDashboard.inventorySummary.sellableValueCents)} detail="Finished goods value including negative shipment and sample shortages." />
            <StatTile label="Negative Items" value={number(profitabilityDashboard.inventorySummary.negativeSellableCount)} detail="Sellable products below zero on hand." />
            <StatTile label="Sample Box COGS" value={money(sampleBoxSummary.totalCents)} detail={`${quantity(sampleBoxSummary.boxes)} sample boxes; shown as prospecting expense only.`} />
          </section>
          <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="card space-y-5">
              <SectionHeading
                eyebrow="Inventory value"
                title="Stock value by item"
                subtitle="Raw coffee, materials, and sellable inventory stay separated; sellable items can show negative when shipped short."
              />
              <InventoryValueTable rows={profitabilityDashboard.inventoryRows} />
            </div>
            <div className="card space-y-5">
              <SectionHeading
                eyebrow="Non-inventory expenses"
                title="Spend versus recipe-imputed COGS"
                subtitle="Tape and labels are visible as spend, but not deducted again from gross margin."
              />
              <FixedExpenseTable rows={profitabilityDashboard.fixedExpenseComparisonRows} />
            </div>
          </section>
          <section className="card space-y-5">
            <SectionHeading
              eyebrow="Sample / Prospecting Expense"
              title="Sample box COGS"
              subtitle="Sample boxes consume inventory and finished products, but stay separate from shipped-order gross margin and commissions."
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <StatTile label="Total Sample COGS" value={money(sampleBoxSummary.totalCents)} detail={`${sampleBoxSummary.estimatedCount} estimated sample line${sampleBoxSummary.estimatedCount === 1 ? '' : 's'} in range.`} />
              <StatTile label="Coffee & Materials" value={money(sampleBoxSummary.inventoryCents)} detail="Raw coffee and packaging consumed FIFO." />
              <StatTile label="Finished Products" value={money(sampleBoxSummary.productCents)} detail="Included products and special add-ons." />
              <StatTile label="Fixed Costs" value={money(sampleBoxSummary.fixedCents)} detail="Sample shipping and miscellaneous costs." />
              <StatTile label="Boxes Sent" value={quantity(sampleBoxSummary.boxes)} detail="Sample boxes recorded in the selected range." />
            </div>
          </section>
        </>
      ) : null}

      {activeReport === 'sales' ? (
        <>
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
        </>
      ) : null}
    </div>
  );
}

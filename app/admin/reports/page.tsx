import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import { getSalesScopedCenterIdsForAdmin, scopeCenterRelatedQueryForAdmin, scopeCentersForAdmin } from '@/lib/admin-center-scope';
import { adminCanView, requireAdminSectionView } from '@/lib/admin-permissions';
import { dataNeedsForReport, type AdminReportId } from '@/lib/admin-report-data-needs';
import {
  ADMIN_QUERY_ROW_LIMIT,
  limitReportDetailRows,
  queryReachedAdminRowLimit,
  REPORT_DETAIL_ROW_LIMIT,
} from '@/lib/admin-query-limits';
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
  centralDateInput,
  emptyProspectingReportAggregate,
  formatRatePercent,
  formatRateWithRatio,
  normalizeProspectingReportAggregate,
  rate,
  type AuthorizedProspectingReportScope,
  type ProspectingReportAggregate,
} from '@/lib/prospecting-reporting';
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
import { stageLabel, type ProspectingStage } from '@/lib/prospecting';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { logServerTiming } from '@/lib/server-performance';
import { convertInventoryQuantity } from '@/lib/inventory';
import { usd } from '@/lib/utils';

const ROW_LIMIT = 12;
const REPORTS = [
  { id: 'overview', label: 'Profitability Overview' },
  { id: 'centers', label: 'Center Profitability' },
  { id: 'items', label: 'Item Profitability' },
  { id: 'margin', label: 'Margin Health' },
  { id: 'simulator', label: 'Gross Profit Simulator' },
  { id: 'production', label: 'Production & COGS' },
  { id: 'inventory', label: 'Inventory Value & Expenses' },
  { id: 'sales', label: 'Sales & Customers' },
  { id: 'prospecting', label: 'Prospecting' },
] as const;

type ReportId = AdminReportId;
type SimulatorTab = 'labor' | 'raw' | 'supplies';

function skippedReportQuery() {
  return Promise.resolve({ data: [] as any[], error: null });
}

type AdminRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

type ProfitabilityCenterRows = ReturnType<typeof buildProfitabilityDashboard>['centerRows'];
type ProfitabilityItemRows = ReturnType<typeof buildProfitabilityDashboard>['itemRows'];

type CoffeeSoldInventoryItemRow = {
  id: string;
  name: string | null;
  sku?: string | null;
  item_type?: string | null;
  base_unit?: string | null;
};

type CoffeeSoldRecipeComponentRow = {
  component_role?: string | null;
  inventory_item_id: string;
  inventory_items?: CoffeeSoldInventoryItemRow | CoffeeSoldInventoryItemRow[] | null;
  quantity: number | string | null;
  unit: string | null;
};

type CoffeeSoldRecipeRow = {
  output_qty: number | string | null;
  product_id: string;
  product_recipe_components?: CoffeeSoldRecipeComponentRow[] | null;
};

type CoffeeSoldByRawMaterialRow = {
  id: string;
  label: string;
  lineCount: number;
  poundsSold: number;
  productCount: number;
};

type CoffeeSoldByRawMaterialSummary = {
  rows: CoffeeSoldByRawMaterialRow[];
  totalPoundsSold: number;
  unweightedLineCount: number;
  weightedLineCount: number;
};

const RAW_COFFEE_BUCKETS = [
  { id: 'fourth_dimension_medium', label: '4th Dimension Medium' },
  { id: 'meeting_coffee_medium', label: 'Meeting Coffee Medium' },
  { id: 'meeting_coffee_dark', label: 'Meeting Coffee Dark' },
] as const;

function reportIsProfitability(reportId: ReportId) {
  return reportId !== 'sales' && reportId !== 'prospecting';
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

function compactNumber(value: number) {
  return number(value, value % 1 === 0 ? 0 : 1);
}

function normalizeReportNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function simulatorPercentParam(value: string | string[] | undefined) {
  const parsed = Number.parseFloat(stringParam(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function simulatorPricePerPoundParam(value: string | string[] | undefined) {
  const rawValue = stringParam(value).trim();
  if (!rawValue) return undefined;
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed * 100 : undefined;
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

function pricePerPoundInputValue(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? String(Number((value / 100).toFixed(4))) : '';
}

function PercentInput({ defaultValue, name }: { defaultValue: number; name: string }) {
  return (
    <div className="relative">
      <input
        className="input pr-12 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        name={name}
        type="number"
        step="0.01"
        defaultValue={String(defaultValue)}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
    </div>
  );
}

function unitMoney(value: number) {
  return `$${(Math.max(0, value) / 100).toFixed(4)}`;
}

function quantity(value: number) {
  return number(value, value % 1 === 0 ? 0 : 1);
}

function pounds(value: number) {
  return number(value, value % 1 === 0 ? 0 : 2);
}

function percent(value: number) {
  return `${value > 0 ? '+' : ''}${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}%`;
}

function prospectingStageTone(stage: ProspectingStage) {
  const classes: Record<ProspectingStage, string> = {
    converted: 'bg-emerald-50 text-emerald-800 ring-emerald-100',
    follow_up: 'bg-amber-50 text-amber-800 ring-amber-100',
    interested: 'bg-teal-50 text-teal-800 ring-teal-100',
    lost: 'bg-rose-50 text-rose-800 ring-rose-100',
    new: 'bg-slate-100 text-slate-700 ring-slate-200',
    not_a_fit: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
    recycle_try_later: 'bg-sky-50 text-sky-800 ring-sky-100',
    sample_requested: 'bg-indigo-50 text-indigo-800 ring-indigo-100',
    working: 'bg-blue-50 text-blue-800 ring-blue-100',
  };
  return classes[stage];
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

const UNKNOWN_REP_ID = '__unknown_rep__';
const UNASSIGNED_REP_ID = '__unassigned_rep__';

function reportDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rawCoffeeBucketForItem(item: CoffeeSoldInventoryItemRow | null) {
  const sku = item?.sku?.toUpperCase() ?? '';
  const name = item?.name?.toLowerCase() ?? '';
  if (sku === 'RAW-COF-FD-MED' || ((name.includes('fourth dimension') || name.includes('4th dimension')) && name.includes('medium'))) {
    return RAW_COFFEE_BUCKETS[0];
  }
  if (sku === 'RAW-COF-MTC-MED' || (name.includes('meeting coffee') && name.includes('medium'))) {
    return RAW_COFFEE_BUCKETS[1];
  }
  if (sku === 'RAW-COF-MTC-DRK' || (name.includes('meeting coffee') && name.includes('dark'))) {
    return RAW_COFFEE_BUCKETS[2];
  }
  const fallbackLabel = item?.name?.replace(/^Raw Coffee\s*-\s*/i, '').trim() || 'Other Raw Coffee';
  return { id: `other_${item?.id ?? fallbackLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, label: fallbackLabel };
}

function recipeRawCoffeePoundsByBucket(recipe: CoffeeSoldRecipeRow | undefined) {
  if (!recipe) return [];
  const outputQty = normalizeReportNumber(recipe.output_qty) || 1;
  const rows: Array<{ bucket: { id: string; label: string }; poundsPerUnit: number }> = [];

  for (const component of recipe.product_recipe_components ?? []) {
    const inventoryItem = relatedOne(component.inventory_items);
    const itemType = inventoryItem?.item_type === 'supply' ? 'material_supply' : inventoryItem?.item_type;
    const isRawCoffee = component.component_role === 'raw_coffee' || itemType === 'raw_coffee';
    if (!isRawCoffee) continue;

    try {
      const rawCoffeePounds = convertInventoryQuantity(normalizeReportNumber(component.quantity), component.unit ?? 'lb', 'lb');
      if (rawCoffeePounds > 0 && outputQty > 0) {
        rows.push({
          bucket: rawCoffeeBucketForItem(inventoryItem),
          poundsPerUnit: rawCoffeePounds / outputQty,
        });
      }
    } catch {
      // Keep report rendering resilient if an old recipe has an unsupported unit.
    }
  }

  return rows;
}

function buildCoffeeSoldByRawMaterialSummary({
  centerId,
  orderItems,
  orders,
  productId,
  rangeEndExclusive,
  rangeStart,
  recipes,
}: {
  centerId?: string;
  orderItems: ProfitabilityOrderItemRow[];
  orders: ProfitabilityOrderRow[];
  productId?: string;
  rangeEndExclusive: Date;
  rangeStart: Date;
  recipes: CoffeeSoldRecipeRow[];
}): CoffeeSoldByRawMaterialSummary {
  const itemsByOrderId = new Map<string, ProfitabilityOrderItemRow[]>();
  for (const item of orderItems) {
    const rows = itemsByOrderId.get(item.order_id) ?? [];
    rows.push(item);
    itemsByOrderId.set(item.order_id, rows);
  }

  const recipeByProductId = new Map(recipes.map((recipe) => [recipe.product_id, recipe]));
  const rowsByBucket = new Map<string, CoffeeSoldByRawMaterialRow & { productIds: Set<string> }>();
  for (const bucket of RAW_COFFEE_BUCKETS) {
    rowsByBucket.set(bucket.id, { ...bucket, lineCount: 0, poundsSold: 0, productCount: 0, productIds: new Set<string>() });
  }

  let unweightedLineCount = 0;
  let weightedLineCount = 0;

  for (const order of orders) {
    if (order.status !== 'Shipped') continue;
    const orderDate = reportDate(order.shipped_at) ?? reportDate(order.created_at);
    if (!orderDate || orderDate < rangeStart || orderDate >= rangeEndExclusive) continue;
    if (centerId && order.center_id !== centerId) continue;

    for (const item of itemsByOrderId.get(order.id) ?? []) {
      const qty = normalizeReportNumber(item.qty);
      if (qty <= 0) continue;
      if (productId && item.product_id !== productId) continue;

      const rawCoffeeRows = item.product_id ? recipeRawCoffeePoundsByBucket(recipeByProductId.get(item.product_id)) : [];
      if (!rawCoffeeRows.length) {
        unweightedLineCount += 1;
        continue;
      }

      weightedLineCount += 1;
      for (const rawCoffeeRow of rawCoffeeRows) {
        const row = rowsByBucket.get(rawCoffeeRow.bucket.id) ?? {
          id: rawCoffeeRow.bucket.id,
          label: rawCoffeeRow.bucket.label,
          lineCount: 0,
          poundsSold: 0,
          productCount: 0,
          productIds: new Set<string>(),
        };
        row.lineCount += 1;
        row.poundsSold += rawCoffeeRow.poundsPerUnit * qty;
        if (item.product_id) {
          row.productIds.add(item.product_id);
          row.productCount = row.productIds.size;
        }
        rowsByBucket.set(row.id, row);
      }
    }
  }

  const rows = [...rowsByBucket.values()]
    .map(({ productIds, ...row }) => row)
    .filter((row) => RAW_COFFEE_BUCKETS.some((bucket) => bucket.id === row.id) || row.poundsSold > 0)
    .sort((a, b) => {
      const aIndex = RAW_COFFEE_BUCKETS.findIndex((bucket) => bucket.id === a.id);
      const bIndex = RAW_COFFEE_BUCKETS.findIndex((bucket) => bucket.id === b.id);
      if (aIndex >= 0 || bIndex >= 0) return (aIndex >= 0 ? aIndex : 99) - (bIndex >= 0 ? bIndex : 99);
      return b.poundsSold - a.poundsSold || a.label.localeCompare(b.label);
    });

  return {
    rows,
    totalPoundsSold: rows.reduce((sum, row) => sum + row.poundsSold, 0),
    unweightedLineCount,
    weightedLineCount,
  };
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

function DetailRowLimitNotice({ total }: { total: number }) {
  if (total <= REPORT_DETAIL_ROW_LIMIT) return null;

  return (
    <p className="text-sm text-slate-500">
      Showing the first {REPORT_DETAIL_ROW_LIMIT.toLocaleString()} of {total.toLocaleString()} rows. Narrow the filters to inspect a smaller result set.
    </p>
  );
}

function SourceRowLimitNotice({ sources }: { sources: string[] }) {
  if (!sources.length) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-900" role="status">
      This report reached the 1,000-row safety limit for {sources.join(', ')}. Totals from those sources may be incomplete until database aggregate loaders are enabled.
    </section>
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

function ItemProfitabilityTableHead() {
  return (
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
  );
}

function ItemProfitabilityRows({ rows }: { rows: ProfitabilityItemRows }) {
  return (
    <>
      {rows.map((row) => (
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
    </>
  );
}

function ItemProfitabilityTable({ rows }: { rows: ProfitabilityItemRows }) {
  if (!rows.length) return <EmptyState message="No shipped item profitability found for the selected range." />;

  const previewRows = rows.slice(0, ROW_LIMIT);
  const remainingRows = rows.slice(ROW_LIMIT);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[90rem] border-separate border-spacing-y-2 text-left text-sm">
          <ItemProfitabilityTableHead />
          <tbody>
            <ItemProfitabilityRows rows={previewRows} />
          </tbody>
        </table>
      </div>
      {remainingRows.length ? (
        <details className="rounded-xl border border-slate-200/70 bg-white/50">
          <summary className="cursor-pointer px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-950">Show all products</p>
                <p className="mt-1 text-sm text-slate-500">
                  Showing the top {number(previewRows.length)} by profit after COGS. Expand to review {number(remainingRows.length)} more product{remainingRows.length === 1 ? '' : 's'}.
                </p>
              </div>
              <span className="w-fit rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                {number(rows.length)} products
              </span>
            </div>
          </summary>
          <div className="border-t border-slate-200/70 px-4 pb-4 pt-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[90rem] border-separate border-spacing-y-2 text-left text-sm">
                <ItemProfitabilityTableHead />
                <tbody>
                  <ItemProfitabilityRows rows={remainingRows} />
                </tbody>
              </table>
            </div>
          </div>
        </details>
      ) : null}
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

function metricValue(row: ReturnType<typeof buildProfitabilityDashboard>['marginHealth']['salesMetrics'][number], value: number) {
  if (row.format === 'currency') return money(value);
  if (row.format === 'percent') return `${number(value, 1)}%`;
  return number(value, 1);
}

function metricChange(row: ReturnType<typeof buildProfitabilityDashboard>['marginHealth']['salesMetrics'][number]) {
  if (row.format === 'currency') return signedMoney(row.changeValue);
  if (row.format === 'percent') return `${row.changeValue > 0 ? '+' : ''}${number(row.changeValue, 1)} pts`;
  return `${row.changeValue > 0 ? '+' : ''}${number(row.changeValue, 1)}`;
}

function impactTone(value: number) {
  return value >= 0 ? 'text-teal-800' : 'text-rose-700';
}

function MarginHealthMetricTable({
  rows,
}: {
  rows: ReturnType<typeof buildProfitabilityDashboard>['marginHealth']['salesMetrics'];
}) {
  if (!rows.length) return <EmptyState message="No margin health metrics found for the selected range." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[66rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Driver</th>
            <th className="px-4 py-2 text-right">Current</th>
            <th className="px-4 py-2 text-right">8-week baseline</th>
            <th className="px-4 py-2 text-right">Previous range</th>
            <th className="px-4 py-2 text-right">Change</th>
            <th className="px-4 py-2 text-right">Est. impact</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3">
                <p className="font-semibold text-slate-950">{row.label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{row.detail}</p>
              </td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{metricValue(row, row.currentValue)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{metricValue(row, row.baselineValue)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{metricValue(row, row.previousValue)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${impactTone(row.changeValue)}`}>{metricChange(row)}</td>
              <td className={`rounded-r-xl px-4 py-3 text-right font-semibold ${impactTone(row.estimatedImpactCents)}`}>{signedMoney(row.estimatedImpactCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarginLeakTable({
  emptyLabel,
  rows,
}: {
  emptyLabel: string;
  rows: ReturnType<typeof buildProfitabilityDashboard>['marginHealth']['productLeaks'];
}) {
  if (!rows.length) return <EmptyState message={emptyLabel} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[58rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Product or center</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Current margin</th>
            <th className="px-4 py-2 text-right">8-week margin</th>
            <th className="px-4 py-2 text-right">Change</th>
            <th className="px-4 py-2 text-right">Est. impact</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3">
                <p className="font-semibold text-slate-950">{row.label}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">{row.status === 'new' ? 'New in current range' : row.status}</p>
              </td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{money(row.currentRevenueCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.currentMarginPercent, 1)}%</td>
              <td className="px-4 py-3 text-right text-slate-700">{row.baselineMarginPercent === null ? 'New' : `${number(row.baselineMarginPercent, 1)}%`}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.marginPointChange === null ? 'text-slate-500' : impactTone(row.marginPointChange)}`}>
                {row.marginPointChange === null ? 'New' : `${row.marginPointChange > 0 ? '+' : ''}${number(row.marginPointChange, 1)} pts`}
              </td>
              <td className={`rounded-r-xl px-4 py-3 text-right font-semibold ${impactTone(row.estimatedImpactCents)}`}>{signedMoney(row.estimatedImpactCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CogsTimingGrid({
  centerId,
  productId,
  summary,
}: {
  centerId?: string;
  productId?: string;
  summary: ReturnType<typeof buildProfitabilityDashboard>['marginHealth']['cogsTiming'];
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile label="Shipped COGS" value={money(summary.shippedTotalCogsCents)} detail={`${money(summary.shippedProductCogsCents)} product COGS; ${money(summary.shippedLaborCogsCents)} labor recognized on shipped lines.`} />
        <StatTile label="Production COGS Created" value={money(summary.productionActualCogsCents)} detail={`${money(summary.productionLaborCogsCents)} labor created in production runs during the selected range.`} />
        <StatTile label="Finished Inventory Value" value={money(summary.inventoryFinishedValueCents)} detail={`${quantity(summary.netFinishedUnits)} net units; ${quantity(summary.positiveFinishedUnits)} units in positive lots.`} />
        <StatTile label="Labor Still In Inventory" value={money(summary.inventoryFinishedLaborCents)} detail="Estimated labor COGS currently held in finished-good inventory." />
        <StatTile label="Lotless Shortages" value={quantity(summary.lotlessShortageUnits)} detail="Shipment or sample consumption netted into visible inventory without an exact lot split." />
        <StatTile label="Timing Lens" value={summary.productionActualCogsCents > summary.shippedProductCogsCents ? 'Building' : 'Drawing down'} detail="Compares production COGS created to product COGS recognized on shipments." />
      </div>
      {summary.hasEstimatedInventoryLabor || centerId ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm leading-6 text-amber-900">
          {summary.hasEstimatedInventoryLabor ? 'Finished inventory labor includes an estimate where lotless shortage movements are netted against positive production lots. ' : ''}
          {centerId ? 'Production and inventory timing are not center-specific, so the center filter only affects shipped margin.' : ''}
          {productId ? 'The product filter is applied to shipped margin, production timing, and finished-good inventory timing.' : ''}
        </div>
      ) : null}
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

function CoffeeSoldByRawMaterialGrid({ summary }: { summary: CoffeeSoldByRawMaterialSummary }) {
  if (!summary.weightedLineCount) {
    return <EmptyState message="No shipped coffee pounds could be calculated for the selected range." />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label="Coffee Pounds Sold"
        value={`${pounds(summary.totalPoundsSold)} lb`}
        detail={`${number(summary.weightedLineCount)} weighted shipped line${summary.weightedLineCount === 1 ? '' : 's'}.`}
      />
      {summary.rows.map((row) => (
        <StatTile
          key={row.id}
          label={row.label}
          value={`${pounds(row.poundsSold)} lb`}
          detail={`${number(row.lineCount)} shipped line${row.lineCount === 1 ? '' : 's'} from ${number(row.productCount)} product${row.productCount === 1 ? '' : 's'}.`}
        />
      ))}
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
                <p className="mt-1 text-xs text-slate-500">
                  {row.sku ? `${row.sku} - ` : ''}{number(row.productCount)} product{row.productCount === 1 ? '' : 's'}
                </p>
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
                  placeholder={row.hasRecipe ? String(Number(row.simulatedLaborMinutes.toFixed(4))) : ''}
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
                  placeholder={row.hasRecipe ? String(Number((row.simulatedLaborRateCents / 100).toFixed(4))) : ''}
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
      <table className="w-full min-w-[104rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Product</th>
            <th className="px-4 py-2 text-right">Units</th>
            <th className="px-4 py-2 text-right">Pounds</th>
            <th className="px-4 py-2 text-right">Revenue</th>
            <th className="px-4 py-2 text-right">Scenario revenue</th>
            <th className="px-4 py-2 text-right">Actual GP</th>
            <th className="px-4 py-2 text-right">Scenario material/supply</th>
            <th className="px-4 py-2 text-right">Scenario labor</th>
            <th className="px-4 py-2 text-right">Simulated GP</th>
            <th className="px-4 py-2 text-right">Profit impact</th>
            <th className="px-4 py-2 text-right">Unweighted</th>
            <th className="px-4 py-2 text-right">Unpriced lines</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, ROW_LIMIT).map((row) => (
            <tr key={row.id} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{row.name}</td>
              <td className="px-4 py-3 text-right text-slate-700">{quantity(row.unitsSold)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{pounds(row.coffeePoundsSold)} lb</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.revenueCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.simulatedRevenueCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.actualGrossProfitCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{money(row.actualGrossProfitCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.simulatedMaterialCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{money(row.simulatedLaborCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.simulatedGrossProfitCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{money(row.simulatedGrossProfitCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold ${row.grossProfitImpactCents >= 0 ? 'text-teal-800' : 'text-rose-700'}`}>{signedMoney(row.grossProfitImpactCents)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.unweightedLineCount)}</td>
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
  laborPercentDelta,
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
  scenarioPricePerPoundCents,
}: {
  activeTab: SimulatorTab;
  centerId?: string;
  dashboard: GrossProfitSimulatorDashboard;
  laborPercentDelta: number;
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
  scenarioPricePerPoundCents?: number;
}) {
  const rawCoffeeRows = dashboard.inputRows.filter((row) => row.itemType === 'raw_coffee');
  const materialSupplyRows = dashboard.inputRows.filter((row) => row.itemType === 'material_supply' || row.itemType === 'supply');

  return (
    <>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatTile label="Total Revenue" value={money(dashboard.revenueCents)} detail={`${signedMoney(dashboard.revenueImpactCents)} scenario revenue change.`} />
        <StatTile label="Simulated Revenue" value={money(dashboard.simulatedRevenueCents)} detail="Weighted coffee lines use the scenario price per pound." />
        <StatTile label="Pounds Sold" value={`${pounds(dashboard.coffeePoundsSold)} lb`} detail={`${money(dashboard.weightedRevenueCents)} weighted coffee revenue.`} />
        <StatTile label="Avg Price / lb Sold" value={money(dashboard.actualPricePerPoundCents)} detail={`${number(dashboard.unweightedLineCount)} unweighted line${dashboard.unweightedLineCount === 1 ? '' : 's'}.`} />
        <StatTile label="Actual Gross Profit" value={money(dashboard.actualGrossProfitCents)} detail={`${percent(dashboard.actualMarginPercent).replace('+', '')} actual margin.`} />
        <StatTile label="Simulated Gross Profit" value={money(dashboard.simulatedGrossProfitCents)} detail={`${percent(dashboard.simulatedMarginPercent).replace('+', '')} simulated margin.`} />
        <StatTile label="Profit Change" value={signedMoney(dashboard.grossProfitChangeCents)} detail={`${number(dashboard.orderCount)} shipped order${dashboard.orderCount === 1 ? '' : 's'} in scenario.`} />
        <StatTile label="Material/Supply COGS" value={money(dashboard.simulatedMaterialSupplyCents)} detail={`${signedMoney(dashboard.simulatedMaterialSupplyCents - dashboard.actualMaterialSupplyCents)} versus actual material and box-supply COGS.`} />
        <StatTile label="Labor COGS" value={money(dashboard.simulatedLaborCents)} detail={`${signedMoney(dashboard.simulatedLaborCents - dashboard.actualLaborCents)} versus actual labor COGS.`} />
        <StatTile label="Unpriced Lines" value={number(dashboard.unresolvedLineCount)} detail="Lines without a usable recipe remain unchanged." />
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Gross profit simulator"
          title="Labor and material what-if"
          subtitle="Recipe labor minutes, material costs, shipping box supplies, and weighted coffee-line revenue can move; tape, labels, shipping, processing, donation, and unweighted revenue stay actual."
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
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Scenario price / lb sold
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
                  <input
                    className="input pl-7 text-right"
                    min="0"
                    name="sim_price_per_lb"
                    placeholder={dashboard.actualPricePerPoundCents > 0 ? String(Number((dashboard.actualPricePerPoundCents / 100).toFixed(2))) : ''}
                    step="0.01"
                    type="number"
                    defaultValue={pricePerPoundInputValue(scenarioPricePerPoundCents)}
                  />
                </div>
              </label>
              <StatTile label="Weighted Revenue" value={money(dashboard.weightedRevenueCents)} detail={`${pounds(dashboard.coffeePoundsSold)} lb from raw coffee recipes.`} />
              <StatTile label="Scenario Revenue Change" value={signedMoney(dashboard.revenueImpactCents)} detail={`${money(dashboard.simulatedRevenueCents)} simulated total revenue.`} />
              <StatTile label="Unweighted Lines" value={number(dashboard.unweightedLineCount)} detail="No raw coffee recipe weight found for price-per-pound." />
            </div>

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
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  All labor minutes change
                  <PercentInput name="sim_labor_delta" defaultValue={laborPercentDelta} />
                </label>
                <StatTile label="Labor Impact" value={signedMoney(dashboard.laborImpactCents)} detail={`${money(dashboard.laborScenarioCents)} scenario recipe labor COGS.`} />
                <StatTile label="Scenario Labor COGS" value={money(dashboard.simulatedLaborCents)} detail={`${signedMoney(dashboard.simulatedLaborCents - dashboard.actualLaborCents)} versus actual labor COGS.`} />
                <StatTile label="Labor Products" value={number(dashboard.laborRows.length)} detail="Products with shipped lines in this simulator scope." />
              </div>
              <SimulatorLaborTable rows={limitReportDetailRows(dashboard.laborRows)} laborMinutesOverrides={laborMinutesOverrides} laborRateOverrides={laborRateOverrides} />
              <DetailRowLimitNotice total={dashboard.laborRows.length} />
            </div>

            <div className="hidden space-y-5 peer-checked/raw:block">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Raw coffee change
                  <PercentInput name="sim_raw_delta" defaultValue={rawCoffeePercentDelta} />
                </label>
                <StatTile label="Raw Coffee Impact" value={signedMoney(dashboard.rawCoffeeImpactCents)} detail={`${money(dashboard.rawCoffeeScenarioCents)} scenario raw coffee COGS.`} />
                <StatTile label="Raw Inputs" value={number(rawCoffeeRows.length)} detail="Active raw inputs; shipped usage is shown in the table." />
              </div>
              <SimulatorInputTable
                emptyMessage="No active raw coffee inputs were found."
                rows={rawCoffeeRows}
                overrides={overrides}
              />
            </div>

            <div className="hidden space-y-5 peer-checked/supplies:block">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Materials & supplies change
                  <PercentInput name="sim_material_delta" defaultValue={materialSupplyPercentDelta} />
                </label>
                <StatTile label="Supply Impact" value={signedMoney(dashboard.materialSupplyImpactCents)} detail={`${money(dashboard.materialSupplyScenarioCents)} scenario material and box-supply COGS.`} />
                <StatTile label="Supply Inputs" value={number(materialSupplyRows.length)} detail="Active materials and supplies; shipped usage is shown in the table." />
              </div>
              <SimulatorInputTable
                emptyMessage="No active materials or supplies were found."
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
          subtitle="Product rows apply price-per-pound revenue, recipe-minute labor, material, and shipping-box supply scenarios while non-simulated COGS stay actual."
        />
        <SimulatorProductTable rows={limitReportDetailRows(dashboard.productRows)} />
        <DetailRowLimitNotice total={dashboard.productRows.length} />
      </section>
    </>
  );
}

function prospectingRepLabel(repId: string, profilesById: Map<string, AdminRow>) {
  if (repId === UNASSIGNED_REP_ID) return 'Unassigned';
  if (repId === UNKNOWN_REP_ID) return 'Unknown rep';
  return adminLabel(profilesById.get(repId));
}

function prospectingRate(numerator: number, denominator: number) {
  return formatRateWithRatio(rate(numerator, denominator));
}

function ProspectingRepTable({
  profilesById,
  rows,
}: {
  profilesById: Map<string, AdminRow>;
  rows: ProspectingReportAggregate['reps'];
}) {
  if (!rows.length) return <EmptyState message="No prospecting activity found for the selected period and rep filter." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[74rem] border-separate border-spacing-y-2 text-left text-sm">
        <caption className="sr-only">Prospecting activity and conversion rates by sales rep.</caption>
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Rep</th>
            <th className="px-4 py-2 text-right">New Leads</th>
            <th className="px-4 py-2 text-right">Calls</th>
            <th className="px-4 py-2 text-right">Live %</th>
            <th className="px-4 py-2 text-right">Samples</th>
            <th className="px-4 py-2 text-right">Calls → Sample</th>
            <th className="px-4 py-2 text-right">Won</th>
            <th className="px-4 py-2 text-right">Win %</th>
            <th className="px-4 py-2 text-right">Boxes</th>
            <th className="px-4 py-2 text-right">Sample COGS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rep_key} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{prospectingRepLabel(row.rep_key, profilesById)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.new_leads)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.calls)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{formatRatePercent(rate(row.live_contacts, row.calls).percent)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.sample_requests)}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatRatePercent(rate(row.phone_sample_requests, row.calls).percent)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.deals_won)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{formatRatePercent(rate(row.deals_won, row.deals_won + row.deals_lost).percent)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{compactNumber(row.sample_boxes)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right font-semibold text-slate-950">{money(row.sample_cogs_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProspectingPipelineTable({ rows, total }: { rows: ProspectingReportAggregate['stages']; total: number }) {
  if (!total) return <EmptyState message="No current prospecting leads match the selected rep filter." />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-separate border-spacing-y-2 text-left text-sm">
        <caption className="sr-only">Current prospecting lead count and share by stage.</caption>
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Stage</th>
            <th className="px-4 py-2 text-right">Leads</th>
            <th className="px-4 py-2 text-right">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.filter((row) => row.count > 0).map((row) => (
            <tr key={row.stage} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${prospectingStageTone(row.stage)}`}>{stageLabel(row.stage)}</span>
              </td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{number(row.count)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{formatRatePercent(rate(row.count, total).percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProspectingSourceTable({ rows }: { rows: ProspectingReportAggregate['sources'] }) {
  if (!rows.length) return <EmptyState message="No prospecting source rows found for the selected period." />;

  const labels: Record<string, string> = {
    lead_activity: 'Lead activity log',
    leads_created: 'Leads created',
    followup_blocks: 'Legacy follow-up blocks',
    prospecting_blocks: 'Legacy prospecting blocks',
    sample_box_runs: 'Sample box runs',
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[70rem] border-separate border-spacing-y-2 text-left text-sm">
        <caption className="sr-only">Aggregated source rows used to build this Prospecting report.</caption>
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Source</th>
            <th className="px-4 py-2 text-right">Rows</th>
            <th className="px-4 py-2 text-right">Calls</th>
            <th className="px-4 py-2 text-right">Emails</th>
            <th className="px-4 py-2 text-right">Texts</th>
            <th className="px-4 py-2 text-right">Notes</th>
            <th className="px-4 py-2 text-right">Follow-ups</th>
            <th className="px-4 py-2 text-right">Samples</th>
            <th className="px-4 py-2 text-right">Won</th>
            <th className="px-4 py-2 text-right">Lost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{labels[row.source] ?? row.source}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.source_rows)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.calls)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.emails)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.texts)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.notes)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.followups)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.sample_requests)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.deals_won)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{number(row.deals_lost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProspectingChannelTable({ rows }: { rows: ProspectingReportAggregate['channels'] }) {
  if (!rows.length) return <EmptyState message="No channel activity was logged for the selected period." />;
  const labels: Record<string, string> = { phone: 'Call', email: 'Email', text: 'Text' };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[68rem] border-separate border-spacing-y-2 text-left text-sm">
        <caption className="sr-only">Initial outreach, samples, follow-ups, and outcomes by channel.</caption>
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Channel</th>
            <th className="px-4 py-2 text-right">Attempts</th>
            <th className="px-4 py-2 text-right">Live contacts</th>
            <th className="px-4 py-2 text-right">Samples</th>
            <th className="px-4 py-2 text-right">Sample rate</th>
            <th className="px-4 py-2 text-right">Follow-ups</th>
            <th className="px-4 py-2 text-right">Won</th>
            <th className="px-4 py-2 text-right">Lost</th>
            <th className="px-4 py-2 text-right">Win rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.filter((row) => ['phone', 'email', 'text'].includes(row.channel)).map((row) => (
            <tr key={row.channel} className="bg-white/65">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{labels[row.channel] ?? row.channel}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.attempts)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{row.channel === 'phone' ? number(row.live_contacts) : '—'}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.sample_requests)}</td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{formatRatePercent(rate(row.sample_requests, row.attempts).percent)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.followups)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.deals_won)}</td>
              <td className="px-4 py-3 text-right text-slate-700">{number(row.deals_lost)}</td>
              <td className="rounded-r-xl px-4 py-3 text-right text-slate-700">{formatRatePercent(rate(row.deals_won, row.deals_won + row.deals_lost).percent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProspectingPhoneFunnel({ period }: { period: ProspectingReportAggregate['period'] }) {
  const steps = [
    { label: 'Call attempts', value: period.call_attempts, detail: 'Initial phone outreach logged in the selected period.' },
    { label: 'Live contacts', value: period.live_contacts, detail: prospectingRate(period.live_contacts, period.call_attempts) },
    { label: 'Contact-sourced samples', value: period.live_contact_sample_requests, detail: prospectingRate(period.live_contact_sample_requests, period.live_contacts) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3" aria-label="Phone conversion funnel">
      {steps.map((step, index) => (
        <div key={step.label} className="relative rounded-xl border border-slate-200/80 bg-white/65 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Step {index + 1}</p>
          <p className="mt-2 font-semibold text-slate-950">{step.label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{number(step.value)}</p>
          <p className="mt-1 text-sm text-slate-500">{step.detail}</p>
        </div>
      ))}
    </div>
  );
}

function ProspectingReport({
  profilesById,
  salesProfileId,
  summary,
}: {
  profilesById: Map<string, AdminRow>;
  salesProfileId: string | null;
  summary: ProspectingReportAggregate;
}) {
  const period = summary.period;
  const pipeline = summary.pipeline_snapshot;
  const selectedRepName = salesProfileId ? prospectingRepLabel(salesProfileId, profilesById) : 'all reps';
  const averageSampleCost = period.sample_boxes > 0 ? money(period.sample_cogs_cents / period.sample_boxes) : '—';

  return (
    <>
      <section className="space-y-5">
        <SectionHeading
          eyebrow="Selected period"
          title="Selected-period performance"
          subtitle={`Exact activity and outcomes recorded for ${selectedRepName}. Percentages include their raw numerator and denominator.`}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <StatTile label="New Leads" value={number(period.new_leads)} detail={`Created in range; grouped by current assignee.`} />
          <StatTile label="Call Attempts" value={number(period.call_attempts)} detail={`${number(period.calls_voicemail)} voicemail, ${number(period.calls_no_answer)} no answer.`} />
          <StatTile label="Live Contact Rate" value={prospectingRate(period.live_contacts, period.call_attempts)} detail="Live conversations divided by initial call attempts." />
          <StatTile label="Sample Requests" value={number(period.sample_requests)} detail={`${number(period.phone_sample_requests)} phone, ${number(period.email_sample_requests)} email, ${number(period.text_sample_requests)} text.`} />
          <StatTile label="Calls → Sample" value={prospectingRate(period.phone_sample_requests, period.call_attempts)} detail="Phone-attributed sample requests divided by call attempts." />
          <StatTile label="Deals Won" value={number(period.deals_won)} detail={`${prospectingRate(period.deals_won, period.deals_won + period.deals_lost)} decided outcomes; ${number(period.deals_lost)} lost.`} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="card space-y-5">
          <SectionHeading
            eyebrow="Phone funnel"
            title="From call attempts to samples"
            subtitle="Follow-up phone calls are excluded because the legacy follow-up source does not record sample outcomes."
          />
          <ProspectingPhoneFunnel period={period} />
        </div>
        <div className="card space-y-5">
          <SectionHeading
            eyebrow="Sample operations"
            title="Boxes sent and cost"
            subtitle="Operational totals only; sample runs are not yet linked to individual lead requests."
          />
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <StatTile label="Boxes Sent" value={compactNumber(period.sample_boxes)} detail={`${number(period.sample_runs)} recorded run${period.sample_runs === 1 ? '' : 's'}.`} />
            <StatTile label="Sample COGS" value={money(period.sample_cogs_cents)} detail="Total recorded sample-box cost in range." />
            <StatTile label="Average Cost / Box" value={averageSampleCost} detail="Shown only when at least one box was recorded." />
          </div>
        </div>
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Channel efficiency"
          title="Outreach, samples, and follow-up outcomes"
          subtitle="Initial sample conversion and follow-up win rates use separate denominators so the percentages stay meaningful."
        />
        <ProspectingChannelTable rows={summary.channels} />
      </section>

      <section className="space-y-5">
        <SectionHeading
          eyebrow="Current snapshot"
          title="Current pipeline snapshot"
          subtitle={`Exact current lead health for ${selectedRepName}; these values are not limited by the selected activity period.`}
          action={pipeline.unassigned_open ? <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">{number(pipeline.unassigned_open)} unassigned open lead{pipeline.unassigned_open === 1 ? '' : 's'}</span> : null}
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <StatTile label="Total Leads" value={number(pipeline.total_leads)} detail="Every current unarchived lead, including terminal stages." />
          <StatTile label="Open Pipeline" value={number(pipeline.open_pipeline)} detail={`${number(pipeline.active_queue)} leads remain in the active calling queue.`} />
          <StatTile label="Untouched Open" value={number(pipeline.untouched_open)} detail={`${formatRatePercent(rate(pipeline.untouched_open, pipeline.open_pipeline).percent)} have no call or email activity.`} />
          <StatTile label="Unassigned Open" value={number(pipeline.unassigned_open)} detail={`${formatRatePercent(rate(pipeline.unassigned_open, pipeline.open_pipeline).percent)} of the open pipeline.`} />
          <StatTile label="Leads Beyond New" value={number(pipeline.leads_beyond_new)} detail={`${formatRatePercent(rate(pipeline.leads_beyond_new, pipeline.open_pipeline).percent)} activation; ${number(pipeline.hubspot_ready)} HubSpot-ready.`} />
          <StatTile label="Follow-ups Due" value={number(pipeline.due_today)} detail={`${number(pipeline.overdue_followups)} overdue as of today.`} />
        </div>
        <div className="card space-y-5">
          <SectionHeading
            eyebrow="Stage distribution"
            title="Current lead database by stage"
            subtitle="Stage shares use the exact current lead total, including terminal maintenance stages."
          />
          <ProspectingPipelineTable rows={summary.stages} total={pipeline.total_leads} />
        </div>
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Rep performance"
          title="Prospecting by sales rep"
          subtitle="Activity is credited to its creator; new leads use the current assignee; sample boxes use their saved sales profile."
        />
        <ProspectingRepTable rows={summary.reps} profilesById={profilesById} />
      </section>

      <details className="card group space-y-5">
        <summary className="cursor-pointer list-none font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-4">
          How totals are calculated
          <span className="ml-2 text-sm font-normal text-slate-500">Aggregated source audit</span>
        </summary>
        <p className="text-sm leading-6 text-slate-500">
          Legacy daily blocks and newer lead-level activity remain separate and are added once. They cannot be deduplicated across systems because legacy rows do not identify individual leads.
        </p>
        <ProspectingSourceTable rows={summary.sources} />
      </details>
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
  const reportStartedAt = performance.now();
  const currentAccess = await requireAdminSectionView('reports');
  const supabase = await createClient();
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
  const dataNeeds = dataNeedsForReport(activeReport);

  const salesRepSettingsResult = currentAccess.isOwner
    ? await supabase.from('admin_commission_settings').select('profile_id').eq('is_sales_rep', true).limit(ADMIN_QUERY_ROW_LIMIT)
    : { data: [], error: null };
  const salesRepProfileIds = [...new Set((salesRepSettingsResult.data ?? []).map((row: { profile_id: string | null }) => row.profile_id).filter(Boolean))] as string[];
  const salesRepsResult = currentAccess.isOwner && salesRepProfileIds.length
    ? await supabase
      .from('profiles')
      .select('id,email,full_name,is_active')
      .in('id', salesRepProfileIds)
      .eq('is_admin', true)
      .order('full_name', { ascending: true })
      .limit(ADMIN_QUERY_ROW_LIMIT)
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
  const prospectingReportProfileId = currentAccess.isOwner
    ? selectedSalesRepId || null
    : currentAccess.profile.id;
  const prospectingReportScope: AuthorizedProspectingReportScope = {
    salesProfileId: prospectingReportProfileId,
    centerIds: centerScope,
  };

  const ordersQuery = scopeCenterRelatedQueryForAdmin(
    supabase.from('orders').select('id,center_id,status,subtotal_cents,shipping_cost_cents,processing_fee_cents,donation_cogs_cents,created_at,shipped_at').order('created_at', { ascending: false }).limit(ADMIN_QUERY_ROW_LIMIT),
    'center_id',
    centerScope
  );
  const centersQuery = scopeCentersForAdmin(
    supabase.from('centers').select('id,name,is_active,created_at').order('name', { ascending: true }).limit(ADMIN_QUERY_ROW_LIMIT),
    centerScope
  );
  const prospectingReportStartedAt = performance.now();
  const prospectingReportQuery = dataNeeds.prospecting
    ? getSupabaseAdmin().rpc('admin_prospecting_report_v1', {
      p_range_start: formatDateInput(rangeStart),
      p_range_end_exclusive: formatDateInput(rangeEndExclusive),
      p_as_of_date: centralDateInput(now),
      p_sales_profile_id: prospectingReportScope.salesProfileId,
      p_center_ids: prospectingReportScope.centerIds,
    })
    : skippedReportQuery();

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
    shippingBoxUsagesResult,
    prospectingReportResult,
  ] = await Promise.all([
    dataNeeds.coreCommerce ? ordersQuery : skippedReportQuery(),
    dataNeeds.coreCommerce
      ? supabase.from('order_items').select('id,order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents,shipping_boxes_used,cogs_material_cents,cogs_labor_cents,cogs_fixed_cents,cogs_tape_cents,cogs_shipping_label_cents,cogs_branding_label_cents,cogs_fixed_other_cents,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_unit_cents,cogs_source,cogs_estimated,cogs_snapshot_at').limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.coreCommerce ? centersQuery : skippedReportQuery(),
    dataNeeds.coreCommerce
      ? supabase.from('products').select('id,name,sku,category,active').order('name', { ascending: true }).limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.inventoryValuation
      ? supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,product_id,active').order('name', { ascending: true }).limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.inventoryValuation
      ? supabase
        .from('inventory_lots')
        .select('inventory_item_id,production_run_id,quantity_remaining,unit_cost_cents,received_at,created_at')
        .or('quantity_remaining.neq.0,unit_cost_cents.gt.0')
        .order('created_at', { ascending: false })
        .limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.reorderSettings
      ? supabase.from('inventory_reorder_settings').select('inventory_item_id,reorder_point,target_stock,lead_time_days').limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.productionRuns
      ? supabase.from('production_runs').select('id,product_id,quantity_produced,quantity_voided,status,estimated_unit_cost_cents,actual_unit_cost_cents,actual_labor_cost_cents,fixed_cost_cents,fixed_tape_cost_cents,fixed_shipping_label_cost_cents,fixed_branding_label_cost_cents,fixed_other_cost_cents,produced_at').order('produced_at', { ascending: false }).limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.productionInputs
      ? supabase.from('production_run_inputs').select('production_run_id,quantity_expected,quantity_used,cost_cents').limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.shortageMovements
      ? supabase.from('inventory_movements').select('inventory_item_id,quantity_change,unit_cost_cents').in('movement_type', ['shipment_consume', 'sample_box_consume']).is('lot_id', null).limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.nonInventoryExpenses
      ? supabase
        .from('non_inventory_expenses')
        .select('expense_type,amount_cents,spent_at')
        .gte('spent_at', rangeStart.toISOString())
        .lt('spent_at', rangeEndExclusive.toISOString())
        .limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.sampleBoxes
      ? supabase
        .from('sample_box_runs')
        .select('id,center_id,sales_profile_id,quantity_boxes,inventory_cogs_cents,product_cogs_cents,fixed_shipping_cents,fixed_misc_cents,total_cogs_cents,cogs_estimated,sent_at')
        .gte('sent_at', rangeStart.toISOString())
        .lt('sent_at', rangeEndExclusive.toISOString())
        .limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    dataNeeds.productRecipes
      ? supabase
        .from('product_recipes')
        .select('product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,product_recipe_components(inventory_item_id,quantity,unit,component_role,inventory_items(id,name,sku,item_type,base_unit))')
        .limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    activeReport === 'simulator'
      ? supabase
        .from('order_item_shipping_boxes')
        .select('order_item_id,inventory_item_id,quantity,unit_cost_cents,total_cost_cents,inventory_items(id,name,sku,item_type,base_unit,active)')
        .gte('consumed_at', rangeStart.toISOString())
        .lt('consumed_at', rangeEndExclusive.toISOString())
        .limit(ADMIN_QUERY_ROW_LIMIT)
      : skippedReportQuery(),
    prospectingReportQuery,
  ]);

  if (ordersResult.error || orderItemsResult.error || centersResult.error || productsResult.error) {
    return (
      <CriticalReportError
        message={ordersResult.error?.message || orderItemsResult.error?.message || centersResult.error?.message || productsResult.error?.message || 'Unknown reporting query error.'}
      />
    );
  }
  if (dataNeeds.prospecting && prospectingReportResult.error) {
    return <CriticalReportError message={prospectingReportResult.error.message || 'The Prospecting aggregate could not be loaded.'} />;
  }
  if (activeReport === 'simulator' && shippingBoxUsagesResult.error) {
    return <CriticalReportError message={shippingBoxUsagesResult.error.message || 'The simulator shipping box usage could not be loaded.'} />;
  }

  const centers = (centersResult.data ?? []) as ReportingCenterRow[];
  const products = (productsResult.data ?? []) as ReportingProductRow[];
  const selectedProductId = stringParam(searchParams?.product);
  const selectedCenterId = stringParam(searchParams?.center);
  const productId = products.some((product) => product.id === selectedProductId) ? selectedProductId : undefined;
  const centerId = centers.some((center) => center.id === selectedCenterId) ? selectedCenterId : undefined;
  const inventoryUnavailable = Boolean(dataNeeds.inventoryValuation && (inventoryItemsResult.error || inventoryLotsResult.error));
  const dashboard = buildReportingDashboard({
    centers,
    filters: {
      selectedMonth,
      rangeStart,
      rangeEndExclusive,
      productId,
      centerId,
    },
    inventoryItems: !dataNeeds.salesDashboard || inventoryUnavailable ? [] : ((inventoryItemsResult.data ?? []) as ReportingInventoryItemRow[]),
    inventoryLots: !dataNeeds.salesDashboard || inventoryUnavailable ? [] : ((inventoryLotsResult.data ?? []) as ReportingInventoryLotRow[]),
    shortageMovements: !dataNeeds.salesDashboard || shortageMovementsResult.error ? [] : ((shortageMovementsResult.data ?? []) as ReportingInventoryMovementRow[]),
    now,
    orderItems: dataNeeds.salesDashboard ? (orderItemsResult.data ?? []) as ReportingOrderItemRow[] : [],
    orders: dataNeeds.salesDashboard ? (ordersResult.data ?? []) as ReportingOrderRow[] : [],
    products: dataNeeds.salesDashboard ? products : [],
    reorderSettings: !dataNeeds.reorderSettings || reorderSettingsResult.error ? [] : ((reorderSettingsResult.data ?? []) as ReportingReorderSettingRow[]),
  });
  const profitabilityDashboard = buildProfitabilityDashboard({
    centerId,
    centers: dataNeeds.productionRuns ? centers : [],
    inventoryItems: !dataNeeds.inventoryValuation || inventoryUnavailable ? [] : ((inventoryItemsResult.data ?? []) as any[]),
    inventoryLots: !dataNeeds.inventoryValuation || inventoryUnavailable ? [] : ((inventoryLotsResult.data ?? []) as any[]),
    nonInventoryExpenses: !dataNeeds.nonInventoryExpenses || nonInventoryExpensesResult.error ? [] : ((nonInventoryExpensesResult.data ?? []) as any[]),
    orderItems: dataNeeds.productionRuns ? (orderItemsResult.data ?? []) as ProfitabilityOrderItemRow[] : [],
    orders: dataNeeds.productionRuns ? (ordersResult.data ?? []) as ProfitabilityOrderRow[] : [],
    productId,
    productionRunInputs: !dataNeeds.productionInputs || productionRunInputsResult.error ? [] : ((productionRunInputsResult.data ?? []) as any[]),
    productionRuns: !dataNeeds.productionRuns || productionRunsResult.error ? [] : ((productionRunsResult.data ?? []) as any[]),
    products: dataNeeds.productionRuns ? products : [],
    rangeEndExclusive,
    rangeStart,
    shortageMovements: !dataNeeds.shortageMovements || shortageMovementsResult.error ? [] : ((shortageMovementsResult.data ?? []) as any[]),
  });
  const rawCoffeePercentDelta = simulatorPercentParam(searchParams?.sim_raw_delta);
  const materialSupplyPercentDelta = simulatorPercentParam(searchParams?.sim_material_delta);
  const laborPercentDelta = simulatorPercentParam(searchParams?.sim_labor_delta);
  const scenarioPricePerPoundCents = simulatorPricePerPoundParam(searchParams?.sim_price_per_lb);
  const itemUnitCostOverrides = simulatorUnitCostOverrides(searchParams);
  const { laborMinutesOverrides, laborRateOverridesCents } = simulatorLaborOverrides(searchParams);
  const simulatorTab = simulatorTabParam(searchParams?.sim_tab);
  const simulatorDashboard = buildGrossProfitSimulator({
    actual: profitabilityDashboard.current,
    centers: activeReport === 'simulator' ? centers : [],
    inventoryItems: activeReport !== 'simulator' || inventoryUnavailable ? [] : ((inventoryItemsResult.data ?? []) as any[]),
    inventoryLots: activeReport !== 'simulator' || inventoryUnavailable ? [] : ((inventoryLotsResult.data ?? []) as any[]),
    orderItems: activeReport === 'simulator' ? (orderItemsResult.data ?? []) as ProfitabilityOrderItemRow[] : [],
    orders: activeReport === 'simulator' ? (ordersResult.data ?? []) as ProfitabilityOrderRow[] : [],
    params: {
      centerId,
      itemUnitCostOverridesCents: itemUnitCostOverrides,
      laborMinutesOverrides,
      laborPercentDelta,
      laborRateOverridesCents,
      materialSupplyPercentDelta,
      productId,
      rangeEndExclusive,
      rangeStart,
      rawCoffeePercentDelta,
      scenarioPricePerPoundCents,
    },
    products: activeReport === 'simulator' ? products : [],
    recipes: activeReport !== 'simulator' || recipeResult.error ? [] : ((recipeResult.data ?? []) as any[]),
    shippingBoxUsages: activeReport !== 'simulator' || shippingBoxUsagesResult.error ? [] : ((shippingBoxUsagesResult.data ?? []) as any[]),
  });
  const coffeeSoldByRawMaterialSummary = buildCoffeeSoldByRawMaterialSummary({
    centerId,
    orderItems: activeReport === 'production' ? (orderItemsResult.data ?? []) as ProfitabilityOrderItemRow[] : [],
    orders: activeReport === 'production' ? (ordersResult.data ?? []) as ProfitabilityOrderRow[] : [],
    productId,
    rangeEndExclusive,
    rangeStart,
    recipes: activeReport !== 'production' || recipeResult.error ? [] : ((recipeResult.data ?? []) as CoffeeSoldRecipeRow[]),
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
  const prospectingProfileRows = [
    ...salesReps,
    currentAccess.profile as AdminRow,
  ].filter((profile): profile is AdminRow => Boolean(profile?.id));
  const prospectingProfilesById = new Map(prospectingProfileRows.map((profile) => [profile.id, profile]));
  const prospectingSummary = dataNeeds.prospecting
    ? normalizeProspectingReportAggregate(prospectingReportResult.data)
    : emptyProspectingReportAggregate();
  if (dataNeeds.prospecting) {
    logServerTiming('admin_prospecting_report', prospectingReportStartedAt, {
      rep_scoped: Boolean(prospectingReportScope.salesProfileId),
      total_leads: prospectingSummary.pipeline_snapshot.total_leads,
    });
  }
  const limitedSourceLabels = [
    ['orders', ordersResult.data],
    ['order items', orderItemsResult.data],
    ['customers', centersResult.data],
    ['products', productsResult.data],
    ['inventory items', inventoryItemsResult.data],
    ['inventory lots', inventoryLotsResult.data],
    ['reorder settings', reorderSettingsResult.data],
    ['production runs', productionRunsResult.data],
    ['production inputs', productionRunInputsResult.data],
    ['inventory adjustments', shortageMovementsResult.data],
    ['expenses', nonInventoryExpensesResult.data],
    ['sample boxes', sampleBoxRunsResult.data],
    ['recipes', recipeResult.data],
    ['shipping box usages', shippingBoxUsagesResult.data],
  ]
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]) && queryReachedAdminRowLimit(entry[1]))
    .map(([label]) => label);
  const hasCommerceOrders = (ordersResult.data?.length ?? 0) > 0;
  const rangeEndInput = formatDateInput(addDays(rangeEndExclusive, -1));
  const activeFilterCount = activeReport === 'prospecting'
    ? [selectedSalesRepId, parsedRangeStart, parsedRangeEnd].filter(Boolean).length
    : [productId, centerId, selectedSalesRepId, parsedRangeStart, parsedRangeEnd].filter(Boolean).length;
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

  logServerTiming('admin_report', reportStartedAt, {
    report: activeReport,
    detail_limit: REPORT_DETAIL_ROW_LIMIT,
  });

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
              {activeReport !== 'prospecting' ? (
                <>
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
                </>
              ) : null}
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
              {activeReport === 'prospecting'
                ? `${REPORTS.find((report) => report.id === activeReport)?.label}. Using ${dateLabel(rangeStart)} through ${dateLabel(addDays(rangeEndExclusive, -1))}.`
                : activeReport === 'margin'
                  ? `${REPORTS.find((report) => report.id === activeReport)?.label}. Using ${dateLabel(rangeStart)} through ${dateLabel(addDays(rangeEndExclusive, -1))}; normalized against trailing 8 weeks and the previous equal-length range.`
                  : `${REPORTS.find((report) => report.id === activeReport)?.label}. Using ${dateLabel(rangeStart)} through ${dateLabel(addDays(rangeEndExclusive, -1))}; sales comparisons still compare ${monthLabel(selectedMonth)} with ${monthLabel(dashboard.previousMonthStart)}.`}
            </p>
          </form>
        </div>
      </section>

      <ReportNav activeReport={activeReport} reports={allowedReports} searchParams={navParams} />

      <SourceRowLimitNotice sources={limitedSourceLabels} />

      {activeReport !== 'prospecting' && !hasCommerceOrders ? (
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
          <CenterProfitabilityTable rows={limitReportDetailRows(profitabilityDashboard.centerRows)} />
          <DetailRowLimitNotice total={profitabilityDashboard.centerRows.length} />
        </section>
      ) : null}

      {activeReport === 'items' ? (
        <section className="card space-y-5">
          <SectionHeading
            eyebrow="Item profitability"
            title="Profit by product"
            subtitle="Item-level revenue, product COGS before shipping, allocated shipping COGS, profit, and margin."
          />
          <ItemProfitabilityTable rows={limitReportDetailRows(profitabilityDashboard.itemRows)} />
          <DetailRowLimitNotice total={profitabilityDashboard.itemRows.length} />
        </section>
      ) : null}

      {activeReport === 'margin' ? (
        <section className="space-y-5">
          <div className="card space-y-5">
            <SectionHeading
              eyebrow="Margin health"
              title="Is the business getting healthier?"
              subtitle={`Selected range compared with a trailing 8-week baseline (${dateLabel(profitabilityDashboard.marginHealth.baselineRange.trailingStart)} through ${dateLabel(addDays(profitabilityDashboard.marginHealth.baselineRange.trailingEndExclusive, -1))}) and the immediately previous equal-length range.`}
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Gross Margin" value={`${number(profitabilityDashboard.current.marginPercent, 1)}%`} detail={`${money(profitabilityDashboard.current.grossProfitCents)} gross profit on shipped orders.`} />
              <StatTile label="Profit / $1k Revenue" value={money((profitabilityDashboard.current.marginPercent / 100) * 100000)} detail="Normalizes profit quality so revenue swings do not hide margin health." />
              <StatTile label="Revenue / Day" value={metricValue(profitabilityDashboard.marginHealth.salesMetrics[0], profitabilityDashboard.marginHealth.salesMetrics[0]?.currentValue ?? 0)} detail={`${metricChange(profitabilityDashboard.marginHealth.salesMetrics[0])} versus the trailing 8-week baseline.`} />
              <StatTile label="Orders / Day" value={metricValue(profitabilityDashboard.marginHealth.salesMetrics[1], profitabilityDashboard.marginHealth.salesMetrics[1]?.currentValue ?? 0)} detail={`${metricChange(profitabilityDashboard.marginHealth.salesMetrics[1])} versus the trailing 8-week baseline.`} />
            </div>
          </div>

          <div className="card space-y-5">
            <SectionHeading eyebrow="Sales strength" title="Pace, order size, and density" subtitle="These are normalized by days and orders so the report does not compare a partial month to a full month." />
            <MarginHealthMetricTable rows={profitabilityDashboard.marginHealth.salesMetrics} />
          </div>

          <div className="card space-y-5">
            <SectionHeading eyebrow="Unit economics" title="Margin drivers at current revenue" subtitle="Estimated impact shows what each driver is worth at current revenue or volume versus the trailing 8-week baseline." />
            <MarginHealthMetricTable rows={profitabilityDashboard.marginHealth.unitEconomicsRows} />
          </div>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className="card space-y-5">
              <SectionHeading eyebrow="Top margin leaks" title="Products pulling margin down" subtitle="Ranked by margin-rate decline multiplied by current revenue." />
              <MarginLeakTable rows={profitabilityDashboard.marginHealth.productLeaks} emptyLabel="No product-level margin leaks found for the selected range." />
            </div>
            <div className="card space-y-5">
              <SectionHeading eyebrow="Top margin leaks" title="Centers pulling margin down" subtitle="Ranked by margin-rate decline multiplied by current revenue." />
              <MarginLeakTable rows={profitabilityDashboard.marginHealth.centerLeaks} emptyLabel="No center-level margin leaks found for the selected range." />
            </div>
          </section>

          <div className="card space-y-5">
            <SectionHeading eyebrow="COGS timing" title="Is timing hiding the answer?" subtitle="Compares COGS recognized on shipments, COGS created in production, and value still sitting in finished-good inventory." />
            <CogsTimingGrid centerId={centerId} productId={productId} summary={profitabilityDashboard.marginHealth.cogsTiming} />
          </div>
        </section>
      ) : null}

      {activeReport === 'simulator' ? (
        <GrossProfitSimulatorReport
          activeTab={simulatorTab}
          centerId={centerId}
          dashboard={simulatorDashboard}
          laborPercentDelta={laborPercentDelta}
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
          scenarioPricePerPoundCents={scenarioPricePerPoundCents}
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
              eyebrow="Coffee sold"
              title="Pounds sold by raw material"
              subtitle="Uses shipped order lines and each product recipe's raw coffee weight, without applying waste or shrinkage."
              action={coffeeSoldByRawMaterialSummary.unweightedLineCount ? <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">{number(coffeeSoldByRawMaterialSummary.unweightedLineCount)} unweighted line{coffeeSoldByRawMaterialSummary.unweightedLineCount === 1 ? '' : 's'}</span> : null}
            />
            <CoffeeSoldByRawMaterialGrid summary={coffeeSoldByRawMaterialSummary} />
          </section>
          <section className="card space-y-5">
            <SectionHeading
              eyebrow="Production & COGS"
              title="Expected versus actual run cost"
              subtitle="Shows actual production cost, estimated recipe cost, labor, fixed packaging, and material usage variance."
            />
            <ProductionCogsTable rows={limitReportDetailRows(profitabilityDashboard.productionRows)} />
            <DetailRowLimitNotice total={profitabilityDashboard.productionRows.length} />
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
              <InventoryValueTable rows={limitReportDetailRows(profitabilityDashboard.inventoryRows)} />
              <DetailRowLimitNotice total={profitabilityDashboard.inventoryRows.length} />
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
          <ProductTable rows={limitReportDetailRows(dashboard.productSalesRows)} />
          <DetailRowLimitNotice total={dashboard.productSalesRows.length} />
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
        <CustomerTable rows={limitReportDetailRows(dashboard.customerSalesRows)} />
        <DetailRowLimitNotice total={dashboard.customerSalesRows.length} />
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Reorder risk"
          title="Customers due or overdue for another order"
          subtitle="Order history estimates each customer's normal cadence and highlights accounts past their reorder window."
        />
        <ReorderTable rows={limitReportDetailRows(dashboard.reorderRiskRows)} />
        <DetailRowLimitNotice total={dashboard.reorderRiskRows.length} />
      </section>

      <section className="card space-y-5">
        <SectionHeading
          eyebrow="Inventory planning"
          title="Product demand and stock coverage"
          subtitle="Forecasted product demand, current available finished goods when tracked, runout timing, and rounded whole-unit recommendations."
        />
        <InventoryTable rows={limitReportDetailRows(dashboard.inventoryPlanningRows)} unavailable={inventoryUnavailable} />
        <DetailRowLimitNotice total={dashboard.inventoryPlanningRows.length} />
      </section>
        </>
      ) : null}

      {activeReport === 'prospecting' ? (
        <ProspectingReport
          profilesById={prospectingProfilesById}
          salesProfileId={prospectingReportScope.salesProfileId}
          summary={prospectingSummary}
        />
      ) : null}
    </div>
  );
}

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSalesScopedCenterIdsForAdmin } from '@/lib/admin-center-scope';
import { adminCanView, requireAdminSectionView } from '@/lib/admin-permissions';
import { createReportDataCache } from '@/lib/admin-report-cache';
import { loadReportCommerce } from '@/lib/admin-report-commerce';
import { buildBaselineRanges } from '@/lib/profitability-reporting';
import { getReportPreloadTarget } from '@/lib/report-navigation-policy';
import { addDays, defaultRangeForMonth, parseDateInput, parseMonthInput } from '@/lib/reporting';
import { fetchAllByIds, fetchAllPages } from '@/lib/supabase/pagination';
import type { Database } from '@/lib/supabase/schema';
import { createClient } from '@/lib/supabase/server';

export function loadReportProductionRuns(supabase: SupabaseClient<Database>, productIds?: string[]) {
  const query = (from: number, to: number) => supabase.from('production_runs')
    .select('id,product_id,quantity_produced,quantity_voided,status,estimated_unit_cost_cents,actual_unit_cost_cents,actual_labor_cost_cents,fixed_cost_cents,fixed_tape_cost_cents,fixed_shipping_label_cost_cents,fixed_branding_label_cost_cents,fixed_other_cost_cents,produced_at')
    .order('produced_at', { ascending: false }).order('id').range(from, to);
  return productIds === undefined
    ? fetchAllPages(query)
    : fetchAllByIds(productIds, (ids, from, to) => query(from, to).in('product_id', ids));
}

/** Same comparison window and cache filters used by the report page. */
export function reportPreloadCommerceOptions(target: string, centerScope: string[] | null, now = new Date()) {
  const params = new URL(target, 'https://report-navigation.invalid').searchParams;
  const selectedMonth = parseMonthInput(params.get('month') ?? undefined, now);
  const defaultRange = defaultRangeForMonth(selectedMonth);
  const rangeStart = parseDateInput(params.get('rangeStart') ?? undefined) ?? defaultRange.rangeStart;
  const parsedRangeEnd = parseDateInput(params.get('rangeEnd') ?? undefined);
  const rangeEndExclusive = parsedRangeEnd && parsedRangeEnd >= rangeStart ? addDays(parsedRangeEnd, 1) : defaultRange.rangeEndExclusive;
  const baseline = buildBaselineRanges(rangeStart, rangeEndExclusive);
  const recent = params.get('report') === 'recent_order_gpm';
  return {
    centerScope,
    shippedRange: recent ? undefined : {
      start: new Date(Math.min(baseline.previousStart.getTime(), baseline.trailingStart.getTime())),
      endExclusive: rangeEndExclusive,
    },
    recentOrders: recent ? { limit: 10 } : undefined,
  };
}

/** Preload raw data only. Every real navigation still authenticates and authorizes. */
export async function preloadAdminReport(href: string) {
  const target = getReportPreloadTarget(href);
  if (!target) return 'unsupported' as const;
  const current = await requireAdminSectionView('reports');
  if (!adminCanView(current.access, 'reports_profitability')) return 'forbidden' as const;
  const supabase = await createClient();
  const centerScope = await getSalesScopedCenterIdsForAdmin({ current, selectedSalesProfileId: '', supabase });
  const reportData = createReportDataCache(current, centerScope);
  const options = reportPreloadCommerceOptions(target, centerScope);
  const [commerce, production] = await Promise.all([
    reportData.read('commerce', {
      shippedRange: options.shippedRange,
      recentOrders: options.recentOrders,
      selectedSalesRepId: '',
    }, () => loadReportCommerce(supabase, options)),
    // Recent orders usually carry COGS snapshots. Only an actual visit loads
    // historical fallback products when its returned order lines require them.
    options.recentOrders ? Promise.resolve({ data: [], error: null })
      : reportData.read('production_runs', { productIds: null }, () => loadReportProductionRuns(supabase)),
  ]);
  if (commerce.orders.error || commerce.orderItems.error || production.error) {
    throw new Error('Report preload could not complete.');
  }
  return 'loaded' as const;
}

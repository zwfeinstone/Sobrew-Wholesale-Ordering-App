import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import type { DeferredPayEntry, DeferredPayPlan } from '@/lib/deferred-pay';
import { buildDeferredPayAccountingSummary, deferredPayPeriodBounds, type DeferredPayAccountingSummary, type DeferredPayAllocation } from '@/lib/deferred-pay-accounting';
import { fetchAllByIds, fetchAllPages, type QueryError } from '@/lib/supabase/pagination';
import { parseCentralDateInput, type TimeClockBreakRow } from '@/lib/time-clock';

type Client = Pick<SupabaseClient<Database>, 'from'>;
type Result = { data: DeferredPayAccountingSummary; error: null } | { data: null; error: QueryError };

/**
 * Admin-only financial inputs. Call after Accounting or Payroll view permission
 * checks. Reports must also require Payroll access before loading these rows.
 * Load full plan histories even for January-only reports: opening liability and
 * settlement links must not disappear after the accrual period has ended.
 */
export async function loadDeferredPayAccounting({
  supabase, start, end, now = new Date(), profileId,
}: { supabase: Client; start: string; end: string; now?: Date; profileId?: string }): Promise<Result> {
  try {
    deferredPayPeriodBounds(start, end);
    if (!Number.isFinite(now.getTime())) throw new RangeError('The report date must be valid.');
    const plansResult = await fetchAllPages<DeferredPayPlan>((from, to) => {
      let query = supabase.from('admin_deferred_pay_plans').select('*').order('start_date').order('id');
      if (profileId) query = query.eq('profile_id', profileId);
      return query.range(from, to);
    });
    if (plansResult.error) return { data: null, error: plansResult.error };
    const plans = plansResult.data.filter((plan) => !profileId || plan.profile_id === profileId);
    const empty = buildDeferredPayAccountingSummary({ plans, entries: [], start, end, now });
    if (!plans.length) return { data: empty, error: null };

    const profileIds = [...new Set(plans.map((plan) => plan.profile_id))];
    const firstDate = plans.reduce((date, plan) => plan.start_date < date ? plan.start_date : date, plans[0].start_date);
    const lastDate = plans.reduce((date, plan) => plan.end_date > date ? plan.end_date : date, plans[0].end_date);
    const planBounds = deferredPayPeriodBounds(firstDate, lastDate);
    const before = new Date(Math.min(planBounds.endExclusive.getTime(), now.getTime()));
    const [profilesResult, entriesResult] = await Promise.all([
      fetchAllByIds<{ id: string; full_name: string | null; email: string | null }>(profileIds, (ids, from, to) => supabase
        .from('profiles').select('id,full_name,email').in('id', ids).order('id').range(from, to)),
      before <= parseCentralDateInput(firstDate)!
        ? { data: [] as DeferredPayEntry[], error: null }
        : fetchAllByIds<DeferredPayEntry>(profileIds, (ids, from, to) => supabase.from('admin_time_entries')
          .select('id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,work_type')
          .in('profile_id', ids).gt('clock_out_at', planBounds.start.toISOString())
          .lt('clock_in_at', before.toISOString()).lte('clock_out_at', now.toISOString())
          .order('clock_in_at').order('id').range(from, to)),
    ]);
    if (profilesResult.error) return { data: null, error: profilesResult.error };
    if (entriesResult.error) return { data: null, error: entriesResult.error };
    const entries = entriesResult.data.filter((entry) => entry.profile_id && profileIds.includes(entry.profile_id));
    const entryIds = entries.map((entry) => entry.id);
    const [breaksResult, allocationsResult] = await Promise.all([
      fetchAllByIds<TimeClockBreakRow & { time_entry_id: string }>(entryIds, (ids, from, to) => supabase
        .from('admin_time_breaks').select('time_entry_id,break_start_at,break_end_at,status')
        .in('time_entry_id', ids).order('id').range(from, to)),
      fetchAllByIds<DeferredPayAllocation>(entryIds, (ids, from, to) => supabase
        .from('admin_time_entry_allocations').select('time_entry_id,work_type,minutes')
        .in('time_entry_id', ids).order('id').range(from, to)),
    ]);
    if (breaksResult.error) return { data: null, error: breaksResult.error };
    if (allocationsResult.error) return { data: null, error: allocationsResult.error };
    const breaksByEntry = new Map<string, TimeClockBreakRow[]>();
    for (const row of breaksResult.data) {
      const rows = breaksByEntry.get(row.time_entry_id) ?? [];
      rows.push(row);
      breaksByEntry.set(row.time_entry_id, rows);
    }
    return { data: buildDeferredPayAccountingSummary({
      plans, start, end, now, allocations: allocationsResult.data,
      employeeNames: Object.fromEntries(profilesResult.data.map((row) => [row.id, row.full_name || row.email || 'Employee'])),
      entries: entries.map((entry) => ({ ...entry, admin_time_breaks: breaksByEntry.get(entry.id) ?? [] })),
    }), error: null };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Deferred payroll accounting could not be loaded.' } };
  }
}

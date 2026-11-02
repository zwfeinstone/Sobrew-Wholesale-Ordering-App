import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { calculateDeferredPay, type DeferredPayEntry, type DeferredPayPlan, type DeferredPaySummary } from '@/lib/deferred-pay';
import { fetchAllByIds, fetchAllPages, type QueryError } from '@/lib/supabase/pagination';
import type { Database } from '@/lib/supabase/schema';
import { parseCentralDateInput, type TimeClockBreakRow } from '@/lib/time-clock';

type DeferredPayClient = Pick<SupabaseClient<Database>, 'from'>;
export type DeferredPayView = { plan: DeferredPayPlan; summary: DeferredPaySummary };
export type DeferredPayDataResult =
  | { data: DeferredPayView[]; error: null }
  | { data: null; error: QueryError };

const PLAN_COLUMNS = 'id,profile_id,label,start_date,end_date,payout_date,accrual_rate_cents,weekly_rate_cents,paid_at,paid_amount_cents';
const ENTRY_COLUMNS = 'id,profile_id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,work_type';

/**
 * The caller must use the authenticated employee's profile ID. Every parent
 * query is employee-scoped, even when the server's service client is supplied.
 * Query the complete plan period independently of the page's calendar year.
 * Breaks are paginated separately to avoid silent embedded-row truncation.
 */
export async function loadDeferredPayForProfile(
  supabase: DeferredPayClient,
  profileId: string,
  now = new Date(),
): Promise<DeferredPayDataResult> {
  if (!profileId || !Number.isFinite(now.getTime())) {
    return { data: null, error: { message: 'A valid employee and date are required.' } };
  }
  const plansResult = await fetchAllPages<DeferredPayPlan>((from, to) => supabase
    .from('admin_deferred_pay_plans')
    .select(PLAN_COLUMNS)
    .eq('profile_id', profileId)
    .order('start_date', { ascending: false })
    .order('id')
    .range(from, to));
  if (plansResult.error) return { data: null, error: plansResult.error };
  const plans = plansResult.data.filter((plan) => plan.profile_id === profileId);
  if (!plans.length) return { data: [], error: null };

  try {
    // Validate plans before using their dates in any subsequent database filter.
    plans.forEach((plan) => calculateDeferredPay(plan, [], now));
    const firstDate = plans.reduce((date, plan) => plan.start_date < date ? plan.start_date : date, plans[0].start_date);
    const lastDate = plans.reduce((date, plan) => plan.end_date > date ? plan.end_date : date, plans[0].end_date);
    const nextDate = new Date(Date.parse(`${lastDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const start = parseCentralDateInput(firstDate)!;
    const end = new Date(Math.min(parseCentralDateInput(nextDate)!.getTime(), now.getTime()));
    if (end <= start) {
      return { data: plans.map((plan) => ({ plan, summary: calculateDeferredPay(plan, [], now) })), error: null };
    }

    const entriesResult = await fetchAllPages<DeferredPayEntry>((from, to) => supabase
      .from('admin_time_entries')
      .select(ENTRY_COLUMNS)
      .eq('profile_id', profileId)
      .gt('clock_out_at', start.toISOString())
      .lt('clock_in_at', end.toISOString())
      .lte('clock_out_at', now.toISOString())
      .order('clock_in_at')
      .order('id')
      .range(from, to));
    if (entriesResult.error) return { data: null, error: entriesResult.error };
    const entries = entriesResult.data.filter((entry) => entry.profile_id === profileId);
    const breaksResult = await fetchAllByIds<TimeClockBreakRow & { time_entry_id: string }>(
      entries.map((entry) => entry.id),
      (ids, from, to) => supabase.from('admin_time_breaks')
        .select('time_entry_id,break_start_at,break_end_at,status')
        .in('time_entry_id', ids)
        .order('id')
        .range(from, to),
    );
    if (breaksResult.error) return { data: null, error: breaksResult.error };
    const breaksByEntry = new Map<string, TimeClockBreakRow[]>();
    for (const entryBreak of breaksResult.data) {
      const rows = breaksByEntry.get(entryBreak.time_entry_id) ?? [];
      rows.push(entryBreak);
      breaksByEntry.set(entryBreak.time_entry_id, rows);
    }
    const completeEntries = entries.map((entry) => ({ ...entry, admin_time_breaks: breaksByEntry.get(entry.id) ?? [] }));
    return {
      data: plans.map((plan) => ({ plan, summary: calculateDeferredPay(plan, completeEntries, now) })),
      error: null,
    };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Deferred pay could not be calculated.' } };
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import {
  MISSING_STATE_FILTER,
  postgrestIlikePattern,
  prospectingQueueExcludesFollowUpDue,
  prospectingQueueOrderFields,
  prospectingQueueRequiresFollowUp,
  prospectingQueueSkipsTouchedToday,
  prospectingQueueStageFilter,
  type ProspectingQueueContext,
} from '@/lib/prospecting';

export type ProspectingQueueOptions = {
  context: ProspectingQueueContext;
  profileId: string | null;
  today: string;
  todayStartIso: string;
};

export const PROSPECTING_QUEUE_COLUMNS = 'id,company_name,phone,company_email,address_line_1,city,state,state_key,postal_code,priority,stage,do_not_contact,next_follow_up_at,last_activity_at,last_result,created_at,updated_at';

export function quoteProspectingFilterValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Only the record's authorization scope: a moved record remains a useful cursor. */
export function prospectingQueueAuthorizedQuery(
  supabase: SupabaseClient<Database>,
  { profileId }: Pick<ProspectingQueueOptions, 'profileId'>,
  columns = PROSPECTING_QUEUE_COLUMNS,
) {
  let query = supabase.from('prospecting_leads').select(columns).is('archived_at', null);
  query = profileId ? query.eq('assigned_profile_id', profileId) : query.is('assigned_profile_id', null);
  return query;
}

/** Shared membership for visible rows, exact counts, and next/previous navigation. */
export function prospectingQueueQuery(
  supabase: SupabaseClient<Database>,
  { context, profileId, today, todayStartIso }: ProspectingQueueOptions,
  columns = PROSPECTING_QUEUE_COLUMNS,
  options?: { count?: 'exact'; head?: boolean },
) {
  const selectColumns = context.listId ? `${columns},prospecting_list_leads!inner(list_id)` : columns;
  let query = supabase.from('prospecting_leads').select(selectColumns, options)
    .is('archived_at', null).eq('do_not_contact', false);
  query = profileId ? query.eq('assigned_profile_id', profileId) : query.is('assigned_profile_id', null);
  query = query.in('stage', prospectingQueueStageFilter(context));

  if (context.tab === 'today') {
    const preset = context.preset ?? 'all';
    if (preset === 'all') {
      query = query.or(`next_follow_up_at.lte.${today},and(stage.eq.new,next_follow_up_at.is.null,or(last_activity_at.is.null,last_activity_at.lt.${todayStartIso}))`);
    } else if (preset === 'overdue') {
      query = query.not('next_follow_up_at', 'is', null).lt('next_follow_up_at', today);
    } else if (preset === 'due_today') {
      query = query.eq('next_follow_up_at', today);
    } else if (preset === 'upcoming') {
      query = query.gt('next_follow_up_at', today);
    } else if (preset === 'new' || preset === 'needs_scheduling') {
      query = query.is('next_follow_up_at', null);
      if (preset === 'new') query = query.or(`last_activity_at.is.null,last_activity_at.lt.${todayStartIso}`);
    }
  } else {
    if (prospectingQueueRequiresFollowUp(context)) query = query.not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today);
    if (prospectingQueueExcludesFollowUpDue(context)) query = query.or(`next_follow_up_at.is.null,next_follow_up_at.gt.${today}`);
    if (prospectingQueueSkipsTouchedToday(context)) query = query.or(`last_activity_at.is.null,last_activity_at.lt.${todayStartIso}`);
  }

  if (context.priority) query = query.eq('priority', context.priority);
  if (context.state === MISSING_STATE_FILTER) query = query.is('state_key', null);
  else if (context.state) query = query.eq('state_key', context.state);
  if (context.listId) query = query.eq('prospecting_list_leads.list_id', context.listId);
  if (context.q) {
    const search = quoteProspectingFilterValue(postgrestIlikePattern(context.q));
    query = query.or(['company_name', 'phone', 'company_email', 'city', 'state', 'last_result']
      .map((column) => `${column}.ilike.${search}`).join(','));
  }
  return query;
}

export function orderedProspectingQueueQuery(
  supabase: SupabaseClient<Database>,
  options: ProspectingQueueOptions,
  columns = PROSPECTING_QUEUE_COLUMNS,
  selectOptions?: { count?: 'exact'; head?: boolean },
) {
  let query = prospectingQueueQuery(supabase, options, columns, selectOptions);
  for (const order of prospectingQueueOrderFields(options.context)) query = query.order(order.column, { ascending: order.ascending, nullsFirst: !order.ascending });
  return query;
}

export function prospectingTodayGroup(nextFollowUp: string | null, today: string) {
  if (nextFollowUp && nextFollowUp < today) return 'Overdue';
  if (nextFollowUp === today) return 'Due today';
  return 'New';
}

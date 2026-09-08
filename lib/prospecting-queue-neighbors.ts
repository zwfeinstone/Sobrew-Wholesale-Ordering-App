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

type QueueOrderField = { column: string; ascending: boolean; nullsFirst?: boolean };
type Direction = 'previous' | 'next';

function quotedFilterValue(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function queueNeighborOrderFields(fields: readonly QueueOrderField[], direction: Direction) {
  return fields.map(({ column, ascending, nullsFirst = !ascending }) => ({
    column,
    ascending: direction === 'next' ? ascending : !ascending,
    nullsFirst: direction === 'next' ? nullsFirst : !nullsFirst,
  }));
}

export function queueNeighborFilter(
  fields: readonly QueueOrderField[],
  cursor: Record<string, unknown>,
  direction: Direction,
) {
  const branches: string[] = [];
  const equalPrefix: string[] = [];

  for (const { column, ascending, nullsFirst } of queueNeighborOrderFields(fields, direction)) {
    const value = cursor[column];
    if (value !== null && typeof value !== 'string') throw new Error(`Missing queue cursor field: ${column}`);
    let comparison: string | null;
    if (value === null) {
      comparison = nullsFirst ? `${column}.not.is.null` : null;
    } else {
      const strictComparison = `${column}.${ascending ? 'gt' : 'lt'}.${quotedFilterValue(value)}`;
      // The primary key is never null; nullable sort fields also need their null boundary.
      comparison = !nullsFirst && column !== 'id'
        ? `or(${strictComparison},${column}.is.null)`
        : strictComparison;
    }
    if (comparison) {
      branches.push(equalPrefix.length ? `and(${equalPrefix.join(',')},${comparison})` : comparison);
    }
    equalPrefix.push(value === null ? `${column}.is.null` : `${column}.eq.${quotedFilterValue(value)}`);
  }

  return branches.join(',');
}

type QueueOptions = {
  context: ProspectingQueueContext;
  profileId: string | null;
  today: string;
  todayStartIso: string;
};

const QUEUE_CURSOR_COLUMNS = 'id,next_follow_up_at,last_activity_at,created_at,stage,updated_at,state_key,city,company_name';

function queueQuery(supabase: SupabaseClient<Database>, { context, profileId, today, todayStartIso }: QueueOptions) {
  let query = context.listId
    ? supabase.from('prospecting_leads').select(`${QUEUE_CURSOR_COLUMNS},prospecting_list_leads!inner(list_id)`)
    : supabase.from('prospecting_leads').select(QUEUE_CURSOR_COLUMNS);
  query = query.is('archived_at', null);
  query = profileId ? query.eq('assigned_profile_id', profileId) : query.is('assigned_profile_id', null);
  query = query.in('stage', prospectingQueueStageFilter(context));
  if (prospectingQueueRequiresFollowUp(context)) query = query.not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today);
  if (prospectingQueueExcludesFollowUpDue(context)) query = query.or(`next_follow_up_at.is.null,next_follow_up_at.gt.${today}`);
  if (prospectingQueueSkipsTouchedToday(context)) query = query.or(`last_activity_at.is.null,last_activity_at.lt.${todayStartIso}`);
  if (context.priority) query = query.eq('priority', context.priority);
  if (context.state === MISSING_STATE_FILTER) query = query.is('state_key', null);
  else if (context.state) query = query.eq('state_key', context.state);
  if (context.listId) query = query.eq('prospecting_list_leads.list_id', context.listId);
  if (context.q) {
    const search = quotedFilterValue(postgrestIlikePattern(context.q));
    query = query.or(['company_name', 'phone', 'company_email', 'city', 'state', 'last_result']
      .map((column) => `${column}.ilike.${search}`).join(','));
  }
  return query;
}

export async function loadProspectingQueueNeighbors(
  supabase: SupabaseClient<Database>,
  options: QueueOptions & { currentLeadId: string },
) {
  const fields = prospectingQueueOrderFields(options.context);
  const { data: cursor, error } = await queueQuery(supabase, options).eq('id', options.currentLeadId).limit(1).maybeSingle();
  if (error) return { previousLeadId: null, nextLeadId: null };

  function orderedQuery(direction: Direction) {
    let query = queueQuery(supabase, options);
    for (const { column, ascending, nullsFirst } of queueNeighborOrderFields(fields, direction)) {
      query = query.order(column, { ascending, nullsFirst });
    }
    return query.limit(1);
  }

  if (!cursor) {
    const { data } = await orderedQuery('next').neq('id', options.currentLeadId).maybeSingle();
    return { previousLeadId: null, nextLeadId: data?.id ?? null };
  }

  const [previous, next] = await Promise.all([
    orderedQuery('previous').or(queueNeighborFilter(fields, cursor, 'previous')).maybeSingle(),
    orderedQuery('next').or(queueNeighborFilter(fields, cursor, 'next')).maybeSingle(),
  ]);
  return { previousLeadId: previous.data?.id ?? null, nextLeadId: next.data?.id ?? null };
}

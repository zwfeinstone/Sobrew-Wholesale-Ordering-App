import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/schema';
import { prospectingQueueOrderFields } from '@/lib/prospecting';
import { prospectingQueueAuthorizedQuery, prospectingQueueQuery, type ProspectingQueueOptions } from '@/lib/prospecting-queue';

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

export async function loadProspectingQueueNeighbors(
  supabase: SupabaseClient<Database>,
  options: ProspectingQueueOptions & { currentLeadId: string; excludedLeadIds?: string[] },
) {
  const fields = prospectingQueueOrderFields(options.context);
  const { data: cursor, error } = await prospectingQueueAuthorizedQuery(supabase, options).eq('id', options.currentLeadId).limit(1).maybeSingle();
  if (error) return { previousLeadId: null, nextLeadId: null, unavailable: true as const };
  if (!cursor) return { previousLeadId: null, nextLeadId: null };
  let unavailable = false;

  const excludedIds = [...new Set((options.excludedLeadIds ?? []).filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)).map((id) => id.toLowerCase()))].slice(0, 5000);
  const excluded = new Set(excludedIds);
  const needsBatches = excludedIds.length > 100;

  function orderedQuery(direction: Direction) {
    let query = prospectingQueueQuery(supabase, options);
    for (const { column, ascending, nullsFirst } of queueNeighborOrderFields(fields, direction)) {
      query = query.order(column, { ascending, nullsFirst });
    }
    if (excludedIds.length && !needsBatches) query = query.not('id', 'in', `(${excludedIds.join(',')})`);
    return query.limit(needsBatches ? 100 : 1);
  }

  async function neighbor(direction: Direction) {
    let currentCursor = cursor as unknown as Record<string, unknown>;
    // Large work sessions use bounded keyset batches instead of an oversized GET URL.
    // At most the visited set plus one fresh batch is examined, never the full table.
    for (let batch = 0; batch <= Math.ceil(excludedIds.length / 100); batch += 1) {
      const { data, error: candidateError } = await orderedQuery(direction)
        .or(queueNeighborFilter(fields, currentCursor, direction));
      if (candidateError) { unavailable = true; return null; }
      const candidates = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;
      const next = candidates.find((candidate) => !excluded.has(candidate.id));
      if (next) return next.id;
      if (!needsBatches || candidates.length < 100) return null;
      currentCursor = candidates[candidates.length - 1];
    }
    return null;
  }

  const [previousLeadId, nextLeadId] = await Promise.all([neighbor('previous'), neighbor('next')]);
  return { previousLeadId, nextLeadId, ...(unavailable ? { unavailable: true as const } : {}) };
}

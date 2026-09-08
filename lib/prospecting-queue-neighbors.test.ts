import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/lib/supabase/schema';
import { prospectingQueueContextFromParams, prospectingQueueOrderFields } from '@/lib/prospecting';
import { loadProspectingQueueNeighbors, queueNeighborFilter, queueNeighborOrderFields } from '@/lib/prospecting-queue-neighbors';

type Row = Record<string, string | null>;
type Order = { column: string; ascending: boolean; nullsFirst?: boolean };

// Interpret the emitted PostgREST subset so cursor predicates can be checked against a full sorted queue.
function splitExpressions(value: string) {
  const expressions: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted && character === '\\') { index += 1; continue; }
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      expressions.push(value.slice(start, index));
      start = index + 1;
    }
  }
  expressions.push(value.slice(start));
  return expressions;
}

function matches(expression: string, row: Row): boolean {
  for (const operator of ['and', 'or']) {
    if (expression.startsWith(`${operator}(`)) {
      const children = splitExpressions(expression.slice(operator.length + 1, -1));
      return operator === 'and' ? children.every((child) => matches(child, row)) : children.some((child) => matches(child, row));
    }
  }
  const parsed = /^([a-z_]+)\.(not\.is|is|eq|gt|lt)\.(.*)$/s.exec(expression);
  if (!parsed) throw new Error(`Unsupported filter: ${expression}`);
  const [, column, operator, raw] = parsed;
  const actual = row[column];
  if (operator === 'is') return actual === null;
  if (operator === 'not.is') return actual !== null;
  const expected = raw.slice(1, -1).replace(/\\(.)/gs, '$1');
  if (actual === null) return false;
  if (operator === 'eq') return actual === expected;
  return operator === 'gt' ? actual > expected : actual < expected;
}

function compareRows(left: Row, right: Row, fields: readonly Order[]) {
  for (const { column, ascending, nullsFirst = !ascending } of fields) {
    const a = left[column];
    const b = right[column];
    if (a === b) continue;
    if (a === null) return nullsFirst ? -1 : 1;
    if (b === null) return nullsFirst ? 1 : -1;
    return (a < b ? -1 : 1) * (ascending ? 1 : -1);
  }
  return 0;
}

const LIST_ID = '11111111-2222-3333-4444-555555555555';
const REP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CURRENT_ID = '00000000-0000-0000-0000-000000000002';
const PREVIOUS_ID = '00000000-0000-0000-0000-000000000001';
const NEXT_ID = '00000000-0000-0000-0000-000000000003';
const dates = [null, '2026-09-01T10:00:00+00:00', '2026-09-08T10:00:00+00:00'];
const rows: Row[] = Array.from({ length: 27 }, (_, index) => ({
  id: String(index).padStart(3, '0'),
  last_activity_at: dates[index % 3],
  next_follow_up_at: dates[Math.floor(index / 3) % 3],
  created_at: dates[Math.floor(index / 9)],
  updated_at: dates[index % 3],
  stage: ['interested', 'new', 'working'][Math.floor(index / 3) % 3],
  state_key: [null, 'IL', 'TX'][index % 3],
  city: [null, 'Austin (North)', 'Chicago'][Math.floor(index / 3) % 3],
  company_name: ['Acme, Inc.', 'Quote: "North"', 'Backslash:\\branch'][Math.floor(index / 9)],
}));

describe('prospecting queue neighbor cursors', () => {
  it.each([
    { tab: 'list' },
    { tab: 'tasks' },
    { tab: 'pipeline' },
    { tab: 'pipeline', stage: 'new' },
    { tab: 'list', list: LIST_ID },
  ])('finds exact adjacent rows under every queue ordering: %j', (params) => {
    const fields = prospectingQueueOrderFields(prospectingQueueContextFromParams(params));
    const sorted = [...rows].sort((left, right) => compareRows(left, right, fields));
    for (const [index, cursor] of sorted.entries()) {
      for (const direction of ['previous', 'next'] as const) {
        const predicate = `or(${queueNeighborFilter(fields, cursor, direction)})`;
        const candidates = sorted.filter((row) => matches(predicate, row));
        const actual = direction === 'previous' ? candidates.at(-1) : candidates[0];
        const expected = sorted[index + (direction === 'previous' ? -1 : 1)];
        expect(actual?.id).toBe(expected?.id);
      }
    }
  });

  it.each([
    { ascending: true, nullsFirst: true },
    { ascending: true, nullsFirst: false },
    { ascending: false, nullsFirst: true },
    { ascending: false, nullsFirst: false },
  ])('preserves explicit null placement in both directions: %j', (ordering) => {
    const fields = [{ column: 'updated_at', ...ordering }, { column: 'id', ascending: true }];
    const sorted = [...rows].sort((left, right) => compareRows(left, right, fields));
    for (const [index, cursor] of sorted.entries()) {
      const next = sorted.filter((row) => matches(`or(${queueNeighborFilter(fields, cursor, 'next')})`, row));
      const previous = sorted.filter((row) => matches(`or(${queueNeighborFilter(fields, cursor, 'previous')})`, row));
      expect(next[0]?.id).toBe(sorted[index + 1]?.id);
      expect(previous.at(-1)?.id).toBe(sorted[index - 1]?.id);
    }
    expect(queueNeighborOrderFields(fields, 'previous')[0]).toEqual({
      column: 'updated_at', ascending: !ordering.ascending, nullsFirst: !ordering.nullsFirst,
    });
  });

  it('rejects a missing cursor field instead of silently treating it as null', () => {
    expect(() => queueNeighborFilter([{ column: 'created_at', ascending: true }], {}, 'next')).toThrow('Missing queue cursor field');
  });
});

function queryFixture(responseFor: (url: URL) => unknown[], status = 200) {
  const requests: URL[] = [];
  const supabase = createClient<Database>('https://queue.test.supabase.co', 'test-key', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return new Response(JSON.stringify(responseFor(url)), { status, headers: { 'Content-Type': 'application/json' } });
      },
    },
  });
  return { supabase, requests };
}

const cursor = { ...rows[10], id: CURRENT_ID };
const options = {
  currentLeadId: CURRENT_ID,
  profileId: REP_ID,
  today: '2026-09-08',
  todayStartIso: '2026-09-08T05:00:00.000Z',
};

describe('prospecting neighbor requests through the installed Supabase client', () => {
  it('keeps every queue filter on membership and both bounded neighbor queries', async () => {
    const { supabase, requests } = queryFixture((url) => {
      if (url.searchParams.get('id') === `eq.${CURRENT_ID}`) return [cursor];
      return [{ id: url.searchParams.get('order')?.startsWith('created_at.desc') ? PREVIOUS_ID : NEXT_ID }];
    });
    const context = prospectingQueueContextFromParams({
      tab: 'pipeline', stage: 'new', priority: 'high', state: 'IL', list: LIST_ID,
      q: 'Acme "West" (R&D)\\North',
    });

    expect(await loadProspectingQueueNeighbors(supabase, { ...options, context })).toEqual({
      previousLeadId: PREVIOUS_ID, nextLeadId: NEXT_ID,
    });
    expect(requests).toHaveLength(3);
    for (const url of requests) {
      expect(url.searchParams.get('limit')).toBe('1');
      expect(url.searchParams.get('assigned_profile_id')).toBe(`eq.${REP_ID}`);
      expect(url.searchParams.get('archived_at')).toBe('is.null');
      expect(url.searchParams.get('stage')).toBe('in.(new)');
      expect(url.searchParams.get('priority')).toBe('eq.high');
      expect(url.searchParams.get('state_key')).toBe('eq.IL');
      expect(url.searchParams.get('prospecting_list_leads.list_id')).toBe(`eq.${LIST_ID}`);
      expect(url.searchParams.get('select')).toContain('prospecting_list_leads!inner(list_id)');
      const filters = url.searchParams.getAll('or');
      expect(filters).toContain('(next_follow_up_at.is.null,next_follow_up_at.gt.2026-09-08)');
      expect(filters).toContain('(last_activity_at.is.null,last_activity_at.lt.2026-09-08T05:00:00.000Z)');
      const quotedSearch = String.raw`"%Acme \"West\" (R&D)\\North%"`;
      expect(filters).toContain(`(${['company_name', 'phone', 'company_email', 'city', 'state', 'last_result']
        .map((column) => `${column}.ilike.${quotedSearch}`).join(',')})`);
    }
    expect(requests[1].searchParams.get('order')).toBe('created_at.desc.nullsfirst,id.desc.nullsfirst');
    expect(requests[2].searchParams.get('order')).toBe('created_at.asc.nullslast,id.asc.nullslast');
  });

  it('retains due-task, missing-state, and unassigned-owner filters', async () => {
    const { supabase, requests } = queryFixture((url) => url.searchParams.has('id') ? [cursor] : []);
    const context = prospectingQueueContextFromParams({ tab: 'tasks', state: 'missing' });

    expect(await loadProspectingQueueNeighbors(supabase, { ...options, context, profileId: null })).toEqual({
      previousLeadId: null, nextLeadId: null,
    });
    for (const url of requests) {
      expect(url.searchParams.get('assigned_profile_id')).toBe('is.null');
      expect(url.searchParams.get('state_key')).toBe('is.null');
      expect(url.searchParams.getAll('next_follow_up_at')).toEqual(['not.is.null', 'lte.2026-09-08']);
      expect(url.searchParams.get('stage')).toBe('in.(new,working,follow_up,interested)');
    }
  });

  it('falls back to the first matching queue row when the current lead left its filters', async () => {
    const { supabase, requests } = queryFixture((url) => url.searchParams.get('id') === `eq.${CURRENT_ID}` ? [] : [{ id: NEXT_ID }]);
    const context = prospectingQueueContextFromParams({ tab: 'list', list: LIST_ID });

    expect(await loadProspectingQueueNeighbors(supabase, { ...options, context })).toEqual({
      previousLeadId: null, nextLeadId: NEXT_ID,
    });
    expect(requests).toHaveLength(2);
    expect(requests[1].searchParams.get('id')).toBe(`neq.${CURRENT_ID}`);
    expect(requests[1].searchParams.get('limit')).toBe('1');
    expect(requests[1].searchParams.get('order')).toBe('state_key.asc.nullslast,city.asc.nullslast,company_name.asc.nullslast,id.asc.nullslast');
  });

  it('does not mistake a membership query failure for a lead leaving the queue', async () => {
    const { supabase, requests } = queryFixture(() => [], 400);
    const context = prospectingQueueContextFromParams({ tab: 'list' });
    expect(await loadProspectingQueueNeighbors(supabase, { ...options, context })).toEqual({
      previousLeadId: null, nextLeadId: null,
    });
    expect(requests).toHaveLength(1);
  });
});

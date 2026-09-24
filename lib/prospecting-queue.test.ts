import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '@/lib/supabase/schema';
import { prospectingLeadPath, prospectingOriginPath, prospectingPath, prospectingQueueContextFromParams, prospectingQueueHiddenFields } from '@/lib/prospecting';
import { orderedProspectingQueueQuery, prospectingQueueQuery, prospectingTodayGroup } from '@/lib/prospecting-queue';

const REP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const LIST_ID = '11111111-2222-3333-4444-555555555555';
const date = { today: '2026-09-24', todayStartIso: '2026-09-24T05:00:00.000Z', profileId: REP_ID };

function fixture() {
  const requests: URL[] = [];
  const supabase = createClient<Database>('https://queue.test.supabase.co', 'test-key', {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: async (input) => {
      requests.push(new URL(String(input)));
      return new Response('[]', { headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/0' } });
    } },
  });
  return { requests, supabase };
}

describe('Today queue contracts', () => {
  it('defaults new entry points to Today while retaining legacy task URLs', () => {
    expect(prospectingQueueContextFromParams(null).tab).toBe('today');
    expect(prospectingQueueContextFromParams({ tab: 'tasks' }).tab).toBe('tasks');
    const list = prospectingQueueContextFromParams({ tab: 'list' });
    expect(prospectingQueueContextFromParams(new URLSearchParams(prospectingPath(list).split('?')[1])).tab).toBe('list');
  });

  it('uses one exact union for Today rows and counts, excluding DNC and archived leads', async () => {
    const { supabase, requests } = fixture();
    const context = prospectingQueueContextFromParams({ q: 'Clinic (West), Inc', priority: 'high', state: 'IL', list: LIST_ID });
    await orderedProspectingQueueQuery(supabase, { ...date, context }, undefined, { count: 'exact' }).range(25, 49);
    await prospectingQueueQuery(supabase, { ...date, context }, 'id', { count: 'exact', head: true });
    const [rows, count] = requests;
    for (const key of ['assigned_profile_id', 'archived_at', 'do_not_contact', 'stage', 'priority', 'state_key', 'prospecting_list_leads.list_id', 'or']) {
      expect(rows.searchParams.getAll(key)).toEqual(count.searchParams.getAll(key));
    }
    expect(rows.searchParams.get('do_not_contact')).toBe('eq.false');
    expect(rows.searchParams.get('stage')).toBe('in.(new,working,follow_up,interested)');
    expect(rows.searchParams.getAll('or')).toContain('(next_follow_up_at.lte.2026-09-24,and(stage.eq.new,next_follow_up_at.is.null,or(last_activity_at.is.null,last_activity_at.lt.2026-09-24T05:00:00.000Z)))');
    expect(rows.searchParams.get('order')).toBe('next_follow_up_at.asc.nullslast,last_activity_at.asc.nullslast,created_at.asc.nullslast,id.asc.nullslast');
    expect(rows.searchParams.get('offset')).toBe('25');
    expect(rows.searchParams.get('limit')).toBe('25');
  });

  it.each([
    { preset: 'overdue', dates: ['not.is.null', 'lt.2026-09-24'], stages: 'in.(new,working,follow_up,interested)' },
    { preset: 'due_today', dates: ['eq.2026-09-24'], stages: 'in.(new,working,follow_up,interested)' },
    { preset: 'new', dates: ['is.null'], stages: 'in.(new)' },
    { preset: 'upcoming', dates: ['gt.2026-09-24'], stages: 'in.(new,working,follow_up,interested)' },
    { preset: 'needs_scheduling', dates: ['is.null'], stages: 'in.(working,follow_up,interested)' },
  ])('keeps $preset membership explicit', async ({ preset, dates, stages }) => {
    const { supabase, requests } = fixture();
    await prospectingQueueQuery(supabase, { ...date, context: prospectingQueueContextFromParams({ preset }) });
    expect(requests[0].searchParams.getAll('next_follow_up_at')).toEqual(dates);
    expect(requests[0].searchParams.get('stage')).toBe(stages);
    if (preset === 'new') expect(requests[0].searchParams.getAll('or')).toContain('(last_activity_at.is.null,last_activity_at.lt.2026-09-24T05:00:00.000Z)');
  });

  it('keeps legacy tasks due-only and does not pull unscheduled New into them', async () => {
    const { supabase, requests } = fixture();
    await prospectingQueueQuery(supabase, { ...date, context: prospectingQueueContextFromParams({ tab: 'tasks' }) });
    expect(requests[0].searchParams.getAll('next_follow_up_at')).toEqual(['not.is.null', 'lte.2026-09-24']);
    expect(requests[0].searchParams.has('or')).toBe(false);
  });

  it('labels Today groups using the shared Central calendar date', () => {
    expect(prospectingTodayGroup('2026-09-23', date.today)).toBe('Overdue');
    expect(prospectingTodayGroup(date.today, date.today)).toBe('Due today');
    expect(prospectingTodayGroup(null, date.today)).toBe('New');
  });
});

describe('origin and preset context', () => {
  it('preserves manager filters and Today presets through URLs and hidden forms', () => {
    const context = prospectingQueueContextFromParams({ preset: 'overdue', origin: 'leads', run_id: REP_ID, return_to: '/admin/sales/prospecting/admin?tab=leads&state=IL&page=4', state: 'IL', page: '2' });
    const url = prospectingLeadPath('lead-id', context);
    expect(prospectingQueueContextFromParams(new URLSearchParams(url.split('?').slice(1).join('?')))).toEqual(context);
    const form = new FormData();
    prospectingQueueHiddenFields(context).forEach(({ name, value }) => form.set(name, value));
    expect(prospectingQueueContextFromParams(form)).toEqual(context);
    expect(prospectingOriginPath(context)).toBe('/admin/sales/prospecting/admin?tab=leads&state=IL&page=4');
  });

  it.each(['https://example.com', '//example.com', '/admin/sales/prospecting/admin\\evil', '/admin/sales/prospecting/admin/../../users', '/admin/users'])('rejects an unapproved return path: %s', (return_to) => {
    const context = prospectingQueueContextFromParams({ origin: 'samples', return_to });
    expect(context.returnTo).toBeUndefined();
    expect(prospectingOriginPath(context)).toBe('/admin/sales/prospecting/admin?tab=samples');
  });
});

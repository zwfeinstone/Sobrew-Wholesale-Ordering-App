import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/supabase/schema';
import { prospectingQueueContextFromParams } from '@/lib/prospecting';

vi.mock('next/link', () => ({ default: ({ scroll: _scroll, ...props }: Record<string, unknown>) => createElement('a', props) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));

import ProspectingQueuePanel from '@/components/prospecting-queue-panel';
import ProspectingWorkspaceNav from '@/components/prospecting-workspace-nav';

const repId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const leadId = '11111111-2222-4333-8444-555555555555';
const workedAt = '2026-10-05T14:30:00.000Z';
const futureLead = {
  id: leadId, company_name: 'Future follow-up lead', phone: '3125550101', company_email: null,
  address_line_1: null, city: 'Chicago', state: 'IL', postal_code: null,
  stage: 'follow_up', priority: 'normal', next_follow_up_at: '2099-11-05',
  last_result: 'Reached gatekeeper', last_activity_at: workedAt,
};
let rows = [futureLead];
let total = 1;
const database = createClient<Database>('https://queue.test.supabase.co', 'test-key', {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  global: { fetch: async (input) => {
    const isLeads = new URL(String(input)).pathname.endsWith('/prospecting_leads');
    return new Response(JSON.stringify(isLeads ? rows : []), {
      headers: { 'Content-Type': 'application/json', 'Content-Range': isLeads ? `0-${Math.max(0, rows.length - 1)}/${total}` : '0-0/0' },
    });
  } },
});

beforeEach(() => { rows = [futureLead]; total = 1; });

describe('Recently worked workspace', () => {
  it('links from Today to Recently worked without carrying a due-only preset or old page', () => {
    const context = prospectingQueueContextFromParams({ preset: 'overdue', page: '3', state: 'IL', rep: repId });
    const html = renderToStaticMarkup(createElement(ProspectingWorkspaceNav, { context }));
    const link = html.match(/href="([^"]+)"[^>]*>Recently worked<\/a>/);
    expect(link).not.toBeNull();
    const target = new URL(link![1].replaceAll('&amp;', '&'), 'https://example.test');
    expect(target.searchParams.get('tab')).toBe('recent');
    expect(target.searchParams.get('page')).toBe('1');
    expect(target.searchParams.has('preset')).toBe(false);
    expect(target.searchParams.get('state')).toBe('IL');
    expect(target.searchParams.get('rep')).toBe(repId);
  });

  it('shows a worked lead with its future follow-up, activity time, and recent navigation context', async () => {
    total = 51;
    const context = prospectingQueueContextFromParams({ tab: 'recent', rep: repId });
    const html = renderToStaticMarkup(await ProspectingQueuePanel({ context, currentLeadId: leadId, profileId: repId }));
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('>Recently worked</a>');
    expect(html).toContain('Latest activity first · Includes future follow-ups');
    expect(html).toContain('Future follow-up lead');
    expect(html).toContain('Nov 5, 2099');
    expect(html).toContain(`Last worked: <time dateTime="${workedAt}">`);
    expect(html).toContain(`lead=${leadId}&amp;tab=recent`);
    expect(html).toContain('name="tab" value="recent"');
    expect(html).toContain('tab=recent&amp;rep=');
    expect(html).toContain('page=2');
    expect(html).not.toContain('aria-label="Today filters"');
  });

  it('explains how worked leads appear and preserves the view when clearing filters', async () => {
    rows = [];
    total = 0;
    const context = prospectingQueueContextFromParams({ tab: 'recent', rep: repId });
    const html = renderToStaticMarkup(await ProspectingQueuePanel({ context, profileId: repId }));
    expect(html).toContain('No recently worked leads yet');
    expect(html).toContain('after a call, email, or note is logged, even with a future follow-up.');

    const filtered = renderToStaticMarkup(await ProspectingQueuePanel({ context: { ...context, q: 'No match' }, profileId: repId }));
    expect(filtered).toContain('No leads match these filters');
    expect(filtered).not.toContain('No recently worked leads yet');
    const clear = filtered.match(/href="([^"]+)"[^>]*>Clear filters<\/a>/);
    expect(clear).not.toBeNull();
    const target = new URL(clear![1].replaceAll('&amp;', '&'), 'https://example.test');
    expect(target.searchParams.get('tab')).toBe('recent');
    expect(target.searchParams.has('q')).toBe(false);
  });
});

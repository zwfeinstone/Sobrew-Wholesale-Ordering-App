import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { centerPricingFilters, centerPricingHref, loadCenterPricingDetail, loadCenterPricingList, pricingPage } from '@/lib/center-pricing';
import type { Database } from '@/lib/supabase/schema';

const leadId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const otherRep = '33333333-3333-4333-8333-333333333333';
const center = { id: leadId, company_name: 'Center', stage: 'sample_requested', archived_at: null, assigned_profile_id: actorId, quotes: [{ id: 'sent', sent_at: '2026-09-30T20:22:23Z' }] };
const filters = centerPricingFilters({});

function database(reply: (url: URL) => { rows?: unknown[]; status?: number } = () => ({ rows: [] })) {
  const requests: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); requests.push(url);
    const { rows = [], status = 200 } = reply(url);
    return new Response(JSON.stringify(status === 200 ? rows : { message: 'Unavailable', code: 'XX000' }), {
      status, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${rows.length - 1}/${rows.length}` },
    });
  });
  const client = createClient<Database>('https://pricing.example.test', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
  return { client, requests };
}

describe('center pricing access and history', () => {
  it('scopes the list to the current prospect assignment and fetches only sent summaries', async () => {
    const db = database();
    await loadCenterPricingList({ actorId, isOwner: false, supabase: db.client }, filters);
    const query = db.requests[0].searchParams;
    expect(query.get('assigned_profile_id')).toBe(`eq.${actorId}`);
    expect(query.get('quotes.sent_at')).toBe('not.is.null');
    expect(query.get('quotes')).toBe('not.is.null');
    expect(query.has('or')).toBe(false);
    expect(query.get('select')).not.toMatch(/body_html|body_text|sender_profile_id/);
    expect(query.get('quotes.limit')).toBe('1');
    expect(query.get('limit')).toBe('25');
  });

  it('transfers detail access to the current rep, regardless of the original sender', async () => {
    let assignedTo = actorId;
    const originalEmail = { id: 'saved', subject: 'Original price', body_html: '<p>$35.00</p>', sender_profile_id: actorId, sent_at: '2026-09-30T20:22:23Z' };
    const db = database(url => {
      const quoteQuery = url.pathname.endsWith('/prospecting_sample_quotes');
      const ownerFilter = url.searchParams.get(quoteQuery ? 'lead.assigned_profile_id' : 'assigned_profile_id');
      if (ownerFilter && ownerFilter !== `eq.${assignedTo}`) return { rows: [] };
      return { rows: quoteQuery ? [originalEmail] : [{ ...center, assigned_profile_id: assignedTo }] };
    });
    const access = { actorId, isOwner: false, supabase: db.client };
    const before = await loadCenterPricingDetail(access, leadId);
    expect(before.ok && before.emails[0].body_html).toBe('<p>$35.00</p>');
    assignedTo = otherRep;
    expect(await loadCenterPricingDetail(access, leadId)).toEqual({ ok: false, unavailable: true });
    const after = await loadCenterPricingDetail({ ...access, actorId: otherRep }, leadId);
    expect(after.ok && after.emails[0].body_html).toBe('<p>$35.00</p>');
    const emailsQuery = db.requests.at(-1)!.searchParams;
    expect(emailsQuery.get('select')).toContain('prospecting_sample_quotes_lead_id_fkey!inner');
    expect(emailsQuery.get('lead_id')).toBe(`eq.${leadId}`);
    expect(emailsQuery.get('sent_at')).toBe('not.is.null');
    expect(emailsQuery.has('sender_profile_id')).toBe(false);
  });

  it('scopes emails again if the assignment changes between the center and email reads', async () => {
    const db = database(url => ({ rows: url.pathname.endsWith('/prospecting_leads') ? [center] : [] }));
    const result = await loadCenterPricingDetail({ actorId, isOwner: false, supabase: db.client }, leadId);
    expect(result.ok && result.emails).toEqual([]);
    expect(db.requests[1].searchParams.get('lead.assigned_profile_id')).toBe(`eq.${actorId}`);
  });

  it('allows superadmins to see unassigned and historical centers without order or stage restrictions on email history', async () => {
    const db = database(url => ({ rows: url.pathname.endsWith('/prospecting_leads') ? [{ ...center, assigned_profile_id: null, archived_at: '2026-10-10', stage: 'won' }] : [] }));
    const access = { actorId, isOwner: true, supabase: db.client };
    await loadCenterPricingList(access, filters);
    const result = await loadCenterPricingDetail(access, leadId);
    expect(result.ok).toBe(true);
    for (const query of db.requests.map(url => url.searchParams)) {
      expect(query.has('assigned_profile_id')).toBe(false);
      expect(query.has('lead.assigned_profile_id')).toBe(false);
      expect(query.get('select')).not.toMatch(/orders[(!]/);
    }
  });

  it('rejects malformed identifiers before reading any private data', async () => {
    const db = database();
    expect(await loadCenterPricingDetail({ actorId, isOwner: false, supabase: db.client }, '../other')).toEqual({ ok: false, unavailable: true });
    expect(db.requests).toHaveLength(0);
  });

  it('reports lookup and message failures instead of showing empty history', async () => {
    const db = database(() => ({ status: 500 }));
    expect(await loadCenterPricingList({ actorId, isOwner: false, supabase: db.client }, filters)).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await loadCenterPricingDetail({ actorId, isOwner: false, supabase: db.client }, leadId)).toMatchObject({ ok: false, error: expect.any(String) });
    const emailFailure = database(url => url.pathname.endsWith('/prospecting_leads') ? { rows: [center] } : { status: 500 });
    expect(await loadCenterPricingDetail({ actorId, isOwner: false, supabase: emailFailure.client }, leadId)).toMatchObject({ ok: false, error: expect.stringContaining('emails') });
  });

  it.each(['all', 'sent', 'awaiting'])('only lists sent pricing even with an old %s status URL', async status => {
    const db = database();
    await loadCenterPricingList({ actorId, isOwner: false, supabase: db.client }, centerPricingFilters({ status, page: '2', q: '50%_Center' }));
    const query = db.requests[0].searchParams;
    expect(query.get('quotes')).toBe('not.is.null');
    expect(query.get('quotes.sent_at')).toBe('not.is.null');
    expect(query.get('offset')).toBe('25');
    expect(query.get('company_name')).toBe('ilike.%50\\%\\_Center%');
    expect(query.get('order')).toBe('company_name.asc,id.asc');
  });

  it('paginates saved messages newest first', async () => {
    const db = database(url => ({ rows: url.pathname.endsWith('/prospecting_leads') ? [center] : [] }));
    await loadCenterPricingDetail({ actorId, isOwner: false, supabase: db.client }, leadId, 2);
    expect(db.requests[1].searchParams.get('offset')).toBe('5');
    expect(db.requests[1].searchParams.get('limit')).toBe('5');
    expect(db.requests[1].searchParams.get('order')).toBe('sent_at.desc,id.asc');
  });
});

describe('center pricing navigation', () => {
  it('normalizes filters and preserves search in paging links', () => {
    const value = centerPricingFilters({ q: ' Lake & Valley ', status: 'sent', page: '2' });
    expect(centerPricingHref(value, 3)).toBe('/admin/center-pricing?q=Lake+%26+Valley&page=3');
    expect(centerPricingFilters({ q: ['bad'], page: '-1', status: 'unknown' })).toEqual(filters);
    for (const value of ['NaN', 'Infinity', '1.5', '0', undefined]) expect(pricingPage(value)).toBe(1);
  });
});

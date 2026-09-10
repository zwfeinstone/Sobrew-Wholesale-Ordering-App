import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, any>>>,
  push: vi.fn(),
}));
vi.mock('@/lib/prospecting-hubspot-export', () => ({ pushProspectingHubSpotLeadWithTracking: state.push }));
vi.mock('@/lib/env', () => ({ env: { cronSecret: 'cron-secret', hubspotAccessToken: 'test-token' } }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => database }));

import { isSampleHubSpotSyncTime, pushRequestedSamplesToHubSpot } from './prospecting-hubspot-schedule';
import { GET } from '@/app/api/cron/prospecting-hubspot/route';

const database = {
  from(table: string) {
    const predicates: Array<(row: Record<string, any>) => boolean> = [];
    let limit = Infinity;
    let offset = 0;
    let insert: Record<string, any> | undefined;
    return {
      select() { return this; }, order() { return this; },
      eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return this; },
      neq(key: string, value: unknown) { predicates.push((row) => row[key] !== value); return this; },
      gt(key: string, value: string) { predicates.push((row) => row[key] > value); return this; },
      lte(key: string, value: string) { predicates.push((row) => row[key] <= value); return this; },
      is(key: string, value: unknown) { predicates.push((row) => row[key] === value); return this; },
      not(key: string, _op: string, value: unknown) { predicates.push((row) => row[key] !== value); return this; },
      in(key: string, values: unknown[]) { predicates.push((row) => values.includes(row[key])); return this; },
      limit(count: number) { limit = count; return this; },
      range(start: number, end: number) { offset = start; limit = end - start + 1; return this; },
      insert(row: Record<string, any>) { insert = row; return this; },
      then(resolve: (value: unknown) => unknown) {
        if (insert) state.tables[table].push(insert);
        return Promise.resolve({ data: state.tables[table].filter((row) => predicates.every((predicate) => predicate(row))).slice(offset, offset + limit), error: null }).then(resolve);
      },
    };
  },
};

function lead(id: string, changes: Record<string, unknown> = {}) {
  return { id, assigned_profile_id: 'rep-1', company_name: `Center ${id}`, stage: 'sample_requested',
    do_not_contact: false, archived_at: null, hubspot_status: 'queued', sample_requested_at: '2026-09-10T16:00:00Z', ...changes };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T22:00:00Z'));
  state.tables = { prospecting_leads: [], prospecting_contacts: [], prospecting_activities: [],
    profiles: [{ id: 'rep-1', email: 'rep@example.com' }], cron_run_log: [] };
  state.push.mockReset().mockImplementation(async ({ lead: row }) => {
    row.hubspot_status = 'exported';
    return { status: 'exported', message: 'Exported' };
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('daily sample HubSpot schedule', () => {
  const crons: Array<{ path: string; schedule: string }> = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  ).crons;

  it('uses only once-daily schedules supported by Vercel Hobby', () => {
    expect(crons.length).toBeLessThanOrEqual(100);
    for (const { schedule } of crons) {
      expect(schedule).toMatch(/^(?:[0-5]?\d) (?:[01]?\d|2[0-3]) \* \* \*$/);
    }
  });

  it.each([
    '2026-09-10', '2027-01-10', '2027-03-14', '2026-11-01',
  ])('configured jobs produce one accepted run despite up to 59 minutes of delay on %s', (day) => {
    const hubspotCrons = crons.filter(({ path }) => path === '/api/cron/prospecting-hubspot');
    for (const delay of [0, 59]) {
      const accepted = hubspotCrons.filter(({ schedule }) => {
        const [minute, hour] = schedule.split(' ').map(Number);
        const invocation = new Date(`${day}T00:00:00Z`);
        invocation.setUTCHours(hour, minute + delay);
        return isSampleHubSpotSyncTime(invocation);
      });
      expect(accepted).toHaveLength(1);
    }
  });

  it.each([
    ['2026-09-10T22:00:00Z', true], ['2026-09-10T23:00:00Z', false],
    ['2027-01-10T23:00:00Z', true], ['2027-01-10T22:00:00Z', false],
    ['2027-03-14T22:00:00Z', true], ['2026-11-01T23:00:00Z', true],
    ['2026-09-10T22:55:00Z', true],
  ])('handles Central time and delayed invocations at %s', (date, expected) => {
    expect(isSampleHubSpotSyncTime(new Date(date))).toBe(expected);
  });

  it('excludes the existing backlog, exported leads, other stages, archived and do-not-contact records', async () => {
    state.tables.prospecting_leads = [
      lead('a', { sample_requested_at: null }), lead('b', { hubspot_status: 'exported' }),
      lead('c', { stage: 'interested' }), lead('d', { archived_at: '2026-09-10' }),
      lead('e', { do_not_contact: true }), lead('f'), lead('g', { sample_requested_at: '2026-09-10T22:15:00Z' }),
    ];
    const result = await pushRequestedSamplesToHubSpot(database);
    expect(result.exported).toBe(1);
    expect(state.push.mock.calls.map(([input]) => input.lead.id)).toEqual(['f']);
    expect(state.push.mock.calls[0][0]).toMatchObject({ ownerEmail: 'rep@example.com', actorId: null });
  });

  it('processes all batches without skipping leads as successful exports leave the queue', async () => {
    state.tables.prospecting_leads = Array.from({ length: 23 }, (_, i) => lead(String(i).padStart(3, '0')));
    const result = await pushRequestedSamplesToHubSpot(database);
    expect(result.exported).toBe(23);
    expect(new Set(state.push.mock.calls.map(([input]) => input.lead.id)).size).toBe(23);
    await pushRequestedSamplesToHubSpot(database);
    expect(state.push).toHaveBeenCalledTimes(23);
  });

  it('continues after a failure and keeps the failed record available for retry', async () => {
    state.tables.prospecting_leads = [lead('a'), lead('b')];
    state.push.mockImplementationOnce(async () => ({ status: 'error', message: 'Missing contact email' }));
    const result = await pushRequestedSamplesToHubSpot(database);
    expect(result.exported).toBe(1);
    expect(result.errors).toEqual([{ leadId: 'a', message: 'Missing contact email' }]);
    expect(state.tables.prospecting_leads[0].hubspot_status).toBe('queued');
  });

  it('reports unfinished work at the execution deadline', async () => {
    const result = await pushRequestedSamplesToHubSpot(database, 0);
    expect(result.incomplete).toBe(true);
    expect(state.push).not.toHaveBeenCalled();
  });

  it('requires the cron secret before reading or pushing anything', async () => {
    const response = await GET(new Request('https://example.com/api/cron/prospecting-hubspot'));
    expect(response.status).toBe(401);
    expect(state.tables.cron_run_log).toHaveLength(0);
  });

  it('runs at 5 p.m. and records the result', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T22:00:00Z'));
    state.tables.prospecting_leads = [lead('a')];
    const response = await GET(new Request('https://example.com/api/cron/prospecting-hubspot', { headers: { authorization: 'Bearer cron-secret' } }));
    expect(response.status).toBe(200);
    expect(state.tables.cron_run_log[0]).toMatchObject({ job_name: 'prospecting_hubspot', created_count: 1, status: 'success' });
  });

  it('skips the daylight-saving alternate invocation outside 5 p.m.', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T23:00:00Z'));
    const response = await GET(new Request('https://example.com/api/cron/prospecting-hubspot', { headers: { authorization: 'Bearer cron-secret' } }));
    expect(await response.json()).toMatchObject({ skipped: true });
    expect(state.push).not.toHaveBeenCalled();
  });
});

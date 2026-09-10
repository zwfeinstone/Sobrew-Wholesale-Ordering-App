import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  claimed: true,
  push: vi.fn(),
  note: vi.fn(),
  writes: [] as Array<{ table: string; operation: string; values: Record<string, unknown>; filters: Record<string, unknown> }>,
}));
vi.mock('@/lib/env', () => ({ env: { hubspotAccessToken: 'token', hubspotDealPipeline: 'default', hubspotSampleRequestedDealStage: 'samples' } }));
vi.mock('@/lib/hubspot-prospecting', () => ({ pushProspectingLeadToHubSpot: state.push, syncHubSpotProspectingActivityNote: state.note }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => database }));

import { pushProspectingHubSpotLeadWithTracking } from './prospecting-hubspot-export';

const database = {
  rpc: async () => ({ data: state.claimed, error: null }),
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let operation = '';
    let values = {};
    const result = () => {
      state.writes.push({ table, operation, values, filters });
      return { data: { id: 'export-activity' }, error: null };
    };
    return {
      eq(key: string, value: unknown) { filters[key] = value; return this; },
      update(row: Record<string, unknown>) { operation = 'update'; values = row; return this; },
      insert(row: Record<string, unknown>) { operation = 'insert'; values = row; return this; },
      delete() { operation = 'delete'; return this; },
      select() { return this; }, single: async () => result(),
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
  },
};
const input = () => ({
  supabase: database, lead: { id: 'lead-1', company_name: 'Center', stage: 'sample_requested' },
  contacts: [{ full_name: 'Jane', email: 'jane@example.com' }], activities: [], ownerEmail: 'rep@example.com', actorId: null,
});
beforeEach(() => {
  state.claimed = true; state.writes.length = 0; state.push.mockReset(); state.note.mockReset().mockResolvedValue('note-export');
  state.push.mockResolvedValue({ status: 'exported', companyId: 'company-1', contactId: 'contact-1', contactIds: ['contact-1'],
    dealId: 'deal-1', noteId: null, activityNoteIds: {}, message: 'Exported' });
});

describe('tracked HubSpot export', () => {
  it('skips an already claimed/exported lead before contacting HubSpot', async () => {
    state.claimed = false;
    expect((await pushProspectingHubSpotLeadWithTracking(input())).status).toBe('skipped');
    expect(state.push).not.toHaveBeenCalled();
    expect(state.writes).toHaveLength(0);
  });

  it('rejects incomplete sample contacts before any HubSpot writes and releases the lease', async () => {
    const result = await pushProspectingHubSpotLeadWithTracking({ ...input(), contacts: [{ email: 'jane@example.com' }] });
    expect(result.status).toBe('error');
    expect(state.push).not.toHaveBeenCalled();
    expect(state.writes.at(-1)).toMatchObject({ table: 'prospecting_hubspot_push_locks', operation: 'delete', filters: { lead_id: 'lead-1' } });
  });

  it('saves a created deal ID before a later failure so a retry can reuse it', async () => {
    state.push.mockImplementationOnce(async ({ onProgress }) => {
      await onProgress({ dealId: 'deal-created' });
      await onProgress({ activityNoteIds: { 'activity-1': 'note-created' } });
      throw new Error('Later association failed');
    });
    const result = await pushProspectingHubSpotLeadWithTracking(input());
    expect(result).toEqual({ status: 'error', message: 'Later association failed' });
    expect(state.writes.some(({ values }) => values.hubspot_deal_id === 'deal-created')).toBe(true);
    expect(state.writes.some(({ values, filters }) => values.hubspot_note_id === 'note-created' && filters.id === 'activity-1')).toBe(true);
    expect(state.writes.some(({ values }) => values.hubspot_status === 'exported')).toBe(false);
    expect(state.writes.at(-1)?.operation).toBe('delete');
  });

  it('marks successful exports and records the automatic actor without impersonating a sales rep', async () => {
    const result = await pushProspectingHubSpotLeadWithTracking(input());
    expect(result.status).toBe('exported');
    expect(state.writes.some(({ values }) => values.hubspot_status === 'exported' && values.hubspot_exported_by === null)).toBe(true);
    expect(state.push.mock.calls[0][0].ownerEmail).toBe('rep@example.com');
    expect(state.writes.at(-1)?.table).toBe('prospecting_hubspot_push_locks');
  });
});

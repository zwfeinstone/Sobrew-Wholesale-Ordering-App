import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  owner: true,
  canEdit: true,
  actor: '11111111-1111-4111-8111-111111111111',
  lead: null as Record<string, unknown> | null,
  leadError: null as { message: string } | null,
  filters: [] as Array<[string, string, unknown]>,
  createClient: vi.fn(),
  commit: vi.fn(),
  replay: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({
  adminCanEdit: () => state.canEdit,
  getCurrentAdminAccess: async () => ({ isOwner: state.owner, access: {}, profile: { id: state.actor } }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.createClient() }));
vi.mock('@/lib/prospecting-mutations', () => ({
  commitProspectingRecord: (...args: unknown[]) => state.commit(...args),
  readProspectingMutationReceiptChecked: (...args: unknown[]) => state.replay(...args),
}));
import { markSampleOutcome } from '@/app/admin/sales/prospecting/admin/sample-outcome';

const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ID = '44444444-4444-4444-8444-444444444444';
const VERSION = '2026-10-01T10:00:00.123456+00:00';
const lead = {
  id: LEAD_ID,
  company_name: 'Test treatment center',
  company_name_key: 'test treatment center',
  phone: '3125550199',
  phone_key: '3125550199',
  company_email: null,
  address_line_1: '123 Main St',
  city: 'Chicago',
  state: 'IL',
  state_key: 'IL',
  country: 'US',
  stage: 'sample_requested',
  priority: 'normal',
  assigned_profile_id: state.actor,
  next_follow_up_at: '2026-10-02',
  notes: 'Preserve existing lead notes.',
  hubspot_status: 'exported',
  hubspot_deal_id: 'existing-deal',
  hubspot_exported_at: '2026-09-29T10:00:00+00:00',
  updated_at: VERSION,
  archived_at: null,
};
const receipt = { leadId: LEAD_ID, stage: 'lost', replayed: false };

function form(outcome = 'lost') {
  const data = new FormData();
  Object.entries({ lead_id: LEAD_ID, submission_id: SUBMISSION_ID, expected_updated_at: VERSION, outcome, outcome_note: '  Too expensive  ' })
    .forEach(([key, value]) => data.set(key, value));
  return data;
}

class LeadQuery {
  select() { return this; }
  eq(field: string, value: unknown) { state.filters.push(['eq', field, value]); return this; }
  is(field: string, value: unknown) { state.filters.push(['is', field, value]); return this; }
  async maybeSingle() { return { data: state.lead, error: state.leadError }; }
}

beforeEach(() => {
  Object.assign(state, { owner: true, canEdit: true, lead: structuredClone(lead), leadError: null, filters: [] });
  state.createClient.mockReset().mockResolvedValue({ from: () => new LeadQuery() });
  state.replay.mockReset().mockResolvedValue({ ok: true, receipt: null });
  state.commit.mockReset().mockResolvedValue({ ok: true, receipt });
});

describe('sample outcome action', () => {
  it.each(['non-owner', 'read-only'])('rejects %s before checking receipts or records', async access => {
    if (access === 'non-owner') state.owner = false;
    else state.canEdit = false;
    expect(await markSampleOutcome(form())).toMatchObject({ ok: false, message: expect.stringContaining('permission') });
    expect(state.replay).not.toHaveBeenCalled();
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.commit).not.toHaveBeenCalled();
  });

  it.each([
    ['lead_id', 'invalid'], ['submission_id', ''], ['expected_updated_at', ''],
    ['expected_updated_at', 'not-a-date'], ['expected_updated_at', '2026-10-01'],
    ['outcome', ''], ['outcome', 'won'],
  ])('rejects invalid %s without defaulting to won', async (field, value) => {
    const data = form(); data.set(field, value);
    expect(await markSampleOutcome(data)).toMatchObject({ ok: false });
    expect(state.replay).not.toHaveBeenCalled();
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('atomically records Lost and its note while preserving unrelated lead and export fields', async () => {
    expect(await markSampleOutcome(form())).toEqual({ ok: true });
    expect(state.filters).toEqual([['eq', 'id', LEAD_ID], ['is', 'archived_at', null]]);
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.commit.mock.calls[0][0]).toMatchObject({
      actorId: state.actor,
      leadId: LEAD_ID,
      submissionId: SUBMISSION_ID,
      expectedUpdatedAt: VERSION,
      lead: { ...lead, stage: 'lost', assigned_profile_id: null, next_follow_up_at: null },
      activity: {
        activity_type: 'stage_change', body: 'Too expensive', result: 'Lost',
        previous_stage: 'sample_requested', next_stage: 'lost', previous_assigned_profile_id: state.actor,
      },
    });
    const signature = state.commit.mock.calls[0][0].submissionSignature;
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
    expect(state.replay).toHaveBeenCalledWith(state.actor, SUBMISSION_ID, signature);
  });

  it('keeps the rep for Won and supplies the default activity note', async () => {
    state.commit.mockResolvedValue({ ok: true, receipt: { ...receipt, stage: 'converted' } });
    const data = form('converted'); data.set('outcome_note', ' ');
    expect(await markSampleOutcome(data)).toEqual({ ok: true });
    expect(state.commit.mock.calls[0][0]).toMatchObject({
      lead: { stage: 'converted', assigned_profile_id: state.actor, next_follow_up_at: null },
      activity: { body: 'Sample outcome marked won.', result: 'Won', next_stage: 'converted', previous_assigned_profile_id: null },
    });
  });

  it('recovers an interrupted save before loading the now-closed lead', async () => {
    state.lead = null;
    state.replay.mockResolvedValue({ ok: true, receipt: { ...receipt, replayed: true } });
    expect(await markSampleOutcome(form())).toEqual({ ok: true });
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.commit).not.toHaveBeenCalled();
  });

  it.each([
    { leadId: OTHER_ID, stage: 'lost' },
    { leadId: LEAD_ID, stage: 'converted' },
  ])('does not accept a receipt for another lead or outcome', async mismatch => {
    state.replay.mockResolvedValue({ ok: true, receipt: { ...receipt, ...mismatch } });
    expect(await markSampleOutcome(form())).toMatchObject({ ok: false });
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('binds recovery to the outcome, note and loaded version', async () => {
    const requests = [form(), form('converted'), form(), form()];
    requests[2].set('outcome_note', 'Different reason');
    requests[3].set('expected_updated_at', '2026-10-01T11:00:00+00:00');
    for (const request of requests) await markSampleOutcome(request);
    expect(new Set(state.replay.mock.calls.map(call => call[2])).size).toBe(4);
  });

  it('returns receipt lookup errors before any write', async () => {
    state.replay.mockResolvedValue({ ok: false, error: { message: 'This submission was already used with different values.' } });
    expect(await markSampleOutcome(form())).toEqual({ ok: false, message: 'This submission was already used with different values.' });
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.commit).not.toHaveBeenCalled();
  });

  it.each(['missing', 'load-error', 'stage-changed', 'version-changed'])('keeps the card when the lead is %s', async reason => {
    if (reason === 'missing') state.lead = null;
    if (reason === 'load-error') state.leadError = { message: 'Unavailable' };
    if (reason === 'stage-changed') state.lead = { ...lead, stage: 'working' };
    if (reason === 'version-changed') state.lead = { ...lead, updated_at: '2026-10-01T11:00:00+00:00' };
    expect(await markSampleOutcome(form())).toMatchObject({ ok: false });
    expect(state.commit).not.toHaveBeenCalled();
  });

  it('returns the atomic save error without a success response', async () => {
    state.commit.mockResolvedValue({ ok: false, error: { message: 'This lead changed while you were editing.' } });
    expect(await markSampleOutcome(form())).toEqual({ ok: false, message: 'This lead changed while you were editing.' });
  });

  it('recovers on the same submission after the save response is lost', async () => {
    state.commit.mockRejectedValueOnce(new Error('Connection interrupted after commit'));
    expect(await markSampleOutcome(form())).toMatchObject({ ok: false, message: expect.stringContaining('retry this same outcome') });
    state.replay.mockResolvedValueOnce({ ok: true, receipt: { ...receipt, replayed: true } });
    expect(await markSampleOutcome(form())).toEqual({ ok: true });
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.replay.mock.calls[0]).toEqual(state.replay.mock.calls[1]);
  });

  it('does not hide a card for a mismatched commit receipt', async () => {
    state.commit.mockResolvedValue({ ok: true, receipt: { ...receipt, leadId: OTHER_ID } });
    expect(await markSampleOutcome(form())).toMatchObject({ ok: false, message: expect.stringContaining('could not be confirmed') });
  });
});

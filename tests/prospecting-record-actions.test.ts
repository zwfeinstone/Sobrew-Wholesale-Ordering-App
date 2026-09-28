import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialRecordDraft, type RecordContact, type RecordLead, type RecordSaveInput } from '@/lib/prospecting-record';
import { prospectingSubmissionSignature } from '@/lib/prospecting-submission';

const state = vi.hoisted(() => ({
  enabled: true, canEdit: true, owner: false,
  actor: '11111111-1111-4111-8111-111111111111',
  lead: null as Record<string, unknown> | null,
  contacts: [] as Record<string, unknown>[],
  leadError: null as { message: string } | null,
  filters: [] as Array<{ table: string; op: string; field: string; value: unknown }>,
  createClient: vi.fn(), commit: vi.fn(), replay: vi.fn(), neighbors: vi.fn(), revalidate: vi.fn(), eligible: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => state.revalidate(...args) }));
vi.mock('@/lib/admin-permissions', () => ({ adminCanEdit: () => state.canEdit, getCurrentAdminAccess: async () => ({ isOwner: state.owner, access: {}, profile: { id: state.actor } }) }));
vi.mock('@/lib/prospecting-rollout', () => ({ isProspectingWorkspaceEnabled: () => state.enabled }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.createClient() }));
vi.mock('@/lib/prospecting-mutations', () => ({ commitProspectingRecord: (...args: unknown[]) => state.commit(...args), readProspectingMutationReceiptChecked: (...args: unknown[]) => state.replay(...args) }));
vi.mock('@/lib/prospecting-queue-neighbors', () => ({ loadProspectingQueueNeighbors: (...args: unknown[]) => state.neighbors(...args) }));
vi.mock('@/lib/prospecting-sales-reps', () => ({ isEligibleProspectingSalesRep: (...args: unknown[]) => state.eligible(...args) }));
import { saveProspectingRecord } from '@/app/admin/sales/prospecting/[id]/actions';

const LEAD_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const NEXT_ID = '44444444-4444-4444-8444-444444444444';
const SUBMISSION_ID = '55555555-5555-4555-8555-555555555555';
const CONTACT_ID = '66666666-6666-4666-8666-666666666666';
const loadedVersion = '2026-09-24T10:00:00.123456Z';
const lead: RecordLead = {
  id: LEAD_ID, assigned_profile_id: state.actor, company_name: 'Private company', phone: '3125550199', company_email: 'private@example.com', company_website: null,
  address_line_1: null, address_line_2: null, city: 'Chicago', state: 'IL', postal_code: null, country: 'US', notes: 'Private customer notes',
  stage: 'working', priority: 'normal', do_not_contact: false, next_follow_up_at: '2026-09-24', updated_at: loadedVersion,
};
const contact: RecordContact = { id: CONTACT_ID, full_name: 'Private buyer', email: 'buyer@example.com', phone: null, title: null, notes: null, is_primary: true };
const receipt = { leadId: LEAD_ID, updatedAt: '2026-09-24T11:00:00Z', stage: 'working', requestId: null, orderId: null, replayed: false };
function input(): RecordSaveInput {
  return { leadId: LEAD_ID, submissionId: SUBMISSION_ID, expectedUpdatedAt: loadedVersion, draft: initialRecordDraft(lead, [contact]), queueParams: 'tab=tasks&state=IL', visitedIds: [] };
}
class Query {
  constructor(private table: string) {}
  select() { return this; }
  private filter(op: string, field: string, value: unknown) { state.filters.push({ table: this.table, op, field, value }); return this; }
  eq(field: string, value: unknown) { return this.filter('eq', field, value); }
  neq(field: string, value: unknown) { return this.filter('neq', field, value); }
  is(field: string, value: unknown) { return this.filter('is', field, value); }
  result() { return this.table === 'prospecting_leads' ? { data: state.lead, error: state.leadError } : { data: state.contacts, error: null }; }
  maybeSingle() { return Promise.resolve(this.result()); }
  then(resolve: (result: ReturnType<Query['result']>) => unknown) { return Promise.resolve(this.result()).then(resolve); }
}
const database = { from: (table: string) => new Query(table) };

beforeEach(() => {
  Object.assign(state, { enabled: true, canEdit: true, owner: false, lead: structuredClone(lead), contacts: [structuredClone(contact)], leadError: null, filters: [] });
  for (const mock of [state.createClient, state.commit, state.replay, state.neighbors, state.revalidate, state.eligible]) mock.mockReset();
  state.createClient.mockResolvedValue(database);
  state.replay.mockResolvedValue({ ok: true, receipt: null });
  state.commit.mockResolvedValue({ ok: true, receipt });
  state.neighbors.mockResolvedValue({ previousLeadId: null, nextLeadId: NEXT_ID });
  state.eligible.mockResolvedValue(true);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('prospecting record server action boundaries', () => {
  it.each(['view-only', 'flag-off'] as const)('%s cannot read receipts, query records, or write', async mode => {
    if (mode === 'view-only') state.canEdit = false; else state.enabled = false;
    expect(await saveProspectingRecord(input())).toMatchObject({ ok: false, error: { code: 'unauthorized' } });
    expect(state.replay).not.toHaveBeenCalled();expect(state.createClient).not.toHaveBeenCalled();expect(state.commit).not.toHaveBeenCalled();
  });
  it('forces forged rep filters back to the authenticated rep and scopes record loading', async () => {
    const request = { ...input(), queueParams: `tab=pipeline&stage=working&rep=${OTHER_ID}&state=IL`, visitedIds: [OTHER_ID, 'invalid'] };
    const result = await saveProspectingRecord(request);
    expect(state.filters).toContainEqual({ table: 'prospecting_leads', op: 'eq', field: 'assigned_profile_id', value: state.actor });
    expect(state.filters).toContainEqual({ table: 'prospecting_leads', op: 'neq', field: 'stage', value: 'sample_requested' });
    expect(state.neighbors.mock.calls[0][1]).toMatchObject({ profileId: state.actor, context: { repId: state.actor, state: 'IL' }, excludedLeadIds: [OTHER_ID] });
    expect(state.commit.mock.calls[0][0]).toMatchObject({ actorId: state.actor, leadId: LEAD_ID, expectedUpdatedAt: loadedVersion, lead: { assigned_profile_id: state.actor } });
    expect(result.ok).toBe(true);
    if (result.ok) { const url = new URL(result.nextHref!, 'https://example.test');expect(url.pathname).toBe('/admin/sales/prospecting');expect(url.searchParams.get('lead')).toBe(NEXT_ID);expect(url.searchParams.get('rep')).toBe(state.actor); }
  });
  it('rejects a stale browser version without building a neighbor query or committing', async () => {
    state.lead = { ...lead, updated_at: '2026-09-24T11:00:00Z' };
    expect(await saveProspectingRecord(input())).toMatchObject({ ok: false, error: { code: 'record_stale' } });
    expect(state.neighbors).not.toHaveBeenCalled();expect(state.commit).not.toHaveBeenCalled();
  });
  it('uses the same raw-input signature for receipt recovery and commit', async () => {
    const request = input();const result = await saveProspectingRecord(request);
    const signature = prospectingSubmissionSignature(request);
    expect(state.replay).toHaveBeenCalledWith(state.actor, SUBMISSION_ID, signature);
    expect(state.commit.mock.calls[0][0].submissionSignature).toBe(signature);
    if (result.ok) expect(state.commit.mock.calls[0][0].nextHref).toBe(result.nextHref);
  });
  it('preserves a checked receipt signature error and never queries the current record', async () => {
    const failure = { ok: false, error: { code: 'submission_reused', message: 'Signed input changed', fieldErrors: {} } };
    state.replay.mockResolvedValue(failure);
    expect(await saveProspectingRecord(input())).toEqual(failure);expect(state.createClient).not.toHaveBeenCalled();expect(state.commit).not.toHaveBeenCalled();
  });
  it('refuses a receipt for a different lead before returning a false success', async () => {
    state.replay.mockResolvedValue({ ok: true, receipt: { ...receipt, leadId: OTHER_ID, replayed: true } });
    expect(await saveProspectingRecord(input())).toMatchObject({ ok: false, error: { code: 'submission_reused' } });
    expect(state.createClient).not.toHaveBeenCalled();expect(state.commit).not.toHaveBeenCalled();
  });
  it('recovers a successful rep handoff without reloading the now-inaccessible record', async () => {
    state.lead = null;
    state.replay.mockResolvedValue({ ok: true, receipt: { ...receipt, stage: 'sample_requested', requestId: OTHER_ID, replayed: true } });
    const result = await saveProspectingRecord(input());
    expect(result).toMatchObject({ ok: true, handedOff: true, receipt: { replayed: true, requestId: OTHER_ID } });
    expect(state.createClient).not.toHaveBeenCalled();expect(state.neighbors).not.toHaveBeenCalled();expect(state.commit).not.toHaveBeenCalled();
    if (result.ok) expect(new URL(result.nextHref!, 'https://example.test').searchParams.get('toast')).toBe('record_saved');
  });
  it('recovers the original next record after a lost response without recomputing neighbors', async () => {
    const nextHref = `/admin/sales/prospecting/${NEXT_ID}?preset=today`;
    state.lead = null;
    state.replay.mockResolvedValue({ ok: true, receipt: { ...receipt, nextHref, replayed: true } });
    expect(await saveProspectingRecord(input())).toMatchObject({ ok: true, nextHref });
    expect(state.createClient).not.toHaveBeenCalled();expect(state.neighbors).not.toHaveBeenCalled();expect(state.commit).not.toHaveBeenCalled();
  });
  it('honors the original continuation if a concurrent save completes between receipt lookup and commit', async () => {
    const nextHref = `/admin/sales/prospecting/${OTHER_ID}?preset=today`;
    state.commit.mockResolvedValue({ ok: true, receipt: { ...receipt, nextHref, replayed: true } });
    expect(await saveProspectingRecord(input())).toMatchObject({ ok: true, nextHref });
    expect(state.commit).toHaveBeenCalledOnce();
  });
  it('preserves a record load error and never writes an incomplete draft', async () => {
    state.leadError = { message: 'database unavailable' };
    expect(await saveProspectingRecord(input())).toMatchObject({ ok: false, error: { code: 'load_error' } });expect(state.commit).not.toHaveBeenCalled();
  });
  it('requires the sample wizard for a new Sample Requested stage', async () => {
    const request = input();request.draft.lead.stage = 'sample_requested';
    expect(await saveProspectingRecord(request)).toMatchObject({ ok: false, error: { code: 'sample_handoff_required' } });expect(state.commit).not.toHaveBeenCalled();
  });
  it('does not write if an unexpected neighbor lookup exception occurs before commit', async () => {
    state.neighbors.mockRejectedValue(new Error('neighbor unavailable'));
    expect(await saveProspectingRecord(input())).toMatchObject({ ok: false, error: { code: 'queue_unavailable' } });expect(state.commit).not.toHaveBeenCalled();
  });
  it('preserves the draft when the database neighbor query is unavailable', async () => {
    state.neighbors.mockResolvedValue({ previousLeadId: null, nextLeadId: null, unavailable: true });
    expect(await saveProspectingRecord(input())).toMatchObject({ ok: false, error: { code: 'queue_unavailable' } });expect(state.commit).not.toHaveBeenCalled();
  });
  it('saves safely when no neighbor is returned and exits without fabricating another record', async () => {
    state.neighbors.mockResolvedValue({ previousLeadId: null, nextLeadId: null });
    const result = await saveProspectingRecord(input());
    expect(state.commit).toHaveBeenCalledOnce();expect(result.ok).toBe(true);
    if (result.ok) { const url = new URL(result.nextHref!, 'https://example.test');expect(url.pathname).toBe('/admin/sales/prospecting');expect(url.searchParams.get('toast')).toBe('queue_end'); }
  });
  it('records only outcome and duration metadata, never draft/customer information', async () => {
    await saveProspectingRecord(input());
    const logged = vi.mocked(console.info).mock.calls[0][0] as string;
    expect(JSON.parse(logged)).toEqual({ event: 'prospecting_record_save', outcome: 'saved', durationMs: expect.any(Number) });
    expect(logged).not.toContain(lead.company_name);expect(logged).not.toContain(lead.notes);expect(logged).not.toContain(lead.company_email);expect(logged).not.toContain(LEAD_ID);
  });
});

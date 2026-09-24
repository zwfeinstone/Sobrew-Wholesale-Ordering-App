import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => ({ rpc: state.rpc }) }));
import { commitProspectingRecord, readProspectingMutationReceipt, readProspectingMutationReceiptChecked } from './prospecting-mutations';

const actorId = '11111111-1111-4111-8111-111111111111';
const leadId = '22222222-2222-4222-8222-222222222222';
const submissionId = '33333333-3333-4333-8333-333333333333';
const expectedUpdatedAt = '2026-09-24T16:00:00.123456Z';
const input = { actorId, leadId, submissionId, expectedUpdatedAt };
beforeEach(() => { state.rpc.mockReset(); });
describe('atomic prospecting mutation boundary', () => {
  it('passes the loaded version and stable submission through one atomic RPC', async () => {
    state.rpc.mockResolvedValue({ data: { leadId, stage: 'sample_requested', updatedAt: expectedUpdatedAt, requestId: 'request', orderId: null }, error: null });
    const sample = { mode: 'request_only' as const, contactId: 'new', notes: 'Needs a morning delivery' };
    const result = await commitProspectingRecord({ ...input, newContact: { full_name: 'Buyer', email: 'buyer@example.com' }, contactDeleteIds: [leadId], sample });
    expect(result).toMatchObject({ ok: true, receipt: { leadId, requestId: 'request', replayed: false } });
    expect(state.rpc).toHaveBeenCalledOnce();
    expect(state.rpc).toHaveBeenCalledWith('commit_prospecting_record_v2', expect.objectContaining({ p_expected_updated_at: expectedUpdatedAt, p_submission_id: submissionId, p_sample: sample, p_contact_delete_ids: [leadId] }));
  });
  it('refuses a missing loaded version instead of fetching a fresh version at submit time', async () => {
    expect(await commitProspectingRecord({ ...input, expectedUpdatedAt: null })).toMatchObject({ ok: false, error: { code: 'record_stale' } });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([
    [{ code: '40001' }, 'record_stale'],
    [{ code: '42501' }, 'unauthorized'],
    [{ code: '23514', message: 'sample_requested_contact_required' }, 'sample_contact_required'],
    [{ code: 'PGRST202' }, 'setup_required'],
    [{ code: '22023', message: 'sample_request_closed' }, 'request_closed'],
  ])('returns recoverable errors without dropping the caller draft: %j', async (error, code) => {
    state.rpc.mockResolvedValue({ data: null, error });
    expect(await commitProspectingRecord(input)).toMatchObject({ ok: false, error: { code } });
  });
  it('treats an interrupted response as uncertain and keeps the same operation ID on retry', async () => {
    state.rpc.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ data: { leadId, replayed: true }, error: null });
    expect(await commitProspectingRecord(input)).toMatchObject({ ok: false, error: { code: 'connection_error' } });
    expect(await commitProspectingRecord(input)).toMatchObject({ ok: true, receipt: { replayed: true } });
    expect(state.rpc.mock.calls[0]).toEqual(state.rpc.mock.calls[1]);
  });
  it('reads only the authenticated actor receipt before trying to reload a handed-off lead', async () => {
    state.rpc.mockResolvedValue({ data: { leadId, requestId: 'saved-request' }, error: null });
    expect(await readProspectingMutationReceipt(actorId, submissionId)).toMatchObject({ leadId, requestId: 'saved-request', replayed: true });
    expect(state.rpc).toHaveBeenCalledWith('read_prospecting_receipt_v2', { p_actor_id: actorId, p_submission_id: submissionId, p_submission_signature: null });
  });
  it('binds early receipt recovery to the immutable raw draft signature', async () => {
    const signature = 'a'.repeat(64);
    state.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'submission_reused' } });
    expect(await readProspectingMutationReceiptChecked(actorId, submissionId, signature)).toMatchObject({ ok: false, error: { code: 'submission_reused' } });
    expect(state.rpc).toHaveBeenCalledWith('read_prospecting_receipt_v2', { p_actor_id: actorId, p_submission_id: submissionId, p_submission_signature: signature });
    state.rpc.mockResolvedValueOnce({ data: { leadId, replayed: true }, error: null });
    expect(await commitProspectingRecord({ ...input, submissionSignature: signature })).toMatchObject({ ok: true });
    expect(state.rpc.mock.calls[1][1].p_submission_signature).toBe(signature);
  });
  it('normalizes a wizard containing blank and zero rows into selected sample boxes', async () => {
    state.rpc.mockResolvedValue({ data: { orderId: 'order' }, error: null });
    await commitProspectingRecord({ ...input, sample: { mode: 'order', items: [{ productId: actorId, quantity: '' }, { productId: actorId, quantity: 0 }, { productId: leadId, quantity: 2 }, { productId: leadId, quantity: '1' }] } });
    expect(state.rpc.mock.calls[0][1].p_sample.items).toEqual([{ productId: leadId, quantity: 3 }]);
  });
  it('persists the internal continuation and parses it on both save and early replay', async () => {
    const nextHref = `/admin/sales/prospecting/${leadId}?preset=today`;
    state.rpc.mockResolvedValue({ data: { leadId, nextHref }, error: null });
    expect(await commitProspectingRecord({ ...input, nextHref })).toMatchObject({ ok: true, receipt: { nextHref } });
    expect(state.rpc.mock.calls[0][1].p_next_href).toBe(nextHref);
    expect(await readProspectingMutationReceiptChecked(actorId, submissionId)).toMatchObject({ ok: true, receipt: { nextHref, replayed: true } });
  });
  it('rejects an external continuation before calling the mutation RPC', async () => {
    expect(await commitProspectingRecord({ ...input, nextHref: 'https://example.com' })).toMatchObject({ ok: false, error: { code: 'invalid_submission' } });
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it.each([-1, 0, 0.5, 10000, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid wizard quantity %s before RPC', async quantity => {
    const result = await commitProspectingRecord({ ...input, sample: { mode: 'order', items: [{ productId: leadId, quantity }] } });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_items' } });expect(state.rpc).not.toHaveBeenCalled();
  });
});

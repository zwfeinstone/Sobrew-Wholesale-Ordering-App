import { describe, expect, it, vi } from 'vitest';
import { createProspectingSampleOrder, prospectingSampleOrderInputFromFormData, type ProspectingSampleOrderInput } from './prospecting-sample-orders';
const actor = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const submissionId = '33333333-3333-4333-8333-333333333333';
const base: ProspectingSampleOrderInput = { submissionId, centerName: 'Center', attentionName: 'Buyer', address1: '123 Main', city: 'Chicago', state: 'IL', zip: '60601', items: [{ productId, quantity: 1 }] };
describe('atomic sample order wrapper', () => {
  it('sends only one RPC and preserves request, contact and loaded version', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { orderId: 'order', requestId: 'request' }, error: null });
    const from = vi.fn();
    const result = await createProspectingSampleOrder({ currentProfileId: actor, isOwner: false, input: { ...base, leadId: actor, requestId: submissionId, contactId: productId, expectedUpdatedAt: '2026-09-24T10:00:00Z' }, supabase: { rpc, from } });
    expect(result).toMatchObject({ error: null, orderId: 'order' });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_submission_id: submissionId, p_expected_updated_at: '2026-09-24T10:00:00Z', p_sample: { requestId: submissionId, contactId: productId } });
  });
  it.each([0, -1, 1.5, 10000])('rejects invalid total quantity %s before any write', async quantity => {
    const rpc = vi.fn();
    const result = await createProspectingSampleOrder({ currentProfileId: actor, isOwner: false, input: { ...base, items: [{ productId, quantity }] }, supabase: { rpc } });
    expect(result.error).toBe('invalid_items'); expect(rpc).not.toHaveBeenCalled();
  });
  it('ignores zero rows while combining duplicate selected sample boxes', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { orderId: 'order' }, error: null });
    await createProspectingSampleOrder({ currentProfileId: actor, isOwner: false, input: { ...base, items: [{ productId: 'unused', quantity: 0 }, { productId, quantity: 2 }, { productId, quantity: 1 }] }, supabase: { rpc } });
    expect(rpc.mock.calls[0][1].p_sample.items).toEqual([{ productId, quantity: 3 }]);
  });
  it('keeps deferred server contact errors actionable', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: '23514', message: 'sample_requested_contact_required' } });
    const result = await createProspectingSampleOrder({ currentProfileId: actor, isOwner: false, input: base, supabase: { rpc } });
    expect(result.error).toBe('sample_contact_required'); expect(result.message).toContain('contact');
  });
  it('parses the stable browser submission and version with shipping values', () => {
    const form = new FormData();form.set('submission_id', submissionId);form.set('expected_updated_at', '2026-09-24T12:00:00Z');form.set('request_id', actor);form.set('contact_id', productId);form.append('product_id',productId);form.append('quantity','2');
    expect(prospectingSampleOrderInputFromFormData(form)).toMatchObject({ submissionId, expectedUpdatedAt:'2026-09-24T12:00:00Z',requestId:actor,contactId:productId,items:[{productId,quantity:2}] });
  });
});

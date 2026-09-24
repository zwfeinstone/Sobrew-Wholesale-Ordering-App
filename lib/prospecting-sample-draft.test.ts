import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSampleOrderDraft, sampleOrderDraftFormData, sampleOrderDraftKey, type SampleOrderDraft } from './prospecting-sample-draft';
const actor = '11111111-1111-4111-8111-111111111111';
const product = '22222222-2222-4222-8222-222222222222';
const submissionId = '33333333-3333-4333-8333-333333333333';
const draft: SampleOrderDraft = {
  values: { center_name: 'Center', attention_name: 'Buyer', address1: '123 Main', address2: '', city: 'Chicago', state: 'IL', zip: '60601', notes: 'Morning', contact_id: 'contact' },
  quantities: { [product]: '2' }, submissionId, uncertain: true,
  hiddenFields: [{ name: 'lead_id', value: actor }, { name: 'request_id', value: product }, { name: 'expected_updated_at', value: '2026-09-24T10:00:00.123456Z' }, { name: 'queue_return_to', value: '/admin/sales/prospecting/admin?tab=requests&sample_page=2' }],
};
describe('sample draft reload recovery', () => {
  it('round-trips an uncertain operation without changing ID, record version, quantities, or context', () => {
    const restored = parseSampleOrderDraft(JSON.stringify(draft));
    expect(restored).toEqual(draft);
    const data = sampleOrderDraftFormData(restored!);
    expect(data.get('submission_id')).toBe(submissionId);
    expect(data.get('expected_updated_at')).toBe('2026-09-24T10:00:00.123456Z');
    expect(data.getAll('product_id')).toEqual([product]);expect(data.getAll('quantity')).toEqual(['2']);
    expect(data.get('queue_return_to')).toContain('sample_page=2');expect(data.get('notes')).toBe('Morning');
  });
  it('isolates drafts by authenticated actor, linked lead, and manager request', () => {
    const key = sampleOrderDraftKey(actor, draft.hiddenFields);
    expect(sampleOrderDraftKey(product, draft.hiddenFields)).not.toBe(key);
    expect(sampleOrderDraftKey(actor, draft.hiddenFields.map(field => field.name === 'request_id' ? { ...field, value: submissionId } : field))).not.toBe(key);
    expect(sampleOrderDraftKey(actor, [])).not.toBe(key);
  });
  it.each([null, '{bad', '{}', JSON.stringify({ ...draft, submissionId: 'new-id' }), JSON.stringify({ ...draft, hiddenFields: [] }), JSON.stringify({ ...draft, values: { city: 'Chicago' } })])('rejects incomplete storage instead of mixing versions: %s', value => {
    expect(parseSampleOrderDraft(value)).toBeNull();
  });
  it('keeps previously selected product IDs even when a reload no longer lists that box', () => {
    const data = sampleOrderDraftFormData(draft);
    expect(data.getAll('product_id')).toEqual(Object.keys(draft.quantities));
  });
  it('wires storage before submission, frozen recovery, explicit draft choices, and success cleanup', () => {
    const source = readFileSync(new URL('../components/prospecting-sample-order-form.tsx', import.meta.url), 'utf8');
    expect(source.indexOf('sessionStorage.setItem(storageKey, JSON.stringify(submitted))')).toBeLessThan(source.indexOf('await props.action'));
    expect(source).toContain('sampleOrderDraftFormData(submitted)');expect(source).toContain('sessionStorage.removeItem(storageKey)');
    expect(source).toContain('disabled = !recoveryReady || !props.canEdit || pending || uncertain');
    expect(source).toContain('Submit and leave');expect(source).toContain('Discard and leave');expect(source).toContain('Stay here');
  });
});

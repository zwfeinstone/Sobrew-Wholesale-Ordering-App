import { describe, expect, it } from 'vitest';
import { prospectingSubmissionSignature } from '@/lib/prospecting-submission';
import { initialRecordDraft, type RecordLead, type RecordSaveInput } from '@/lib/prospecting-record';

const lead = { id: 'lead-a', updated_at: '2026-09-24T12:00:00Z', company_name: 'Example', stage: 'working', priority: 'normal' } as RecordLead;
const input: RecordSaveInput = { leadId: lead.id, expectedUpdatedAt: lead.updated_at, submissionId: 'receipt-a', draft: initialRecordDraft(lead, []), queueParams: 'preset=overdue', visitedIds: [] };
describe('immutable prospecting submission identity', () => {
  it('ignores queue navigation and object-key ordering during a retry', () => {
    const reordered = { ...input, draft: Object.fromEntries(Object.entries(input.draft).reverse()) as typeof input.draft, queueParams: 'preset=overdue&page=2', visitedIds: ['another-lead'] };
    expect(prospectingSubmissionSignature(reordered)).toBe(prospectingSubmissionSignature(input));
  });
  it('binds the lead, loaded version, activity, and sample details', () => {
    for (const changed of [{ ...input, leadId: 'lead-b' }, { ...input, expectedUpdatedAt: '2026-09-24T13:00:00Z' }, { ...input, draft: { ...input.draft, activity: { ...input.draft.activity, body: 'An edited note' } } }, { ...input, sample: { mode: 'request_only', contactId: 'contact', notes: 'Manager fulfillment', items: [], centerName: 'Example', attentionName: 'Buyer', address1: '', address2: '', city: '', state: '', zip: '' } as RecordSaveInput['sample'] }]) {
      expect(prospectingSubmissionSignature(changed)).not.toBe(prospectingSubmissionSignature(input));
    }
  });
});

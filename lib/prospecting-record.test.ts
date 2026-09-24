import { describe, expect, it } from 'vitest';
import { CALL_RESULTS, EMAIL_RESULTS, type ProspectingStage } from './prospecting';
import { buildProspectingRecordMutation, emptyRecordContact, initialRecordDraft, recordFollowUpDate, validFollowUpDate, type RecordContact, type RecordDraft, type RecordLead } from './prospecting-record';

const lead: RecordLead = {
  id: 'lead-1', company_name: 'Lakeview Recovery', phone: '3125550101', company_email: 'buyer@example.test', company_website: 'https://example.test', address_line_1: '10 Lake Street', address_line_2: null,
  city: 'Chicago', state: 'IL', postal_code: '60601', country: 'US', notes: null, stage: 'working', priority: 'normal', assigned_profile_id: 'rep-1', do_not_contact: false, next_follow_up_at: '2026-09-24', updated_at: '2026-09-24T12:00:00Z',
};
const primary: RecordContact = { id: 'contact-1', full_name: 'Taylor Buyer', title: null, email: 'taylor@example.test', phone: null, notes: null, is_primary: true };
const secondary: RecordContact = { ...primary, id: 'contact-2', full_name: 'Sam Buyer', email: 'sam@example.test', is_primary: false };
function setup(before: RecordLead = lead, contacts: RecordContact[] = [primary]) { return { before: structuredClone(before), contacts: structuredClone(contacts), draft: initialRecordDraft(before, contacts) }; }
function success(result: ReturnType<typeof buildProspectingRecordMutation>) { expect(result.ok).toBe(true); if (!result.ok) throw new Error(JSON.stringify(result.errors)); return result; }
function failure(result: ReturnType<typeof buildProspectingRecordMutation>) { expect(result.ok).toBe(false); if (result.ok) throw new Error('Expected validation error'); return result.errors; }

describe('initial prospecting record draft', () => {
  it('starts in Edit only with Keep follow-up, without scheduling or logging a blank call', () => {
    const { before, contacts, draft } = setup();
    expect(draft.activity).toEqual({ type: 'none', result: '', body: '', contactId: '' });
    expect(draft.followUp).toEqual({ mode: 'keep', date: '2026-09-24' });
    const result = success(buildProspectingRecordMutation(before, contacts, draft, false));
    expect(result.activity).toBeNull(); expect(result.auditActivities).toEqual([]); expect(result.newContact).toBeNull();
  });
  it('normalizes nullable display fields without sharing mutable data with the loaded record', () => {
    const before = { ...lead, company_email: null, stage: null, priority: null, assigned_profile_id: null, next_follow_up_at: null };
    const contacts = [{ ...primary, full_name: null, is_primary: null }];
    const draft = initialRecordDraft(before, contacts);
    expect(draft.lead).toMatchObject({ company_email: '', stage: 'new', priority: 'normal', assigned_profile_id: '' });
    expect(draft.followUp).toEqual({ mode: 'keep', date: '' });
    expect(draft.contacts[0]).toMatchObject({ full_name: '', phone: '', is_primary: false });
    draft.contacts[0].full_name = 'Changed'; draft.lead.company_name = 'Changed';
    expect(contacts[0].full_name).toBeNull(); expect(before.company_name).toBe('Lakeview Recovery');
  });
  it('makes the first prospective new contact primary without inserting an empty contact', () => {
    const draft = initialRecordDraft(lead, []);
    expect(draft.newContact.is_primary).toBe(true);
    expect(success(buildProspectingRecordMutation(lead, [], draft, false)).newContact).toBeNull();
    expect(emptyRecordContact().is_primary).toBe(false);
  });
});

const callStages: Record<typeof CALL_RESULTS[number], ProspectingStage> = {
  'No answer': 'follow_up', 'Left voicemail': 'follow_up', 'Wrong number': 'not_a_fit', 'Reached gatekeeper': 'working', 'Reached decision maker': 'working', 'Call back later': 'follow_up', 'Requested info': 'follow_up', Interested: 'interested', 'Sample requested': 'sample_requested', 'Not interested': 'not_a_fit', 'Do not contact': 'not_a_fit',
};
const emailStages: Record<typeof EMAIL_RESULTS[number], ProspectingStage> = {
  'Intro sent': 'follow_up', 'Follow-up sent': 'follow_up', Bounced: 'not_a_fit', 'Out of office': 'follow_up', 'Reply interested': 'interested', 'Requested pricing': 'interested', 'Requested sample': 'sample_requested', 'Not interested': 'not_a_fit', Unsubscribed: 'not_a_fit',
};

describe('outreach and final stage', () => {
  it.each(['call', 'email'] as const)('rejects a blank %s but accepts an outcome or meaningful body', (type) => {
    const { before, contacts, draft } = setup(); draft.activity = { type, result: '', body: '  ', contactId: '' };
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, false))).toHaveProperty('activity_body');
    draft.activity.body = 'Attempted to reach purchasing.';
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).activity).toMatchObject({ activity_type: type, result: null, body: 'Attempted to reach purchasing.' });
  });
  it.each([
    ...Object.entries(callStages).map(([result, stage]) => ['call', result, stage] as const),
    ...Object.entries(emailStages).map(([result, stage]) => ['email', result, stage] as const),
  ])('preserves the reviewed %s outcome %s and stage %s', (type, result, stage) => {
    const { before, contacts, draft } = setup(); draft.activity = { type, result, body: '', contactId: primary.id }; draft.lead.stage = stage;
    const built = success(buildProspectingRecordMutation(before, contacts, draft, false));
    expect(built.finalStage).toBe(stage); expect(built.activity).toMatchObject({ activity_type: type, result, contact_id: primary.id, previous_stage: 'working', next_stage: stage });
    expect(built.lead.do_not_contact).toBe(['Do not contact', 'Unsubscribed', 'Wrong number', 'Bounced'].includes(result));
    expect(built.auditActivities.filter((item) => item.activity_type === 'stage_change')).toHaveLength(0);
  });
  it.each([['call', 'Intro sent'], ['email', 'No answer'], ['note', 'Interested'], ['none', 'Interested']] as const)('rejects %s activity with incompatible result %s', (type, result) => {
    const { before, contacts, draft } = setup(); draft.activity = { type, result, body: 'Useful context', contactId: '' };
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, false))).toHaveProperty('activity_result');
  });
  it.each([['call', 'Do not contact'], ['call', 'Wrong number'], ['email', 'Unsubscribed'], ['email', 'Bounced']] as const)('forces %s/%s to Do Not Contact even if the reviewed stage conflicts', (type, result) => {
    const { before, contacts, draft } = setup(); draft.activity = { type, result, body: '', contactId: '' }; draft.lead.stage = 'interested';
    const built = success(buildProspectingRecordMutation(before, contacts, draft, true));
    expect(built.lead).toMatchObject({ stage: 'not_a_fit', do_not_contact: true, assigned_profile_id: null, next_follow_up_at: null });
  });
  it('preserves an explicit stage override for a non-forced outcome', () => {
    const { before, contacts, draft } = setup(); draft.activity = { type: 'call', result: 'Interested', body: '', contactId: '' }; draft.lead.stage = 'working';
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).finalStage).toBe('working');
  });
  it('blocks further call/email outreach on DNC records while allowing internal notes and a deliberate DNC clear', () => {
    const { before, contacts, draft } = setup({ ...lead, do_not_contact: true, stage: 'not_a_fit', assigned_profile_id: null, next_follow_up_at: null });
    for (const type of ['call', 'email'] as const) { draft.activity = { type, result: '', body: 'Outreach attempted', contactId: '' }; expect(failure(buildProspectingRecordMutation(before, contacts, draft, true))).toHaveProperty('activity_type'); }
    draft.activity = { type: 'note', result: '', body: 'Internal account context.', contactId: '' };
    expect(success(buildProspectingRecordMutation(before, contacts, draft, true)).activity).toMatchObject({ activity_type: 'note', body: 'Internal account context.' });
    draft.lead.do_not_contact = false; draft.lead.stage = 'working'; draft.activity = { type: 'call', result: 'Reached decision maker', body: '', contactId: '' };
    expect(success(buildProspectingRecordMutation(before, contacts, draft, true)).lead.do_not_contact).toBe(false);
  });
  it('requires content for a note', () => {
    const { before, contacts, draft } = setup(); draft.activity.type = 'note'; draft.activity.body = '\n  ';
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, false))).toHaveProperty('activity_body');
  });
});

describe('follow-up and ownership', () => {
  it.each([['keep', '2099-01-01', '2026-09-24'], ['reschedule', '2026-10-01', '2026-10-01'], ['clear', '2026-10-01', null]] as const)('%s uses the explicit date policy', (mode, date, expected) => {
    const { before, contacts, draft } = setup(); draft.followUp = { mode, date };
    expect(recordFollowUpDate(draft, before, 'working')).toBe(expected);
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).lead.next_follow_up_at).toBe(expected);
  });
  it.each(['recycle_try_later', 'not_a_fit', 'lost'] as const)('clears follow-up and assignment in %s for every follow-up mode', (stage) => {
    for (const mode of ['keep', 'reschedule', 'clear'] as const) {
      const { before, contacts, draft } = setup(); draft.lead.stage = stage; draft.followUp = { mode, date: '2026-10-01' };
      expect(success(buildProspectingRecordMutation(before, contacts, draft, true)).lead).toMatchObject({ next_follow_up_at: null, assigned_profile_id: null });
    }
  });
  it('ignores a hidden unfinished reschedule field when the final stage clears follow-up', () => {
    const { before, contacts, draft } = setup(); draft.lead.stage = 'lost'; draft.followUp = { mode: 'reschedule', date: '' };
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).lead.next_follow_up_at).toBeNull();
    draft.lead.stage = 'interested'; draft.activity = { type: 'email', result: 'Unsubscribed', body: '', contactId: '' };
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).lead.next_follow_up_at).toBeNull();
  });
  it('cannot change the assigned rep as a rep, but lets an owner explicitly change or clear it', () => {
    const { before, contacts, draft } = setup(); draft.lead.assigned_profile_id = 'rep-2';
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).lead.assigned_profile_id).toBe('rep-1');
    expect(success(buildProspectingRecordMutation(before, contacts, draft, true)).lead.assigned_profile_id).toBe('rep-2');
    draft.lead.assigned_profile_id = '';
    expect(success(buildProspectingRecordMutation(before, contacts, draft, true)).lead.assigned_profile_id).toBeNull();
  });
  it.each(['2026-09-24', '2024-02-29', '2000-02-29', '2020-01-01'])('accepts real date-only value %s, including preserved past dates', (date) => expect(validFollowUpDate(date)).toBe(true));
  it.each(['', '2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-9-24', '2026-09-24T00:00:00Z', ' 2026-09-24'])('rejects malformed or rolled-over date %s', (date) => {
    expect(validFollowUpDate(date)).toBe(false);
    const { before, contacts, draft } = setup(); draft.followUp = { mode: 'reschedule', date };
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, false))).toHaveProperty('follow_up');
  });
});

describe('contact changes and primary selection', () => {
  it('deletes only explicitly removed contacts and rejects an activity linked to a deleted contact', () => {
    const { before, contacts, draft } = setup(lead, [primary, secondary]); draft.deletedContactIds = [primary.id];
    let built = success(buildProspectingRecordMutation(before, contacts, draft, false));
    expect(built.contactDeleteIds).toEqual([primary.id]); expect(built.contactUpdates.map((contact) => contact.id)).toEqual([secondary.id]);
    draft.activity = { type: 'call', result: 'No answer', body: '', contactId: primary.id };
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, false))).toHaveProperty('activity_contact');
    draft.activity.contactId = secondary.id;
    built = success(buildProspectingRecordMutation(before, contacts, draft, false)); expect(built.activity?.contact_id).toBe(secondary.id);
  });
  it('rejects foreign contact IDs, duplicate edit IDs, and foreign deletion/activity references', () => {
    for (const mutate of [
      (draft: RecordDraft) => { draft.contacts[0].id = 'other-lead-contact'; },
      (draft: RecordDraft) => { draft.contacts.push({ ...draft.contacts[0] }); },
      (draft: RecordDraft) => { draft.deletedContactIds = ['other-lead-contact']; },
      (draft: RecordDraft) => { draft.activity = { type: 'call', result: 'No answer', body: '', contactId: 'other-lead-contact' }; },
    ]) { const { before, contacts, draft } = setup(); mutate(draft); expect(buildProspectingRecordMutation(before, contacts, draft, false).ok).toBe(false); }
  });
  it('requires one primary among surviving edited contacts and a real new contact', () => {
    const { before, contacts, draft } = setup(lead, [primary, secondary]); draft.contacts[1].is_primary = true;
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, false))).toHaveProperty('contacts');
    draft.contacts[0].is_primary = false;
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).contactUpdates.filter((contact) => contact.is_primary)).toHaveLength(1);
    draft.newContact = { ...emptyRecordContact(), full_name: 'New buyer', is_primary: true };
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, false))).toHaveProperty('contacts');
    draft.contacts[1].is_primary = false;
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).newContact).toMatchObject({ full_name: 'New buyer', is_primary: true });
  });
  it('does not count a deleted primary or an empty prospective contact as competing primaries', () => {
    const { before, contacts, draft } = setup(lead, [primary, secondary]); draft.newContact.is_primary = true;
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).newContact).toBeNull();
    draft.deletedContactIds = [primary.id]; draft.contacts[1].is_primary = true;
    expect(success(buildProspectingRecordMutation(before, contacts, draft, false)).contactUpdates[0]).toMatchObject({ id: secondary.id, is_primary: true });
  });
  it('includes unchanged existing contacts in the primary invariant even if omitted from an update', () => {
    const { before, contacts, draft } = setup(); draft.contacts = []; draft.newContact = { ...emptyRecordContact(), full_name: 'New buyer', is_primary: true };
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, true))).toHaveProperty('contacts');
  });
});

describe('mutation normalization and audit history', () => {
  it('trims fields, regenerates search keys, and records company/contact changes separately from outreach', () => {
    const { before, contacts, draft } = setup(); draft.lead.company_name = '  Lakeview Recovery North  '; draft.lead.phone = '(312) 555-0199'; draft.lead.notes = '   ';
    draft.contacts[0].title = '  Purchasing manager  ';
    const built = success(buildProspectingRecordMutation(before, contacts, draft, true));
    expect(built.lead).toMatchObject({ company_name: 'Lakeview Recovery North', company_name_key: 'lakeview recovery north', phone_key: '3125550199', notes: null, state_key: 'IL' });
    expect(built.contactUpdates[0].title).toBe('Purchasing manager'); expect(built.activity).toBeNull();
    expect(built.auditActivities.map((item) => item.result)).toEqual(['Lead updated', 'Contacts updated']);
    expect(before.company_name).toBe('Lakeview Recovery'); expect(contacts[0].title).toBeNull();
  });
  it('records deliberate stage, assignment, and follow-up changes with previous context', () => {
    const { before, contacts, draft } = setup(); draft.lead.stage = 'lost';
    const built = success(buildProspectingRecordMutation(before, contacts, draft, true));
    expect(built.auditActivities).toEqual(expect.arrayContaining([
      expect.objectContaining({ activity_type: 'stage_change', previous_stage: 'working', next_stage: 'lost', previous_assigned_profile_id: 'rep-1' }),
      expect.objectContaining({ activity_type: 'assignment', result: 'Unassigned', previous_assigned_profile_id: 'rep-1' }),
      expect.objectContaining({ activity_type: 'enrichment', result: 'Follow-up cleared', next_follow_up_at: null }),
    ]));
    expect(built.activity).toBeNull();
  });
  it('returns field errors rather than a mutation for malformed top-level drafts and invalid reviewed values', () => {
    expect(failure(buildProspectingRecordMutation(lead, [primary], null as unknown as RecordDraft, false))).toHaveProperty('record');
    const { before, contacts, draft } = setup(); draft.lead.company_name = ' '; draft.lead.stage = 'invalid' as ProspectingStage; draft.lead.priority = 'urgent';
    expect(failure(buildProspectingRecordMutation(before, contacts, draft, false))).toMatchObject({ company_name: expect.any(String), stage: expect.any(String), priority: expect.any(String) });
  });
});

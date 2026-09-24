import { CALL_RESULTS, EMAIL_RESULTS, PROSPECTING_STAGES, isMaintenanceStage, normalizePhoneKey, normalizeStateKey, normalizeTextKey, resolveActivityStage, stageLabel, type ProspectingStage } from '@/lib/prospecting';
import type { Json } from '@/lib/supabase/database.types';

export type RecordContact = { id: string; full_name: string | null; email: string | null; phone: string | null; title: string | null; notes: string | null; is_primary: boolean | null };
export type EditableContact = { id: string; full_name: string; email: string; phone: string; title: string; notes: string; is_primary: boolean };
export const RECORD_TEXT_FIELDS = ['company_name', 'phone', 'company_email', 'company_website', 'address_line_1', 'address_line_2', 'city', 'state', 'postal_code', 'country', 'notes'] as const;
export type RecordTextField = typeof RECORD_TEXT_FIELDS[number];
export type RecordLead = Record<RecordTextField, string | null> & { id: string; updated_at: string | null; stage: string | null; priority: string | null; assigned_profile_id: string | null; do_not_contact: boolean | null; next_follow_up_at: string | null; last_result?: string | null; hubspot_status?: string | null; created_at?: string | null };
export type RecordDraft = {
  lead: Record<RecordTextField, string> & { stage: ProspectingStage; priority: string; assigned_profile_id: string; do_not_contact: boolean };
  contacts: EditableContact[];
  newContact: EditableContact;
  deletedContactIds: string[];
  activity: { type: 'none' | 'call' | 'email' | 'note'; result: string; body: string; contactId: string };
  followUp: { mode: 'keep' | 'reschedule' | 'clear'; date: string };
};
export type RecordActionResult = { ok: false; error: { code: string; message: string; fieldErrors: Record<string, string> } } | { ok: true; receipt: { leadId: string | null; updatedAt: string | null; stage?: string | null; orderId?: string | null; requestId?: string | null; replayed?: boolean }; nextHref?: string; handedOff?: boolean };
export type RecordSampleDraft = { mode: 'request_only' | 'order'; contactId?: string | null; centerName: string; attentionName: string; address1: string; address2: string; city: string; state: string; zip: string; notes: string; items: { productId: string; quantity: number | string }[] };
export type RecordSaveInput = { leadId: string; expectedUpdatedAt: string | null; submissionId: string; draft: RecordDraft; sample?: RecordSampleDraft; queueParams: string; visitedIds: string[] };

export function emptyRecordContact(): EditableContact {
  return { id: '', full_name: '', email: '', phone: '', title: '', notes: '', is_primary: false };
}

export function initialRecordDraft(lead: RecordLead, contacts: RecordContact[]): RecordDraft {
  const textFields = Object.fromEntries(RECORD_TEXT_FIELDS.map((field) => [field, lead[field] ?? ''])) as Record<RecordTextField, string>;
  return {
    lead: { ...textFields, stage: (lead.stage || 'new') as ProspectingStage, priority: lead.priority || 'normal', assigned_profile_id: lead.assigned_profile_id || '', do_not_contact: Boolean(lead.do_not_contact) },
    contacts: contacts.map((contact) => ({ ...emptyRecordContact(), ...contact, full_name: contact.full_name || '', email: contact.email || '', phone: contact.phone || '', title: contact.title || '', notes: contact.notes || '', is_primary: Boolean(contact.is_primary) })),
    newContact: { ...emptyRecordContact(), is_primary: contacts.length === 0 },
    deletedContactIds: [], activity: { type: 'none', result: '', body: '', contactId: '' }, followUp: { mode: 'keep', date: lead.next_follow_up_at || '' },
  };
}

export function validFollowUpDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function recordFollowUpDate(draft: RecordDraft, before: RecordLead, stage: ProspectingStage) {
  if (stage === 'recycle_try_later' || isMaintenanceStage(stage)) return null;
  if (draft.followUp.mode === 'keep') return before.next_follow_up_at;
  return draft.followUp.mode === 'clear' ? null : draft.followUp.date;
}

export function buildProspectingRecordMutation(before: RecordLead, existingContacts: RecordContact[], draft: RecordDraft, isOwner: boolean) {
  const errors: Record<string, string> = {};
  const text = (value: unknown) => typeof value === 'string' ? value.trim() || null : null;
  if (!draft || !draft.lead || !draft.activity || !draft.followUp || !Array.isArray(draft.contacts) || !draft.newContact || !Array.isArray(draft.deletedContactIds)) {
    return { ok: false as const, errors: { record: 'This draft could not be read. Reload the record and try again.' } };
  }
  if (!text(draft.lead.company_name)) errors.company_name = 'Enter a company name.';
  if (!PROSPECTING_STAGES.some(({ id }) => id === draft.lead.stage)) errors.stage = 'Select a valid stage.';
  if (!['low', 'normal', 'high'].includes(draft.lead.priority)) errors.priority = 'Select a valid priority.';
  if (!['none', 'call', 'email', 'note'].includes(draft.activity.type)) errors.activity_type = 'Select a valid activity type.';
  if (!['keep', 'reschedule', 'clear'].includes(draft.followUp.mode)) errors.follow_up = 'Choose what should happen to the follow-up.';
  const allowedResults: readonly string[] = draft.activity.type === 'call' ? CALL_RESULTS : draft.activity.type === 'email' ? EMAIL_RESULTS : [];
  if (draft.activity.result && !allowedResults.includes(draft.activity.result)) errors.activity_result = 'Choose a result for this activity type.';
  if (['call', 'email'].includes(draft.activity.type) && !text(draft.activity.result) && !text(draft.activity.body)) errors.activity_body = 'Choose an outcome or enter what happened before saving outreach.';
  if (draft.activity.type === 'note' && !text(draft.activity.body)) errors.activity_body = 'Write a note before saving it.';
  const contactIds = new Set(existingContacts.map(({ id }) => id));
  if (draft.contacts.some(({ id }) => !contactIds.has(id)) || draft.deletedContactIds.some((id) => !contactIds.has(id))) errors.contacts = 'A contact has changed or was removed. Reload to review the latest record.';
  if (new Set(draft.contacts.map(({ id }) => id)).size !== draft.contacts.length) errors.contacts = 'The contact list contains a duplicate.';
  if (draft.activity.contactId && (!contactIds.has(draft.activity.contactId) || draft.deletedContactIds.includes(draft.activity.contactId))) errors.activity_contact = 'Choose a contact that is still on this record.';
  const hasNewContactDetails = [draft.newContact.full_name, draft.newContact.email, draft.newContact.phone, draft.newContact.title, draft.newContact.notes].some((value) => Boolean(text(value)));
  const survivingPrimaryCount = existingContacts.filter((contact) => !draft.deletedContactIds.includes(contact.id)).filter((contact) => Boolean((draft.contacts.find((edited) => edited.id === contact.id) ?? contact).is_primary)).length;
  if (survivingPrimaryCount + (hasNewContactDetails && draft.newContact.is_primary ? 1 : 0) > 1) errors.contacts = 'Choose only one primary contact.';
  if (before.do_not_contact && draft.lead.do_not_contact && ['call', 'email'].includes(draft.activity.type)) errors.activity_type = 'Clear Do Not Contact before logging new outreach.';
  const finalStage = draft.lead.do_not_contact ? 'not_a_fit' : draft.activity.type === 'none' ? draft.lead.stage : resolveActivityStage({ currentStage: before.stage, explicitStage: draft.lead.stage, result: draft.activity.result });
  const forcedDnc = draft.activity.type !== 'none' && ['Do not contact', 'Unsubscribed', 'Wrong number', 'Bounced'].includes(draft.activity.result);
  const parked = finalStage === 'recycle_try_later' || isMaintenanceStage(finalStage);
  if (!parked && draft.followUp.mode === 'reschedule' && !validFollowUpDate(draft.followUp.date)) errors.follow_up = 'Choose a valid follow-up date.';
  if ((before.do_not_contact || forcedDnc) && draft.lead.do_not_contact && finalStage === 'recycle_try_later') errors.stage = 'Clear Do Not Contact before recycling this lead.';
  if (Object.keys(errors).length) return { ok: false as const, errors };
  const lead: Record<string, Json | undefined> = Object.fromEntries(RECORD_TEXT_FIELDS.map((field) => [field, text(draft.lead[field])]));
  Object.assign(lead, {
    stage: finalStage, priority: draft.lead.priority, do_not_contact: draft.lead.do_not_contact || forcedDnc,
    assigned_profile_id: parked ? null : isOwner ? draft.lead.assigned_profile_id || null : before.assigned_profile_id,
    next_follow_up_at: recordFollowUpDate(draft, before, finalStage),
    company_name_key: normalizeTextKey(draft.lead.company_name), phone_key: normalizePhoneKey(draft.lead.phone), state_key: normalizeStateKey(draft.lead.state),
  });
  const cleanContact = (contact: EditableContact) => ({ full_name: text(contact.full_name), email: text(contact.email), phone: text(contact.phone), title: text(contact.title), notes: text(contact.notes), is_primary: Boolean(contact.is_primary) });
  const contactUpdates = draft.contacts.filter(({ id }) => !draft.deletedContactIds.includes(id)).map((contact) => ({ id: contact.id, ...cleanContact(contact) }));
  const newContact = cleanContact(draft.newContact);
  const hasNewContact = [newContact.full_name, newContact.email, newContact.phone, newContact.title, newContact.notes].some(Boolean);
  const auditActivities: Record<string, Json | undefined>[] = [];
  if (before.stage !== finalStage && draft.activity.type === 'none') auditActivities.push({ activity_type: 'stage_change', result: 'Stage updated', body: `Stage changed from ${stageLabel(before.stage)} to ${stageLabel(finalStage)}.`, previous_stage: before.stage, next_stage: finalStage, previous_assigned_profile_id: before.assigned_profile_id });
  if ((before.assigned_profile_id || null) !== lead.assigned_profile_id) auditActivities.push({ activity_type: 'assignment', result: lead.assigned_profile_id ? 'Assigned' : 'Unassigned', body: lead.assigned_profile_id ? 'Assigned sales rep changed.' : 'Lead moved out of the assigned queue.', previous_assigned_profile_id: before.assigned_profile_id, previous_stage: before.stage, next_stage: finalStage });
  if (RECORD_TEXT_FIELDS.some((field) => (before[field] || null) !== lead[field]) || before.priority !== lead.priority || Boolean(before.do_not_contact) !== lead.do_not_contact) auditActivities.push({ activity_type: 'enrichment', result: 'Lead updated', body: 'Company details or internal notes updated.' });
  if (before.next_follow_up_at !== lead.next_follow_up_at) auditActivities.push({ activity_type: 'enrichment', result: lead.next_follow_up_at ? 'Follow-up scheduled' : 'Follow-up cleared', body: lead.next_follow_up_at ? `Next follow-up: ${lead.next_follow_up_at}` : 'Next follow-up cleared.', next_follow_up_at: lead.next_follow_up_at });
  const contactsChanged = hasNewContact || draft.deletedContactIds.length > 0 || contactUpdates.some((contact) => { const previous = existingContacts.find(({ id }) => id === contact.id)!; return Object.entries(contact).some(([field, value]) => field !== 'id' && (previous[field as keyof RecordContact] ?? null) !== value); });
  if (contactsChanged) auditActivities.push({ activity_type: 'enrichment', result: 'Contacts updated', body: 'Key contacts updated.' });
  const activity: Record<string, Json | undefined> | null = draft.activity.type === 'none' ? null : {
    activity_type: draft.activity.type, result: text(draft.activity.result), body: text(draft.activity.body), contact_id: draft.activity.contactId || null,
    previous_stage: before.stage, next_stage: finalStage, previous_assigned_profile_id: parked ? before.assigned_profile_id : null, next_follow_up_at: lead.next_follow_up_at,
  };
  return { ok: true as const, lead, contactUpdates, newContact: hasNewContact ? newContact : null, contactDeleteIds: draft.deletedContactIds, activity, auditActivities, finalStage };
}

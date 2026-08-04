import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';
import {
  CALL_RESULTS,
  EMAIL_RESULTS,
  MISSING_STATE_FILTER,
  PROSPECTING_ACTIVITY_TYPES,
  PROSPECTING_PRIORITIES,
  PROSPECTING_STAGES,
  cleanText,
  formatDate,
  formatDateTime,
  isMaintenanceStage,
  missingLeadFields,
  normalizePhoneKey,
  normalizePriority,
  normalizeStateKey,
  normalizeStage,
  normalizeTextKey,
  postgrestIlikePattern,
  priorityLabel,
  prospectingLeadPath,
  prospectingPath,
  prospectingQueueContextFromParams,
  prospectingQueueHiddenFields,
  prospectingQueueOrderFields,
  prospectingQueueQueryString,
  prospectingQueueRequiresFollowUp,
  prospectingQueueSkipsTouchedToday,
  prospectingQueueStageFilter,
  resolveActivityNextFollowUp,
  resolveActivityStage,
  stageLabel,
  type ProspectingActivityType,
  type ProspectingQueueContext,
  type ProspectingStage,
} from '@/lib/prospecting';
import {
  isEligibleProspectingSalesRep,
  loadProspectingSalesReps,
  type ProspectingSalesRepProfile,
} from '@/lib/prospecting-sales-reps';

type LeadRow = {
  address_line_1: string | null;
  address_line_2: string | null;
  assigned_profile_id: string | null;
  city: string | null;
  company_email: string | null;
  company_name: string;
  company_website: string | null;
  country: string | null;
  created_at: string | null;
  do_not_contact: boolean | null;
  hubspot_exported_at: string | null;
  hubspot_status: string | null;
  id: string;
  last_activity_at: string | null;
  last_result: string | null;
  next_follow_up_at: string | null;
  notes: string | null;
  phone: string | null;
  postal_code: string | null;
  priority: string | null;
  stage: string | null;
  state: string | null;
  state_key: string | null;
  updated_at: string | null;
};

type MutationLeadRow = Pick<
  LeadRow,
  | 'address_line_1'
  | 'address_line_2'
  | 'assigned_profile_id'
  | 'city'
  | 'company_email'
  | 'company_name'
  | 'company_website'
  | 'country'
  | 'do_not_contact'
  | 'id'
  | 'next_follow_up_at'
  | 'notes'
  | 'phone'
  | 'postal_code'
  | 'priority'
  | 'stage'
  | 'state'
  | 'updated_at'
>;

type ContactRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_primary: boolean | null;
  notes: string | null;
  phone: string | null;
  title: string | null;
};

type ActivityRow = {
  activity_type: string;
  body: string | null;
  contact_id: string | null;
  created_at: string | null;
  created_by: string | null;
  id: string;
  next_follow_up_at: string | null;
  next_stage: string | null;
  previous_assigned_profile_id?: string | null;
  previous_stage: string | null;
  result: string | null;
};

type ProfileRow = ProspectingSalesRepProfile;

type ListLeadRow = {
  prospecting_lists?: { name: string | null } | { name: string | null }[] | null;
};

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function profileLabel(profile: ProfileRow | null | undefined) {
  return profile?.full_name || profile?.email || 'Unassigned';
}

function noteBlocks(notes: string | null | undefined) {
  return String(notes ?? '')
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function titleCase(value: string | null | undefined) {
  return String(value ?? 'Activity')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityTone(activityType: string | null | undefined) {
  const type = String(activityType ?? '').toLowerCase();
  if (type === 'call') return { accent: 'bg-teal-600', badge: 'bg-teal-50 text-teal-800', border: 'border-teal-100' };
  if (type === 'email') return { accent: 'bg-indigo-600', badge: 'bg-indigo-50 text-indigo-800', border: 'border-indigo-100' };
  if (type === 'note') return { accent: 'bg-amber-500', badge: 'bg-amber-50 text-amber-800', border: 'border-amber-100' };
  if (type === 'assignment') return { accent: 'bg-slate-500', badge: 'bg-slate-100 text-slate-700', border: 'border-slate-200' };
  if (type === 'stage_change') return { accent: 'bg-emerald-600', badge: 'bg-emerald-50 text-emerald-800', border: 'border-emerald-100' };
  return { accent: 'bg-blue-600', badge: 'bg-blue-50 text-blue-800', border: 'border-blue-100' };
}

function safeDateInput(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function leadHref(leadId: string, toast?: string, queueContext: ProspectingQueueContext = prospectingQueueContextFromParams(null)) {
  return prospectingLeadPath(leadId, queueContext, { includePageSize: true, toast });
}

function sampleOrderHref({
  leadId,
  nextRecordId,
  previousRecordId,
  queueContext,
  toast,
}: {
  leadId: string;
  nextRecordId?: string;
  previousRecordId?: string;
  queueContext: ProspectingQueueContext;
  toast?: string;
}) {
  const params = new URLSearchParams(prospectingQueueQueryString(queueContext, { includePageSize: true }));
  params.set('lead', leadId);
  if (nextRecordId) params.set('next_record_id', nextRecordId);
  if (previousRecordId) params.set('previous_record_id', previousRecordId);
  if (toast) params.set('toast', toast);
  return `/admin/sales/prospecting/sample-order?${params.toString()}`;
}

function prospectingBackHref(queueContext: ProspectingQueueContext) {
  return prospectingPath(queueContext, { includePageSize: true });
}

function prospectingListHref(toast: string, queueContext: ProspectingQueueContext) {
  return prospectingPath(queueContext, { includePageSize: true, toast });
}

function cleanRecordId(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : '';
}

function contactFieldName(contactId: string, field: 'email' | 'full_name' | 'is_primary' | 'notes' | 'phone' | 'title') {
  return `contact_${contactId}_${field}`;
}

function cleanRecordIds(formData: FormData, name: string) {
  return Array.from(new Set(formData.getAll(name).map(cleanRecordId).filter(Boolean)));
}

function textChanged(previous: string | null | undefined, next: string | null | undefined) {
  return (previous ?? null) !== (next ?? null);
}

function QueueContextFields({ context }: { context: ProspectingQueueContext }) {
  return (
    <>
      {prospectingQueueHiddenFields(context).map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}
    </>
  );
}

async function loadLeadForMutation(supabase: Awaited<ReturnType<typeof createClient>>, leadId: string, current: Awaited<ReturnType<typeof requireAdminSectionEdit>>) {
  let query = supabase
    .from('prospecting_leads')
    .select('id,address_line_1,address_line_2,assigned_profile_id,city,company_email,company_name,company_website,country,do_not_contact,next_follow_up_at,notes,phone,postal_code,priority,stage,state,updated_at')
    .eq('id', leadId);
  if (!current.isOwner) query = query.eq('assigned_profile_id', current.profile.id).neq('stage', 'sample_requested');
  const { data } = await query.maybeSingle();
  return data as MutationLeadRow | null;
}

async function shuckedRepRedirectHref({
  current,
  nextRecordId,
  previousRecordId,
  queueContext,
  toast,
}: {
  current: Awaited<ReturnType<typeof requireAdminSectionEdit>>;
  nextRecordId: string;
  previousRecordId: string;
  queueContext: ProspectingQueueContext;
  toast: string;
}) {
  const candidateIds = [nextRecordId, previousRecordId].filter(Boolean);
  if (!candidateIds.length) return prospectingListHref(toast, queueContext);

  const supabase = await createClient();
  const today = formatCentralDateInput(new Date());
  const todayStart = parseCentralDateInput(today) ?? new Date();
  const selectColumns = queueContext.listId ? 'id,prospecting_list_leads!inner(list_id)' : 'id';
  let query = supabase
    .from('prospecting_leads')
    .select(selectColumns)
    .in('id', candidateIds)
    .eq('assigned_profile_id', current.profile.id)
    .is('archived_at', null);

  query = query.in('stage', prospectingQueueStageFilter(queueContext));
  if (prospectingQueueRequiresFollowUp(queueContext)) query = query.not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today);
  if (prospectingQueueSkipsTouchedToday(queueContext)) query = query.or(`last_activity_at.is.null,last_activity_at.lt.${todayStart.toISOString()}`);
  if (queueContext.priority) query = query.eq('priority', queueContext.priority);
  if (queueContext.state === MISSING_STATE_FILTER) query = query.is('state_key', null);
  else if (queueContext.state) query = query.eq('state_key', queueContext.state);
  if (queueContext.listId) query = query.eq('prospecting_list_leads.list_id', queueContext.listId);
  if (queueContext.q) {
    const search = postgrestIlikePattern(queueContext.q);
    query = query.or([
      `company_name.ilike.${search}`,
      `phone.ilike.${search}`,
      `company_email.ilike.${search}`,
      `city.ilike.${search}`,
      `state.ilike.${search}`,
      `last_result.ilike.${search}`,
    ].join(','));
  }

  const { data } = await query;
  const validIds = new Set(((data ?? []) as unknown as Array<{ id: string | null }>).map((row) => row.id).filter(Boolean));
  const destinationId = candidateIds.find((id) => validIds.has(id));
  return destinationId ? leadHref(destinationId, toast, queueContext) : prospectingListHref(toast, queueContext);
}

async function saveRecordData(formData: FormData) {
  'use server';

  const leadId = String(formData.get('lead_id') ?? '').trim();
  const queueContext = prospectingQueueContextFromParams(formData);
  const nextRecordId = cleanRecordId(formData.get('next_record_id'));
  const previousRecordId = cleanRecordId(formData.get('previous_record_id'));
  const current = await requireAdminSectionEdit('prospecting', leadHref(leadId, 'admin_write_denied', queueContext));
  const supabase = await createClient();
  const before = await loadLeadForMutation(supabase, leadId, current);
  if (!before) redirect('/admin/sales/prospecting?toast=missing_lead');

  const companyName = cleanText(formData.get('company_name'));
  if (!companyName) redirect(leadHref(leadId, 'company_required', queueContext));
  const phone = cleanText(formData.get('phone'));
  const nextStage = normalizeStage(String(formData.get('stage') ?? before.stage ?? 'new'));
  const priority = normalizePriority(String(formData.get('priority') ?? 'normal'));
  const selectedRepId = String(formData.get('assigned_profile_id') ?? '').trim();
  const doNotContact = formData.get('do_not_contact') === 'on';
  const savedStage = doNotContact ? 'not_a_fit' : nextStage;
  const shouldRecycle = savedStage === 'recycle_try_later';
  const shouldMoveToMaintenance = isMaintenanceStage(savedStage);
  const shouldMoveToSampleReview = savedStage === 'sample_requested';
  const shouldUnassign = shouldRecycle || shouldMoveToMaintenance;
  let finalStage = savedStage;
  let finalShouldRecycle = shouldRecycle;
  let finalShouldMoveToMaintenance = shouldMoveToMaintenance;
  let finalShouldMoveToSampleReview = shouldMoveToSampleReview;
  const assignedProfileId = shouldUnassign ? null : current.isOwner ? selectedRepId || null : before.assigned_profile_id;
  if (current.isOwner && assignedProfileId && assignedProfileId !== before.assigned_profile_id) {
    const isEligibleRep = await isEligibleProspectingSalesRep(supabase, assignedProfileId);
    if (!isEligibleRep) redirect(leadHref(leadId, 'invalid_rep', queueContext));
  }
  const nextFollowUp = shouldUnassign ? null : safeDateInput(formData.get('next_follow_up_at'));
  const notes = cleanText(formData.get('notes'));
  const state = cleanText(formData.get('state'));
  const addressLine1 = cleanText(formData.get('address_line_1'));
  const addressLine2 = cleanText(formData.get('address_line_2'));
  const city = cleanText(formData.get('city'));
  const companyEmail = cleanText(formData.get('company_email'));
  const companyWebsite = cleanText(formData.get('company_website'));
  const country = cleanText(formData.get('country'));
  const postalCode = cleanText(formData.get('postal_code'));
  const stageChanged = normalizeStage(before.stage) !== savedStage;
  const assignmentChanged = (before.assigned_profile_id ?? null) !== (assignedProfileId ?? null);
  const leadDetailsChanged = [
    textChanged(before.address_line_1, addressLine1),
    textChanged(before.address_line_2, addressLine2),
    textChanged(before.city, city),
    textChanged(before.company_email, companyEmail),
    textChanged(before.company_name, companyName),
    textChanged(before.company_website, companyWebsite),
    textChanged(before.country, country),
    textChanged(before.next_follow_up_at, nextFollowUp),
    textChanged(before.phone, phone),
    textChanged(before.postal_code, postalCode),
    textChanged(before.state, state),
    Boolean(before.do_not_contact) !== doNotContact,
    normalizePriority(before.priority) !== priority,
    stageChanged,
  ].some(Boolean);
  const notesChanged = textChanged(before.notes, notes);

  const activityRows: Array<Record<string, unknown>> = [];
  if (leadDetailsChanged) {
    activityRows.push({
      activity_type: stageChanged ? 'stage_change' : 'enrichment',
      body: stageChanged ? `Stage changed from ${stageLabel(before.stage)} to ${stageLabel(savedStage)}.` : 'Lead details updated.',
      created_by: current.profile.id,
      lead_id: leadId,
      next_stage: savedStage,
      previous_assigned_profile_id: shouldUnassign ? before.assigned_profile_id : null,
      previous_stage: before.stage,
      result: stageChanged ? 'Stage updated' : 'Lead updated',
    });
  }
  if (assignmentChanged) {
    activityRows.push({
      activity_type: 'assignment',
      body: assignedProfileId ? 'Assigned sales rep changed.' : 'Lead unassigned.',
      created_by: current.profile.id,
      lead_id: leadId,
      next_stage: savedStage,
      previous_assigned_profile_id: before.assigned_profile_id,
      previous_stage: before.stage,
      result: assignedProfileId ? 'Assigned' : 'Unassigned',
    });
  }

  if (notesChanged) {
    activityRows.push({
      activity_type: 'enrichment',
      body: 'Lead notes updated.',
      created_by: current.profile.id,
      lead_id: leadId,
      previous_stage: before.stage,
      result: 'Notes updated',
    });
  }

  const contactUpdates: Array<Record<string, unknown>> = [];
  const contactIds = cleanRecordIds(formData, 'record_contact_id');
  if (contactIds.length) {
    const { data: existingContactsData, error: contactLoadError } = await supabase
      .from('prospecting_contacts')
      .select('email,full_name,id,is_primary,notes,phone,title')
      .eq('lead_id', leadId)
      .in('id', contactIds);
    if (contactLoadError) redirect(leadHref(leadId, 'save_error', queueContext));

    const existingContacts = new Map(((existingContactsData ?? []) as ContactRow[]).map((contact) => [contact.id, contact]));
    for (const contactId of contactIds) {
      const existing = existingContacts.get(contactId);
      if (!existing) redirect(leadHref(leadId, 'save_error', queueContext));

      const contactUpdate = {
        email: cleanText(formData.get(contactFieldName(contactId, 'email'))),
        full_name: cleanText(formData.get(contactFieldName(contactId, 'full_name'))),
        is_primary: formData.get(contactFieldName(contactId, 'is_primary')) === 'on',
        notes: cleanText(formData.get(contactFieldName(contactId, 'notes'))),
        phone: cleanText(formData.get(contactFieldName(contactId, 'phone'))),
        title: cleanText(formData.get(contactFieldName(contactId, 'title'))),
      };
      const contactChanged = [
        textChanged(existing.email, contactUpdate.email),
        textChanged(existing.full_name, contactUpdate.full_name),
        textChanged(existing.notes, contactUpdate.notes),
        textChanged(existing.phone, contactUpdate.phone),
        textChanged(existing.title, contactUpdate.title),
        Boolean(existing.is_primary) !== contactUpdate.is_primary,
      ].some(Boolean);
      if (!contactChanged) continue;

      contactUpdates.push({ id: contactId, ...contactUpdate });

      activityRows.push({
        activity_type: 'enrichment',
        body: 'Key contact updated.',
        created_by: current.profile.id,
        lead_id: leadId,
        result: 'Contact updated',
      });
    }
  }

  const newContact = {
    email: cleanText(formData.get('new_contact_email')),
    full_name: cleanText(formData.get('new_contact_full_name')),
    is_primary: formData.get('new_contact_is_primary') === 'on',
    notes: cleanText(formData.get('new_contact_notes')),
    phone: cleanText(formData.get('new_contact_phone')),
    title: cleanText(formData.get('new_contact_title')),
  };
  const shouldAddContact = [newContact.email, newContact.full_name, newContact.notes, newContact.phone, newContact.title].some(Boolean);
  if (shouldAddContact) {
    activityRows.push({
      activity_type: 'enrichment',
      body: 'Key contact added.',
      created_by: current.profile.id,
      lead_id: leadId,
      result: 'Contact added',
    });
  }

  const activityTypeRaw = String(formData.get('activity_type') ?? 'note');
  const activityType = PROSPECTING_ACTIVITY_TYPES.some((item) => item.id === activityTypeRaw) ? activityTypeRaw as ProspectingActivityType : 'note';
  const activityResult = cleanText(formData.get('activity_result'));
  const activityBody = cleanText(formData.get('activity_body'));
  const activityContactId = cleanRecordId(formData.get('activity_contact_id'));
  const activityExplicitStage = String(formData.get('activity_next_stage') ?? '');
  const activityNextFollowUp = safeDateInput(formData.get('activity_next_follow_up_at'));
  const activityBlockedByDoNotContact = Boolean(before.do_not_contact) && doNotContact;
  const shouldLogActivity = Boolean(activityResult || activityBody || activityContactId || activityExplicitStage || activityNextFollowUp);
  let activityPayload: Record<string, unknown> | null = null;
  let finalAssignedProfileId = assignedProfileId;
  let finalDoNotContact = doNotContact;
  let finalNextFollowUp = nextFollowUp;
  if (shouldLogActivity && !activityBlockedByDoNotContact) {
    const activitySavedStage = resolveActivityStage({ currentStage: finalStage, explicitStage: activityExplicitStage, result: activityResult });
    const activityDoNotContact = activitySavedStage === 'not_a_fit' && ['Do not contact', 'Unsubscribed', 'Wrong number', 'Bounced'].includes(activityResult ?? '');
    const activityShouldRecycle = activitySavedStage === 'recycle_try_later';
    const activityShouldMoveToMaintenance = isMaintenanceStage(activitySavedStage);
    const activityShouldMoveToSampleReview = activitySavedStage === 'sample_requested';
    const activityShouldUnassign = activityShouldRecycle || activityShouldMoveToMaintenance;
    const activitySavedNextFollowUp = resolveActivityNextFollowUp({
      requestedNextFollowUp: activityNextFollowUp,
      shouldUnassign: activityShouldUnassign,
    });

    activityPayload = {
      activity_type: activityType,
      body: activityBody,
      contact_id: activityContactId || null,
      next_follow_up_at: activityNextFollowUp,
      next_stage: activitySavedStage,
      previous_assigned_profile_id: activityShouldUnassign ? assignedProfileId : null,
      previous_stage: finalStage,
      result: activityResult,
    };

    if (activityShouldRecycle) {
      activityRows.push({
        activity_type: 'assignment',
        body: 'Lead recycled to the unassigned pool.',
        created_by: current.profile.id,
        lead_id: leadId,
        next_stage: activitySavedStage,
        previous_assigned_profile_id: assignedProfileId,
        previous_stage: finalStage,
        result: 'Unassigned',
      });
    }

    if (activityShouldMoveToMaintenance) {
      activityRows.push({
        activity_type: 'assignment',
        body: `Lead moved to ${stageLabel(activitySavedStage)} review.`,
        created_by: current.profile.id,
        lead_id: leadId,
        next_stage: activitySavedStage,
        previous_assigned_profile_id: assignedProfileId,
        previous_stage: finalStage,
        result: 'Unassigned',
      });
    }

    finalStage = activitySavedStage;
    finalAssignedProfileId = activityShouldUnassign ? null : assignedProfileId;
    finalDoNotContact = doNotContact || activityDoNotContact;
    finalNextFollowUp = activitySavedNextFollowUp;
    finalShouldRecycle = activityShouldRecycle;
    finalShouldMoveToMaintenance = activityShouldMoveToMaintenance;
    finalShouldMoveToSampleReview = activityShouldMoveToSampleReview;
  }

  const { data: savedLead, error: saveError } = await supabaseAdmin.rpc('save_prospecting_record_v1', {
    p_actor_id: current.profile.id,
    p_activity: activityPayload,
    p_audit_activities: activityRows,
    p_contact_updates: contactUpdates,
    p_expected_updated_at: before.updated_at,
    p_lead: {
      address_line_1: addressLine1,
      address_line_2: addressLine2,
      assigned_profile_id: finalAssignedProfileId,
      city,
      company_email: companyEmail,
      company_name: companyName,
      company_name_key: normalizeTextKey(companyName),
      company_website: companyWebsite,
      country,
      do_not_contact: finalDoNotContact,
      next_follow_up_at: finalNextFollowUp,
      notes,
      phone,
      phone_key: normalizePhoneKey(phone),
      postal_code: postalCode,
      priority,
      stage: finalStage,
      state,
      state_key: normalizeStateKey(state),
    },
    p_lead_id: leadId,
    p_new_contact: shouldAddContact ? newContact : null,
  });

  if (saveError || !savedLead) {
    redirect(leadHref(leadId, saveError?.code === '40001' ? 'record_stale' : 'save_error', queueContext));
  }

  if (finalShouldMoveToSampleReview) {
    redirect(sampleOrderHref({ leadId, nextRecordId, previousRecordId, queueContext, toast: 'sample_requested' }));
  }

  if ((finalShouldRecycle || finalShouldMoveToMaintenance) && !current.isOwner) {
    redirect(await shuckedRepRedirectHref({
      current,
      nextRecordId,
      previousRecordId,
      queueContext,
      toast: finalShouldRecycle ? 'lead_recycled' : finalShouldMoveToMaintenance ? 'lead_reviewed' : 'record_saved',
    }));
  }
  redirect(leadHref(leadId, 'record_saved', queueContext));
}

async function deleteContact(formData: FormData) {
  'use server';

  const leadId = String(formData.get('lead_id') ?? '').trim();
  const contactId = String(formData.get('contact_id') ?? '').trim();
  const queueContext = prospectingQueueContextFromParams(formData);
  const current = await requireAdminSectionEdit('prospecting', leadHref(leadId, 'admin_write_denied', queueContext));
  const supabase = await createClient();
  const before = await loadLeadForMutation(supabase, leadId, current);
  if (!before || !contactId) redirect('/admin/sales/prospecting?toast=missing_lead');

  const { error } = await supabase.from('prospecting_contacts').delete().eq('id', contactId).eq('lead_id', leadId);
  if (!error) {
    await supabase.from('prospecting_activities').insert({
      activity_type: 'enrichment',
      body: 'Key contact removed.',
      created_by: current.profile.id,
      lead_id: leadId,
      result: 'Contact removed',
    });
  }

  redirect(leadHref(leadId, error ? 'contact_error' : 'contact_deleted', queueContext));
}

function Toasts({ toast }: { toast: string }) {
  const messages: Record<string, { message: string; tone: 'success' | 'error' }> = {
    activity_error: { message: 'Unable to save that activity.', tone: 'error' },
    activity_saved: { message: 'Activity saved.', tone: 'success' },
    admin_write_denied: { message: 'You do not have edit access to this lead.', tone: 'error' },
    company_required: { message: 'Company name is required.', tone: 'error' },
    contact_added: { message: 'Contact added.', tone: 'success' },
    contact_deleted: { message: 'Contact removed.', tone: 'success' },
    contact_error: { message: 'Unable to save that contact.', tone: 'error' },
    contact_saved: { message: 'Contact saved.', tone: 'success' },
    invalid_rep: { message: 'That user is not available for Prospecting assignment.', tone: 'error' },
    lead_recycled: { message: 'Lead recycled. Moved to the next record.', tone: 'success' },
    lead_reviewed: { message: 'Lead moved to review. Moved to the next record.', tone: 'success' },
    lead_saved: { message: 'Lead saved.', tone: 'success' },
    notes_error: { message: 'Unable to save lead notes.', tone: 'error' },
    notes_saved: { message: 'Lead notes saved.', tone: 'success' },
    record_saved: { message: 'Record data saved.', tone: 'success' },
    record_stale: { message: 'This lead changed while you were editing it. Reload and try again.', tone: 'error' },
    save_error: { message: 'Unable to save this lead. Check for duplicate company and phone values.', tone: 'error' },
    sample_order_created: { message: 'Sample order created. Moved to the next record.', tone: 'success' },
    sample_requested: { message: 'Sample requested. Moved to the next record.', tone: 'success' },
  };
  const match = messages[toast];
  return match ? <StatusToast message={match.message} tone={match.tone} /> : null;
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="text-sm font-semibold text-slate-700">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function ResultOptions({ type }: { type: 'call' | 'email' }) {
  const options = type === 'call' ? CALL_RESULTS : EMAIL_RESULTS;
  return options.map((result) => <option key={result} value={result}>{result}</option>);
}

function ActivityTimeline({ activities }: { activities: ActivityRow[] }) {
  return (
    <section className="card space-y-5 border-teal-100 bg-white/95">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">Timeline</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Calls, emails, notes, and changes</h2>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {activities.length.toLocaleString()} {activities.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      <div className="max-h-[44rem] space-y-3 overflow-y-auto pr-1">
        {activities.map((activity) => {
          const tone = activityTone(activity.activity_type);
          const bodyBlocks = noteBlocks(activity.body);
          return (
            <article key={activity.id} className={`relative overflow-hidden rounded-lg border ${tone.border} bg-white px-4 py-4 shadow-sm`}>
              <div className={`absolute left-0 top-0 h-full w-1 ${tone.accent}`} />
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem]">
                <div className="min-w-0 space-y-3 pl-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone.badge}`}>{titleCase(activity.activity_type)}</span>
                    {activity.result ? <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">{activity.result}</span> : null}
                  </div>

                  {activity.previous_stage !== activity.next_stage && activity.next_stage ? (
                    <p className="text-base font-semibold text-teal-800">{stageLabel(activity.previous_stage)} to {stageLabel(activity.next_stage)}</p>
                  ) : null}

                  {activity.next_follow_up_at ? (
                    <p className="inline-flex rounded-lg bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700">
                      Next follow-up: {formatDate(activity.next_follow_up_at)}
                    </p>
                  ) : null}

                  {bodyBlocks.length ? (
                    <div className="space-y-2 rounded-lg bg-slate-50 px-4 py-3 text-[0.95rem] leading-7 text-slate-700">
                      {bodyBlocks.map((block, index) => (
                        <p key={`${activity.id}-${index}`} className="whitespace-pre-wrap break-words">{block}</p>
                      ))}
                    </div>
                  ) : null}
                </div>

                <time className="pl-2 text-sm font-semibold text-slate-500 md:text-right" dateTime={activity.created_at ?? undefined}>
                  {formatDateTime(activity.created_at)}
                </time>
              </div>
            </article>
          );
        })}
        {!activities.length ? <p className="rounded-lg border border-dashed border-slate-200 px-3 py-10 text-center text-sm font-semibold text-slate-500">No activity yet.</p> : null}
      </div>
    </section>
  );
}

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const current = await requireAdminSectionView('prospecting');
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const queueContext = prospectingQueueContextFromParams(searchParams);

  const [{ data: leadData }, { data: contactsData }, { data: activitiesData }, { data: listLinksData }] = await Promise.all([
    supabase.from('prospecting_leads').select('*').eq('id', params.id).maybeSingle(),
    supabase.from('prospecting_contacts').select('*').eq('lead_id', params.id).order('is_primary', { ascending: false }).order('created_at', { ascending: true }),
    supabase.from('prospecting_activities').select('*').eq('lead_id', params.id).order('created_at', { ascending: false }).limit(40),
    supabase.from('prospecting_list_leads').select('prospecting_lists(name)').eq('lead_id', params.id),
  ]);

  if (!leadData) notFound();

  const lead = leadData as LeadRow;
  const isOwner = current.isOwner;
  if (!isOwner && (lead.assigned_profile_id !== current.profile.id || normalizeStage(lead.stage) === 'sample_requested')) {
    redirect('/admin/sales/prospecting?toast=missing_lead');
  }

  const contacts = (contactsData ?? []) as ContactRow[];
  const activities = (activitiesData ?? []) as ActivityRow[];
  const listLinks = (listLinksData ?? []) as ListLeadRow[];
  const missing = missingLeadFields(lead, contacts);
  const [salesRepsData, assignedProfileResult] = await Promise.all([
    isOwner ? loadProspectingSalesReps(supabase) : Promise.resolve([]),
    lead.assigned_profile_id
      ? supabase.from('profiles').select('id,email,full_name,is_active').eq('id', lead.assigned_profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const salesReps = (salesRepsData as ProfileRow[]).sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)));
  const assignedProfile = assignedProfileResult.data as ProfileRow | null;
  const assignedProfileOption = assignedProfile && lead.assigned_profile_id && !salesReps.some((rep) => rep.id === lead.assigned_profile_id)
    ? assignedProfile
    : null;
  const today = formatCentralDateInput(new Date());
  const todayStart = parseCentralDateInput(today) ?? new Date();
  const queueProfileId = isOwner
    ? queueContext.repId || lead.assigned_profile_id || null
    : current.profile.id;
  const nextQueueSelect = queueContext.listId ? 'id,prospecting_list_leads!inner(list_id)' : 'id';
  let nextQueueQuery = supabase
    .from('prospecting_leads')
    .select(nextQueueSelect)
    .is('archived_at', null)
    .limit(5000);
  nextQueueQuery = queueProfileId
    ? nextQueueQuery.eq('assigned_profile_id', queueProfileId)
    : nextQueueQuery.is('assigned_profile_id', null);
  if (!isOwner) nextQueueQuery = nextQueueQuery.eq('assigned_profile_id', current.profile.id);
  nextQueueQuery = nextQueueQuery.in('stage', prospectingQueueStageFilter(queueContext));
  if (prospectingQueueRequiresFollowUp(queueContext)) nextQueueQuery = nextQueueQuery.not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today);
  if (prospectingQueueSkipsTouchedToday(queueContext)) nextQueueQuery = nextQueueQuery.or(`last_activity_at.is.null,last_activity_at.lt.${todayStart.toISOString()}`);
  if (queueContext.priority) nextQueueQuery = nextQueueQuery.eq('priority', queueContext.priority);
  if (queueContext.state === MISSING_STATE_FILTER) nextQueueQuery = nextQueueQuery.is('state_key', null);
  else if (queueContext.state) nextQueueQuery = nextQueueQuery.eq('state_key', queueContext.state);
  if (queueContext.listId) nextQueueQuery = nextQueueQuery.eq('prospecting_list_leads.list_id', queueContext.listId);
  if (queueContext.q) {
    const search = postgrestIlikePattern(queueContext.q);
    nextQueueQuery = nextQueueQuery.or([
      `company_name.ilike.${search}`,
      `phone.ilike.${search}`,
      `company_email.ilike.${search}`,
      `city.ilike.${search}`,
      `state.ilike.${search}`,
      `last_result.ilike.${search}`,
    ].join(','));
  }
  for (const order of prospectingQueueOrderFields(queueContext)) {
    nextQueueQuery = nextQueueQuery.order(order.column, { ascending: order.ascending });
  }
  const { data: nextQueueData } = await nextQueueQuery;
  const queueIds = ((nextQueueData ?? []) as unknown as Array<{ id: string | null }>).map((row) => row.id).filter(Boolean) as string[];
  const currentQueueIndex = queueIds.indexOf(lead.id);
  const previousLeadId = currentQueueIndex > 0 ? queueIds[currentQueueIndex - 1] : null;
  const nextLeadId = currentQueueIndex >= 0
    ? queueIds[currentQueueIndex + 1] ?? null
    : queueIds.find((id) => id !== lead.id) ?? null;
  const leadNoteBlocks = noteBlocks(lead.notes);
  const recordFormId = 'prospecting-record-data-form';

  return (
    <div className="space-y-6">
      <Toasts toast={toast} />
      <section className="panel">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Link className="btn-secondary inline-flex self-start" href={prospectingBackHref(queueContext)}>Back to Main Prospecting List</Link>
          <div className="flex flex-col gap-2 sm:flex-row">
            {previousLeadId ? <Link className="btn-secondary inline-flex" href={leadHref(previousLeadId, undefined, queueContext)}>Previous Record</Link> : null}
            {nextLeadId ? <Link className="btn-primary inline-flex" href={leadHref(nextLeadId, undefined, queueContext)}>Next Record</Link> : null}
          </div>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <span className="eyebrow">Lead Detail</span>
            <h1 className="page-title mt-4">{lead.company_name}</h1>
            <p className="page-subtitle mt-3">
              {stageLabel(lead.stage)} - {priorityLabel(lead.priority)} - Rep: {profileLabel(assignedProfile)}
            </p>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:w-[32rem]">
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Next Follow-Up</p>
              <p className="mt-2 font-semibold text-slate-950">{formatDate(lead.next_follow_up_at)}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Last Result</p>
              <p className="mt-2 font-semibold text-slate-950">{lead.last_result || 'None'}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">HubSpot</p>
              <p className="mt-2 font-semibold text-slate-950">{lead.hubspot_status || 'Not queued'}</p>
            </div>
          </div>
        </div>
      </section>

      {lead.do_not_contact ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
          This lead is marked do not contact.
        </div>
      ) : null}

      <form action={saveRecordData} className="sticky top-3 z-30" id={recordFormId}>
        <input type="hidden" name="lead_id" value={lead.id} />
        <QueueContextFields context={queueContext} />
        <input type="hidden" name="next_record_id" value={nextLeadId ?? ''} />
        <input type="hidden" name="previous_record_id" value={previousLeadId ?? ''} />
        <div className="rounded-2xl border border-teal-200 bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Record Updates</p>
              <p className="mt-1 text-sm font-semibold text-slate-700">Company profile, contacts, and lead notes</p>
            </div>
            <PendingSubmitButton className="btn-primary min-h-14 w-full px-6 text-base sm:w-auto" label="Save All Record Data" pendingLabel="Saving Record..." />
          </div>
        </div>
      </form>

      <ActivityTimeline activities={activities} />

      {missing.length ? (
        <section className="card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Missing Info</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {missing.map((item) => <span key={item} className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">{item}</span>)}
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
        <section className="card space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Company Profile</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Enrich lead details</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Company name"><input className="input" form={recordFormId} name="company_name" defaultValue={lead.company_name} required /></Field>
            <Field label="Phone"><input className="input" form={recordFormId} name="phone" defaultValue={lead.phone ?? ''} /></Field>
            <Field label="Company email"><input className="input" form={recordFormId} name="company_email" type="email" defaultValue={lead.company_email ?? ''} /></Field>
            <Field label="Website"><input className="input" form={recordFormId} name="company_website" defaultValue={lead.company_website ?? ''} /></Field>
            <Field label="Address 1"><input className="input" form={recordFormId} name="address_line_1" defaultValue={lead.address_line_1 ?? ''} /></Field>
            <Field label="Address 2"><input className="input" form={recordFormId} name="address_line_2" defaultValue={lead.address_line_2 ?? ''} /></Field>
            <Field label="City"><input className="input" form={recordFormId} name="city" defaultValue={lead.city ?? ''} /></Field>
            <Field label="State"><input className="input" form={recordFormId} name="state" defaultValue={lead.state ?? ''} /></Field>
            <Field label="Postal code"><input className="input" form={recordFormId} name="postal_code" defaultValue={lead.postal_code ?? ''} /></Field>
            <Field label="Country"><input className="input" form={recordFormId} name="country" defaultValue={lead.country ?? ''} /></Field>
            <Field label="Stage">
              <select className="input" form={recordFormId} name="stage" defaultValue={normalizeStage(lead.stage)}>
                {PROSPECTING_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" form={recordFormId} name="priority" defaultValue={normalizePriority(lead.priority)}>
                {PROSPECTING_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
              </select>
            </Field>
            <Field label="Next follow-up"><input className="input" form={recordFormId} name="next_follow_up_at" type="date" defaultValue={lead.next_follow_up_at ?? ''} /></Field>
            {isOwner ? (
              <Field label="Assigned rep">
                <select className="input" form={recordFormId} name="assigned_profile_id" defaultValue={lead.assigned_profile_id ?? ''}>
                  <option value="">Unassigned</option>
                  {assignedProfileOption ? <option value={assignedProfileOption.id} hidden>{profileLabel(assignedProfileOption)} (current)</option> : null}
                  {salesReps.map((rep) => <option key={rep.id} value={rep.id}>{profileLabel(rep)}</option>)}
                </select>
              </Field>
            ) : <input form={recordFormId} type="hidden" name="assigned_profile_id" value={lead.assigned_profile_id ?? ''} />}
          </div>
          <label className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700">
            <input form={recordFormId} type="checkbox" name="do_not_contact" defaultChecked={Boolean(lead.do_not_contact)} />
            Do not contact
          </label>
        </section>

        <section className="card space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Activity Log</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Record call, email, or note</h2>
          </div>
          <Field label="Activity type">
            <select className="input" form={recordFormId} name="activity_type" defaultValue="call">
              {PROSPECTING_ACTIVITY_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select>
          </Field>
          <Field label="Contact">
            <select className="input" form={recordFormId} name="activity_contact_id" defaultValue="">
              <option value="">Company level</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name || contact.email || contact.phone || 'Unnamed contact'}</option>)}
            </select>
          </Field>
          <Field label="Canned result">
            <select className="input" form={recordFormId} name="activity_result" defaultValue="">
              <option value="">No canned result</option>
              <optgroup label="Call results"><ResultOptions type="call" /></optgroup>
              <optgroup label="Email results"><ResultOptions type="email" /></optgroup>
            </select>
          </Field>
          <Field label="Move stage">
            <select className="input" form={recordFormId} name="activity_next_stage" defaultValue="">
              <option value="">{stageLabel(lead.stage)} (current)</option>
              {PROSPECTING_STAGES
                .filter((stage) => stage.id !== normalizeStage(lead.stage))
                .map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
            </select>
          </Field>
          <Field label="Next follow-up"><input className="input" form={recordFormId} name="activity_next_follow_up_at" type="date" /></Field>
          <Field label="Notes after this activity"><textarea className="input min-h-32" form={recordFormId} name="activity_body" placeholder="What happened, who you spoke with, and what should happen next." /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            {previousLeadId ? <Link className="btn-secondary inline-flex justify-center" href={leadHref(previousLeadId, undefined, queueContext)}>Previous Record</Link> : null}
            {nextLeadId ? <Link className="btn-secondary inline-flex justify-center" href={leadHref(nextLeadId, undefined, queueContext)}>Next Record</Link> : null}
          </div>
        </section>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
        <section className="card space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Key Contacts</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">People inside the company</h2>
          </div>
          <div className="space-y-3">
            {contacts.map((contact) => (
              <details key={contact.id} className="rounded-lg border border-slate-200 bg-white/70 p-3" open={contacts.length === 1}>
                <summary className="cursor-pointer text-sm font-semibold text-slate-950">
                  {contact.full_name || contact.email || contact.phone || 'Unnamed contact'} {contact.is_primary ? <span className="text-teal-700">- Primary</span> : null}
                </summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <input form={recordFormId} type="hidden" name="record_contact_id" value={contact.id} />
                  <Field label="Name"><input className="input" form={recordFormId} name={contactFieldName(contact.id, 'full_name')} defaultValue={contact.full_name ?? ''} /></Field>
                  <Field label="Title"><input className="input" form={recordFormId} name={contactFieldName(contact.id, 'title')} defaultValue={contact.title ?? ''} /></Field>
                  <Field label="Email"><input className="input" form={recordFormId} name={contactFieldName(contact.id, 'email')} type="email" defaultValue={contact.email ?? ''} /></Field>
                  <Field label="Phone"><input className="input" form={recordFormId} name={contactFieldName(contact.id, 'phone')} defaultValue={contact.phone ?? ''} /></Field>
                  <label className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 md:col-span-2">
                    <input form={recordFormId} type="checkbox" name={contactFieldName(contact.id, 'is_primary')} defaultChecked={Boolean(contact.is_primary)} />
                    Primary contact
                  </label>
                  <div className="md:col-span-2">
                    <Field label="Contact notes"><textarea className="input min-h-24" form={recordFormId} name={contactFieldName(contact.id, 'notes')} defaultValue={contact.notes ?? ''} /></Field>
                  </div>
                </div>
                <form action={deleteContact} className="mt-3">
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <input type="hidden" name="contact_id" value={contact.id} />
                  <QueueContextFields context={queueContext} />
                  <ConfirmSubmitButton className="rounded-full border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700" confirmMessage="Remove this contact?" label="Remove Contact" pendingLabel="Removing..." />
                </form>
              </details>
            ))}
            {!contacts.length ? <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">No contacts yet.</p> : null}
          </div>
        </section>

        <section className="card space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Add Contact</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">New key contact</h2>
          </div>
          <Field label="Name"><input className="input" form={recordFormId} name="new_contact_full_name" /></Field>
          <Field label="Title"><input className="input" form={recordFormId} name="new_contact_title" /></Field>
          <Field label="Email"><input className="input" form={recordFormId} name="new_contact_email" type="email" /></Field>
          <Field label="Phone"><input className="input" form={recordFormId} name="new_contact_phone" /></Field>
          <label className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700">
            <input form={recordFormId} type="checkbox" name="new_contact_is_primary" defaultChecked={!contacts.length} />
            Primary contact
          </label>
          <Field label="Notes"><textarea className="input min-h-24" form={recordFormId} name="new_contact_notes" /></Field>
        </section>
      </section>

      <aside className="card space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Lead Lists</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Source context</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {listLinks.map((link, index) => (
              <span key={`${relatedOne(link.prospecting_lists)?.name}-${index}`} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                {relatedOne(link.prospecting_lists)?.name || 'Lead list'}
              </span>
            ))}
            {!listLinks.length ? <p className="text-sm text-slate-500">No list association.</p> : null}
          </div>
          <div className="rounded-lg bg-white/70 px-3 py-2 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Created</p>
            <p className="mt-1">{formatDateTime(lead.created_at)}</p>
          </div>
          <div className="rounded-lg bg-white/70 px-3 py-2 text-sm text-slate-600">
            <p className="font-semibold text-slate-950">Updated</p>
            <p className="mt-1">{formatDateTime(lead.updated_at)}</p>
          </div>
          {lead.hubspot_exported_at ? (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <p className="font-semibold">HubSpot exported</p>
              <p className="mt-1">{formatDateTime(lead.hubspot_exported_at)}</p>
            </div>
          ) : null}
      </aside>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
        <section className="card border-slate-200 bg-white/80">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Lead Notes</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Internal notes</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">Secondary</span>
          </div>
          {leadNoteBlocks.length ? (
            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white/85 px-5 py-4 text-[0.95rem] leading-7 text-slate-700">
              <div className="space-y-4">
                {leadNoteBlocks.map((block, index) => (
                  <p key={`${index}-${block.slice(0, 24)}`} className="whitespace-pre-wrap break-words">
                    {block}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-slate-200 bg-white/70 px-5 py-5 text-sm font-semibold text-slate-500">
              No lead notes yet.
            </p>
          )}
        </section>

        <section className="card space-y-4 border-slate-200 bg-white/80">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Edit Notes</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Lead notes</h2>
          </div>
          <textarea className="input min-h-44 text-[0.95rem] leading-7" form={recordFormId} name="notes" defaultValue={lead.notes ?? ''} />
        </section>
      </section>
    </div>
  );
}

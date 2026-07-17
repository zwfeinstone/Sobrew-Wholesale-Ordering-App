import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionEdit, requireAdminSectionView } from '@/lib/admin-permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { formatCentralDateInput } from '@/lib/time-clock';
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
  isHubspotQueueStage,
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
  prospectingQueueRequiresFollowUp,
  prospectingQueueStageFilter,
  stageFromResult,
  stageLabel,
  type ProspectingActivityType,
  type ProspectingQueueContext,
  type ProspectingStage,
} from '@/lib/prospecting';

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

type ProfileRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
};

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
    .select('id,assigned_profile_id,stage,hubspot_status,company_name')
    .eq('id', leadId);
  if (!current.isOwner) query = query.eq('assigned_profile_id', current.profile.id);
  const { data } = await query.maybeSingle();
  return data as { assigned_profile_id: string | null; company_name: string; hubspot_status: string | null; id: string; stage: string | null } | null;
}

async function syncHubspotQueue({
  actorId,
  leadId,
  stage,
}: {
  actorId: string;
  leadId: string;
  stage: ProspectingStage;
}) {
  if (isHubspotQueueStage(stage)) {
    const { error: queueError } = await supabaseAdmin.from('prospecting_hubspot_queue').upsert({
      lead_id: leadId,
      queued_by: actorId,
      queued_stage: stage,
      status: 'queued',
    }, { onConflict: 'lead_id' });
    const { error: leadError } = await supabaseAdmin.from('prospecting_leads').update({ hubspot_status: 'queued' }).eq('id', leadId);
    return queueError ?? leadError;
  } else {
    const { error: queueError } = await supabaseAdmin.from('prospecting_hubspot_queue').delete().eq('lead_id', leadId).eq('status', 'queued');
    const { error: leadError } = await supabaseAdmin.from('prospecting_leads').update({ hubspot_status: 'not_queued' }).eq('id', leadId).eq('hubspot_status', 'queued');
    return queueError ?? leadError;
  }
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
  const selectColumns = queueContext.listId ? 'id,prospecting_list_leads!inner(list_id)' : 'id';
  let query = supabase
    .from('prospecting_leads')
    .select(selectColumns)
    .in('id', candidateIds)
    .eq('assigned_profile_id', current.profile.id)
    .is('archived_at', null);

  query = query.in('stage', prospectingQueueStageFilter(queueContext));
  if (prospectingQueueRequiresFollowUp(queueContext)) query = query.not('next_follow_up_at', 'is', null).lte('next_follow_up_at', today);
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

async function saveLeadDetails(formData: FormData) {
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
  const shouldUnassign = shouldRecycle || shouldMoveToMaintenance;
  const assignedProfileId = shouldUnassign ? null : current.isOwner ? selectedRepId || null : before.assigned_profile_id;
  const nextFollowUp = shouldUnassign ? null : safeDateInput(formData.get('next_follow_up_at'));
  const state = cleanText(formData.get('state'));

  const { error, data } = await supabaseAdmin
    .from('prospecting_leads')
    .update({
      address_line_1: cleanText(formData.get('address_line_1')),
      address_line_2: cleanText(formData.get('address_line_2')),
      assigned_profile_id: assignedProfileId,
      city: cleanText(formData.get('city')),
      company_email: cleanText(formData.get('company_email')),
      company_name: companyName,
      company_name_key: normalizeTextKey(companyName),
      company_website: cleanText(formData.get('company_website')),
      country: cleanText(formData.get('country')),
      do_not_contact: doNotContact,
      next_follow_up_at: nextFollowUp,
      notes: cleanText(formData.get('notes')),
      phone,
      phone_key: normalizePhoneKey(phone),
      postal_code: cleanText(formData.get('postal_code')),
      priority,
      stage: savedStage,
      state,
      state_key: normalizeStateKey(state),
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq('id', leadId)
    .select('id')
    .maybeSingle();

  if (error || !data) redirect(leadHref(leadId, 'save_error', queueContext));

  const hubspotError = await syncHubspotQueue({ actorId: current.profile.id, leadId, stage: savedStage });
  if (hubspotError) redirect(leadHref(leadId, 'save_error', queueContext));

  const activityRows: Array<Record<string, unknown>> = [
    {
      activity_type: before.stage !== savedStage ? 'stage_change' : 'enrichment',
      body: before.stage !== savedStage ? `Stage changed from ${stageLabel(before.stage)} to ${stageLabel(savedStage)}.` : 'Lead details updated.',
      created_by: current.profile.id,
      lead_id: leadId,
      next_stage: savedStage,
      previous_assigned_profile_id: shouldUnassign ? before.assigned_profile_id : null,
      previous_stage: before.stage,
      result: before.stage !== savedStage ? 'Stage updated' : 'Lead updated',
    },
  ];
  if (before.assigned_profile_id !== assignedProfileId) {
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
  const { error: activityError } = await supabaseAdmin.from('prospecting_activities').insert(activityRows);
  if (activityError) redirect(leadHref(leadId, 'save_error', queueContext));

  if ((shouldRecycle || shouldMoveToMaintenance) && !current.isOwner) {
    redirect(await shuckedRepRedirectHref({
      current,
      nextRecordId,
      previousRecordId,
      queueContext,
      toast: shouldRecycle ? 'lead_recycled' : 'lead_reviewed',
    }));
  }
  redirect(leadHref(leadId, 'lead_saved', queueContext));
}

async function addContact(formData: FormData) {
  'use server';

  const leadId = String(formData.get('lead_id') ?? '').trim();
  const queueContext = prospectingQueueContextFromParams(formData);
  const current = await requireAdminSectionEdit('prospecting', leadHref(leadId, 'admin_write_denied', queueContext));
  const supabase = await createClient();
  const before = await loadLeadForMutation(supabase, leadId, current);
  if (!before) redirect('/admin/sales/prospecting?toast=missing_lead');

  const { error } = await supabase.from('prospecting_contacts').insert({
    created_by: current.profile.id,
    email: cleanText(formData.get('email')),
    full_name: cleanText(formData.get('full_name')),
    is_primary: formData.get('is_primary') === 'on',
    lead_id: leadId,
    notes: cleanText(formData.get('notes')),
    phone: cleanText(formData.get('phone')),
    title: cleanText(formData.get('title')),
    updated_by: current.profile.id,
  });

  if (!error) {
    await supabase.from('prospecting_activities').insert({
      activity_type: 'enrichment',
      body: 'Key contact added.',
      created_by: current.profile.id,
      lead_id: leadId,
      result: 'Contact added',
    });
  }

  redirect(leadHref(leadId, error ? 'contact_error' : 'contact_added', queueContext));
}

async function updateContact(formData: FormData) {
  'use server';

  const leadId = String(formData.get('lead_id') ?? '').trim();
  const contactId = String(formData.get('contact_id') ?? '').trim();
  const queueContext = prospectingQueueContextFromParams(formData);
  const current = await requireAdminSectionEdit('prospecting', leadHref(leadId, 'admin_write_denied', queueContext));
  const supabase = await createClient();
  const before = await loadLeadForMutation(supabase, leadId, current);
  if (!before || !contactId) redirect('/admin/sales/prospecting?toast=missing_lead');

  const { error } = await supabase
    .from('prospecting_contacts')
    .update({
      email: cleanText(formData.get('email')),
      full_name: cleanText(formData.get('full_name')),
      is_primary: formData.get('is_primary') === 'on',
      notes: cleanText(formData.get('notes')),
      phone: cleanText(formData.get('phone')),
      title: cleanText(formData.get('title')),
      updated_at: new Date().toISOString(),
      updated_by: current.profile.id,
    })
    .eq('id', contactId)
    .eq('lead_id', leadId);

  if (!error) {
    await supabase.from('prospecting_activities').insert({
      activity_type: 'enrichment',
      body: 'Key contact updated.',
      created_by: current.profile.id,
      lead_id: leadId,
      result: 'Contact updated',
    });
  }

  redirect(leadHref(leadId, error ? 'contact_error' : 'contact_saved', queueContext));
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

async function logLeadActivity(formData: FormData) {
  'use server';

  const leadId = String(formData.get('lead_id') ?? '').trim();
  const queueContext = prospectingQueueContextFromParams(formData);
  const nextRecordId = cleanRecordId(formData.get('next_record_id'));
  const previousRecordId = cleanRecordId(formData.get('previous_record_id'));
  const current = await requireAdminSectionEdit('prospecting', leadHref(leadId, 'admin_write_denied', queueContext));
  const supabase = await createClient();
  const before = await loadLeadForMutation(supabase, leadId, current);
  if (!before) redirect('/admin/sales/prospecting?toast=missing_lead');

  const activityTypeRaw = String(formData.get('activity_type') ?? 'note');
  const activityType = PROSPECTING_ACTIVITY_TYPES.some((item) => item.id === activityTypeRaw) ? activityTypeRaw as ProspectingActivityType : 'note';
  const result = cleanText(formData.get('result'));
  const body = cleanText(formData.get('body'));
  const explicitStage = String(formData.get('next_stage') ?? '');
  const nextStage = explicitStage ? normalizeStage(explicitStage) : stageFromResult(result) ?? normalizeStage(before.stage);
  const nextFollowUp = safeDateInput(formData.get('next_follow_up_at'));
  const doNotContact = ['Do not contact', 'Unsubscribed', 'Wrong number', 'Bounced'].includes(result ?? '');
  const savedStage = doNotContact ? 'not_a_fit' : nextStage;
  const shouldRecycle = savedStage === 'recycle_try_later';
  const shouldMoveToMaintenance = isMaintenanceStage(savedStage);
  const shouldUnassign = shouldRecycle || shouldMoveToMaintenance;
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin.from('prospecting_activities').insert({
    activity_type: activityType,
    body,
    contact_id: cleanText(formData.get('contact_id')),
    created_by: current.profile.id,
    lead_id: leadId,
    next_follow_up_at: nextFollowUp,
    next_stage: savedStage,
    previous_assigned_profile_id: shouldUnassign ? before.assigned_profile_id : null,
    previous_stage: before.stage,
    result,
  });

  if (error) redirect(leadHref(leadId, 'activity_error', queueContext));

  const { error: leadUpdateError, data: updatedLead } = await supabaseAdmin
    .from('prospecting_leads')
    .update({
      do_not_contact: doNotContact || undefined,
      assigned_profile_id: shouldUnassign ? null : undefined,
      last_activity_at: now,
      last_result: result,
      next_follow_up_at: shouldUnassign ? null : nextFollowUp,
      stage: savedStage,
      updated_at: now,
      updated_by: current.profile.id,
    })
    .eq('id', leadId)
    .select('id')
    .maybeSingle();

  if (leadUpdateError || !updatedLead) redirect(leadHref(leadId, 'activity_error', queueContext));

  const hubspotError = await syncHubspotQueue({ actorId: current.profile.id, leadId, stage: savedStage });
  if (hubspotError) redirect(leadHref(leadId, 'activity_error', queueContext));

  if (shouldRecycle) {
    const { error: assignmentError } = await supabaseAdmin.from('prospecting_activities').insert({
      activity_type: 'assignment',
      body: 'Lead recycled to the unassigned pool.',
      created_by: current.profile.id,
      lead_id: leadId,
      next_stage: savedStage,
      previous_assigned_profile_id: before.assigned_profile_id,
      previous_stage: before.stage,
      result: 'Unassigned',
    });
    if (assignmentError) redirect(leadHref(leadId, 'activity_error', queueContext));
  }

  if (shouldMoveToMaintenance) {
    const { error: assignmentError } = await supabaseAdmin.from('prospecting_activities').insert({
      activity_type: 'assignment',
      body: `Lead moved to ${stageLabel(savedStage)} review.`,
      created_by: current.profile.id,
      lead_id: leadId,
      next_stage: savedStage,
      previous_assigned_profile_id: before.assigned_profile_id,
      previous_stage: before.stage,
      result: 'Unassigned',
    });
    if (assignmentError) redirect(leadHref(leadId, 'activity_error', queueContext));
  }

  if ((shouldRecycle || shouldMoveToMaintenance) && !current.isOwner) {
    redirect(await shuckedRepRedirectHref({
      current,
      nextRecordId,
      previousRecordId,
      queueContext,
      toast: shouldRecycle ? 'lead_recycled' : 'lead_reviewed',
    }));
  }

  redirect(leadHref(leadId, 'activity_saved', queueContext));
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
    lead_recycled: { message: 'Lead recycled. Moved to the next record.', tone: 'success' },
    lead_reviewed: { message: 'Lead moved to review. Moved to the next record.', tone: 'success' },
    lead_saved: { message: 'Lead saved.', tone: 'success' },
    save_error: { message: 'Unable to save this lead. Check for duplicate company and phone values.', tone: 'error' },
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
  if (!isOwner && lead.assigned_profile_id !== current.profile.id) redirect('/admin/sales/prospecting?toast=missing_lead');

  const contacts = (contactsData ?? []) as ContactRow[];
  const activities = (activitiesData ?? []) as ActivityRow[];
  const listLinks = (listLinksData ?? []) as ListLeadRow[];
  const missing = missingLeadFields(lead, contacts);
  const [salesRepsResult, assignedProfileResult] = await Promise.all([
    isOwner
      ? supabase
          .from('admin_commission_settings')
          .select('profile_id')
          .eq('is_sales_rep', true)
      : Promise.resolve({ data: [] }),
    lead.assigned_profile_id
      ? supabase.from('profiles').select('id,email,full_name,is_active').eq('id', lead.assigned_profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const salesRepIds = [...new Set(((salesRepsResult.data ?? []) as Array<{ profile_id: string | null }>).map((row) => row.profile_id).filter(Boolean))] as string[];
  const { data: salesRepsData } = isOwner && salesRepIds.length
    ? await supabase.from('profiles').select('id,email,full_name,is_active').in('id', salesRepIds).eq('is_admin', true)
    : { data: [] };
  const salesReps = ((salesRepsData ?? []) as ProfileRow[]).sort((a, b) => profileLabel(a).localeCompare(profileLabel(b)));
  const assignedProfile = assignedProfileResult.data as ProfileRow | null;
  const today = formatCentralDateInput(new Date());
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
  if (queueContext.tab === 'tasks') {
    nextQueueQuery = nextQueueQuery.order('next_follow_up_at', { ascending: true }).order('last_activity_at', { ascending: true });
  } else if (queueContext.tab === 'pipeline') {
    nextQueueQuery = nextQueueQuery.order('stage', { ascending: true }).order('updated_at', { ascending: false });
  } else {
    nextQueueQuery = nextQueueQuery.order('last_activity_at', { ascending: true }).order('created_at', { ascending: true });
  }
  const { data: nextQueueData } = await nextQueueQuery;
  const queueIds = ((nextQueueData ?? []) as unknown as Array<{ id: string | null }>).map((row) => row.id).filter(Boolean) as string[];
  const currentQueueIndex = queueIds.indexOf(lead.id);
  const previousLeadId = currentQueueIndex > 0 ? queueIds[currentQueueIndex - 1] : null;
  const nextLeadId = currentQueueIndex >= 0
    ? queueIds[currentQueueIndex + 1] ?? null
    : queueIds.find((id) => id !== lead.id) ?? null;
  const leadNoteBlocks = noteBlocks(lead.notes);

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

      <ActivityTimeline activities={activities} />

      <section className="card border-amber-200 bg-amber-50/70">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Lead Notes</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Internal notes</h2>
          </div>
          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-amber-800">Rep context</span>
        </div>
        {leadNoteBlocks.length ? (
          <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-amber-100 bg-white/85 px-5 py-4 text-[0.95rem] leading-7 text-slate-800 shadow-sm">
            <div className="space-y-4">
              {leadNoteBlocks.map((block, index) => (
                <p key={`${index}-${block.slice(0, 24)}`} className="whitespace-pre-wrap break-words">
                  {block}
                </p>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-amber-200 bg-white/70 px-5 py-5 text-sm font-semibold text-slate-500">
            No lead notes yet.
          </p>
        )}
      </section>

      {missing.length ? (
        <section className="card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Missing Info</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {missing.map((item) => <span key={item} className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-800">{item}</span>)}
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
        <form action={saveLeadDetails} className="card space-y-5">
          <input type="hidden" name="lead_id" value={lead.id} />
          <QueueContextFields context={queueContext} />
          <input type="hidden" name="next_record_id" value={nextLeadId ?? ''} />
          <input type="hidden" name="previous_record_id" value={previousLeadId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Company Profile</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Enrich lead details</h2>
          </div>
          <label className="block rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-3 text-sm font-semibold text-slate-700">
            Lead notes
            <textarea className="input mt-2 min-h-48 text-[0.95rem] leading-7" name="notes" defaultValue={lead.notes ?? ''} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Company name"><input className="input" name="company_name" defaultValue={lead.company_name} required /></Field>
            <Field label="Phone"><input className="input" name="phone" defaultValue={lead.phone ?? ''} /></Field>
            <Field label="Company email"><input className="input" name="company_email" type="email" defaultValue={lead.company_email ?? ''} /></Field>
            <Field label="Website"><input className="input" name="company_website" defaultValue={lead.company_website ?? ''} /></Field>
            <Field label="Address 1"><input className="input" name="address_line_1" defaultValue={lead.address_line_1 ?? ''} /></Field>
            <Field label="Address 2"><input className="input" name="address_line_2" defaultValue={lead.address_line_2 ?? ''} /></Field>
            <Field label="City"><input className="input" name="city" defaultValue={lead.city ?? ''} /></Field>
            <Field label="State"><input className="input" name="state" defaultValue={lead.state ?? ''} /></Field>
            <Field label="Postal code"><input className="input" name="postal_code" defaultValue={lead.postal_code ?? ''} /></Field>
            <Field label="Country"><input className="input" name="country" defaultValue={lead.country ?? ''} /></Field>
            <Field label="Stage">
              <select className="input" name="stage" defaultValue={normalizeStage(lead.stage)}>
                {PROSPECTING_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" name="priority" defaultValue={normalizePriority(lead.priority)}>
                {PROSPECTING_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
              </select>
            </Field>
            <Field label="Next follow-up"><input className="input" name="next_follow_up_at" type="date" defaultValue={lead.next_follow_up_at ?? ''} /></Field>
            {isOwner ? (
              <Field label="Assigned rep">
                <select className="input" name="assigned_profile_id" defaultValue={lead.assigned_profile_id ?? ''}>
                  <option value="">Unassigned</option>
                  {salesReps.map((rep) => <option key={rep.id} value={rep.id}>{profileLabel(rep)}</option>)}
                </select>
              </Field>
            ) : <input type="hidden" name="assigned_profile_id" value={lead.assigned_profile_id ?? ''} />}
          </div>
          <label className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" name="do_not_contact" defaultChecked={Boolean(lead.do_not_contact)} />
            Do not contact
          </label>
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save Lead" pendingLabel="Saving..." />
        </form>

        <form action={logLeadActivity} className="card space-y-4">
          <input type="hidden" name="lead_id" value={lead.id} />
          <QueueContextFields context={queueContext} />
          <input type="hidden" name="next_record_id" value={nextLeadId ?? ''} />
          <input type="hidden" name="previous_record_id" value={previousLeadId ?? ''} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Activity Log</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Record call, email, or note</h2>
          </div>
          <Field label="Activity type">
            <select className="input" name="activity_type" defaultValue="call">
              {PROSPECTING_ACTIVITY_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
            </select>
          </Field>
          <Field label="Contact">
            <select className="input" name="contact_id" defaultValue="">
              <option value="">Company level</option>
              {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name || contact.email || contact.phone || 'Unnamed contact'}</option>)}
            </select>
          </Field>
          <Field label="Canned result">
            <select className="input" name="result" defaultValue="">
              <option value="">No canned result</option>
              <optgroup label="Call results"><ResultOptions type="call" /></optgroup>
              <optgroup label="Email results"><ResultOptions type="email" /></optgroup>
            </select>
          </Field>
          <Field label="Move stage">
            <select className="input" name="next_stage" defaultValue="">
              <option value="">Auto from result</option>
              {PROSPECTING_STAGES.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
            </select>
          </Field>
          <Field label="Next follow-up"><input className="input" name="next_follow_up_at" type="date" /></Field>
          <Field label="Notes after this activity"><textarea className="input min-h-32" name="body" placeholder="What happened, who you spoke with, and what should happen next." /></Field>
          <PendingSubmitButton className="btn-primary w-full" disabled={Boolean(lead.do_not_contact)} disabledLabel="Do Not Contact" label="Save Activity" pendingLabel="Saving..." />
          <div className="grid gap-2 sm:grid-cols-2">
            {previousLeadId ? <Link className="btn-secondary inline-flex justify-center" href={leadHref(previousLeadId, undefined, queueContext)}>Previous Record</Link> : null}
            {nextLeadId ? <Link className="btn-secondary inline-flex justify-center" href={leadHref(nextLeadId, undefined, queueContext)}>Next Record</Link> : null}
          </div>
        </form>
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
                <form action={updateContact} className="mt-4 grid gap-3 md:grid-cols-2">
                  <input type="hidden" name="lead_id" value={lead.id} />
                  <input type="hidden" name="contact_id" value={contact.id} />
                  <QueueContextFields context={queueContext} />
                  <Field label="Name"><input className="input" name="full_name" defaultValue={contact.full_name ?? ''} /></Field>
                  <Field label="Title"><input className="input" name="title" defaultValue={contact.title ?? ''} /></Field>
                  <Field label="Email"><input className="input" name="email" type="email" defaultValue={contact.email ?? ''} /></Field>
                  <Field label="Phone"><input className="input" name="phone" defaultValue={contact.phone ?? ''} /></Field>
                  <label className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 md:col-span-2">
                    <input type="checkbox" name="is_primary" defaultChecked={Boolean(contact.is_primary)} />
                    Primary contact
                  </label>
                  <div className="md:col-span-2">
                    <Field label="Contact notes"><textarea className="input min-h-24" name="notes" defaultValue={contact.notes ?? ''} /></Field>
                  </div>
                  <PendingSubmitButton className="btn-primary" label="Save Contact" pendingLabel="Saving..." />
                </form>
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

        <form action={addContact} className="card space-y-4">
          <input type="hidden" name="lead_id" value={lead.id} />
          <QueueContextFields context={queueContext} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Add Contact</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">New key contact</h2>
          </div>
          <Field label="Name"><input className="input" name="full_name" /></Field>
          <Field label="Title"><input className="input" name="title" /></Field>
          <Field label="Email"><input className="input" name="email" type="email" /></Field>
          <Field label="Phone"><input className="input" name="phone" /></Field>
          <label className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" name="is_primary" defaultChecked={!contacts.length} />
            Primary contact
          </label>
          <Field label="Notes"><textarea className="input min-h-24" name="notes" /></Field>
          <PendingSubmitButton className="btn-primary w-full" label="Add Contact" pendingLabel="Adding..." />
        </form>
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
    </div>
  );
}

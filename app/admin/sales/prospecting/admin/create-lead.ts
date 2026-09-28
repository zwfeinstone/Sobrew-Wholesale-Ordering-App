'use server';

import { redirect, unstable_rethrow } from 'next/navigation';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { PARKED_PROSPECTING_STAGES, cleanText, normalizePhoneKey, normalizePriority, normalizeStage, normalizeStateKey, normalizeTextKey } from '@/lib/prospecting';
import { mergeMissingFields } from '@/lib/prospecting-lead-merge';
import { hasSampleRequestContact, isSampleContactError, SAMPLE_CONTACT_REQUIRED } from '@/lib/prospecting-sample-contact';
import type { SingleLeadResult } from '@/lib/prospecting-single-lead-result';
import { createClient } from '@/lib/supabase/server';
import type { Tables, TablesInsert } from '@/lib/supabase/database.types';

class LeadSaveError extends Error {}

function checked(error: { message?: string } | null, message: string) {
  if (error) throw new LeadSaveError(isSampleContactError(error) ? SAMPLE_CONTACT_REQUIRED : message);
}

function sameContact(existing: Pick<Tables<'prospecting_contacts'>, 'full_name' | 'email' | 'phone' | 'title'>, incoming: typeof existing) {
  return ['full_name', 'email', 'title'].every((field) =>
    String(existing[field as keyof typeof existing] ?? '').trim().toLowerCase() === String(incoming[field as keyof typeof incoming] ?? '').trim().toLowerCase())
    && normalizePhoneKey(existing.phone) === normalizePhoneKey(incoming.phone);
}

export async function createSingleLead(formData: FormData): Promise<SingleLeadResult> {
  let leadId: string | undefined;
  let signal: AbortSignal | undefined;
  try {
    const deniedHref = '/admin/sales/prospecting/admin?tab=add&toast=admin_write_denied';
    const current = await requireAdminSectionEdit('prospecting', deniedHref);
    if (!current.isOwner) redirect(deniedHref);
    const supabase = await createClient();
    signal = AbortSignal.timeout(20_000);

    const companyName = cleanText(formData.get('company_name'));
    if (!companyName) return { ok: false, message: 'Company name is required before adding a lead.' };
    const stage = normalizeStage(String(formData.get('stage') ?? 'new'));
    const contact = {
      full_name: cleanText(formData.get('contact_full_name')),
      title: cleanText(formData.get('contact_title')),
      email: cleanText(formData.get('contact_email')),
      phone: cleanText(formData.get('contact_phone')),
    };
    if (stage === 'sample_requested' && !hasSampleRequestContact([contact])) {
      return { ok: false, message: SAMPLE_CONTACT_REQUIRED };
    }

    const salesProfileId = cleanText(formData.get('assigned_profile_id'));
    if (salesProfileId) {
      const [settingResult, profileResult] = await Promise.all([
        supabase.from('admin_commission_settings').select('profile_id').eq('profile_id', salesProfileId).eq('is_sales_rep', true).abortSignal(signal).maybeSingle(),
        supabase.from('profiles').select('id,is_active').eq('id', salesProfileId).eq('is_admin', true).abortSignal(signal).maybeSingle(),
      ]);
      checked(settingResult.error || profileResult.error, 'Unable to check the assigned rep. Please try again.');
      if (!settingResult.data || !profileResult.data || profileResult.data.is_active === false) {
        return { ok: false, message: 'Choose an active sales rep before adding this lead.' };
      }
    }

    const phone = cleanText(formData.get('phone'));
    const state = cleanText(formData.get('state'));
    const companyNameKey = normalizeTextKey(companyName);
    const phoneKey = normalizePhoneKey(phone);
    const listName = cleanText(formData.get('list_name'));
    const shouldParkLead = PARKED_PROSPECTING_STAGES.includes(stage);
    const followUp = String(formData.get('next_follow_up_at') ?? '').trim();
    const payload: TablesInsert<'prospecting_leads'> = {
      address_line_1: cleanText(formData.get('address_line_1')),
      address_line_2: cleanText(formData.get('address_line_2')),
      assigned_profile_id: shouldParkLead ? null : salesProfileId,
      city: cleanText(formData.get('city')),
      company_email: cleanText(formData.get('company_email')),
      company_name: companyName,
      company_name_key: companyNameKey,
      company_website: cleanText(formData.get('company_website')),
      country: cleanText(formData.get('country')) || 'US',
      created_by: current.profile.id,
      last_result: cleanText(formData.get('last_result')),
      next_follow_up_at: shouldParkLead || !/^\d{4}-\d{2}-\d{2}$/.test(followUp) ? null : followUp,
      notes: cleanText(formData.get('notes')),
      phone,
      phone_key: phoneKey,
      postal_code: cleanText(formData.get('postal_code')),
      priority: normalizePriority(String(formData.get('priority') ?? 'normal')),
      source: listName || 'manual',
      stage,
      state,
      state_key: normalizeStateKey(state),
      updated_by: current.profile.id,
    };

    const { data: existingRows, error: existingError } = await supabase.from('prospecting_leads')
      .select('*').eq('company_name_key', companyNameKey).abortSignal(signal);
    checked(existingError, 'Unable to check for existing leads. Please try again.');
    const exact = (existingRows ?? []).find((lead) => (lead.phone_key ?? '') === phoneKey);
    if (!exact && existingRows?.length) {
      return { ok: false, message: 'A lead with that company already exists under a different phone number. Review the existing lead before adding another.' };
    }
    leadId = exact?.id;
    if (exact?.archived_at) return { ok: false, leadId, message: 'This lead is archived. Restore the existing lead before updating it.' };
    if (exact?.do_not_contact && stage === 'sample_requested') {
      return { ok: false, leadId, message: 'This lead is marked Do Not Contact. Review the existing lead before requesting samples.' };
    }

    if (exact) {
      const updates = mergeMissingFields(exact, payload, current.profile.id);
      if (!exact.next_follow_up_at && payload.next_follow_up_at) updates.next_follow_up_at = payload.next_follow_up_at;
      if (!exact.last_result && payload.last_result) updates.last_result = payload.last_result;
      if (Object.keys(updates).length) {
        updates.updated_by = current.profile.id;
        const { data, error } = await supabase.from('prospecting_leads').update(updates).eq('id', exact.id)
          .is('archived_at', null).select('id').abortSignal(signal).maybeSingle();
        checked(error, 'Unable to merge the lead details. Please try again.');
        if (!data) throw new LeadSaveError('The existing lead is no longer available. Reload the page before trying again.');
      }
    } else {
      // The sample-stage constraint requires a saved contact first.
      const { data, error } = await supabase.from('prospecting_leads')
        .insert({ ...payload, stage: stage === 'sample_requested' ? 'new' : stage }).select('id').abortSignal(signal).single();
      checked(error, 'Unable to add this lead. Please try again.');
      if (!data) throw new LeadSaveError('Unable to confirm the saved lead. Please try again.');
      leadId = data.id;
    }
    if (!leadId) throw new LeadSaveError('Unable to confirm the saved lead. Please try again.');

    if (Object.values(contact).some(Boolean)) {
      const { data: contacts, error: contactsError } = await supabase.from('prospecting_contacts')
        .select('full_name,title,email,phone,is_primary').eq('lead_id', leadId).abortSignal(signal);
      checked(contactsError, 'Unable to check the lead contacts. Please try again.');
      // A retry after a partial save must not add the same contact again.
      if (!(contacts ?? []).some((existing) => sameContact(existing, contact))) {
        const { error } = await supabase.from('prospecting_contacts').insert({
          ...contact,
          lead_id: leadId,
          is_primary: !(contacts ?? []).some((existing) => existing.is_primary),
          created_by: current.profile.id,
          updated_by: current.profile.id,
        }).abortSignal(signal);
        checked(error, 'Unable to save the lead contact. Please try again.');
      }
    }

    const alreadyExported = exact?.stage === 'sample_requested' && exact.hubspot_status === 'exported';
    if (stage === 'sample_requested' && !alreadyExported) {
      const { data: savedStage, error: stageError } = await supabase.from('prospecting_leads')
        .update({ stage, hubspot_status: 'queued', updated_by: current.profile.id }).eq('id', leadId)
        .is('archived_at', null).eq('do_not_contact', false).select('id').abortSignal(signal).maybeSingle();
      checked(stageError, 'Unable to save the Sample Requested stage. Please try again.');
      if (!savedStage) throw new LeadSaveError('This lead is no longer available for sample requests. Review the existing lead before trying again.');
      const { error: queueError } = await supabase.from('prospecting_hubspot_queue').upsert({
        lead_id: leadId,
        queued_by: current.profile.id,
        queued_stage: stage,
        status: 'queued',
      }, { onConflict: 'lead_id' }).abortSignal(signal);
      checked(queueError, 'Unable to finish adding this lead to the HubSpot queue. Please try again.');
    }

    let listId = cleanText(formData.get('existing_list_id'));
    if (!listId && listName) {
      // Reuse this owner's manual list on a retry after it was created successfully.
      const { data: existingList, error: listLookupError } = await supabase.from('prospecting_lists')
        .select('id').eq('name', listName).eq('source', 'manual').eq('created_by', current.profile.id)
        .order('created_at').limit(1).abortSignal(signal).maybeSingle();
      checked(listLookupError, 'Unable to check the lead list. Please try again.');
      listId = existingList?.id ?? null;
      if (!listId) {
        const { data, error } = await supabase.from('prospecting_lists').insert({
          name: listName, description: 'Created from a single manual lead.', source: 'manual',
          created_by: current.profile.id, updated_by: current.profile.id,
        }).select('id').abortSignal(signal).single();
        checked(error, 'Unable to create the lead list. Please try again.');
        if (!data) throw new LeadSaveError('Unable to confirm the lead list. Please try again.');
        listId = data.id;
      }
    }
    if (listId) {
      const { error } = await supabase.from('prospecting_list_leads').upsert({
        lead_id: leadId, list_id: listId, added_by: current.profile.id,
      }, { onConflict: 'list_id,lead_id' }).abortSignal(signal);
      checked(error, 'Unable to add the lead to the selected list. Please try again.');
    }

    const finalStage = stage === 'sample_requested' ? stage : exact?.stage ?? stage;
    const { error: activityError } = await supabase.from('prospecting_activities').insert({
      activity_type: 'enrichment',
      body: exact ? 'Manual single-lead entry merged missing fields.' : 'Manual single-lead entry created.',
      created_by: current.profile.id,
      lead_id: leadId,
      next_follow_up_at: exact?.next_follow_up_at || payload.next_follow_up_at,
      next_stage: finalStage,
      result: exact ? 'Manual merge' : 'Manual add',
    }).abortSignal(signal);
    checked(activityError, 'Unable to save the lead activity. Please try again.');

    const savedMessage = exact ? 'Existing lead found. Missing fields were merged.' : 'Lead added.';
    const queueMessage = stage === 'sample_requested'
      ? alreadyExported ? ' Already exported to HubSpot.' : ' Added to the HubSpot queue.'
      : '';
    return {
      ok: true,
      leadId,
      message: savedMessage + queueMessage,
      href: `/admin/sales/prospecting/${leadId}`,
      ...(stage === 'sample_requested' ? { sampleOrderHref: `/admin/sales/prospecting/sample-order?lead=${leadId}` } : {}),
    };
  } catch (error) {
    unstable_rethrow(error);
    const detail = signal?.aborted
      ? 'Saving took too long and the save could not be confirmed. Check for an existing lead before retrying.'
      : error instanceof LeadSaveError ? error.message : 'Unable to finish saving this lead. Please try again.';
    const message = leadId ? `The lead exists, but we could not confirm all changes. ${detail}` : detail;
    return { ok: false, message, ...(leadId ? { leadId } : {}) };
  }
}

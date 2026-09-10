import 'server-only';
import { env } from '@/lib/env';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { hasSampleRequestContact, SAMPLE_CONTACT_REQUIRED } from '@/lib/prospecting-sample-contact';
import {
  pushProspectingLeadToHubSpot, syncHubSpotProspectingActivityNote,
  type HubSpotProspectingLead, type HubSpotProspectingContact, type HubSpotProspectingActivity,
} from '@/lib/hubspot-prospecting';

export type HubSpotExportLead = HubSpotProspectingLead & { stage?: string | null; assigned_profile_id?: string | null };

function hubspotPushErrorMessage(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  return message.trim().slice(0, 500) || 'Unable to push this lead to HubSpot.';
}

export async function pushProspectingHubSpotLeadWithTracking({
  supabase, lead, contacts, activities, ownerEmail, actorId,
}: {
  supabase: any;
  lead: HubSpotExportLead;
  contacts: HubSpotProspectingContact[];
  activities: HubSpotProspectingActivity[];
  ownerEmail: string | null;
  actorId: string | null;
}) {
  const admin = getSupabaseAdmin();
  const token = crypto.randomUUID();
  const { data: claimed, error: claimError } = await admin.rpc('claim_prospecting_hubspot_push_v1', {
    p_lead_id: lead.id, p_token: token,
  });
  if (claimError) throw claimError;
  if (!claimed) return { status: 'skipped' as const, message: 'Lead already exported, ineligible, or another push is running.' };
  try {
    const attemptAt = new Date().toISOString();
    try {
      if (lead.stage === 'sample_requested' && !hasSampleRequestContact(contacts)) throw new Error(SAMPLE_CONTACT_REQUIRED);
      const result = await pushProspectingLeadToHubSpot({
        accessToken: env.hubspotAccessToken,
        activities,
        contacts,
        dealPipeline: env.hubspotDealPipeline,
        dealStage: env.hubspotSampleRequestedDealStage,
        lead,
        ownerEmail,
        onProgress: async (progress) => {
          // Save IDs before the next HubSpot operation, so retries reuse a deal
          // or note even when a later association or activity export fails.
          const update: Record<string, unknown> = { hubspot_last_push_attempt_at: attemptAt };
          for (const [key, column] of [
            ['companyId', 'hubspot_company_id'], ['contactId', 'hubspot_contact_id'],
            ['dealId', 'hubspot_deal_id'], ['noteId', 'hubspot_note_id'],
          ] as const) {
            if (progress[key]) update[column] = progress[key];
          }
          const { error } = await supabase.from('prospecting_leads').update(update).eq('id', lead.id);
          if (error) throw error;
          for (const [activityId, noteId] of Object.entries(progress.activityNoteIds ?? {})) {
            const { error: noteError } = await supabase.from('prospecting_activities')
              .update({ hubspot_note_id: noteId }).eq('id', activityId).eq('lead_id', lead.id);
            if (noteError) throw noteError;
          }
        },
      });

      const leadUpdate = {
        hubspot_company_id: result.companyId,
        hubspot_contact_id: result.contactId,
        hubspot_deal_id: result.dealId ?? lead.hubspot_deal_id ?? null,
        hubspot_last_push_attempt_at: attemptAt,
        hubspot_last_push_error: result.status === 'partial' ? result.message : null,
        hubspot_note_id: result.noteId ?? lead.hubspot_note_id ?? null,
        updated_at: attemptAt,
        updated_by: actorId,
      };
      const activityNoteEntries = Object.entries(result.activityNoteIds);

      if (result.status === 'exported') {
        const { error } = await supabase.from('prospecting_leads').update(leadUpdate).eq('id', lead.id);
        if (error) throw error;
        for (const [activityId, hubspotNoteId] of activityNoteEntries) {
          const { error: activityNoteError } = await supabase
            .from('prospecting_activities')
            .update({ hubspot_note_id: hubspotNoteId })
            .eq('id', activityId)
            .eq('lead_id', lead.id);
          if (activityNoteError) throw activityNoteError;
        }

        const { data: exportActivity, error: exportActivityError } = await supabase
          .from('prospecting_activities')
          .insert({
            activity_type: 'hubspot_export',
            body: result.message,
            created_at: attemptAt,
            created_by: actorId,
            lead_id: lead.id,
            result: 'Exported',
          })
          .select('id,lead_id,activity_type,result,body,previous_stage,next_stage,next_follow_up_at,created_at,hubspot_note_id')
          .single();
        if (exportActivityError) throw exportActivityError;
        if (exportActivity && result.companyId && result.dealId && result.contactIds.length) {
          const exportActivityNoteId = await syncHubSpotProspectingActivityNote({
            accessToken: env.hubspotAccessToken,
            activity: exportActivity as HubSpotProspectingActivity,
            companyId: result.companyId,
            contactIds: result.contactIds,
            dealId: result.dealId,
            ownerEmail,
          });
          const { error: exportActivityNoteError } = await supabase
            .from('prospecting_activities')
            .update({ hubspot_note_id: exportActivityNoteId })
            .eq('id', exportActivity.id)
            .eq('lead_id', lead.id);
          if (exportActivityNoteError) throw exportActivityNoteError;
        }

        const { error: exportedLeadError } = await supabase
          .from('prospecting_leads')
          .update({
            hubspot_exported_at: attemptAt,
            hubspot_exported_by: actorId,
            hubspot_last_push_error: null,
            hubspot_status: 'exported',
            updated_at: attemptAt,
            updated_by: actorId,
          })
          .eq('id', lead.id);
        if (exportedLeadError) throw exportedLeadError;

        await supabase
          .from('prospecting_hubspot_queue')
          .update({
            exported_at: attemptAt,
            exported_by: actorId,
            notes: result.message,
            status: 'exported',
          })
          .eq('lead_id', lead.id);
        return { status: 'exported' as const, message: result.message };
      } else {
        const { error } = await supabase.from('prospecting_leads').update(leadUpdate).eq('id', lead.id);
        if (error) throw error;
        for (const [activityId, hubspotNoteId] of activityNoteEntries) {
          const { error: activityNoteError } = await supabase
            .from('prospecting_activities')
            .update({ hubspot_note_id: hubspotNoteId })
            .eq('id', activityId)
            .eq('lead_id', lead.id);
          if (activityNoteError) throw activityNoteError;
        }
        await supabase
          .from('prospecting_hubspot_queue')
          .update({ notes: result.message })
          .eq('lead_id', lead.id)
          .eq('status', 'queued');
        await supabase.from('prospecting_activities').insert({
          activity_type: 'hubspot_export',
          body: result.message,
          created_by: actorId,
          lead_id: lead.id,
          result: 'Partial',
        });
        return { status: 'partial' as const, message: result.message };
      }
    } catch (error) {
      const message = hubspotPushErrorMessage(error);
      await supabase
        .from('prospecting_leads')
        .update({
          hubspot_last_push_attempt_at: attemptAt,
          hubspot_last_push_error: message,
          updated_at: attemptAt,
          updated_by: actorId,
        })
        .eq('id', lead.id);
      await supabase
        .from('prospecting_hubspot_queue')
        .update({ notes: message })
        .eq('lead_id', lead.id)
        .eq('status', 'queued');
      return { status: 'error' as const, message };
    }

  } finally {
    const { error } = await admin.from('prospecting_hubspot_push_locks').delete().eq('lead_id', lead.id).eq('token', token);
    if (error) console.error('[hubspot] unable to release push lock', { leadId: lead.id, error });
  }
}

'use server';

import { createHash } from 'node:crypto';
import { adminCanEdit, getCurrentAdminAccess } from '@/lib/admin-permissions';
import { commitProspectingRecord, readProspectingMutationReceiptChecked } from '@/lib/prospecting-mutations';
import type { SampleOutcomeResult } from '@/lib/prospecting-sample-outcome';
import { createClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function textField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export async function markSampleOutcome(formData: FormData): Promise<SampleOutcomeResult> {
  const current = await getCurrentAdminAccess();
  if (!current.isOwner || !adminCanEdit(current.access, 'prospecting')) {
    return { ok: false, message: 'You do not have permission to save sample outcomes.' };
  }

  const leadId = textField(formData, 'lead_id');
  const submissionId = textField(formData, 'submission_id');
  const expectedUpdatedAt = textField(formData, 'expected_updated_at');
  const outcome = textField(formData, 'outcome');
  if (!UUID.test(leadId) || !UUID.test(submissionId) || !TIMESTAMP.test(expectedUpdatedAt) || !Number.isFinite(Date.parse(expectedUpdatedAt))) {
    return { ok: false, message: 'This form could not be verified. Reload the list before saving.' };
  }
  if (outcome !== 'lost' && outcome !== 'converted') {
    return { ok: false, message: 'Choose Mark Won or Mark Lost before saving.' };
  }
  const rawNote = formData.get('outcome_note');
  if (rawNote !== null && typeof rawNote !== 'string') {
    return { ok: false, message: 'Enter the outcome note as text before saving.' };
  }
  const note = rawNote?.trim() || null;
  // Bind recovery to the original intent, never to the record after it changed.
  const submissionSignature = createHash('sha256').update(JSON.stringify({
    kind: 'sample_outcome', leadId, expectedUpdatedAt, outcome, note,
  })).digest('hex');

  try {
    const replay = await readProspectingMutationReceiptChecked(current.profile.id, submissionId, submissionSignature);
    if (!replay.ok) return { ok: false, message: replay.error.message };
    if (replay.receipt) {
      return replay.receipt.leadId === leadId && replay.receipt.stage === outcome
        ? { ok: true }
        : { ok: false, message: 'This submission belongs to another outcome. Reload the list before saving.' };
    }

    const supabase = await createClient();
    const { data: lead, error } = await supabase.from('prospecting_leads').select('*')
      .eq('id', leadId).is('archived_at', null).maybeSingle();
    if (error) return { ok: false, message: 'The current lead could not be checked. Your note is still here; try again.' };
    if (!lead) return { ok: false, message: 'This lead is no longer available. Reload the list to see the latest outcomes.' };
    if (lead.stage !== 'sample_requested' || lead.updated_at !== expectedUpdatedAt) {
      return { ok: false, message: 'This lead changed while the list was open. Reload the list before saving; your note has been kept.' };
    }

    const result = await commitProspectingRecord({
      actorId: current.profile.id,
      submissionId,
      submissionSignature,
      leadId,
      expectedUpdatedAt,
      // The existing atomic RPC saves the full record, closes pending requests,
      // removes queued exports, and preserves already-exported HubSpot metadata.
      lead: {
        ...lead,
        assigned_profile_id: outcome === 'lost' ? null : lead.assigned_profile_id,
        next_follow_up_at: null,
        stage: outcome,
      },
      activity: {
        activity_type: 'stage_change',
        body: note || `Sample outcome marked ${outcome === 'converted' ? 'won' : 'lost'}.`,
        result: outcome === 'converted' ? 'Won' : 'Lost',
        previous_stage: 'sample_requested',
        next_stage: outcome,
        previous_assigned_profile_id: outcome === 'lost' ? lead.assigned_profile_id : null,
      },
    });
    if (!result.ok) return { ok: false, message: result.error.message };
    if (result.receipt.leadId !== leadId || result.receipt.stage !== outcome) {
      return { ok: false, message: 'The saved outcome could not be confirmed. Keep your note and retry this same submission.' };
    }
    // The client removes the saved card first, then refreshes the list separately.
    return { ok: true };
  } catch {
    return { ok: false, message: 'The response was interrupted. Your note is still here; retry this same outcome to check whether it was saved.' };
  }
}

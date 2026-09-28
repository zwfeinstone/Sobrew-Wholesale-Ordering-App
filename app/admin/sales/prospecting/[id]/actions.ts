'use server';

import { revalidatePath } from 'next/cache';
import { adminCanEdit, getCurrentAdminAccess } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';
import { commitProspectingRecord, readProspectingMutationReceiptChecked } from '@/lib/prospecting-mutations';
import { prospectingSubmissionSignature } from '@/lib/prospecting-submission';
import { buildProspectingRecordMutation, type RecordActionResult, type RecordContact, type RecordLead, type RecordSaveInput } from '@/lib/prospecting-record';
import { isEligibleProspectingSalesRep } from '@/lib/prospecting-sales-reps';
import { prospectingQueueContextFromParams, prospectingWorkspaceLeadPath, prospectingOriginPath, type ProspectingQueueContext } from '@/lib/prospecting';
import { loadProspectingQueueNeighbors } from '@/lib/prospecting-queue-neighbors';
import { formatCentralDateInput, parseCentralDateInput } from '@/lib/time-clock';
import { isProspectingWorkspaceEnabled } from '@/lib/prospecting-rollout';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(code: string, message: string, fieldErrors: Record<string, string> = {}): RecordActionResult { return { ok: false, error: { code, message, fieldErrors } }; }
function queueExit(context: ProspectingQueueContext, toast: string) {
  const [pathname, search = ''] = prospectingOriginPath(context).split('?');
  const params = new URLSearchParams(search); params.set('toast', toast);
  return `${pathname}?${params}`;
}

export async function saveProspectingRecord(input: RecordSaveInput): Promise<RecordActionResult> {
  const started = Date.now();
  const result = await saveRecord(input);
  const event = { event: 'prospecting_record_save', outcome: result.ok ? result.receipt.replayed ? 'replayed' : 'saved' : result.error.code, durationMs: Date.now() - started };
  if (result.ok) console.info(JSON.stringify(event));
  else console.warn(JSON.stringify(event));
  return result;
}

async function saveRecord(input: RecordSaveInput): Promise<RecordActionResult> {
  const current = await getCurrentAdminAccess();
  if (!isProspectingWorkspaceEnabled() || !adminCanEdit(current.access, 'prospecting')) return failure('unauthorized', 'You do not have access to save this record. Your draft has been kept.');
  if (!input || !UUID.test(input.leadId) || !UUID.test(input.submissionId) || typeof input.queueParams !== 'string' || input.queueParams.length > 8000) return failure('invalid_submission', 'This form could not be verified. Reload the record before saving.');
  const context = prospectingQueueContextFromParams(new URLSearchParams(input.queueParams));
  if (!current.isOwner) context.repId = current.profile.id;
  const submissionSignature = prospectingSubmissionSignature(input);
  const replayResult = await readProspectingMutationReceiptChecked(current.profile.id, input.submissionId, submissionSignature);
  if (!replayResult.ok) return replayResult;
  const replay = replayResult.receipt;
  if (replay && replay.leadId !== input.leadId) return failure('submission_reused', 'This submission belongs to a different record. Your draft has been kept.');
  if (replay) return { ok: true, receipt: replay, handedOff: replay.stage === 'sample_requested' || ['recycle_try_later', 'lost', 'not_a_fit'].includes(replay.stage || ''), nextHref: replay.nextHref || queueExit(context, 'record_saved') };
  const supabase = await createClient();
  let query = supabase.from('prospecting_leads').select('*').eq('id', input.leadId).is('archived_at', null);
  if (!current.isOwner) query = query.eq('assigned_profile_id', current.profile.id).neq('stage', 'sample_requested');
  const [leadResult, contactResult] = await Promise.all([
    query.maybeSingle(),
    supabase.from('prospecting_contacts').select('id,full_name,email,phone,title,notes,is_primary').eq('lead_id', input.leadId),
  ]);
  if (leadResult.error || contactResult.error) return failure('load_error', 'The current record could not be checked. Your draft is still here; try again.');
  if (!leadResult.data) return failure('missing_record', 'This record is no longer available to you. Your draft has been kept.');
  const before = leadResult.data as RecordLead;
  if (!input.expectedUpdatedAt || input.expectedUpdatedAt !== before.updated_at) return failure('record_stale', 'This record changed while you were editing. Review the latest version before saving; your draft has been kept.');
  let mutation: ReturnType<typeof buildProspectingRecordMutation>;
  try { mutation = buildProspectingRecordMutation(before, contactResult.data as RecordContact[], input.draft, current.isOwner); }
  catch { return failure('invalid_submission', 'This draft could not be read. Reload the record before saving.'); }
  if (!mutation.ok) return failure('validation', 'Check the highlighted fields. Your changes have not been saved.', mutation.errors);
  if (current.isOwner && mutation.lead.assigned_profile_id && mutation.lead.assigned_profile_id !== before.assigned_profile_id && !await isEligibleProspectingSalesRep(supabase, String(mutation.lead.assigned_profile_id))) return failure('invalid_rep', 'Select an active sales rep.', { assigned_profile_id: 'This rep is no longer available for assignment.' });
  if (mutation.finalStage === 'sample_requested' && !input.sample && before.stage !== 'sample_requested') return failure('sample_handoff_required', 'Complete the sample handoff before saving this request.', { sample: 'Choose shipment ordering or manager fulfillment.' });
  if (input.sample && mutation.finalStage !== 'sample_requested') return failure('validation', 'Review the sample handoff stage.', { stage: 'A sample handoff must use Sample Requested.' });
  const today = formatCentralDateInput(new Date());
  const profileId = current.isOwner ? context.repId || before.assigned_profile_id : current.profile.id;
  const excludedLeadIds = Array.isArray(input.visitedIds) ? input.visitedIds.filter((id) => typeof id === 'string' && UUID.test(id)).slice(0, 5000) : [];
  let neighbors: Awaited<ReturnType<typeof loadProspectingQueueNeighbors>>;
  try { neighbors = await loadProspectingQueueNeighbors(supabase, { context, currentLeadId: input.leadId, profileId, today, todayStartIso: (parseCentralDateInput(today) || new Date()).toISOString(), excludedLeadIds }); }
  catch { return failure('queue_unavailable', 'The next lead could not be checked. Your draft has been kept; try saving again.'); }
  if (neighbors.unavailable) return failure('queue_unavailable', 'The next lead could not be checked. Your draft has been kept; try saving again.');
  const nextHref = neighbors.nextLeadId ? prospectingWorkspaceLeadPath(neighbors.nextLeadId, context, { includePageSize: true }) : queueExit(context, 'queue_end');
  const result = await commitProspectingRecord({ actorId: current.profile.id, submissionId: input.submissionId, submissionSignature, nextHref, leadId: input.leadId, expectedUpdatedAt: input.expectedUpdatedAt, ...mutation, sample: input.sample });
  if (!result.ok) return result;
  revalidatePath('/admin/sales/prospecting', 'layout');
  const handedOff = !current.isOwner && (mutation.finalStage === 'sample_requested' || mutation.lead.assigned_profile_id !== current.profile.id);
  return { ...result, handedOff, nextHref: result.receipt.nextHref || nextHref };
}

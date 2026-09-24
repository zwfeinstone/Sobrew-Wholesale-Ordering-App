import 'server-only';

import type { Json } from '@/lib/supabase/database.types';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export type ProspectingRecordPayload = Record<string, Json | undefined>;
export type ProspectingSampleCommit = {
  mode: 'request_only' | 'order';
  requestId?: string | null;
  contactId?: string | null;
  centerName?: string;
  attentionName?: string;
  address1?: string;
  address2?: string | null;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string | null;
  items?: Array<{ productId: string; quantity: number | string }>;
};
export type ProspectingMutationReceipt = {
  leadId: string | null;
  updatedAt: string | null;
  stage: string | null;
  requestId: string | null;
  orderId: string | null;
  replayed: boolean;
  nextHref?: string;
};
export type ProspectingMutationError = {
  code: string;
  message: string;
  fieldErrors: Record<string, string>;
};
export type ProspectingMutationResult =
  | { ok: true; receipt: ProspectingMutationReceipt }
  | { ok: false; error: ProspectingMutationError };

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

export type CommitProspectingRecordInput = {
  actorId: string;
  submissionId: string;
  /** Server SHA-256 of immutable raw lead/version/draft/sample input, excluding navigation. */
  submissionSignature?: string;
  /** Internal continuation constructed by the server; persisted for response-loss recovery. */
  nextHref?: string;
  leadId: string | null;
  expectedUpdatedAt: string | null;
  lead?: ProspectingRecordPayload | null;
  contactUpdates?: ProspectingRecordPayload[];
  newContact?: ProspectingRecordPayload | null;
  activity?: ProspectingRecordPayload | null;
  auditActivities?: ProspectingRecordPayload[];
  contactDeleteIds?: string[];
  sample?: ProspectingSampleCommit | null;
  supabase?: RpcClient;
};

/** Call after the request's auth/edit gate, before loading a now-handed-off lead. */
export async function readProspectingMutationReceipt(actorId: string, submissionId: string): Promise<ProspectingMutationReceipt | null> {
  const result = await readProspectingMutationReceiptChecked(actorId, submissionId);
  return result.ok ? result.receipt : null;
}

export type ProspectingReceiptReplayResult =
  | { ok: true; receipt: ProspectingMutationReceipt | null }
  | { ok: false; error: ProspectingMutationError };

/** Validates the immutable raw-input signature before replaying a handed-off lead. */
export async function readProspectingMutationReceiptChecked(actorId: string, submissionId: string, submissionSignature?: string): Promise<ProspectingReceiptReplayResult> {
  if (!UUID_PATTERN.test(actorId) || !UUID_PATTERN.test(submissionId) || (submissionSignature !== undefined && !SIGNATURE_PATTERN.test(submissionSignature))) return { ok: false, error: { code: 'invalid_submission', message: 'This form could not be verified. Reload before trying again.', fieldErrors: {} } };
  const client = getSupabaseAdmin() as unknown as RpcClient;
  try {
    const { data, error } = await client.rpc('read_prospecting_receipt_v2', { p_actor_id: actorId, p_submission_id: submissionId, p_submission_signature: submissionSignature ?? null });
    if (error) return { ok: false, error: prospectingMutationError(error) };
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: true, receipt: null };
    return { ok: true, receipt: parseReceipt(data as Record<string, unknown>, true) };
  } catch {
    return { ok: false, error: { code: 'connection_error', message: 'The saved submission could not be checked. Keep this draft and retry the same submission.', fieldErrors: {} } };
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;
const NEXT_HREF_PATTERN = /^\/admin\/(?:sales\/prospecting|reports)(?:[/?]|$)/;

function parseReceipt(receipt: Record<string, unknown>, replayed = receipt.replayed === true): ProspectingMutationReceipt {
  return {
    leadId: typeof receipt.leadId === 'string' ? receipt.leadId : null,
    updatedAt: typeof receipt.updatedAt === 'string' ? receipt.updatedAt : null,
    stage: typeof receipt.stage === 'string' ? receipt.stage : null,
    requestId: typeof receipt.requestId === 'string' ? receipt.requestId : null,
    orderId: typeof receipt.orderId === 'string' ? receipt.orderId : null,
    ...(typeof receipt.nextHref === 'string' && NEXT_HREF_PATTERN.test(receipt.nextHref) ? { nextHref: receipt.nextHref } : {}),
    replayed,
  };
}

export function prospectingMutationError(error: { code?: string; message?: string }): ProspectingMutationError {
  const message = error.message ?? '';
  if (error.code === '40001') return { code: 'record_stale', message: 'This lead changed while you were editing. Your draft is still here. Reload the current record before saving again.', fieldErrors: {} };
  if (message.includes('sample_requested_contact_required')) return { code: 'sample_contact_required', message: 'Choose a contact with a name and valid email before requesting samples.', fieldErrors: { sample_contact_id: 'A name and valid email are required on the same contact.' } };
  if (message.includes('sample_missing_fields')) return { code: 'missing_fields', message: 'Enter the company, attention name, and full shipping address.', fieldErrors: { sample_shipping: 'Complete the shipping details before creating the order.' } };
  if (message.includes('sample_invalid_items')) return { code: 'invalid_items', message: 'Choose at least one sample box with a whole-number quantity.', fieldErrors: { sample_items: 'Select at least one sample box.' } };
  if (message.includes('sample_invalid_product')) return { code: 'invalid_product', message: 'A selected sample box is no longer available. Review your quantities and try again.', fieldErrors: { sample_items: 'Only active sample boxes with saved recipes can be ordered.' } };
  if (message.includes('sample_request_closed')) return { code: 'request_closed', message: 'This sample request is no longer pending. Reload to see its current order or status.', fieldErrors: {} };
  if (message.includes('submission_reused')) return { code: 'submission_reused', message: 'This submission was already saved with different values. Reload the saved record before making another change.', fieldErrors: {} };
  if (error.code === '42501') return { code: 'unauthorized', message: 'You no longer have permission to make this change. Your draft has been kept.', fieldErrors: {} };
  if (error.code === '23505') return { code: 'duplicate_record', message: 'A lead with this company and phone already exists. Check those fields before saving.', fieldErrors: { company_name: 'Company and phone match an existing lead.' } };
  if (error.code === 'P0002') return { code: 'missing_record', message: 'The lead, contact, or sample request is no longer available. Your draft has been kept.', fieldErrors: {} };
  if (error.code === 'PGRST202' || error.code === '42883') return { code: 'setup_required', message: 'The new prospecting save service is not available yet. Your draft has been kept; ask an administrator to finish setup.', fieldErrors: {} };
  return { code: 'save_error', message: 'The change could not be saved. Your draft is still here; try again.', fieldErrors: {} };
}

/** Actor identity must come from requireAdminSectionEdit, never from form data. */
export async function commitProspectingRecord(input: CommitProspectingRecordInput): Promise<ProspectingMutationResult> {
  if (!UUID_PATTERN.test(input.actorId) || !UUID_PATTERN.test(input.submissionId) || (input.leadId !== null && !UUID_PATTERN.test(input.leadId)) || (input.submissionSignature !== undefined && !SIGNATURE_PATTERN.test(input.submissionSignature)) || (input.nextHref !== undefined && (!NEXT_HREF_PATTERN.test(input.nextHref) || input.nextHref.length > 10000))) {
    return { ok: false, error: { code: 'invalid_submission', message: 'This form could not be verified. Reload before trying again.', fieldErrors: {} } };
  }
  if (input.leadId && !input.expectedUpdatedAt) return { ok: false, error: { code: 'record_stale', message: 'Reload this lead to get its current version before saving.', fieldErrors: {} } };
  let sample = input.sample ?? null;
  if (sample?.mode === 'order') {
    const items = new Map<string, number>();
    for (const item of sample.items ?? []) {
      const quantity = Number(item.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 9999) return { ok: false, error: { code: 'invalid_items', message: 'Use whole-number sample quantities between 0 and 9,999.', fieldErrors: { sample_items: 'Review the sample quantities.' } } };
      if (quantity === 0) continue;
      if (!UUID_PATTERN.test(item.productId)) return { ok: false, error: { code: 'invalid_product', message: 'A selected sample box is unavailable.', fieldErrors: { sample_items: 'Review the selected sample boxes.' } } };
      items.set(item.productId, (items.get(item.productId) ?? 0) + quantity);
    }
    if (!items.size || [...items.values()].some(quantity => quantity > 9999)) return { ok: false, error: { code: 'invalid_items', message: 'Choose at least one sample box with a whole-number quantity.', fieldErrors: { sample_items: 'Select at least one sample box; maximum 9,999 of each box.' } } };
    sample = { ...sample, items: [...items].map(([productId, quantity]) => ({ productId, quantity })) };
  }
  const client = input.supabase ?? getSupabaseAdmin() as unknown as RpcClient;
  try {
    const { data, error } = await client.rpc('commit_prospecting_record_v2', {
      p_actor_id: input.actorId,
      p_submission_id: input.submissionId,
      p_lead_id: input.leadId,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_lead: input.lead ?? null,
      p_contact_updates: input.contactUpdates ?? [],
      p_new_contact: input.newContact ?? null,
      p_activity: input.activity ?? null,
      p_audit_activities: input.auditActivities ?? [],
      p_contact_delete_ids: input.contactDeleteIds ?? [],
      p_sample: sample,
      p_submission_signature: input.submissionSignature ?? null,
      p_next_href: input.nextHref ?? null,
    });
    if (error) return { ok: false, error: prospectingMutationError(error) };
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: prospectingMutationError({}) };
    return { ok: true, receipt: parseReceipt(data as Record<string, unknown>) };
  } catch {
    return { ok: false, error: { code: 'connection_error', message: 'The response was interrupted. Your draft is still here. Retry this same submission to check whether it was saved.', fieldErrors: {} } };
  }
}

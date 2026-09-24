import { commitProspectingRecord, type ProspectingMutationReceipt } from '@/lib/prospecting-mutations';

export type ProspectingSampleOrderItemInput = { productId: string; quantity: number | string };
export type ProspectingSampleOrderInput = {
  address1: string; address2?: string | null; attentionName: string; centerName: string;
  city: string; items: ProspectingSampleOrderItemInput[]; leadId?: string | null;
  notes?: string | null; state: string; zip: string;
  submissionId?: string; expectedUpdatedAt?: string | null; requestId?: string | null; contactId?: string | null;
};
export type ProspectingSampleOrderError =
  | 'insert_error' | 'invalid_items' | 'invalid_product' | 'lead_error' | 'missing_fields'
  | 'sample_contact_required' | 'unauthorized' | 'record_stale' | 'setup_required'
  | 'request_closed' | 'connection_error' | 'submission_reused' | null;
export type ProspectingSampleOrderResult = {
  error: ProspectingSampleOrderError; orderId?: string; message?: string;
  fieldErrors?: Record<string, string>; receipt?: ProspectingMutationReceipt;
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cleanText = (value: unknown) => String(value ?? '').trim();

export function prospectingSampleOrderInputFromFormData(formData: FormData): ProspectingSampleOrderInput {
  const productIds = formData.getAll('product_id').map(String);
  const quantities = formData.getAll('quantity');
  return {
    address1: cleanText(formData.get('address1')), address2: cleanText(formData.get('address2')) || null,
    attentionName: cleanText(formData.get('attention_name')), centerName: cleanText(formData.get('center_name')),
    city: cleanText(formData.get('city')), state: cleanText(formData.get('state')).toUpperCase(), zip: cleanText(formData.get('zip')),
    items: productIds.map((productId, index) => ({ productId, quantity: Number(quantities[index] ?? 0) })),
    leadId: cleanText(formData.get('lead_id')) || null, notes: cleanText(formData.get('notes')) || null,
    submissionId: cleanText(formData.get('submission_id')), expectedUpdatedAt: cleanText(formData.get('expected_updated_at')) || null,
    requestId: cleanText(formData.get('request_id')) || null, contactId: cleanText(formData.get('contact_id')) || null,
  };
}

/** Preflight is friendly feedback; the RPC revalidates every value under locks. */
export async function createProspectingSampleOrder({ currentProfileId, input, supabase }: {
  currentProfileId: string;
  input: ProspectingSampleOrderInput;
  isOwner: boolean;
  now?: Date;
  supabase: unknown;
}): Promise<ProspectingSampleOrderResult> {
  if (![input.centerName, input.attentionName, input.address1, input.city, input.state, input.zip].every(value => cleanText(value))) {
    return { error: 'missing_fields', message: 'Enter the company, attention name, and full shipping address.' };
  }
  const quantities = new Map<string, number>();
  for (const item of input.items) {
    const qty = Number(item.quantity);
    if (!Number.isSafeInteger(qty) || qty < 0 || qty > 9999) return { error: 'invalid_items' };
    if (qty === 0) continue;
    if (!UUID_PATTERN.test(item.productId)) return { error: 'invalid_product' };
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + qty);
  }
  if (!quantities.size || [...quantities.values()].some(qty => qty > 9999)) return { error: 'invalid_items' };
  if (input.leadId && !UUID_PATTERN.test(input.leadId)) return { error: 'lead_error' };
  const result = await commitProspectingRecord({
    actorId: currentProfileId, submissionId: input.submissionId ?? '', leadId: input.leadId || null,
    expectedUpdatedAt: input.expectedUpdatedAt ?? null,
    sample: { mode: 'order', requestId: input.requestId, contactId: input.contactId,
      centerName: cleanText(input.centerName), attentionName: cleanText(input.attentionName),
      address1: cleanText(input.address1), address2: cleanText(input.address2) || null,
      city: cleanText(input.city), state: cleanText(input.state).toUpperCase(), zip: cleanText(input.zip),
      notes: cleanText(input.notes).slice(0, 5000) || null,
      items: [...quantities].map(([productId, quantity]) => ({ productId, quantity })),
    },
    supabase: supabase as Parameters<typeof commitProspectingRecord>[0]['supabase'],
  });
  if (!result.ok) {
    const known = ['invalid_items', 'invalid_product', 'missing_fields', 'sample_contact_required', 'unauthorized', 'record_stale', 'setup_required', 'request_closed', 'connection_error', 'submission_reused'];
    return { error: (known.includes(result.error.code) ? result.error.code : 'insert_error') as ProspectingSampleOrderError,
      message: result.error.message, fieldErrors: result.error.fieldErrors };
  }
  return { error: null, orderId: result.receipt.orderId ?? undefined, receipt: result.receipt };
}

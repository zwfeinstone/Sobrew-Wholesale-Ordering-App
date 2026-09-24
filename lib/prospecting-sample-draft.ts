export type SampleOrderFields = {
  center_name: string; attention_name: string; address1: string; address2: string;
  city: string; state: string; zip: string; notes: string; contact_id: string;
};
export type SampleOrderDraft = {
  values: SampleOrderFields;
  quantities: Record<string, string>;
  submissionId: string;
  hiddenFields: Array<{ name: string; value: string }>;
  uncertain: boolean;
};
const fields: Array<keyof SampleOrderFields> = ['center_name', 'attention_name', 'address1', 'address2', 'city', 'state', 'zip', 'notes', 'contact_id'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function sampleOrderDraftKey(actorId: string, hiddenFields: SampleOrderDraft['hiddenFields']) {
  const value = (name: string) => hiddenFields.find(field => field.name === name)?.value || 'none';
  return `prospecting-sample:v1:${actorId}:${value('lead_id')}:${value('request_id')}`;
}
/** Session storage is untrusted; reject incomplete snapshots rather than mixing old and fresh versions. */
export function parseSampleOrderDraft(serialized: string | null): SampleOrderDraft | null {
  if (!serialized || serialized.length > 200000) return null;
  try {
    const draft = JSON.parse(serialized) as SampleOrderDraft;
    if (!draft || !draft.values || fields.some(field => typeof draft.values[field] !== 'string' || draft.values[field].length > 10000)
      || !uuid.test(draft.submissionId) || typeof draft.uncertain !== 'boolean'
      || !draft.quantities || Array.isArray(draft.quantities) || Object.entries(draft.quantities).some(([id, value]) => !uuid.test(id) || typeof value !== 'string' || value.length > 30)
      || !Array.isArray(draft.hiddenFields) || draft.hiddenFields.length > 40
      || draft.hiddenFields.some(field => typeof field.name !== 'string' || typeof field.value !== 'string' || field.name.length > 100 || field.value.length > 8000)
      || ['lead_id', 'request_id', 'expected_updated_at'].some(name => !draft.hiddenFields.some(field => field.name === name))) return null;
    return draft;
  } catch { return null; }
}
/** Always uses the entire saved snapshot, including removed products and the original loaded version. */
export function sampleOrderDraftFormData(draft: SampleOrderDraft): FormData {
  const data = new FormData();
  for (const field of draft.hiddenFields) data.append(field.name, field.value);
  data.set('submission_id', draft.submissionId);
  for (const name of fields) data.set(name, draft.values[name]);
  for (const [productId, quantity] of Object.entries(draft.quantities)) {
    data.append('product_id', productId); data.append('quantity', quantity);
  }
  return data;
}

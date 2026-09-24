import { createHash } from 'node:crypto';
import type { RecordSaveInput } from '@/lib/prospecting-record';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

/** Navigation may change during retry; the record and its loaded version may not. */
export function prospectingSubmissionSignature(input: RecordSaveInput): string {
  return createHash('sha256').update(JSON.stringify(canonical({ leadId: input.leadId, expectedUpdatedAt: input.expectedUpdatedAt, draft: input.draft, sample: input.sample ?? null }))).digest('hex');
}

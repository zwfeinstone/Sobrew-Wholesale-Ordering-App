import { createHash } from 'node:crypto';

export function recurringSubmissionId(recurringOrderId: string, scheduledFor: Date) {
  const seed = `sobrew-recurring:${recurringOrderId}:${scheduledFor.toISOString()}`;
  const hash = createHash('sha256').update(seed).digest('hex').split('');
  hash[12] = '8';
  hash[16] = ((Number.parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const value = hash.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

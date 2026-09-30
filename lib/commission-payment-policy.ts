// September 30, 2026 at midnight in the business's America/Chicago time zone.
// Historical earnings retain their original payout rules; this is not a backfill.
export const PAID_INVOICE_COMMISSION_START = '2026-09-30T05:00:00.000Z';

export function commissionRequiresPaidInvoice(snapshot: { shipped_at: string | null }) {
  const shippedAt = Date.parse(snapshot.shipped_at ?? '');
  return !Number.isFinite(shippedAt) || shippedAt >= Date.parse(PAID_INVOICE_COMMISSION_START);
}

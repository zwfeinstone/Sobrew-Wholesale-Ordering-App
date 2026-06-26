export const PROCESSING_FEE_RATE = 0.0299;
export const PROCESSING_FEE_FIXED_CENTS = 30;
export const DONATION_COGS_RATE = 0.01;

export function processingFeeCentsForRevenue(revenueCents: unknown) {
  const parsed = typeof revenueCents === 'number' ? revenueCents : Number.parseFloat(String(revenueCents ?? '0'));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * PROCESSING_FEE_RATE + PROCESSING_FEE_FIXED_CENTS);
}

export function donationCogsCentsForRevenue(revenueCents: unknown) {
  const parsed = typeof revenueCents === 'number' ? revenueCents : Number.parseFloat(String(revenueCents ?? '0'));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * DONATION_COGS_RATE);
}

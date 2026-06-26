export const PROCESSING_FEE_RATE = 0.0399;
export const PROCESSING_FEE_FIXED_CENTS = 30;

export function processingFeeCentsForRevenue(revenueCents: unknown) {
  const parsed = typeof revenueCents === 'number' ? revenueCents : Number.parseFloat(String(revenueCents ?? '0'));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * PROCESSING_FEE_RATE + PROCESSING_FEE_FIXED_CENTS);
}

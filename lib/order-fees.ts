export const PROCESSING_FEE_RATE = 0.0299;
export const PROCESSING_FEE_FIXED_CENTS = 30;
export const DONATION_COGS_RATE = 0.01;
export const SHOPIFY_DONATION_CENTS_PER_BAG = 100;

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

export function shopifyDonationCogsCentsForBags(quantity: unknown) {
  const parsed = typeof quantity === 'number' ? quantity : Number.parseFloat(String(quantity ?? '0'));
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * SHOPIFY_DONATION_CENTS_PER_BAG);
}

export function donationCogsCentsForOrder({
  orderSource,
  revenueCents,
  items,
}: {
  orderSource?: string | null;
  revenueCents: unknown;
  items: ReadonlyArray<{ qty: unknown }>;
}) {
  // Each imported Shopify product unit is a bag, including discounted/free bags.
  if (orderSource === 'shopify') {
    return items.reduce((sum, item) => sum + shopifyDonationCogsCentsForBags(item.qty), 0);
  }
  return donationCogsCentsForRevenue(revenueCents);
}

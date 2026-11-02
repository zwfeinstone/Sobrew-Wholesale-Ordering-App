import { describe, expect, it } from 'vitest';
import { donationCogsCentsForOrder, processingFeeCentsForRevenue, shopifyDonationCogsCentsForBags } from './order-fees';

describe('order donation rules', () => {
  it('counts every Shopify bag regardless of price or discount', () => {
    const items = [{ qty: 2 }, { qty: '3' }];
    expect(donationCogsCentsForOrder({ orderSource: 'shopify', revenueCents: 8000, items })).toBe(500);
    expect(donationCogsCentsForOrder({ orderSource: 'shopify', revenueCents: 0, items })).toBe(500);
  });

  it.each(['portal', undefined, null])('keeps one percent for %s orders, regardless of bag count', (orderSource) => {
    expect(donationCogsCentsForOrder({ orderSource, revenueCents: 12550, items: [{ qty: 50 }] })).toBe(126);
    expect(donationCogsCentsForOrder({ orderSource, revenueCents: 0, items: [{ qty: 50 }] })).toBe(0);
  });

  it('does not create donations from invalid or missing quantities', () => {
    for (const quantity of [undefined, null, 0, -1, NaN, Infinity, 'invalid']) {
      expect(shopifyDonationCogsCentsForBags(quantity)).toBe(0);
    }
    expect(donationCogsCentsForOrder({ orderSource: 'shopify', revenueCents: 5000, items: [] })).toBe(0);
  });

  it('keeps processing at 2.99 percent plus 30 cents per order', () => {
    expect(processingFeeCentsForRevenue(3600)).toBe(138);
    expect(processingFeeCentsForRevenue(8000)).toBe(269);
  });
});

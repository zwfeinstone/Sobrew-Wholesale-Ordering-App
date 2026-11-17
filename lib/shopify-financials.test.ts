import { describe, expect, it } from 'vitest';
import { readShopifyFinancials } from './shopify-financials';

const paid = {
  currency: 'USD', taxes_included: false, current_total_tax: '1.76', current_total_price: '27.76',
  shipping_lines: [{ price: '6.00', discounted_price: '6.00' }],
};

describe('Shopify checkout amounts', () => {
  it('separates customer shipping and tax from merchandise and carrier expense', () => {
    expect(readShopifyFinancials(paid, 2000)).toEqual({
      shopify_shipping_collected_cents: 600, shopify_tax_collected_cents: 176, shopify_total_paid_cents: 2776,
    });
  });
  it('uses discounted shipping even when the original shipping total still has a charge', () => {
    expect(readShopifyFinancials({ ...paid, current_total_price: '40.00', current_total_tax: '0.00',
      total_shipping_price_set: { shop_money: { amount: '6.00' } },
      shipping_lines: [{ price: '6.00', discounted_price: '0.00' }],
    }, 4000)).toEqual({ shopify_shipping_collected_cents: 0, shopify_tax_collected_cents: 0, shopify_total_paid_cents: 4000 });
  });
  it('adds multiple partially discounted shipping lines once', () => {
    expect(readShopifyFinancials({ ...paid, current_total_price: '27.01', shipping_lines: [
      { price: '6.00', discounted_price: '3.00' }, { price: '4.00', discounted_price: '2.25' },
    ] }, 2000).shopify_shipping_collected_cents).toBe(525);
  });
  it('handles an explicit empty shipping list and zero tax/payment', () => {
    expect(readShopifyFinancials({ currency: 'USD', taxes_included: false, total_tax: '0', total_price: '0', shipping_lines: [] }, 0))
      .toEqual({ shopify_shipping_collected_cents: 0, shopify_tax_collected_cents: 0, shopify_total_paid_cents: 0 });
  });
  it.each([
    [{ currency: 'CAD' }, /USD/],
    [{ taxes_included: true }, /Tax-inclusive/],
    [{ taxes_included: undefined }, /unknown tax/],
    [{ shipping_lines: undefined }, /shipping amounts are missing/],
    [{ shipping_lines: [{ price: '6.00' }] }, /Discounted shipping/],
    [{ shipping_lines: [{ discounted_price: '-1.00' }] }, /valid USD/],
    [{ current_total_tax: undefined }, /Sales tax/],
    [{ current_total_price: undefined }, /payment total/],
    [{ current_total_tax: '1.761' }, /valid USD/],
    [{ current_total_price: '21474836.48' }, /supported amount/],
    [{ current_total_price: '28.76' }, /do not match/],
  ])('holds incomplete, unsupported, or inconsistent amounts: %j', (override, error) => {
    expect(() => readShopifyFinancials({ ...paid, ...override }, 2000)).toThrow(error);
  });
  it('rejects overflow after summing shipping lines', () => {
    expect(() => readShopifyFinancials({ ...paid, shipping_lines: [
      { discounted_price: '21474836.47' }, { discounted_price: '0.01' },
    ] }, 2000)).toThrow(/do not match/);
  });
});

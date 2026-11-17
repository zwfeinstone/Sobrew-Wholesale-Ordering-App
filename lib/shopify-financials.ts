type RecordValue = Record<string, unknown>;

export type ShopifyCollectedAmounts = {
  shopify_shipping_collected_cents: number;
  shopify_tax_collected_cents: number;
  shopify_total_paid_cents: number;
};

function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function cents(value: unknown, label: string): number {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string' || !/^\d+(\.\d{1,2})?$/.test(raw)) throw new Error(`${label} is not a valid USD amount.`);
  const [whole, fraction = ''] = raw.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 2_147_483_647) throw new Error(`${label} exceeds the supported amount.`);
  return result;
}

/** Checkout receipts are snapshots. Never infer shipping or tax from a difference. */
export function readShopifyFinancials(source: RecordValue, subtotalCents: number): ShopifyCollectedAmounts {
  if (source.currency !== 'USD') throw new Error('Only USD checkout amounts are supported.');
  if (source.taxes_included !== false) {
    throw new Error('Tax-inclusive orders or orders with unknown tax treatment need manual review in Shopify.');
  }
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0 || subtotalCents > 2_147_483_647) {
    throw new Error('Shopify merchandise subtotal exceeds the supported amount.');
  }
  if (!Array.isArray(source.shipping_lines)) throw new Error('Shopify shipping amounts are missing. Review this order in Shopify.');
  const shippingCents = source.shipping_lines.reduce((sum: number, value: unknown) => {
    const line = record(value);
    // Shopify's total_shipping_price_set can retain the original charge after a
    // free-shipping discount. discounted_price is the amount actually collected.
    return sum + cents(line.discounted_price, 'Discounted shipping charge');
  }, 0);
  const taxCents = cents(source.current_total_tax ?? source.total_tax, 'Sales tax collected');
  const totalCents = cents(source.current_total_price ?? source.total_price, 'Customer payment total');
  if (!Number.isSafeInteger(shippingCents) || shippingCents > 2_147_483_647
    || subtotalCents + shippingCents + taxCents !== totalCents) {
    throw new Error('Shopify merchandise, discounted shipping, and tax do not match the payment total. Review fees, duties, tips, or edits in Shopify.');
  }
  return {
    shopify_shipping_collected_cents: shippingCents,
    shopify_tax_collected_cents: taxCents,
    shopify_total_paid_cents: totalCents,
  };
}

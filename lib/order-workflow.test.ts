import { describe, expect, it } from 'vitest';
import { missingOrderAddressFields, orderAddressLabel, nextOrderAction } from './order-workflow';

describe('order fulfillment requirements', () => {
  it('identifies a missing delivery address instead of treating whitespace as data', () => {
    expect(missingOrderAddressFields({ shipping_name: 'David Lawrence Center', shipping_address1: '  ' })).toEqual(['Street address', 'City', 'State', 'ZIP']);
    expect(orderAddressLabel({ shipping_address1: '', shipping_city: ' ' })).toBe('');
  });
  it('accepts a complete address and an optional second address line', () => {
    expect(missingOrderAddressFields({ shipping_company: 'Center', shipping_address1: '123 Main St', shipping_city: 'Naples', shipping_state: 'FL', shipping_zip: '34116' })).toEqual([]);
    expect(missingOrderAddressFields({ shipping_name: ' ', shipping_company: 'Center', shipping_address1: '123 Main St', shipping_city: 'Naples', shipping_state: 'FL', shipping_zip: '34116' })).toEqual([]);
  });
  it('uses the same next action for every open order', () => {
    expect(nextOrderAction('New')).toBe('Review order');
    expect(nextOrderAction('Processing')).toBe('Review order');
    expect(nextOrderAction('Shipped')).toBe('View order');
  });
});

import { describe, expect, it } from 'vitest';
import { getMileageDetails, isMileageReimbursement, type MileageSource } from '@/lib/payroll-mileage';

function mileage(overrides: Partial<MileageSource> = {}): MileageSource {
  return {
    notes: 'Mileage reimbursement: 29 miles at $0.74 per mile = $21.46. Week of October 5-9, 2026.',
    first_order_id: null,
    amount_cents: 2146,
    ...overrides,
  };
}

describe('isMileageReimbursement', () => {
  it('recognizes legacy and canonical labels despite case or surrounding whitespace', () => {
    expect(isMileageReimbursement(mileage())).toBe(true);
    expect(isMileageReimbursement(mileage({ notes: ' \n MILEAGE  ' }))).toBe(true);
    expect(isMileageReimbursement(mileage({ notes: 'Mileage: 29 miles @ $0.74/mile' }))).toBe(true);
  });

  it('keeps customer-linked SPIFFs and incidental mileage notes out of reimbursements', () => {
    expect(isMileageReimbursement(mileage({ first_order_id: 'order-1' }))).toBe(false);
    expect(isMileageReimbursement(mileage({ notes: 'First-order bonus with mileage included.' }))).toBe(false);
    expect(isMileageReimbursement(mileage({ notes: 'Mileagebonus' }))).toBe(false);
    expect(isMileageReimbursement(mileage({ notes: null }))).toBe(false);
  });
});

describe('getMileageDetails', () => {
  it('reads Haskins mileage and validates it against the actual payroll amount', () => {
    expect(getMileageDetails(mileage())).toEqual({ miles: 29, rateCents: 74, status: 'recorded' });
    expect(getMileageDetails(mileage({ amount_cents: '2146' }))).toEqual({ miles: 29, rateCents: 74, status: 'recorded' });
  });

  it('accepts abbreviated notation and rounds the reimbursement to cents', () => {
    expect(getMileageDetails(mileage({ notes: '  MILEAGE: 29.25 miles @ $0.74/mile', amount_cents: 2165 })))
      .toEqual({ miles: 29.25, rateCents: 74, status: 'recorded' });
    expect(getMileageDetails(mileage({ notes: 'Mileage reimbursement: 1 mile at $0.29 per mile', amount_cents: 29 })))
      .toEqual({ miles: 1, rateCents: 29, status: 'recorded' });
  });

  it('does not infer distance from a legacy payment amount', () => {
    expect(getMileageDetails(mileage({ notes: 'Mileage' }))).toEqual({ miles: null, rateCents: null, status: 'not_recorded' });
    expect(getMileageDetails(mileage({ notes: 'Mileage reimbursement for customer visits' })))
      .toEqual({ miles: null, rateCents: null, status: 'not_recorded' });
  });

  it('does not expose numeric mileage for a customer-linked SPIFF', () => {
    expect(getMileageDetails(mileage({ first_order_id: 'order-1' })))
      .toEqual({ miles: null, rateCents: null, status: 'not_recorded' });
  });

  it('flags inconsistent or incomplete details for review', () => {
    for (const row of [
      mileage({ amount_cents: 2200 }),
      mileage({ notes: 'Mileage reimbursement: 29 miles, rate missing' }),
      mileage({ notes: 'Mileage reimbursement: 29 miles at $Infinity per mile' }),
    ]) {
      expect(getMileageDetails(row)).toEqual({ miles: null, rateCents: null, status: 'needs_review' });
    }
  });

  it('rejects missing, invalid, fractional, or nonpositive stored amounts', () => {
    for (const amount_cents of [null, '', '   ', 'NaN', '2146abc', '2.146e3', NaN, Infinity, 2146.5, 0, -2146]) {
      expect(getMileageDetails(mileage({ amount_cents }))).toEqual({ miles: null, rateCents: null, status: 'needs_review' });
    }
  });

  it('rejects nonpositive values, subcent rates, scientific notation, and implausible bounds', () => {
    for (const [miles, rate, amount] of [
      ['0', '0.74', 0], ['-29', '0.74', -2146], ['29', '0', 0],
      ['29', '-0.74', -2146], ['29', '0.745', 2161],
      ['1e3', '0.74', 74000], ['10001', '0.74', 740074], ['29', '10.01', 29029],
    ] as const) {
      expect(getMileageDetails(mileage({ notes: `Mileage: ${miles} miles at $${rate} per mile`, amount_cents: amount })))
        .toEqual({ miles: null, rateCents: null, status: 'needs_review' });
    }
  });
});

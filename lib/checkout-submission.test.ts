import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgeCheckoutSubmission,
  checkoutCartFingerprint,
  readCheckoutSubmission,
  resetCheckoutSubmission,
  resolveCheckoutSubmission,
  submitCheckoutSubmission,
} from '@/lib/checkout-submission';

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const NEXT_SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const CART_KEY = 'sobrew-cart:customer-one';
const CART = [{ product_id: 'coffee', qty: 4 }];

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('checkout submission lifecycle', () => {
  it('keeps the same submission across checkout mounts and a retry after an uncertain response', () => {
    const storage = createStorage();
    const first = resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID);
    expect(submitCheckoutSubmission(storage, CART_KEY, CART)?.submissionId).toBe(first?.submissionId);

    const createNextId = vi.fn(() => NEXT_SUBMISSION_ID);
    const refreshed = resolveCheckoutSubmission(storage, CART_KEY, CART, createNextId);
    expect(refreshed).toMatchObject({ submissionId: SUBMISSION_ID, status: 'submitted' });
    expect(createNextId).not.toHaveBeenCalled();
  });

  it('uses the persisted identity again at submit time instead of a stale mounted form identity', () => {
    const storage = createStorage();
    resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID);
    resetCheckoutSubmission(storage, CART_KEY);
    resolveCheckoutSubmission(storage, CART_KEY, CART, () => NEXT_SUBMISSION_ID);
    expect(submitCheckoutSubmission(storage, CART_KEY, CART)?.submissionId).toBe(NEXT_SUBMISSION_ID);
  });

  it('ignores item ordering, labels, and refreshed pricing when identifying an unchanged cart', () => {
    const storage = createStorage();
    const items = [
      { product_id: 'coffee', qty: 4, price_cents: 4000, name: 'Coffee' },
      { product_id: 'tea', qty: 2, price_cents: 1000, name: 'Tea' },
    ];
    resolveCheckoutSubmission(storage, CART_KEY, items, () => SUBMISSION_ID);
    const refreshed = [...items].reverse().map((item) => ({ ...item, price_cents: 5000, name: 'Updated name' }));
    expect(resolveCheckoutSubmission(storage, CART_KEY, refreshed)?.submissionId).toBe(SUBMISSION_ID);
    expect(checkoutCartFingerprint([{ product_id: 'coffee', qty: 2 }, { product_id: 'coffee', qty: 2 }]))
      .toBe(checkoutCartFingerprint(CART));
  });

  it('creates a different submission for changed cart quantities or a different customer', () => {
    const storage = createStorage();
    resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID);
    expect(resolveCheckoutSubmission(storage, CART_KEY, [{ product_id: 'coffee', qty: 5 }], () => NEXT_SUBMISSION_ID)?.submissionId)
      .toBe(NEXT_SUBMISSION_ID);
    expect(resolveCheckoutSubmission(storage, 'sobrew-cart:customer-two', CART, () => SUBMISSION_ID)?.submissionId)
      .toBe(SUBMISSION_ID);
  });

  it('acknowledges and clears only the matching submission and cart, once', () => {
    const storage = createStorage();
    resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID);
    const receipt = { submissionId: SUBMISSION_ID, orderId: ORDER_ID, items: CART };
    expect(acknowledgeCheckoutSubmission(storage, CART_KEY, { ...receipt, submissionId: NEXT_SUBMISSION_ID })).toBe(false);
    expect(acknowledgeCheckoutSubmission(storage, CART_KEY, { ...receipt, items: [{ product_id: 'coffee', qty: 5 }] })).toBe(false);
    expect(acknowledgeCheckoutSubmission(storage, CART_KEY, receipt)).toBe(true);
    expect(readCheckoutSubmission(storage, CART_KEY)).toMatchObject({ status: 'completed', orderId: ORDER_ID });
    expect(acknowledgeCheckoutSubmission(storage, CART_KEY, receipt)).toBe(false);
  });

  it('returns a completed receipt to a stale checkout instead of silently creating another order', () => {
    const storage = createStorage();
    resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID);
    acknowledgeCheckoutSubmission(storage, CART_KEY, { submissionId: SUBMISSION_ID, orderId: ORDER_ID, items: CART });
    expect(resolveCheckoutSubmission(storage, CART_KEY, CART)).toMatchObject({ submissionId: SUBMISSION_ID, status: 'completed', orderId: ORDER_ID });
    expect(submitCheckoutSubmission(storage, CART_KEY, CART)).toMatchObject({ status: 'completed', orderId: ORDER_ID });
  });

  it('lets an explicit new draft contain identical items without an old confirmation clearing it', () => {
    const storage = createStorage();
    resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID);
    const oldReceipt = { submissionId: SUBMISSION_ID, orderId: ORDER_ID, items: CART };
    acknowledgeCheckoutSubmission(storage, CART_KEY, oldReceipt);
    resetCheckoutSubmission(storage, CART_KEY);
    resolveCheckoutSubmission(storage, CART_KEY, CART, () => NEXT_SUBMISSION_ID);
    expect(acknowledgeCheckoutSubmission(storage, CART_KEY, oldReceipt)).toBe(false);
    expect(readCheckoutSubmission(storage, CART_KEY)).toMatchObject({ submissionId: NEXT_SUBMISSION_ID, status: 'draft' });
  });

  it('does not replace an outstanding receipt while the cart is empty', () => {
    const storage = createStorage();
    resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID);
    const createId = vi.fn();
    expect(resolveCheckoutSubmission(storage, CART_KEY, [], createId)).toBeNull();
    expect(createId).not.toHaveBeenCalled();
    expect(readCheckoutSubmission(storage, CART_KEY)?.submissionId).toBe(SUBMISSION_ID);
  });

  it('recovers safely from malformed or incompatible persisted records', () => {
    const storage = createStorage();
    storage.setItem(`${CART_KEY}:checkout-submission`, 'not-json');
    expect(resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID)?.submissionId).toBe(SUBMISSION_ID);
    storage.setItem(`${CART_KEY}:checkout-submission`, JSON.stringify({ version: 2, submissionId: SUBMISSION_ID }));
    expect(resolveCheckoutSubmission(storage, CART_KEY, CART, () => NEXT_SUBMISSION_ID)?.submissionId).toBe(NEXT_SUBMISSION_ID);
  });

  it('does not claim an identity was persisted when browser storage fails', () => {
    const storage = { ...createStorage(), setItem: () => { throw new Error('Storage unavailable'); } };
    expect(() => resolveCheckoutSubmission(storage, CART_KEY, CART, () => SUBMISSION_ID)).toThrow('Storage unavailable');
  });
});

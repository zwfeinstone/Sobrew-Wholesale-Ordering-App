import { describe, expect, it } from 'vitest';
import {
  applyReorderItems,
  cartStorageKeyForUser,
  normalizeCartItems,
  setCartItemQuantity,
  summarizeCart,
  type CartItem,
} from '@/lib/cart';

const sunrise: CartItem = {
  product_id: 'sunrise',
  name: 'Sunrise Blend',
  price_cents: 1299,
  qty: 2,
};

const filters: CartItem = {
  product_id: 'filters',
  name: 'Filter Pack',
  price_cents: 925,
  qty: 1,
};

describe('cart normalization and totals', () => {
  it('drops invalid rows and combines duplicate products', () => {
    expect(normalizeCartItems([
      sunrise,
      { ...sunrise, name: 'Current Sunrise name', qty: 3 },
      { product_id: '', name: 'Invalid', price_cents: 100, qty: 1 },
      { product_id: 'negative', name: 'Invalid', price_cents: -1, qty: 1 },
    ])).toEqual([
      { ...sunrise, name: 'Current Sunrise name', qty: 5 },
    ]);
  });

  it('caps persisted and merged quantities at the checkout limit', () => {
    expect(normalizeCartItems([{ ...sunrise, qty: 20_000 }])).toEqual([{ ...sunrise, qty: 9999 }]);
    expect(normalizeCartItems([{ ...sunrise, qty: 7_500 }, { ...sunrise, qty: 7_500 }])).toEqual([
      { ...sunrise, qty: 9999 },
    ]);
  });

  it('computes quantity and subtotal in cents', () => {
    expect(summarizeCart([sunrise, filters])).toMatchObject({
      itemCount: 3,
      subtotalCents: 3523,
    });
  });

  it('keeps carts isolated by user', () => {
    expect(cartStorageKeyForUser('user-a')).toBe('sobrew-cart:user-a');
    expect(cartStorageKeyForUser('user-b')).not.toBe(cartStorageKeyForUser('user-a'));
  });
});

describe('restock cart updates', () => {
  it('merges a previous order into an existing cart', () => {
    expect(applyReorderItems([filters], [sunrise, { ...filters, qty: 2 }], 'merge')).toEqual([
      { ...filters, qty: 3 },
      sunrise,
    ]);
  });

  it('caps merged reorder quantities at the checkout limit', () => {
    expect(applyReorderItems([{ ...sunrise, qty: 9000 }], [{ ...sunrise, qty: 2000 }], 'merge')).toEqual([
      { ...sunrise, qty: 9999 },
    ]);
  });

  it('replaces the cart when requested', () => {
    expect(applyReorderItems([filters], [sunrise], 'replace')).toEqual([sunrise]);
  });

  it('removes a line when its quantity reaches zero', () => {
    expect(setCartItemQuantity([sunrise, filters], sunrise, 0)).toEqual([filters]);
  });
});

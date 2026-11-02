import { describe, expect, it } from 'vitest';
import {
  applyReorderItems,
  cartStorageKeyForUser,
  cartProductQuantityLimit,
  cartExceedsAvailableStock,
  cartCustomerStockGroups,
  reconcileCartItems,
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

  it('caps stored bag requests to availability without persisting stale stock balances', () => {
    const product = {
      product_id: 'custom-bags', name: 'Custom 8-ounce bags', price_cents: 0,
      customer_stock: {
        allocation_id: 'batch', product_id: 'custom-bags', initial_quantity: 1000,
        available_quantity: 900, reserved_quantity: 100, on_hand_quantity: 1000,
      },
    };
    expect(setCartItemQuantity([], product, 1000)).toEqual([
      { product_id: 'custom-bags', name: 'Custom 8-ounce bags', price_cents: 0, qty: 900 },
    ]);
    expect(setCartItemQuantity([], { ...product, customer_stock: { ...product.customer_stock, available_quantity: 0 } }, 1)).toEqual([]);
  });
});


describe('shared Ground and Whole Bean inventory', () => {
  const ground = {
    product_id: 'ground', name: 'Custom 8-ounce bags - Ground', price_cents: 0,
    customer_stock: { allocation_id: 'shared-batch', product_id: 'ground', shared_product_count: 2, initial_quantity: 1000, available_quantity: 1000, reserved_quantity: 0, on_hand_quantity: 1000 },
  };
  const whole = { ...ground, product_id: 'whole', name: 'Custom 8-ounce bags - Whole Bean', customer_stock: { ...ground.customer_stock, product_id: 'whole' } };
  const products = [ground, whole];
  const line = (product: typeof ground, qty: number) => ({ product_id: product.product_id, name: product.name, price_cents: product.price_cents, qty });

  it('counts 100 Ground + 50 Whole Bean as 150 bags from one allocation', () => {
    const items = [line(ground, 100), line(whole, 50)];
    expect(cartCustomerStockGroups(items, products)).toEqual([{ balance: ground.customer_stock, quantity: 150, productName: ground.name }]);
    expect(cartExceedsAvailableStock(items, products)).toBe(false);
    expect(cartProductQuantityLimit(ground, items, products)).toBe(950);
    expect(cartProductQuantityLimit(whole, items, products)).toBe(900);
  });

  it('caps add and edit against the other variant without persisting balance metadata', () => {
    const items = setCartItemQuantity([line(ground, 600)], whole, 500, products);
    expect(items).toEqual([line(ground, 600), line(whole, 400)]);
    expect(setCartItemQuantity(items, ground, 900, products)).toEqual([line(whole, 400), line(ground, 600)]);
    expect(cartProductQuantityLimit(whole, [line(ground, 1000)], products)).toBe(0);
    const removed = setCartItemQuantity(items, ground, 0, products);
    expect(cartProductQuantityLimit(whole, removed, products)).toBe(1000);
  });

  it('rejects combined overselling even if each individual row is below the pool balance', () => {
    expect(cartExceedsAvailableStock([line(ground, 600), line(whole, 500)], products)).toBe(true);
    expect(cartExceedsAvailableStock([line(ground, 600), line(whole, 400)], products)).toBe(false);
  });

  it('refreshes a stale cart against a decreased shared balance', () => {
    const updated = products.map((product) => ({ ...product, customer_stock: { ...product.customer_stock, available_quantity: 120 } }));
    expect(reconcileCartItems([line(ground, 100), line(whole, 50)], updated)).toEqual({ items: [line(ground, 100), line(whole, 20)], changed: true, removedCount: 0 });
  });

  it('caps replace and merge reorders, preserving quantities already in the cart', () => {
    expect(applyReorderItems([], [line(ground, 600), line(whole, 500)], 'replace', products)).toEqual([line(ground, 600), line(whole, 400)]);
    expect(applyReorderItems([line(ground, 100), line(whole, 600)], [line(ground, 500)], 'merge', products)).toEqual([line(whole, 600), line(ground, 400)]);
    expect(applyReorderItems([line(ground, 1000)], [line(whole, 1)], 'merge', products)).toEqual([line(ground, 1000)]);
  });

  it('keeps unrelated allocations independent', () => {
    const separate = { ...whole, customer_stock: { ...whole.customer_stock, allocation_id: 'another-batch' } };
    const items = [line(ground, 1000), line(separate, 1000)];
    expect(cartExceedsAvailableStock(items, [ground, separate])).toBe(false);
    expect(cartCustomerStockGroups(items, [ground, separate])).toHaveLength(2);
  });
});

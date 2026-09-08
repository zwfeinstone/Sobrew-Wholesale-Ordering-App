import { describe, expect, it, vi } from 'vitest';
import { createCartStore, EMPTY_CART_SNAPSHOT } from '@/lib/cart-store';
import type { CartItem } from '@/lib/cart';

function item(productId: string, qty = 1, priceCents = 500): CartItem {
  return { product_id: productId, name: productId, qty, price_cents: priceCents };
}

function fixture(initialItems: CartItem[] = []) {
  let items = initialItems;
  let notify: (() => void) | undefined;
  const disconnect = vi.fn(() => { notify = undefined; });
  const subscribeToUpdates = vi.fn((listener: () => void) => {
    notify = listener;
    return disconnect;
  });
  const readItems = vi.fn(() => items);
  const store = createCartStore({ readItems, subscribeToUpdates });
  return {
    store,
    disconnect,
    readItems,
    subscribeToUpdates,
    update(next: CartItem[]) {
      items = next;
      notify?.();
    },
  };
}

describe('cart external store', () => {
  it('hydrates one cached snapshot with totals and product quantities', () => {
    const { store, readItems } = fixture([item('coffee', 3, 1200), item('tea', 2, 700)]);
    const snapshot = store.getSnapshot();

    expect(snapshot).toMatchObject({ itemCount: 5, subtotalCents: 5000 });
    expect(store.getSnapshot()).toBe(snapshot);
    expect(store.getQuantity('coffee')).toBe(3);
    expect(store.getQuantity('unlisted')).toBe(0);
    expect(readItems).toHaveBeenCalledTimes(1);
  });

  it('shares one external event subscription across summaries and product controls', () => {
    const { store, subscribeToUpdates, disconnect } = fixture();
    const unsubscribeSummary = store.subscribe(vi.fn());
    const unsubscribeCoffee = store.subscribeQuantity('coffee', vi.fn());
    const unsubscribeTea = store.subscribeQuantity('tea', vi.fn());

    expect(subscribeToUpdates).toHaveBeenCalledTimes(1);
    unsubscribeSummary();
    unsubscribeCoffee();
    expect(disconnect).not.toHaveBeenCalled();
    unsubscribeTea();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('notifies only the changed quantity among a large catalog of subscribers', () => {
    const { store, update } = fixture([item('product-10')]);
    const summaryListener = vi.fn();
    store.subscribe(summaryListener);
    const listeners = Array.from({ length: 300 }, (_, index) => {
      const listener = vi.fn();
      store.subscribeQuantity(`product-${index}`, listener);
      return listener;
    });

    update([item('product-10', 2)]);

    expect(summaryListener).toHaveBeenCalledTimes(1);
    expect(listeners[10]).toHaveBeenCalledTimes(1);
    expect(listeners.filter((listener) => listener.mock.calls.length > 0)).toHaveLength(1);
    expect(store.getSnapshot()).toMatchObject({ itemCount: 2, subtotalCents: 1000 });
  });

  it('updates pricing and names without notifying unchanged quantity controls', () => {
    const { store, update } = fixture([item('coffee', 2)]);
    const quantityListener = vi.fn();
    const summaryListener = vi.fn();
    store.subscribeQuantity('coffee', quantityListener);
    store.subscribe(summaryListener);

    update([{ ...item('coffee', 2, 600), name: 'Fresh coffee' }]);

    expect(store.getSnapshot()).toMatchObject({ subtotalCents: 1200, items: [{ name: 'Fresh coffee' }] });
    expect(summaryListener).toHaveBeenCalledTimes(1);
    expect(quantityListener).not.toHaveBeenCalled();
  });

  it('updates removed products and totals when clearing or replacing a cart', () => {
    const { store, update } = fixture([item('coffee'), item('tea', 2)]);
    const coffeeListener = vi.fn();
    const teaListener = vi.fn();
    store.subscribeQuantity('coffee', coffeeListener);
    store.subscribeQuantity('tea', teaListener);

    update([item('tea', 2)]);
    expect(store.getQuantity('coffee')).toBe(0);
    expect(coffeeListener).toHaveBeenCalledTimes(1);
    expect(teaListener).not.toHaveBeenCalled();

    update([]);
    expect(store.getSnapshot()).toEqual(EMPTY_CART_SNAPSHOT);
    expect(store.getQuantity('tea')).toBe(0);
    expect(teaListener).toHaveBeenCalledTimes(1);
  });

  it('preserves snapshot identity and skips notifications for identical storage events', () => {
    const { store, update } = fixture([item('coffee')]);
    const listener = vi.fn();
    store.subscribe(listener);
    const previous = store.getSnapshot();

    update([item('coffee')]);

    expect(store.getSnapshot()).toBe(previous);
    expect(listener).not.toHaveBeenCalled();
  });

  it('preserves a changed item order even when quantities and totals are unchanged', () => {
    const { store, update } = fixture([item('coffee'), item('tea')]);
    const summaryListener = vi.fn();
    const quantityListener = vi.fn();
    store.subscribe(summaryListener);
    store.subscribeQuantity('coffee', quantityListener);

    update([item('tea'), item('coffee')]);

    expect(store.getSnapshot().items.map((row) => row.product_id)).toEqual(['tea', 'coffee']);
    expect(summaryListener).toHaveBeenCalledTimes(1);
    expect(quantityListener).not.toHaveBeenCalled();
  });

  it('rehydrates storage changes made while no component was subscribed', () => {
    const { store, update, subscribeToUpdates } = fixture([item('coffee')]);
    const unsubscribe = store.subscribeQuantity('coffee', vi.fn());
    unsubscribe();
    update([item('coffee', 4)]);

    expect(store.getQuantity('coffee')).toBe(4);
    const listener = vi.fn();
    store.subscribeQuantity('coffee', listener);
    update([item('coffee', 5)]);

    expect(subscribeToUpdates).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().itemCount).toBe(5);
  });
});

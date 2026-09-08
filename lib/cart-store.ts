import { summarizeCart, type CartItem, type CartSummary } from '@/lib/cart';

type Listener = () => void;

export const EMPTY_CART_SNAPSHOT: CartSummary = { items: [], itemCount: 0, subtotalCents: 0 };

function sameItems(left: CartItem[], right: CartItem[]) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return item.product_id === other.product_id && item.qty === other.qty
      && item.name === other.name && item.price_cents === other.price_cents;
  });
}

export function createCartStore({
  readItems,
  subscribeToUpdates,
}: {
  readItems: () => CartItem[];
  subscribeToUpdates: (refresh: Listener) => () => void;
}) {
  let snapshot = EMPTY_CART_SNAPSHOT;
  let quantities = new Map<string, number>();
  let hydrated = false;
  let disconnect: (() => void) | null = null;
  const listeners = new Set<Listener>();
  const quantityListeners = new Map<string, Set<Listener>>();

  function refresh() {
    const items = readItems();
    hydrated = true;
    if (sameItems(snapshot.items, items)) return;

    const previousQuantities = quantities;
    quantities = new Map(items.map((item) => [item.product_id, item.qty]));
    snapshot = summarizeCart(items);
    listeners.forEach((listener) => listener());
    quantityListeners.forEach((productListeners, productId) => {
      if ((previousQuantities.get(productId) ?? 0) !== (quantities.get(productId) ?? 0)) {
        productListeners.forEach((listener) => listener());
      }
    });
  }

  function hydrate() {
    if (!hydrated) refresh();
  }

  function connect() {
    if (!disconnect) disconnect = subscribeToUpdates(refresh);
  }

  function disconnectIfUnused() {
    if (listeners.size || quantityListeners.size) return;
    disconnect?.();
    disconnect = null;
    hydrated = false;
  }

  return {
    getSnapshot() {
      hydrate();
      return snapshot;
    },
    getQuantity(productId: string) {
      hydrate();
      return quantities.get(productId) ?? 0;
    },
    subscribe(listener: Listener) {
      hydrate();
      listeners.add(listener);
      connect();
      return () => {
        listeners.delete(listener);
        disconnectIfUnused();
      };
    },
    subscribeQuantity(productId: string, listener: Listener) {
      hydrate();
      let productListeners = quantityListeners.get(productId);
      if (!productListeners) {
        productListeners = new Set();
        quantityListeners.set(productId, productListeners);
      }
      productListeners.add(listener);
      connect();
      return () => {
        productListeners.delete(listener);
        if (!productListeners.size) quantityListeners.delete(productId);
        disconnectIfUnused();
      };
    },
  };
}

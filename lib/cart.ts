import type { CustomerStockBalance } from '@/lib/customer-stock';

export const LEGACY_CART_STORAGE_KEY = 'cart';
export const MAX_CART_ITEM_QUANTITY = 9999;

export type CartItem = {
  product_id: string;
  name: string;
  price_cents: number;
  qty: number;
};

export type CartProductSnapshot = Omit<CartItem, 'qty'> & { customer_stock?: CustomerStockBalance };

/** Maximum for this row after accounting for other variants from the same batch. */
export function cartProductQuantityLimit(
  product: CartProductSnapshot,
  items: CartItem[] = [],
  products: CartProductSnapshot[] = [product]
) {
  const stock = product.customer_stock;
  if (!stock) return MAX_CART_ITEM_QUANTITY;
  const related = products.filter((candidate) => candidate.customer_stock?.allocation_id === stock.allocation_id);
  const sharedIds = new Set(related.map((candidate) => candidate.product_id));
  const available = Math.min(stock.available_quantity, ...related.map((candidate) => candidate.customer_stock!.available_quantity));
  const otherQuantity = items.reduce((sum, item) => (
    item.product_id !== product.product_id && sharedIds.has(item.product_id) ? sum + item.qty : sum
  ), 0);
  return Math.min(MAX_CART_ITEM_QUANTITY, Math.max(0, Math.trunc(available) - otherQuantity));
}

/** Refresh catalog data and cap the combined quantity of each customer-owned batch. */
export function reconcileCartItems(items: CartItem[], products: CartProductSnapshot[]) {
  const productMap = new Map(products.map((product) => [product.product_id, product]));
  const next: CartItem[] = [];
  for (const item of normalizeCartItems(items)) {
    const product = productMap.get(item.product_id);
    if (!product) continue;
    const qty = Math.min(item.qty, cartProductQuantityLimit(product, next, products));
    if (qty > 0) next.push({ product_id: product.product_id, name: product.name, price_cents: product.price_cents, qty });
  }
  const changed = items.length !== next.length || next.some((item, index) => {
    const original = items[index];
    return !original || item.product_id !== original.product_id || item.name !== original.name || item.price_cents !== original.price_cents || item.qty !== original.qty;
  });
  return { items: next, changed, removedCount: Math.max(0, items.length - next.length) };
}

/** Used at submission as well as controls: individually valid rows may exceed one shared pool. */
export function cartExceedsAvailableStock(items: CartItem[], products: CartProductSnapshot[]) {
  const productMap = new Map(products.map((product) => [product.product_id, product]));
  return items.some((item) => {
    const product = productMap.get(item.product_id);
    return !product || item.qty > cartProductQuantityLimit(product, items, products);
  });
}

/** One summary per allocation, never one total per Ground / Whole Bean variant. */
export function cartCustomerStockGroups(items: CartItem[], products: CartProductSnapshot[]) {
  const productMap = new Map(products.map((product) => [product.product_id, product]));
  const groups = new Map<string, { balance: CustomerStockBalance; quantity: number; productName: string }>();
  for (const item of items) {
    const product = productMap.get(item.product_id);
    const balance = product?.customer_stock;
    if (!balance) continue;
    const group = groups.get(balance.allocation_id);
    if (group) group.quantity += item.qty;
    else groups.set(balance.allocation_id, { balance, quantity: item.qty, productName: product.name });
  }
  return [...groups.values()];
}

export type CartSummary = {
  items: CartItem[];
  itemCount: number;
  subtotalCents: number;
};

export type ReorderMode = 'merge' | 'replace';

export function cartStorageKeyForUser(userId: string) {
  return `sobrew-cart:${userId}`;
}

export function normalizeCartItem(rawItem: unknown): CartItem | null {
  if (!rawItem || typeof rawItem !== 'object') return null;

  const item = rawItem as Partial<CartItem>;
  const productId = typeof item.product_id === 'string' ? item.product_id.trim() : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const priceCents = Number(item.price_cents);
  const qty = Number(item.qty);

  if (!productId || !Number.isInteger(qty) || qty <= 0 || !Number.isFinite(priceCents) || priceCents < 0) {
    return null;
  }

  return {
    product_id: productId,
    name: name || 'Unknown product',
    price_cents: Math.trunc(priceCents),
    qty: Math.min(MAX_CART_ITEM_QUANTITY, qty),
  };
}

export function normalizeCartItems(rawItems: unknown): CartItem[] {
  if (!Array.isArray(rawItems)) return [];

  const combined = new Map<string, CartItem>();
  for (const rawItem of rawItems) {
    const item = normalizeCartItem(rawItem);
    if (!item) continue;

    const current = combined.get(item.product_id);
    combined.set(
      item.product_id,
      current
        ? { ...item, qty: Math.min(MAX_CART_ITEM_QUANTITY, current.qty + item.qty) }
        : item
    );
  }
  return [...combined.values()];
}

export function summarizeCart(items: CartItem[]): CartSummary {
  return items.reduce<CartSummary>(
    (summary, item) => ({
      items,
      itemCount: summary.itemCount + item.qty,
      subtotalCents: summary.subtotalCents + item.qty * item.price_cents,
    }),
    { items, itemCount: 0, subtotalCents: 0 }
  );
}

export function applyReorderItems(
  existing: CartItem[], incoming: CartItem[], mode: ReorderMode, products?: CartProductSnapshot[]
): CartItem[] {
  const normalizedIncoming = normalizeCartItems(incoming);
  if (mode === 'replace') return products ? reconcileCartItems(normalizedIncoming, products).items : normalizedIncoming;

  if (products) {
    const productMap = new Map(products.map((product) => [product.product_id, product]));
    let next = reconcileCartItems(existing, products).items;
    for (const item of normalizedIncoming) {
      const product = productMap.get(item.product_id);
      if (!product) continue;
      const currentQty = next.find((entry) => entry.product_id === item.product_id)?.qty ?? 0;
      next = setCartItemQuantity(next, product, currentQty + item.qty, products);
    }
    return next;
  }
  return normalizeCartItems([...existing, ...normalizedIncoming]);
}

export function setCartItemQuantity(
  items: CartItem[], product: CartProductSnapshot, quantity: number, products: CartProductSnapshot[] = [product]
): CartItem[] {
  const normalizedQty = Number.isFinite(quantity)
    ? Math.min(cartProductQuantityLimit(product, items, products), Math.max(0, Math.trunc(quantity)))
    : 0;
  const withoutProduct = items.filter((item) => item.product_id !== product.product_id);
  if (normalizedQty === 0) return withoutProduct;

  return normalizeCartItems([
    ...withoutProduct,
    { ...product, qty: normalizedQty },
  ]);
}

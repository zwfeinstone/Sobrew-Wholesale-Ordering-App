export const LEGACY_CART_STORAGE_KEY = 'cart';
export const MAX_CART_ITEM_QUANTITY = 9999;

export type CartItem = {
  product_id: string;
  name: string;
  price_cents: number;
  qty: number;
};

export type CartProductSnapshot = Omit<CartItem, 'qty'>;

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

export function applyReorderItems(existing: CartItem[], incoming: CartItem[], mode: ReorderMode): CartItem[] {
  const normalizedIncoming = normalizeCartItems(incoming);
  if (mode === 'replace') return normalizedIncoming;

  const next = new Map(normalizeCartItems(existing).map((item) => [item.product_id, item]));
  for (const item of normalizedIncoming) {
    const current = next.get(item.product_id);
    next.set(
      item.product_id,
      current
        ? { ...item, qty: Math.min(MAX_CART_ITEM_QUANTITY, current.qty + item.qty) }
        : item
    );
  }
  return [...next.values()];
}

export function setCartItemQuantity(items: CartItem[], product: CartProductSnapshot, quantity: number): CartItem[] {
  const normalizedQty = Number.isFinite(quantity)
    ? Math.min(MAX_CART_ITEM_QUANTITY, Math.max(0, Math.trunc(quantity)))
    : 0;
  const withoutProduct = items.filter((item) => item.product_id !== product.product_id);
  if (normalizedQty === 0) return withoutProduct;

  return normalizeCartItems([
    ...withoutProduct,
    {
      ...product,
      qty: normalizedQty,
    },
  ]);
}

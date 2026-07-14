'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import StatusToast from '@/components/status-toast';
import { trackProductEvent } from '@/lib/analytics';
import {
  LEGACY_CART_STORAGE_KEY,
  applyReorderItems,
  normalizeCartItems,
  setCartItemQuantity,
  summarizeCart,
  type CartItem,
  type CartProductSnapshot,
  type ReorderMode,
} from '@/lib/cart';

export type Item = CartItem;
export type { CartProductSnapshot, ReorderMode } from '@/lib/cart';

export const CART_UPDATED_EVENT = 'sobrew-cart-updated';

type CartUpdateDetail = {
  storageKey: string;
};

type CartExternalStore = {
  hydrated: boolean;
  items: Item[];
  listeners: Set<() => void>;
  disconnect: (() => void) | null;
};

const EMPTY_CART_ITEMS: Item[] = [];
const cartStores = new Map<string, CartExternalStore>();

function dispatchCartUpdate(storageKey: string) {
  window.dispatchEvent(new CustomEvent<CartUpdateDetail>(CART_UPDATED_EVENT, { detail: { storageKey } }));
}

export function readCartItems(storageKey: string): Item[] {
  if (typeof window === 'undefined') return [];

  try {
    localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
    return normalizeCartItems(JSON.parse(localStorage.getItem(storageKey) ?? '[]'));
  } catch {
    return [];
  }
}

export function saveCartItems(storageKey: string, next: Item[]) {
  const normalized = normalizeCartItems(next);
  localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  localStorage.setItem(storageKey, JSON.stringify(normalized));
  dispatchCartUpdate(storageKey);
}

export function clearCartItems(storageKey: string) {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  dispatchCartUpdate(storageKey);
}

export function readCartItemCount(storageKey: string) {
  return summarizeCart(readCartItems(storageKey)).itemCount;
}

function getCartStore(storageKey: string) {
  const existing = cartStores.get(storageKey);
  if (existing) return existing;

  const store: CartExternalStore = {
    hydrated: false,
    items: EMPTY_CART_ITEMS,
    listeners: new Set(),
    disconnect: null,
  };
  cartStores.set(storageKey, store);
  return store;
}

function hydrateCartStore(storageKey: string, store: CartExternalStore) {
  if (store.hydrated || typeof window === 'undefined') return;
  store.items = readCartItems(storageKey);
  store.hydrated = true;
}

function connectCartStore(storageKey: string, store: CartExternalStore) {
  if (store.disconnect || typeof window === 'undefined') return;

  const syncItems = (event: Event) => {
    if (event instanceof CustomEvent) {
      const detail = event.detail as CartUpdateDetail | undefined;
      if (detail?.storageKey && detail.storageKey !== storageKey) return;
    }
    if (event instanceof StorageEvent && event.key && event.key !== storageKey && event.key !== LEGACY_CART_STORAGE_KEY) {
      return;
    }

    store.items = readCartItems(storageKey);
    store.hydrated = true;
    store.listeners.forEach((listener) => listener());
  };

  window.addEventListener(CART_UPDATED_EVENT, syncItems);
  window.addEventListener('storage', syncItems);
  store.disconnect = () => {
    window.removeEventListener(CART_UPDATED_EVENT, syncItems);
    window.removeEventListener('storage', syncItems);
    store.disconnect = null;
  };
}

function subscribeToCart(storageKey: string, listener: () => void) {
  const store = getCartStore(storageKey);
  hydrateCartStore(storageKey, store);
  store.listeners.add(listener);
  connectCartStore(storageKey, store);

  return () => {
    store.listeners.delete(listener);
    if (!store.listeners.size) {
      store.disconnect?.();
      store.hydrated = false;
    }
  };
}

function getCartSnapshot(storageKey: string) {
  const store = getCartStore(storageKey);
  hydrateCartStore(storageKey, store);
  return store.items;
}

function useCartItems(storageKey: string) {
  const subscribe = useCallback((listener: () => void) => subscribeToCart(storageKey, listener), [storageKey]);
  const getSnapshot = useCallback(() => getCartSnapshot(storageKey), [storageKey]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CART_ITEMS);
}

export function useCart(storageKey: string) {
  const items = useCartItems(storageKey);
  const { itemCount, subtotalCents } = useMemo(() => summarizeCart(items), [items]);

  const setQuantity = useCallback((product: CartProductSnapshot, quantity: number) => {
    saveCartItems(storageKey, setCartItemQuantity(readCartItems(storageKey), product, quantity));
  }, [storageKey]);

  const addReorderItems = useCallback((incoming: Item[], mode: ReorderMode) => {
    saveCartItems(storageKey, applyReorderItems(readCartItems(storageKey), incoming, mode));
  }, [storageKey]);

  const clear = useCallback(() => clearCartItems(storageKey), [storageKey]);

  return {
    addReorderItems,
    clear,
    itemCount,
    items,
    setQuantity,
    subtotalCents,
  };
}

function reconcileCartItems(items: Item[], products: CartProductSnapshot[]) {
  const productMap = new Map(products.map((product) => [product.product_id, product]));
  let changed = false;
  const next: Item[] = [];

  for (const item of items) {
    const product = productMap.get(item.product_id);
    if (!product) {
      changed = true;
      continue;
    }

    const syncedItem = { ...item, name: product.name, price_cents: product.price_cents };
    if (syncedItem.name !== item.name || syncedItem.price_cents !== item.price_cents) changed = true;
    next.push(syncedItem);
  }

  return { items: next, changed, removedCount: items.length - next.length };
}

export function CartCatalogSync({ products, storageKey }: { products: CartProductSnapshot[]; storageKey: string }) {
  const [syncMessage, setSyncMessage] = useState('');
  const productSignature = useMemo(
    () => products.map((product) => `${product.product_id}:${product.price_cents}:${product.name}`).join('|'),
    [products]
  );

  useEffect(() => {
    const current = readCartItems(storageKey);
    if (!current.length || !products.length) return;

    const reconciled = reconcileCartItems(current, products);
    if (!reconciled.changed) return;

    saveCartItems(storageKey, reconciled.items);
    setSyncMessage(
      reconciled.removedCount > 0
        ? 'Your cart was updated to remove unavailable products and refresh current pricing.'
        : 'Your cart pricing was refreshed.'
    );
  }, [productSignature, products, storageKey]);

  return syncMessage ? <StatusToast message={syncMessage} tone="success" /> : null;
}

export function CatalogQuantityControl({
  compact = false,
  product,
  storageKey,
}: {
  compact?: boolean;
  product: CartProductSnapshot;
  storageKey: string;
}) {
  const { items, setQuantity } = useCart(storageKey);
  const [announcement, setAnnouncement] = useState('');
  const qty = items.find((item) => item.product_id === product.product_id)?.qty ?? 0;

  const updateQuantity = (nextQty: number) => {
    setQuantity(product, nextQty);
    const normalizedQty = Math.max(0, Math.trunc(nextQty));
    if (normalizedQty > qty) {
      trackProductEvent('portal_item_added', {
        quantity: normalizedQty - qty,
        source: 'catalog',
      });
    }
    setAnnouncement(
      normalizedQty > 0
        ? `${product.name} quantity is now ${normalizedQty}.`
        : `${product.name} removed from your order.`
    );
  };

  if (qty === 0) {
    return (
      <div className={compact ? 'catalog-row-control' : 'catalog-card-actions'}>
        <span className="sr-only" aria-live="polite">{announcement}</span>
        <button
          className="btn-primary catalog-add-button"
          type="button"
          onClick={() => updateQuantity(1)}
        >
          Add
          <span className="sr-only"> {product.name} to order</span>
        </button>
      </div>
    );
  }

  return (
    <div className={compact ? 'catalog-row-control' : 'catalog-card-actions'}>
      <span className="sr-only" aria-live="polite">{announcement}</span>
      <div className="quantity-stepper" aria-label={`${product.name} quantity in order`}>
        <button
          aria-label={`Decrease ${product.name} quantity`}
          className="quantity-stepper-button"
          type="button"
          onClick={() => updateQuantity(qty - 1)}
        >
          <span aria-hidden="true">−</span>
        </button>
        <span className="quantity-stepper-value" aria-live="polite">{qty}</span>
        <button
          aria-label={`Increase ${product.name} quantity`}
          className="quantity-stepper-button is-positive"
          type="button"
          onClick={() => updateQuantity(qty + 1)}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <span className="catalog-in-cart-label">In order: {qty}</span>
    </div>
  );
}

export function AddToCartButton({ product, storageKey }: { product: CartProductSnapshot; storageKey: string }) {
  const { items, setQuantity } = useCart(storageKey);
  const qty = items.find((item) => item.product_id === product.product_id)?.qty ?? 0;
  const [showToast, setShowToast] = useState(false);

  return (
    <>
      {showToast ? <StatusToast message={`${product.name} added to your order.`} tone="success" /> : null}
      <button
        className="btn-primary w-full sm:w-auto"
        type="button"
        onClick={() => {
          setQuantity(product, qty + 1);
          trackProductEvent('portal_item_added', { quantity: 1, source: 'catalog' });
          setShowToast(false);
          window.setTimeout(() => setShowToast(true), 0);
        }}
      >
        Add to order
      </button>
    </>
  );
}

export function AddToCartQuantityControls({ product, storageKey }: { product: CartProductSnapshot; storageKey: string }) {
  return <CatalogQuantityControl product={product} storageKey={storageKey} />;
}

export function ReorderButton({
  className = 'btn-secondary w-full sm:w-auto',
  items,
  label = 'Reorder & review',
  storageKey,
}: {
  className?: string;
  items: Item[];
  label?: string;
  storageKey: string;
  toastMessage?: string;
}) {
  const router = useRouter();
  const { addReorderItems, itemCount } = useCart(storageKey);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const reorderingRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const replaceButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    replaceButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog();
      if (event.key !== 'Tab') return;

      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      ) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeDialog, dialogOpen]);

  const finishReorder = (mode: ReorderMode) => {
    if (reorderingRef.current) return;
    reorderingRef.current = true;
    setIsReordering(true);
    addReorderItems(items, mode);
    trackProductEvent('portal_reorder_added', {
      item_count: items.length,
      quantity: items.reduce((sum, item) => sum + item.qty, 0),
      mode,
    });
    setDialogOpen(false);
    router.push('/portal/cart');
  };

  const startReorder = () => {
    if (itemCount > 0) {
      setDialogOpen(true);
      return;
    }
    finishReorder('replace');
  };

  return (
    <>
      <button
        ref={triggerRef}
        aria-expanded={dialogOpen || undefined}
        aria-haspopup="dialog"
        className={className}
        type="button"
        disabled={!items.length || isReordering}
        onClick={startReorder}
      >
        {isReordering ? 'Opening cart...' : label}
      </button>
      {dialogOpen ? (
        <div className="reorder-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}>
          <section
            ref={dialogRef}
            aria-describedby="reorder-dialog-description"
            aria-labelledby="reorder-dialog-title"
            aria-modal="true"
            className="reorder-dialog"
            role="dialog"
          >
            <span className="eyebrow">Current order found</span>
            <h2 id="reorder-dialog-title" className="mt-4 text-xl font-semibold tracking-tight text-slate-950">How should we add this order?</h2>
            <p id="reorder-dialog-description" className="mt-2 text-sm leading-6 text-slate-600">
              Replace starts fresh with this previous order. Merge adds these items to what is already in your cart.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button ref={replaceButtonRef} className="btn-primary" type="button" disabled={isReordering} onClick={() => finishReorder('replace')}>
                {isReordering ? 'Opening cart...' : 'Replace & review'}
              </button>
              <button className="btn-secondary" type="button" disabled={isReordering} onClick={() => finishReorder('merge')}>
                {isReordering ? 'Opening cart...' : 'Merge & review'}
              </button>
            </div>
            <button className="mt-3 w-full px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60" type="button" disabled={isReordering} onClick={closeDialog}>
              Cancel
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function CartSummaryMetric({ storageKey }: { storageKey: string }) {
  const { itemCount, subtotalCents } = useCart(storageKey);

  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Your order</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">${(subtotalCents / 100).toFixed(2)}</p>
      <p className="mt-1 text-sm text-slate-500">{itemCount} item{itemCount === 1 ? '' : 's'} ready</p>
    </div>
  );
}

export function CartPreviewBar({ storageKey }: { storageKey: string }) {
  const { itemCount, subtotalCents } = useCart(storageKey);
  if (!itemCount) return null;

  return (
    <div className="cart-preview-bar">
      <div className="cart-preview-copy" aria-live="polite">
        <p className="cart-preview-label text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Your order</p>
        <p className="cart-preview-total mt-1 text-lg font-semibold text-slate-950">
          {itemCount} item{itemCount === 1 ? '' : 's'} &middot; ${(subtotalCents / 100).toFixed(2)}
        </p>
      </div>
      <Link href="/portal/cart" className="btn-primary inline-flex">Review order</Link>
    </div>
  );
}

function CartQuantityInput({
  item,
  onCommit,
}: {
  item: Item;
  onCommit: (item: Item, quantity: number) => void;
}) {
  const [draftQuantity, setDraftQuantity] = useState(String(item.qty));
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    setDraftQuantity(String(item.qty));
  }, [item.qty]);

  const commitDraft = () => {
    if (cancelCommitRef.current) {
      cancelCommitRef.current = false;
      return;
    }
    const parsedQuantity = Number(draftQuantity);
    if (!draftQuantity.trim() || !Number.isFinite(parsedQuantity)) {
      setDraftQuantity(String(item.qty));
      return;
    }

    const nextQuantity = Math.min(9999, Math.max(1, Math.trunc(parsedQuantity)));
    setDraftQuantity(String(nextQuantity));
    if (nextQuantity !== item.qty) onCommit(item, nextQuantity);
  };

  return (
    <input
      id={`cart-qty-${item.product_id}`}
      className="quantity-stepper-input"
      inputMode="numeric"
      max={9999}
      min={1}
      step={1}
      type="number"
      value={draftQuantity}
      onBlur={commitDraft}
      onChange={(event) => setDraftQuantity(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          cancelCommitRef.current = true;
          setDraftQuantity(String(item.qty));
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function CartTable({ storageKey }: { storageKey: string }) {
  const { clear, itemCount, items, setQuantity, subtotalCents } = useCart(storageKey);
  const [clearedItems, setClearedItems] = useState<Item[] | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const updateQuantity = (item: Item, quantity: number) => {
    setClearedItems(null);
    setQuantity(item, quantity);
    setAnnouncement(
      quantity > 0
        ? `${item.name} quantity is now ${quantity}.`
        : `${item.name} removed from your order.`
    );
  };

  const clearOrder = () => {
    setClearedItems(items);
    clear();
    setAnnouncement('Order cleared. Use Undo to restore it.');
  };

  const undoClear = () => {
    if (!clearedItems) return;
    saveCartItems(storageKey, clearedItems);
    setClearedItems(null);
    setAnnouncement('Your order was restored.');
  };

  return (
    <div className="cart-review space-y-4">
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {clearedItems ? (
        <div className="cart-undo" role="status">
          <span>Your order was cleared.</span>
          <button className="cart-undo-button" type="button" onClick={undoClear}>Undo</button>
        </div>
      ) : null}
      {!items.length ? (
        <div className="empty-state text-center">
          <p className="text-lg font-semibold text-slate-950">Your order is empty.</p>
          <p className="mt-2 text-sm text-slate-500">Add products from Quick Restock to build your next delivery.</p>
          <Link href="/portal" className="btn-secondary mt-4 inline-flex">Browse products</Link>
        </div>
      ) : (
        <>
          <div className="cart-review-heading">
            <p className="text-sm font-semibold text-slate-700">{itemCount} item{itemCount === 1 ? '' : 's'} in this order</p>
            <button className="cart-clear-button" type="button" onClick={clearOrder}>Clear order</button>
          </div>
          <div className="cart-review-list">
            {items.map((item) => (
              <article key={item.product_id} className="cart-review-row">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-950">{item.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">${(item.price_cents / 100).toFixed(2)} each</p>
                </div>
                <div className="cart-review-row-actions">
                  <div className="quantity-stepper" aria-label={`${item.name} quantity`}>
                    <button
                      aria-label={`Decrease ${item.name} quantity`}
                      className="quantity-stepper-button"
                      type="button"
                      onClick={() => updateQuantity(item, item.qty - 1)}
                    >
                      <span aria-hidden="true">−</span>
                    </button>
                    <label className="sr-only" htmlFor={`cart-qty-${item.product_id}`}>Quantity for {item.name}</label>
                    <CartQuantityInput item={item} onCommit={updateQuantity} />
                    <button
                      aria-label={`Increase ${item.name} quantity`}
                      className="quantity-stepper-button is-positive"
                      type="button"
                      disabled={item.qty >= 9999}
                      onClick={() => updateQuantity(item, Math.min(9999, item.qty + 1))}
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  </div>
                  <button className="cart-remove-button" type="button" onClick={() => updateQuantity(item, 0)}>Remove</button>
                </div>
              </article>
            ))}
          </div>
          <div className="cart-summary-bar">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Subtotal</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">${(subtotalCents / 100).toFixed(2)}</p>
            </div>
            <Link href="/portal/checkout" className="btn-primary inline-flex">Continue to checkout</Link>
          </div>
        </>
      )}
    </div>
  );
}

export function CheckoutCartSummary({ storageKey }: { storageKey: string }) {
  const { itemCount, items, subtotalCents } = useCart(storageKey);

  return (
    <section className="checkout-section" aria-labelledby="checkout-order-heading">
      <div className="checkout-section-heading">
        <div>
          <p className="checkout-section-kicker">Order · {itemCount} item{itemCount === 1 ? '' : 's'}</p>
          <h2 id="checkout-order-heading" className="checkout-section-title">Review your restock</h2>
        </div>
        <Link href="/portal/cart" className="checkout-edit-link">Edit</Link>
      </div>
      {!items.length ? (
        <div className="checkout-critical-alert" role="alert">
          Your order is empty. Return to your cart and add products before placing an order.
        </div>
      ) : (
        <div className="checkout-line-items">
          {items.map((item) => (
            <div key={item.product_id} className="checkout-line-item">
              <div className="min-w-0">
                <p className="font-medium text-slate-950">{item.name}</p>
                <p className="mt-0.5 text-sm text-slate-500">{item.qty} × ${(item.price_cents / 100).toFixed(2)}</p>
              </div>
              <p className="shrink-0 text-sm font-semibold text-slate-950">${((item.qty * item.price_cents) / 100).toFixed(2)}</p>
            </div>
          ))}
        </div>
      )}
      <div className="checkout-section-total">
        <span>Subtotal</span>
        <strong>${(subtotalCents / 100).toFixed(2)}</strong>
      </div>
    </section>
  );
}

export function CheckoutCartField({ storageKey }: { storageKey: string }) {
  const { items } = useCart(storageKey);
  return <input type="hidden" name="cart_json" value={JSON.stringify(items)} />;
}

export function ClearCart({ storageKey }: { storageKey: string }) {
  useEffect(() => {
    clearCartItems(storageKey);
  }, [storageKey]);
  return null;
}

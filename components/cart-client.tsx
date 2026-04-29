'use client';

import { useEffect, useState } from 'react';
import StatusToast from '@/components/status-toast';
import { LEGACY_CART_STORAGE_KEY } from '@/lib/cart';

type Item = { product_id: string; name: string; price_cents: number; qty: number };
export const CART_UPDATED_EVENT = 'sobrew-cart-updated';

function cartTotals(items: Item[]) {
  return items.reduce(
    (totals, item) => ({
      count: totals.count + Math.max(0, Number(item.qty) || 0),
      subtotal: totals.subtotal + item.qty * item.price_cents,
    }),
    { count: 0, subtotal: 0 }
  );
}

function mergeCartItems(existing: Item[], incoming: Item[]) {
  const next = [...existing];
  for (const item of incoming) {
    const found = next.find((cartItem) => cartItem.product_id === item.product_id);
    if (found) found.qty += item.qty;
    else next.push({ ...item });
  }
  return next;
}

function readCartItems(storageKey: string) {
  try {
    localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
    return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as Item[];
  } catch {
    return [];
  }
}

function saveCartItems(storageKey: string, next: Item[]) {
  localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  localStorage.setItem(storageKey, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
}

function clearCartItems(storageKey: string) {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
}

export function readCartItemCount(storageKey: string) {
  return readCartItems(storageKey).reduce((sum, item) => sum + Math.max(0, Number(item.qty) || 0), 0);
}

export function AddToCartButton({ product, storageKey }: { product: Omit<Item, 'qty'>; storageKey: string }) {
  const [showToast, setShowToast] = useState(false);

  return (
    <>
      {showToast ? <StatusToast message={`${product.name} added to cart.`} tone="success" /> : null}
      <button
        className="btn-primary w-full sm:w-auto"
        type="button"
        onClick={() => {
          const cart = readCartItems(storageKey);
          saveCartItems(storageKey, mergeCartItems(cart, [{ ...product, qty: 1 }]));
          setShowToast(false);
          window.setTimeout(() => setShowToast(true), 0);
        }}
      >
        Add to cart
      </button>
    </>
  );
}

export function AddToCartQuantityControls({ product, storageKey }: { product: Omit<Item, 'qty'>; storageKey: string }) {
  const [qty, setQty] = useState(1);
  const [showToast, setShowToast] = useState(false);
  const normalizedQty = Math.max(1, Number.isFinite(qty) ? Math.trunc(qty) : 1);

  const updateQty = (nextQty: number) => {
    setQty(Math.max(1, Number.isFinite(nextQty) ? Math.trunc(nextQty) : 1));
  };

  return (
    <>
      {showToast ? <StatusToast message={`${normalizedQty} ${product.name} added to cart.`} tone="success" /> : null}
      <div className="catalog-card-actions">
        <div className="quantity-stepper" aria-label={`Quantity for ${product.name}`}>
          <button
            aria-label={`Decrease quantity for ${product.name}`}
            className="quantity-stepper-button"
            disabled={normalizedQty <= 1}
            type="button"
            onClick={() => updateQty(normalizedQty - 1)}
          >
            -
          </button>
          <input
            aria-label={`Quantity for ${product.name}`}
            className="quantity-stepper-input"
            min={1}
            type="number"
            value={normalizedQty}
            onChange={(event) => updateQty(Number(event.target.value))}
          />
          <button
            aria-label={`Increase quantity for ${product.name}`}
            className="quantity-stepper-button is-positive"
            type="button"
            onClick={() => updateQty(normalizedQty + 1)}
          >
            +
          </button>
        </div>
        <button
          className="btn-primary catalog-card-button w-full"
          type="button"
          onClick={() => {
            const cart = readCartItems(storageKey);
            saveCartItems(storageKey, mergeCartItems(cart, [{ ...product, qty: normalizedQty }]));
            setShowToast(false);
            window.setTimeout(() => setShowToast(true), 0);
          }}
        >
          Add {normalizedQty} to cart
        </button>
      </div>
    </>
  );
}

export function ReorderButton({
  items,
  storageKey,
  label = 'Reorder',
  toastMessage = 'Order added to cart.',
  className = 'btn-secondary w-full sm:w-auto',
}: {
  items: Item[];
  storageKey: string;
  label?: string;
  toastMessage?: string;
  className?: string;
}) {
  const [showToast, setShowToast] = useState(false);

  return (
    <>
      {showToast ? <StatusToast message={toastMessage} tone="success" /> : null}
      <button
        className={className}
        type="button"
        disabled={!items.length}
        onClick={() => {
          const cart = readCartItems(storageKey);
          saveCartItems(storageKey, mergeCartItems(cart, items));
          setShowToast(false);
          window.setTimeout(() => setShowToast(true), 0);
        }}
      >
        {label}
      </button>
    </>
  );
}

export function CartSummaryMetric({ storageKey }: { storageKey: string }) {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const syncItems = () => setItems(readCartItems(storageKey));
    syncItems();
    window.addEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
    window.addEventListener('storage', syncItems);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
      window.removeEventListener('storage', syncItems);
    };
  }, [storageKey]);

  const { count, subtotal } = cartTotals(items);

  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Cart</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950">${(subtotal / 100).toFixed(2)}</p>
      <p className="mt-1 text-sm text-slate-500">{count} item{count === 1 ? '' : 's'} ready</p>
    </div>
  );
}

export function CartPreviewBar({ storageKey }: { storageKey: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [showClearedToast, setShowClearedToast] = useState(false);

  useEffect(() => {
    const syncItems = () => setItems(readCartItems(storageKey));
    syncItems();
    window.addEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
    window.addEventListener('storage', syncItems);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
      window.removeEventListener('storage', syncItems);
    };
  }, [storageKey]);

  const { count, subtotal } = cartTotals(items);
  if (!items.length) return showClearedToast ? <StatusToast message="Cart cleared." tone="success" /> : null;

  return (
    <>
      {showClearedToast ? <StatusToast message="Cart cleared." tone="success" /> : null}
      <div className="cart-preview-bar">
        <div className="cart-preview-copy">
          <p className="cart-preview-label text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current Cart</p>
          <p className="cart-preview-total mt-1 text-lg font-semibold text-slate-950">
            {count} item{count === 1 ? '' : 's'} &middot; ${(subtotal / 100).toFixed(2)}
          </p>
        </div>
        <div className="cart-preview-actions grid gap-2 sm:flex sm:items-center">
          <a href="/portal/cart" className="cart-preview-view btn-secondary inline-flex w-full sm:w-auto">View cart</a>
          <button
            aria-label="Clear all items from cart"
            className="cart-preview-clear btn-secondary"
            type="button"
            onClick={() => {
              if (!window.confirm('Clear all items from your cart?')) return;
              clearCartItems(storageKey);
              setShowClearedToast(false);
              window.setTimeout(() => setShowClearedToast(true), 0);
            }}
          >
            Clear
          </button>
          <a href="/portal/checkout" className="cart-preview-checkout btn-primary inline-flex w-full sm:w-auto">Checkout</a>
        </div>
      </div>
    </>
  );
}

export function CartTable({ storageKey }: { storageKey: string }) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const syncItems = () => setItems(readCartItems(storageKey));
    syncItems();
    window.addEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
    window.addEventListener('storage', syncItems);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
      window.removeEventListener('storage', syncItems);
    };
  }, [storageKey]);

  const save = (next: Item[]) => {
    setItems(next);
    saveCartItems(storageKey, next);
  };

  const updateQty = (productId: string, nextQty: number) => {
    const normalizedQty = Math.max(1, Number.isFinite(nextQty) ? Math.trunc(nextQty) : 1);
    save(items.map((item) => (item.product_id === productId ? { ...item, qty: normalizedQty } : item)));
  };

  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price_cents, 0);

  return (
    <div className="space-y-4">
      {!items.length ? (
        <div className="empty-state text-center">
          <p className="text-lg font-semibold text-slate-950">Your cart is empty.</p>
          <p className="text-sm text-slate-500">Add products from the catalog to start building your next order.</p>
          <a href="/portal" className="btn-secondary inline-flex">Browse catalog</a>
        </div>
      ) : null}
      {items.map((item) => (
        <div key={item.product_id} className="card flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-slate-950">{item.name}</p>
            <p className="mt-1 text-sm text-slate-500">${(item.price_cents / 100).toFixed(2)} each</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center justify-between rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm sm:justify-start">
              <button
                aria-label={`Decrease quantity for ${item.name}`}
                className="btn-secondary h-11 w-11 shrink-0 px-0 py-0 sm:h-10 sm:w-10"
                disabled={item.qty <= 1}
                type="button"
                onClick={() => updateQty(item.product_id, item.qty - 1)}
              >
                -
              </button>
              <input
                aria-label={`Quantity for ${item.name}`}
                className="w-14 bg-transparent px-2 text-center text-base font-semibold text-slate-950 outline-none"
                value={item.qty}
                min={1}
                type="number"
                onChange={(e) => updateQty(item.product_id, Number(e.target.value))}
              />
              <button
                aria-label={`Increase quantity for ${item.name}`}
                className="btn-primary h-11 w-11 shrink-0 px-0 py-0 sm:h-10 sm:w-10"
                type="button"
                onClick={() => updateQty(item.product_id, item.qty + 1)}
              >
                +
              </button>
            </div>
            <button className="btn-secondary w-full px-3 py-2 sm:w-auto" type="button" onClick={() => save(items.filter((i) => i.product_id !== item.product_id))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      {items.length ? (
        <div className="cart-summary-bar flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Order subtotal</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">${(subtotal / 100).toFixed(2)}</p>
          </div>
          <a href="/portal/checkout" className="btn-primary inline-flex w-full sm:w-auto">Checkout</a>
        </div>
      ) : null}
    </div>
  );
}

export function CheckoutCartSummary({ storageKey }: { storageKey: string }) {
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const syncItems = () => setItems(readCartItems(storageKey));
    syncItems();
    window.addEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
    window.addEventListener('storage', syncItems);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
      window.removeEventListener('storage', syncItems);
    };
  }, [storageKey]);

  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price_cents, 0);

  return (
    <div className="subtle-panel checkout-summary">
      <div className="checkout-summary-header flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="checkout-summary-copy">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Order review</p>
          <p className="checkout-summary-description mt-2 text-sm text-slate-600">Confirm the products and subtotal before placing your order.</p>
        </div>
        <a href="/portal/cart" className="btn-secondary checkout-summary-edit inline-flex w-full sm:w-auto">Edit cart</a>
      </div>
      {!items.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your cart is empty. Return to the cart to add products before placing an order.
        </div>
      ) : (
        <>
          <div className="checkout-summary-items mt-4 space-y-3">
            {items.map((item) => (
              <div key={item.product_id} className="checkout-summary-item flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                <div className="min-w-0">
                  <p className="font-medium text-slate-950">{item.name}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.qty} x ${(item.price_cents / 100).toFixed(2)}</p>
                </div>
                <p className="text-sm font-semibold text-slate-950">${((item.qty * item.price_cents) / 100).toFixed(2)}</p>
              </div>
            ))}
          </div>
          <div className="checkout-summary-subtotal mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
            <p className="text-sm uppercase tracking-[0.18em] text-slate-500">Subtotal</p>
            <p className="text-xl font-semibold text-slate-950">${(subtotal / 100).toFixed(2)}</p>
          </div>
        </>
      )}
    </div>
  );
}

export function CheckoutCartField({ storageKey }: { storageKey: string }) {
  const [value, setValue] = useState('[]');

  useEffect(() => {
    const syncValue = () => setValue(JSON.stringify(readCartItems(storageKey)));
    syncValue();
    window.addEventListener(CART_UPDATED_EVENT, syncValue as EventListener);
    window.addEventListener('storage', syncValue);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncValue as EventListener);
      window.removeEventListener('storage', syncValue);
    };
  }, [storageKey]);

  return <input type="hidden" name="cart_json" value={value} />;
}

export function ClearCart({ storageKey }: { storageKey: string }) {
  useEffect(() => {
    clearCartItems(storageKey);
  }, [storageKey]);
  return null;
}

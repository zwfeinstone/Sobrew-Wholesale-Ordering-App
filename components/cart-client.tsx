'use client';

import { useEffect, useState } from 'react';
import StatusToast from '@/components/status-toast';

type Item = { product_id: string; name: string; price_cents: number; qty: number };
const CART_STORAGE_KEY = 'cart';
export const CART_UPDATED_EVENT = 'sobrew-cart-updated';

function mergeCartItems(existing: Item[], incoming: Item[]) {
  const next = [...existing];
  for (const item of incoming) {
    const found = next.find((cartItem) => cartItem.product_id === item.product_id);
    if (found) found.qty += item.qty;
    else next.push({ ...item });
  }
  return next;
}

function readCartItems() {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]') as Item[];
  } catch {
    return [];
  }
}

function saveCartItems(next: Item[]) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
}

export function readCartItemCount() {
  return readCartItems().reduce((sum, item) => sum + Math.max(0, Number(item.qty) || 0), 0);
}

export function AddToCartButton({ product }: { product: Omit<Item, 'qty'> }) {
  const [showToast, setShowToast] = useState(false);

  return (
    <>
      {showToast ? <StatusToast message={`${product.name} added to cart.`} tone="success" /> : null}
      <button
        className="btn-primary w-full sm:w-auto"
        type="button"
        onClick={() => {
          const cart = readCartItems();
          saveCartItems(mergeCartItems(cart, [{ ...product, qty: 1 }]));
          setShowToast(false);
          window.setTimeout(() => setShowToast(true), 0);
        }}
      >
        Add to cart
      </button>
    </>
  );
}

export function ReorderButton({ items }: { items: Item[] }) {
  const [showToast, setShowToast] = useState(false);

  return (
    <>
      {showToast ? <StatusToast message="Order added to cart." tone="success" /> : null}
      <button
        className="btn-secondary w-full sm:w-auto"
        type="button"
        onClick={() => {
          const cart = readCartItems();
          saveCartItems(mergeCartItems(cart, items));
          setShowToast(false);
          window.setTimeout(() => setShowToast(true), 0);
        }}
      >
        Reorder
      </button>
    </>
  );
}

export function CartTable() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    const syncItems = () => setItems(readCartItems());
    syncItems();
    window.addEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
    window.addEventListener('storage', syncItems);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncItems as EventListener);
      window.removeEventListener('storage', syncItems);
    };
  }, []);

  const save = (next: Item[]) => {
    setItems(next);
    saveCartItems(next);
  };

  const updateQty = (productId: string, nextQty: number) => {
    const normalizedQty = Math.max(1, Number.isFinite(nextQty) ? Math.trunc(nextQty) : 1);
    save(items.map((item) => (item.product_id === productId ? { ...item, qty: normalizedQty } : item)));
  };

  const subtotal = items.reduce((sum, item) => sum + item.qty * item.price_cents, 0);

  return (
    <div className="space-y-4">
      {!items.length ? (
        <div className="card space-y-3 text-center">
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
        <div className="card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

export function CheckoutCartField() {
  const [value, setValue] = useState('[]');
  useEffect(() => {
    setValue(JSON.stringify(readCartItems()));
  }, []);
  return <input type="hidden" name="cart_json" value={value} />;
}

export function ClearCart() {
  useEffect(() => {
    localStorage.removeItem(CART_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT));
  }, []);
  return null;
}

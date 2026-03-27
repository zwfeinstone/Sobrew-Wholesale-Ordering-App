'use client';

import { useEffect, useState } from 'react';
import StatusToast from '@/components/status-toast';

type Item = { product_id: string; name: string; price_cents: number; qty: number };

export function AddToCartButton({ product }: { product: Omit<Item, 'qty'> }) {
  const [showToast, setShowToast] = useState(false);

  return (
    <>
      {showToast ? <StatusToast message={`${product.name} added to cart.`} tone="success" /> : null}
      <button
        className="btn-primary"
        type="button"
        onClick={() => {
          const raw = localStorage.getItem('cart') ?? '[]';
          const cart = JSON.parse(raw) as Item[];
          const found = cart.find((c) => c.product_id === product.product_id);
          if (found) found.qty += 1;
          else cart.push({ ...product, qty: 1 });
          localStorage.setItem('cart', JSON.stringify(cart));
          setShowToast(false);
          window.setTimeout(() => setShowToast(true), 0);
        }}
      >
        Add to cart
      </button>
    </>
  );
}

export function CartTable() {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    setItems(JSON.parse(localStorage.getItem('cart') ?? '[]'));
  }, []);

  const save = (next: Item[]) => {
    setItems(next);
    localStorage.setItem('cart', JSON.stringify(next));
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
          <div>
            <p className="text-lg font-semibold text-slate-950">{item.name}</p>
            <p className="mt-1 text-sm text-slate-500">${(item.price_cents / 100).toFixed(2)} each</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input w-20"
              value={item.qty}
              min={1}
              type="number"
              onChange={(e) =>
                save(items.map((i) => (i.product_id === item.product_id ? { ...i, qty: Number(e.target.value) } : i)))
              }
            />
            <button className="btn-secondary px-3 py-2" type="button" onClick={() => save(items.filter((i) => i.product_id !== item.product_id))}>
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
          <a href="/portal/checkout" className="btn-primary inline-flex">Checkout</a>
        </div>
      ) : null}
    </div>
  );
}

export function CheckoutCartField() {
  const [value, setValue] = useState('[]');
  useEffect(() => {
    setValue(localStorage.getItem('cart') ?? '[]');
  }, []);
  return <input type="hidden" name="cart_json" value={value} />;
}

export function ClearCart() {
  useEffect(() => {
    localStorage.removeItem('cart');
  }, []);
  return null;
}

'use client';

import { useEffect, useState } from 'react';

type Item = { product_id: string; name: string; price_cents: number; qty: number };

export function AddToCartButton({ product }: { product: Omit<Item, 'qty'> }) {
  return (
    <button
      className="btn-primary"
      onClick={() => {
        const raw = localStorage.getItem('cart') ?? '[]';
        const cart = JSON.parse(raw) as Item[];
        const found = cart.find((c) => c.product_id === product.product_id);
        if (found) found.qty += 1;
        else cart.push({ ...product, qty: 1 });
        localStorage.setItem('cart', JSON.stringify(cart));
        alert('Added to cart');
      }}
    >
      Add to cart
    </button>
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
      {items.map((item) => (
        <div key={item.product_id} className="card flex items-center justify-between">
          <div>
            {item.name} (${(item.price_cents / 100).toFixed(2)})
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
            <button className="rounded border px-2 py-1" onClick={() => save(items.filter((i) => i.product_id !== item.product_id))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      <div className="font-semibold">Subtotal ${(subtotal / 100).toFixed(2)}</div>
      <a href="/portal/checkout" className="btn-primary inline-block">Checkout</a>
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

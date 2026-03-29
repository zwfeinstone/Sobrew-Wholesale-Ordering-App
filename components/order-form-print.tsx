'use client';

import { useMemo } from 'react';
import { usd } from '@/lib/utils';

type Line = {
  product_id: string;
  name: string;
  sku: string;
  image_url: string | null;
  price_cents: number;
};

type Center = {
  id: string;
  name: string;
  email: string;
};

export function OrderFormPrint({
  center,
  products
}: {
  center: Center;
  products: Line[];
}) {
  const centerLabel = useMemo(() => center.name || center.email, [center]);

  return (
    <div className="space-y-4 print:space-y-2">
      <div className="print:hidden">
        <button type="button" className="btn-primary" onClick={() => window.print()}>
          Print
        </button>
      </div>

      <div className="card print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <div className="mb-4 flex items-start justify-between border-b pb-3">
          <div>
            <h2 className="text-2xl font-semibold">Sobrew Order Form</h2>
            <p className="text-sm text-slate-600">Center: {centerLabel}</p>
            <p className="text-sm text-slate-600">Email: {center.email || 'No active login on file'}</p>
          </div>
          <div className="text-right text-sm text-slate-600">Date: {new Date().toLocaleDateString()}</div>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-semibold">Shipping Address</h3>
            <div className="h-9 rounded border" />
            <div className="h-9 rounded border" />
            <div className="grid grid-cols-3 gap-2">
              <div className="h-9 rounded border" />
              <div className="h-9 rounded border" />
              <div className="h-9 rounded border" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Contact</h3>
            <div className="h-9 rounded border" />
            <div className="h-9 rounded border" />
            <div className="h-9 rounded border" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border p-2 text-left">Image</th>
                <th className="border p-2 text-left">Product</th>
                <th className="border p-2 text-left">SKU</th>
                <th className="border p-2 text-left">Price</th>
                <th className="border p-2 text-left">Qty</th>
              </tr>
            </thead>
            <tbody>
              {products.map((line) => (
                <tr key={line.product_id}>
                  <td className="border p-2 align-middle">
                    {line.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={line.image_url} alt={line.name} className="h-14 w-14 rounded object-cover" />
                    ) : (
                      <div className="h-14 w-14 rounded border" />
                    )}
                  </td>
                  <td className="border p-2 align-middle">{line.name}</td>
                  <td className="border p-2 align-middle">{line.sku}</td>
                  <td className="border p-2 align-middle">{usd(line.price_cents)}</td>
                  <td className="border p-2 align-middle">
                    <input className="h-9 w-20 rounded border px-2 print:border-black" type="number" min="0" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';

type LikelyOrderChecklistItemProps = {
  actionLabel: string;
  children: ReactNode;
  likelyQty: string;
  productId: string;
  productName: string;
  storageKey: string;
};

function checklistStorageKey(storageKey: string, productId: string) {
  return `sobrew.inventory.likely-orders.${storageKey}.${productId}`;
}

export default function LikelyOrderChecklistItem({
  actionLabel,
  children,
  likelyQty,
  productId,
  productName,
  storageKey,
}: LikelyOrderChecklistItemProps) {
  const checkboxId = useId();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    try {
      setChecked(window.localStorage.getItem(checklistStorageKey(storageKey, productId)) === 'made');
    } catch {
      setChecked(false);
    }
  }, [productId, storageKey]);

  function updateChecked(nextChecked: boolean) {
    setChecked(nextChecked);
    try {
      const key = checklistStorageKey(storageKey, productId);
      if (nextChecked) {
        window.localStorage.setItem(key, 'made');
      } else {
        window.localStorage.removeItem(key);
      }
    } catch {
      // The checkbox still works for this page view if local storage is unavailable.
    }
  }

  return (
    <div className={`rounded-2xl border p-4 transition ${checked ? 'border-teal-200 bg-teal-50/70' : 'border-slate-200 bg-white/70'}`}>
      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white/80 p-3 sm:flex-row sm:items-center sm:justify-between">
        <label htmlFor={checkboxId} className="flex cursor-pointer items-center gap-3 text-sm font-semibold text-slate-950">
          <input
            id={checkboxId}
            type="checkbox"
            checked={checked}
            onChange={(event) => updateChecked(event.currentTarget.checked)}
            className="h-5 w-5 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
            aria-label={`Mark ${productName} as made`}
          />
          <span>{checked ? 'Made' : 'Mark made'}</span>
        </label>
        <p className="text-sm text-slate-500">
          {checked ? `${productName} is checked off.` : `${likelyQty} likely ordered - ${actionLabel}`}
        </p>
      </div>
      <div className={checked ? 'opacity-60' : undefined}>{children}</div>
    </div>
  );
}

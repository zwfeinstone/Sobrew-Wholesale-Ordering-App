'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CART_UPDATED_EVENT, readCartItemCount } from '@/components/cart-client';

export function PortalCartLink({ storageKey }: { storageKey: string }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const syncCount = () => setCount(readCartItemCount(storageKey));
    syncCount();
    window.addEventListener(CART_UPDATED_EVENT, syncCount as EventListener);
    window.addEventListener('storage', syncCount);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncCount as EventListener);
      window.removeEventListener('storage', syncCount);
    };
  }, [storageKey]);

  return (
    <Link className="nav-pill inline-flex shrink-0 items-center gap-2 whitespace-nowrap" href="/portal/cart">
      <svg aria-hidden="true" className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.5h1.386c.51 0 .955.347 1.08.841L6.75 7.5m0 0h11.1c.83 0 1.448.765 1.274 1.577l-1.035 4.95a1.125 1.125 0 0 1-1.101.893H8.397a1.125 1.125 0 0 1-1.101-.893L6.75 7.5Zm0 0L6.18 5.341M9.75 19.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm8.25 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
      </svg>
      <span>Cart</span>
      <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-teal-600 px-2 py-0.5 text-xs font-semibold text-white">
        {count}
      </span>
    </Link>
  );
}

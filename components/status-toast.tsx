'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type StatusToastProps = {
  message: string;
  tone: 'success' | 'error';
};

export default function StatusToast({ message, tone }: StatusToastProps) {
  const [visible, setVisible] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 4000);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (!nextParams.has('toast')) return;
    nextParams.delete('toast');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  if (!visible) return null;

  const toneClasses =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-rose-200 bg-rose-50 text-rose-900';

  return (
    <div className="fixed right-4 top-4 z-50 max-w-sm">
      <div className={`rounded-lg border px-4 py-3 shadow-lg ${toneClasses}`}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium">{message}</p>
          <button
            type="button"
            aria-label="Dismiss notification"
            className="text-xs font-semibold uppercase tracking-wide opacity-70 hover:opacity-100"
            onClick={() => setVisible(false)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

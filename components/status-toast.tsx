'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { X } from 'lucide-react';

type StatusToastProps = {
  message: string;
  tone: 'success' | 'error';
  cookieName?: string;
  cookiePath?: string;
  actionHref?: string;
  actionLabel?: string;
  persistent?: boolean;
};

export default function StatusToast({ message, tone, cookieName, cookiePath = '/', actionHref, actionLabel, persistent = false }: StatusToastProps) {
  const [visible, setVisible] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (persistent || tone === 'error') return;
    const timeout = window.setTimeout(() => setVisible(false), 6000);
    return () => window.clearTimeout(timeout);
  }, [persistent, tone]);

  useEffect(() => {
    if (visible) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    if (!nextParams.has('toast')) return;
    nextParams.delete('toast');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, router, searchParams, visible]);

  useEffect(() => {
    if (!cookieName) return;
    document.cookie = `${cookieName}=; Max-Age=0; path=${cookiePath}; SameSite=Lax`;
  }, [cookieName, cookiePath]);

  if (!visible) return null;

  const toneClasses =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-rose-200 bg-rose-50 text-rose-900';

  return (
    <div className="workspace-toast" role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'}>
      <div className={`rounded-lg border px-4 py-3 shadow-lg ${toneClasses}`}>
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-sm font-medium">{message}</p>{actionHref && actionLabel ? <Link className="mt-2 inline-block text-sm font-semibold underline" href={actionHref}>{actionLabel}</Link> : null}</div>
          <button
            type="button"
            aria-label="Dismiss notification"
            className="shrink-0 rounded p-1 opacity-70 hover:opacity-100"
            onClick={() => setVisible(false)}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

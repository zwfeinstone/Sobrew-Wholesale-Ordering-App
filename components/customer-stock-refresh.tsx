'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Only pages displaying finite stock poll, and only while the tab is visible. */
export function CustomerStockRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    let lastRefresh = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRefresh < 5000) return;
      lastRefresh = Date.now();
      router.refresh();
    };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, router]);
  return null;
}

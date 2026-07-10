'use client';

import { startTransition, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

const REFRESH_DEBOUNCE_MS = 750;

function isLiveOrderWorkspace(pathname: string) {
  return pathname === '/admin' || pathname === '/admin/orders';
}

function hasFocusedFormField() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  if (activeElement instanceof HTMLInputElement) return true;
  if (activeElement instanceof HTMLTextAreaElement) return true;
  if (activeElement instanceof HTMLSelectElement) return true;

  return activeElement instanceof HTMLElement && activeElement.isContentEditable;
}

export function AdminRealtimeSync({ centerScope }: { centerScope: string[] | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const pendingRefreshRef = useRef(false);
  const refreshTimeoutRef = useRef<number | null>(null);
  const centerScopeKey = centerScope === null ? '*' : [...centerScope].sort().join(',');

  useEffect(() => {
    if (!isLiveOrderWorkspace(pathname)) return;

    const supabase = createClient();
    let focusOutTimeout: number | null = null;

    const refreshWhenSafe = () => {
      if (!pendingRefreshRef.current) return;
      if (refreshTimeoutRef.current !== null) return;

      if (document.visibilityState !== 'visible' || hasFocusedFormField()) {
        return;
      }

      pendingRefreshRef.current = false;
      startTransition(() => {
        router.refresh();
      });
    };

    const scheduleRefresh = () => {
      pendingRefreshRef.current = true;
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = window.setTimeout(() => {
        refreshTimeoutRef.current = null;
        refreshWhenSafe();
      }, REFRESH_DEBOUNCE_MS);
    };

    const handleFocusOut = () => {
      if (focusOutTimeout !== null) window.clearTimeout(focusOutTimeout);
      focusOutTimeout = window.setTimeout(() => {
        focusOutTimeout = null;
        refreshWhenSafe();
      }, 0);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshWhenSafe();
    };

    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', refreshWhenSafe);

    const scopedCenterIds = centerScopeKey === '*' ? null : centerScopeKey.split(',').filter(Boolean);
    const channels = scopedCenterIds === null
      ? [
          supabase
            .channel(`admin-order-workspace-global-${Date.now()}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'orders' },
              scheduleRefresh,
            )
            .subscribe(),
        ]
      : scopedCenterIds.map((centerId) => supabase
          .channel(`admin-order-workspace-center-${centerId}-${Date.now()}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders', filter: `center_id=eq.${centerId}` },
            scheduleRefresh,
          )
          .subscribe());

    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = null;
      if (focusOutTimeout !== null) {
        window.clearTimeout(focusOutTimeout);
      }
      pendingRefreshRef.current = false;
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', refreshWhenSafe);
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
    };
  }, [centerScopeKey, pathname, router]);

  return null;
}

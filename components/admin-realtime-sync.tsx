'use client';

import { startTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

const REFRESH_DEBOUNCE_MS = 500;
const ADMIN_SYNC_TABLES = [
  'orders',
  'order_items',
  'centers',
  'profiles',
  'products',
  'recurring_orders',
  'recurring_order_items',
] as const;

function hasFocusedFormField() {
  const activeElement = document.activeElement;
  if (!activeElement) return false;

  if (activeElement instanceof HTMLInputElement) return true;
  if (activeElement instanceof HTMLTextAreaElement) return true;
  if (activeElement instanceof HTMLSelectElement) return true;

  return activeElement instanceof HTMLElement && activeElement.isContentEditable;
}

export function AdminRealtimeSync() {
  const router = useRouter();
  const refreshTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const supabase = createClient();

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }

      refreshTimeoutRef.current = window.setTimeout(() => {
        if (hasFocusedFormField()) {
          scheduleRefresh();
          return;
        }

        startTransition(() => {
          router.refresh();
        });
      }, REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase.channel(`admin-realtime-sync-${Date.now()}`);

    for (const table of ADMIN_SYNC_TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleRefresh,
      );
    }

    channel.subscribe();

    return () => {
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}

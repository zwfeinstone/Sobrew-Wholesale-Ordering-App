'use client';

import { startTransition, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

const REFRESH_DEBOUNCE_MS = 750;
const DING_COOLDOWN_MS = 1200;

type OrderRealtimePayload = {
  eventType?: string;
  new?: {
    archived_at?: string | null;
    status?: string | null;
  };
};

function isLiveOrderWorkspace(pathname: string) {
  return pathname === '/admin'
    || pathname === '/admin/orders'
    || pathname === '/admin/planning'
    || pathname === '/admin/production';
}

function isNewOrderInsert(payload: OrderRealtimePayload) {
  return payload.eventType === 'INSERT' && payload.new?.status === 'New' && !payload.new?.archived_at;
}

function audioContextConstructor() {
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastDingAtRef = useRef(0);
  const pendingRefreshRef = useRef(false);
  const refreshTimeoutRef = useRef<number | null>(null);
  const centerScopeKey = centerScope === null ? '*' : [...centerScope].sort().join(',');

  useEffect(() => {
    if (!isLiveOrderWorkspace(pathname)) return;

    const supabase = createClient();
    let focusOutTimeout: number | null = null;

    const getAudioContext = () => {
      const AudioContextCtor = audioContextConstructor();
      if (!AudioContextCtor) return null;
      audioContextRef.current ??= new AudioContextCtor();
      return audioContextRef.current;
    };

    const unlockAudio = () => {
      const context = getAudioContext();
      if (!context) return;
      void context.resume().catch(() => undefined);
    };

    const playNewOrderDing = () => {
      const now = Date.now();
      if (now - lastDingAtRef.current < DING_COOLDOWN_MS) return;

      const context = getAudioContext();
      if (!context) return;
      lastDingAtRef.current = now;

      void context.resume().then(() => {
        const startAt = context.currentTime;
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.16, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.48);
        gain.connect(context.destination);

        for (const [index, frequency] of [880, 1174].entries()) {
          const oscillator = context.createOscillator();
          const toneStart = startAt + index * 0.14;
          oscillator.frequency.setValueAtTime(frequency, toneStart);
          oscillator.type = 'sine';
          oscillator.connect(gain);
          oscillator.start(toneStart);
          oscillator.stop(toneStart + 0.24);
        }
      }).catch(() => undefined);
    };

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

    const handleOrderChange = (payload: OrderRealtimePayload) => {
      if (isNewOrderInsert(payload)) playNewOrderDing();
      scheduleRefresh();
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
    document.addEventListener('keydown', unlockAudio);
    document.addEventListener('pointerdown', unlockAudio);
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
              handleOrderChange,
            )
            .subscribe(),
        ]
      : scopedCenterIds.map((centerId) => supabase
          .channel(`admin-order-workspace-center-${centerId}-${Date.now()}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders', filter: `center_id=eq.${centerId}` },
            handleOrderChange,
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
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('pointerdown', unlockAudio);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', refreshWhenSafe);
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
      void audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, [centerScopeKey, pathname, router]);

  return null;
}

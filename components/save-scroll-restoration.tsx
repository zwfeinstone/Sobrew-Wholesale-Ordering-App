'use client';

import { useEffect } from 'react';
import {
  SAVE_SCROLL_STORAGE_KEY,
  clampScrollPosition,
  createSaveScrollSnapshot,
  getScrollRestoreDecision,
  isValidSaveScrollSnapshot,
  sameSaveScrollSnapshot,
  shouldStoreFormScroll,
  type SaveScrollSnapshot,
} from '@/lib/save-scroll-restoration';

const RESTORE_SETTLE_DELAY_MS = 300;

function readSavedScrollSnapshot() {
  try {
    const rawSnapshot = window.sessionStorage.getItem(SAVE_SCROLL_STORAGE_KEY);
    if (!rawSnapshot) return null;
    const parsedSnapshot: unknown = JSON.parse(rawSnapshot);
    return isValidSaveScrollSnapshot(parsedSnapshot) ? parsedSnapshot : null;
  } catch {
    return null;
  }
}

function writeSavedScrollSnapshot(snapshot: SaveScrollSnapshot) {
  try {
    window.sessionStorage.setItem(SAVE_SCROLL_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Some browser modes block sessionStorage; saving scroll should never block the form submit.
  }
}

function clearSavedScrollSnapshot() {
  try {
    window.sessionStorage.removeItem(SAVE_SCROLL_STORAGE_KEY);
  } catch {
    // Ignore storage failures for the same reason writes are best-effort.
  }
}

function scrollBounds() {
  const root = document.documentElement;
  const body = document.body;
  return {
    scrollHeight: Math.max(root.scrollHeight, root.offsetHeight, body?.scrollHeight ?? 0, body?.offsetHeight ?? 0),
    scrollWidth: Math.max(root.scrollWidth, root.offsetWidth, body?.scrollWidth ?? 0, body?.offsetWidth ?? 0),
    viewportHeight: window.innerHeight || root.clientHeight,
    viewportWidth: window.innerWidth || root.clientWidth,
  };
}

export function SaveScrollRestoration() {
  useEffect(() => {
    let frame: number | null = null;
    let settleTimer: number | null = null;

    const restoreSavedScroll = () => {
      const snapshot = readSavedScrollSnapshot();
      const decision = getScrollRestoreDecision(snapshot, window.location.pathname, Date.now());
      if (decision.type === 'none') return;
      if (decision.type !== 'restore') {
        clearSavedScrollSnapshot();
        return;
      }

      const restore = () => {
        const position = clampScrollPosition(decision.x, decision.y, scrollBounds());
        window.scrollTo({ left: position.x, top: position.y, behavior: 'auto' });
        clearSavedScrollSnapshot();
      };

      if (frame !== null) window.cancelAnimationFrame(frame);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
      frame = window.requestAnimationFrame(restore);
      settleTimer = window.setTimeout(restore, RESTORE_SETTLE_DELAY_MS);
    };

    const scheduleRestore = () => {
      window.setTimeout(restoreSavedScroll, 0);
    };

    const handleSubmit = (event: SubmitEvent) => {
      if (!(event.target instanceof HTMLFormElement)) return;

      const form = event.target;
      if (!shouldStoreFormScroll({
        actionAttribute: form.getAttribute('action'),
        currentHref: window.location.href,
        currentPathname: window.location.pathname,
        preserveScroll: form.dataset.preserveScroll,
        target: form.getAttribute('target'),
      })) {
        return;
      }

      const snapshot = createSaveScrollSnapshot(window.location.pathname, window.scrollX, window.scrollY, Date.now());
      writeSavedScrollSnapshot(snapshot);

      window.setTimeout(() => {
        if (!event.defaultPrevented) return;
        const latestSnapshot = readSavedScrollSnapshot();
        if (sameSaveScrollSnapshot(latestSnapshot, snapshot)) clearSavedScrollSnapshot();
      }, 0);
    };

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
      const result = originalPushState.call(window.history, data, unused, url);
      scheduleRestore();
      return result;
    };

    window.history.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
      const result = originalReplaceState.call(window.history, data, unused, url);
      scheduleRestore();
      return result;
    };

    restoreSavedScroll();
    document.addEventListener('submit', handleSubmit, true);
    window.addEventListener('pageshow', restoreSavedScroll);
    window.addEventListener('popstate', scheduleRestore);

    return () => {
      document.removeEventListener('submit', handleSubmit, true);
      window.removeEventListener('pageshow', restoreSavedScroll);
      window.removeEventListener('popstate', scheduleRestore);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (settleTimer !== null) window.clearTimeout(settleTimer);
    };
  }, []);

  return null;
}

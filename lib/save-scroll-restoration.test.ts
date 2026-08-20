import { describe, expect, it } from 'vitest';
import {
  SAVE_SCROLL_MAX_AGE_MS,
  clampScrollPosition,
  createSaveScrollSnapshot,
  getScrollRestoreDecision,
  shouldStoreFormScroll,
} from '@/lib/save-scroll-restoration';

const currentHref = 'https://app.sobrew.com/admin/inventory?tab=finished_good';
const currentPathname = '/admin/inventory';

describe('save scroll restoration helpers', () => {
  it('restores a same-path saved scroll position', () => {
    const now = 1_000_000;
    const snapshot = createSaveScrollSnapshot(currentPathname, 0, 820, now - 500);

    expect(getScrollRestoreDecision(snapshot, currentPathname, now)).toEqual({
      type: 'restore',
      x: 0,
      y: 820,
    });
  });

  it('restores after a query-only redirect on the same path', () => {
    const now = 1_000_000;
    const snapshot = createSaveScrollSnapshot(currentPathname, 12, 640, now - 500);

    expect(getScrollRestoreDecision(snapshot, '/admin/inventory', now)).toEqual({
      type: 'restore',
      x: 12,
      y: 640,
    });
  });

  it('clears saved scroll when the save lands on a different path', () => {
    const now = 1_000_000;
    const snapshot = createSaveScrollSnapshot(currentPathname, 0, 640, now - 500);

    expect(getScrollRestoreDecision(snapshot, '/admin/orders/123', now)).toEqual({
      type: 'clear',
      reason: 'path_mismatch',
    });
  });

  it('clears saved scroll after the expiry window', () => {
    const now = 1_000_000;
    const snapshot = createSaveScrollSnapshot(currentPathname, 0, 640, now - SAVE_SCROLL_MAX_AGE_MS - 1);

    expect(getScrollRestoreDecision(snapshot, currentPathname, now)).toEqual({
      type: 'clear',
      reason: 'expired',
    });
  });

  it('skips forms with preserve scroll explicitly disabled', () => {
    expect(shouldStoreFormScroll({
      actionAttribute: null,
      currentHref,
      currentPathname,
      preserveScroll: 'off',
      target: null,
    })).toBe(false);
  });

  it('allows force-on forms even when the action points elsewhere', () => {
    expect(shouldStoreFormScroll({
      actionAttribute: '/admin/orders/123',
      currentHref,
      currentPathname,
      preserveScroll: 'on',
      target: null,
    })).toBe(true);
  });

  it('skips automatic restoration for cross-path form actions', () => {
    expect(shouldStoreFormScroll({
      actionAttribute: '/portal/checkout/submit',
      currentHref: 'https://app.sobrew.com/portal/checkout',
      currentPathname: '/portal/checkout',
      preserveScroll: null,
      target: null,
    })).toBe(false);
  });

  it('clamps restored scroll inside the current document bounds', () => {
    expect(clampScrollPosition(50, 10_000, {
      scrollHeight: 2_400,
      scrollWidth: 1_200,
      viewportHeight: 800,
      viewportWidth: 1_000,
    })).toEqual({
      x: 50,
      y: 1_600,
    });
  });
});

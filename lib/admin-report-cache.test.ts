import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAdminAccess } from './admin-permissions';
import { ownerAccessMap } from './admin-permission-definitions';
import { createReportDataCache, REPORT_DATA_CACHE_WINDOW_MS } from './admin-report-cache';

const state = vi.hoisted(() => ({
  entries: new Map<string, { value: unknown; writtenAt: number }>(),
  generation: 0,
  source: 'https://report-a.supabase.co',
  options: [] as Array<{ tags: string[]; revalidate: number }>,
}));

vi.mock('next/cache', () => ({
  unstable_cache: (
    loader: () => Promise<unknown>,
    keys: string[],
    options: { tags: string[]; revalidate: number },
  ) => {
    state.options.push(options);
    const key = JSON.stringify(keys);
    return async () => {
      const entry = state.entries.get(key);
      if (entry) {
        if (Date.now() - entry.writtenAt >= options.revalidate * 1000) {
          // Match Next's ordinary stale-while-revalidate behavior, including
          // swallowing a background failure and retaining the stale entry.
          void loader().then((result) => {
            state.entries.set(key, { value: structuredClone(result), writtenAt: Date.now() });
          }).catch(() => undefined);
        }
        return structuredClone(entry.value);
      }
      const result = await loader();
      state.entries.set(key, { value: structuredClone(result), writtenAt: Date.now() });
      return result;
    };
  },
}));

vi.mock('./report-cache-invalidation', () => ({
  REPORT_DATA_CACHE_TAG: 'report-data-test',
  getReportCacheGeneration: () => state.generation,
}));

vi.mock('@/lib/env', () => ({
  env: { get supabaseUrl() { return state.source; } },
}));

const NOW = Date.UTC(2026, 9, 15, 18);

function access(): CurrentAdminAccess {
  return {
    access: ownerAccessMap(),
    centerScope: ['center-a'],
    firstAllowedHref: '/admin',
    isOwner: false,
    isSuperadmin: false,
    profile: {
      id: 'actor-a',
      avatar_url: null,
      center: null,
      center_id: null,
      email: 'actor@example.test',
      full_name: 'Actor',
      is_active: true,
      is_admin: true,
      is_superadmin: false,
    },
    user: { id: 'actor-a', email: 'actor@example.test' },
  };
}

beforeEach(() => {
  state.entries.clear();
  state.options.length = 0;
  state.generation = 0;
  state.source = 'https://report-a.supabase.co';
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => { vi.useRealTimers(); });

describe('report data cache', () => {
  it('shares identical underlying reads across independently rendered report tabs', async () => {
    const overview = createReportDataCache(access(), ['center-a']);
    const centers = createReportDataCache(access(), ['center-a']);
    const loader = vi.fn(async () => ({ orders: { data: [{ id: 'order-a' }], error: null }, orderItems: { data: [], error: null } }));
    const filters = { mode: 'period', start: '2026-09-01', end: '2026-11-01' };

    expect(await overview.read('commerce', filters, loader)).toEqual(await centers.read('commerce', filters, loader));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(overview.stats).toEqual({ hits: 0, misses: 1 });
    expect(centers.stats).toEqual({ hits: 1, misses: 0 });
    expect(state.options[0]).toEqual({ tags: ['report-data-test'], revalidate: 30 });
  });

  it('normalizes equivalent scopes and object property order', async () => {
    const loader = vi.fn(async () => ({ data: [], error: null }));
    const one = createReportDataCache(access(), ['center-b', 'center-a', 'center-a']);
    const two = createReportDataCache(access(), ['center-a', 'center-b']);
    await one.read('commerce', { start: new Date(NOW), recent: { limit: 10, product: 'p' } }, loader);
    await two.read('commerce', { recent: { product: 'p', limit: 10 }, start: new Date(NOW) }, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('isolates identical actor IDs and filters belonging to different databases', async () => {
    const loader = vi.fn(async () => ({ data: [], error: null }));
    await createReportDataCache(access(), null).read('commerce', {}, loader);
    state.source = 'https://report-b.supabase.co';
    await createReportDataCache(access(), null).read('commerce', {}, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('isolates actors, permission maps, owner status, and profile authorization flags', async () => {
    const loader = vi.fn(async () => ({ data: [], error: null }));
    const variants: Array<(current: CurrentAdminAccess) => void> = [
      () => undefined,
      (current) => { current.profile.id = 'actor-b'; current.user.id = 'actor-b'; },
      (current) => { current.access.reports_profitability = { canView: false, canEdit: false }; },
      (current) => { current.isOwner = true; },
      (current) => { current.isSuperadmin = true; },
      (current) => { current.profile.is_superadmin = true; },
      (current) => { current.profile.is_admin = false; },
      (current) => { current.profile.is_active = false; },
      (current) => { current.profile.center_id = 'center-b'; },
    ];
    // Callers still must enforce authorization before constructing this helper;
    // these inputs only test that old identities cannot collide with new ones.
    for (const change of variants) {
      const current = access();
      change(current);
      await createReportDataCache(current, ['center-a']).read('commerce', {}, loader);
    }
    expect(loader).toHaveBeenCalledTimes(variants.length);
  });

  it('isolates unrestricted, empty, and different authorized center scopes', async () => {
    const loader = vi.fn(async () => ({ data: [], error: null }));
    for (const scope of [null, [], ['center-a'], ['center-b']]) {
      await createReportDataCache(access(), scope).read('commerce', {}, loader);
    }
    expect(loader).toHaveBeenCalledTimes(4);
  });

  it('isolates lifetime, comparison periods, recent filters, and query identities', async () => {
    const cache = createReportDataCache(access(), null);
    const loader = vi.fn(async () => ({ data: [], error: null }));
    const filters = [
      { mode: 'lifetime' },
      { mode: 'period', start: '2026-09-01', end: '2026-11-01' },
      { mode: 'period', start: '2026-08-01', end: '2026-11-01' },
      { mode: 'period', start: '2026-09-01', end: '2026-12-01' },
      { mode: 'recent', limit: 10 },
      { mode: 'recent', limit: 10, product: 'product-a' },
      { mode: 'recent', limit: 10, center: 'center-a' },
      { mode: 'recent', limit: 5 },
    ];
    for (const filter of filters) await cache.read('commerce', filter, loader);
    await cache.read('products', filters[0], loader);
    expect(loader).toHaveBeenCalledTimes(filters.length + 1);
  });

  it('isolates production fallback products from each other and all historical runs', async () => {
    const cache = createReportDataCache(access(), null);
    const loader = vi.fn(async () => ({ data: [], error: null }));
    for (const products of [null, [], ['product-a'], ['product-b'], ['product-a', 'product-b']]) {
      await cache.read('production_runs', { products }, loader);
    }
    expect(loader).toHaveBeenCalledTimes(5);
  });

  it('distinguishes null, absent, empty, and typed filter values', async () => {
    const cache = createReportDataCache(access(), null);
    const loader = vi.fn(async () => ({ data: [], error: null }));
    for (const filter of [null, undefined, {}, [], { id: null }, { id: undefined }, { id: '' }, { id: 1 }, { id: '1' }]) {
      await cache.read('commerce', filter, loader);
    }
    expect(loader).toHaveBeenCalledTimes(9);
  });

  it('blocks for fresh data after 30 seconds without duplicate reads or accumulating keys', async () => {
    const cache = createReportDataCache(access(), null);
    const loader = vi.fn().mockResolvedValueOnce({ data: ['old'], error: null }).mockResolvedValueOnce({ data: ['new'], error: null });
    await cache.read('commerce', {}, loader);
    vi.setSystemTime(NOW + REPORT_DATA_CACHE_WINDOW_MS - 1);
    expect(await cache.read('commerce', {}, loader)).toEqual({ data: ['old'], error: null });
    vi.setSystemTime(NOW + REPORT_DATA_CACHE_WINDOW_MS);
    expect(await cache.read('commerce', {}, loader)).toEqual({ data: ['new'], error: null });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.stats).toEqual({ hits: 1, misses: 2 });
    expect(state.entries.size).toBe(1);
    expect(await cache.read('commerce', {}, loader)).toEqual({ data: ['new'], error: null });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('measures freshness from query start even when Next still considers the entry fresh', async () => {
    const cache = createReportDataCache(access(), null);
    const loader = vi.fn().mockImplementationOnce(async () => {
      vi.setSystemTime(NOW + 10_000);
      return { data: ['old'], error: null };
    }).mockResolvedValue({ data: ['new'], error: null });
    await cache.read('commerce', {}, loader);

    // Stored only 20s ago, but its underlying data read started 30s ago.
    vi.setSystemTime(NOW + REPORT_DATA_CACHE_WINDOW_MS);
    expect(await cache.read('commerce', {}, loader)).toEqual({ data: ['new'], error: null });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(state.entries.size).toBe(1);
  });

  it('returns query errors unchanged without caching partial results', async () => {
    const cache = createReportDataCache(access(), null);
    const failures = [
      { data: [], error: { message: 'products failed' } },
      { orders: { data: [], error: { message: 'orders failed' } }, orderItems: { data: [], error: null } },
      { orders: { data: [{ id: 'partial' }], error: null }, orderItems: { data: [], error: { message: 'items failed' } } },
    ];
    for (const failure of failures) {
      const loader = vi.fn(async () => failure);
      expect(await cache.read('commerce', {}, loader)).toBe(failure);
      expect(await cache.read('commerce', {}, loader)).toBe(failure);
      expect(loader).toHaveBeenCalledTimes(2);
    }
    expect(state.entries.size).toBe(0);
  });

  it('preserves thrown failures despite Next swallowing background revalidation errors', async () => {
    const cache = createReportDataCache(access(), null);
    const failure = new Error('database unavailable');
    const loader = vi.fn().mockResolvedValueOnce({ data: ['old'], error: null }).mockRejectedValue(failure);
    await cache.read('commerce', {}, loader);
    vi.setSystemTime(NOW + REPORT_DATA_CACHE_WINDOW_MS);
    await expect(cache.read('commerce', {}, loader)).rejects.toBe(failure);
    await expect(cache.read('commerce', {}, loader)).rejects.toBe(failure);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('returns resolved query errors from foreground revalidation instead of an expired value', async () => {
    const cache = createReportDataCache(access(), null);
    const failure = { data: [], error: { message: 'database unavailable' } };
    const loader = vi.fn().mockResolvedValueOnce({ data: ['old'], error: null }).mockResolvedValue(failure);
    await cache.read('commerce', {}, loader);
    vi.setSystemTime(NOW + REPORT_DATA_CACHE_WINDOW_MS);
    expect(await cache.read('commerce', {}, loader)).toBe(failure);
    expect(await cache.read('commerce', {}, loader)).toBe(failure);
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('does not mistake an error-named data column for a query failure', async () => {
    const cache = createReportDataCache(access(), null);
    const loader = vi.fn(async () => ({ data: [{ error: 'a stored business value' }], error: null }));
    await cache.read('commerce', {}, loader);
    await cache.read('commerce', {}, loader);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('misses after mutation generation changes, including an older in-flight read', async () => {
    const cache = createReportDataCache(access(), null);
    let complete: (result: { data: string[]; error: null }) => void = () => undefined;
    const oldRead = cache.read('commerce', {}, () => new Promise((resolve) => { complete = resolve; }));
    state.generation += 1;
    complete({ data: ['old'], error: null });
    await oldRead;

    const fresh = vi.fn(async () => ({ data: ['new'], error: null }));
    expect(await cache.read('commerce', {}, fresh)).toEqual({ data: ['new'], error: null });
    expect(await cache.read('commerce', {}, fresh)).toEqual({ data: ['new'], error: null });
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});

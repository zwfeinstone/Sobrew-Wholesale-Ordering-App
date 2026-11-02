import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));

import { getReportCacheGeneration, invalidateReportData, REPORT_DATA_CACHE_TAG } from './report-cache-invalidation';

describe('report data invalidation', () => {
  beforeEach(() => { mocks.revalidateTag.mockReset(); });

  it('expires each refill after consecutive mutations, even if a cache handler retains an older tag timestamp', () => {
    const cache = new Map<number, string>();
    const load = vi.fn(() => 'original');
    const read = () => {
      const generation = getReportCacheGeneration();
      if (!cache.has(generation)) cache.set(generation, load());
      return cache.get(generation);
    };

    expect(read()).toBe('original');
    expect(read()).toBe('original');
    load.mockReturnValue('first change');
    invalidateReportData();
    expect(read()).toBe('first change');
    load.mockReturnValue('second change');
    invalidateReportData();
    expect(read()).toBe('second change');
    expect(read()).toBe('second change');
    expect(load).toHaveBeenCalledTimes(3);
    expect(mocks.revalidateTag.mock.calls).toEqual([[REPORT_DATA_CACHE_TAG], [REPORT_DATA_CACHE_TAG]]);
  });

  it('preserves the generation across a module reload', async () => {
    invalidateReportData();
    const generation = getReportCacheGeneration();
    vi.resetModules();
    const reloaded = await import('./report-cache-invalidation');
    expect(reloaded.getReportCacheGeneration()).toBe(generation);
    reloaded.invalidateReportData();
    expect(getReportCacheGeneration()).toBe(generation + 1);
  });

  it('expires local data and logs no error details when distributed invalidation fails', () => {
    const error = new Error('secret database request detail');
    mocks.revalidateTag.mockImplementation(() => { throw error; });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const generation = getReportCacheGeneration();

    expect(() => invalidateReportData()).not.toThrow();
    expect(getReportCacheGeneration()).toBe(generation + 1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain(error.message);
    log.mockRestore();
  });
});

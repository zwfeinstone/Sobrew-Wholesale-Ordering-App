import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authorize: vi.fn(), tag: vi.fn(), path: vi.fn() }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.authorize }));
vi.mock('next/cache', () => ({ revalidateTag: state.tag, revalidatePath: state.path }));

import { refreshReportData } from '@/app/admin/reports/actions';
import { getReportCacheGeneration, REPORT_DATA_CACHE_TAG } from '@/lib/report-cache-invalidation';

beforeEach(() => {
  state.authorize.mockReset().mockResolvedValue({});
  state.tag.mockReset();
  state.path.mockReset();
});

describe('report refresh action authorization', () => {
  it('waits for current authorization before expiring cached data and refreshing the report route', async () => {
    let authorize!: () => void;
    state.authorize.mockReturnValue(new Promise<void>((resolve) => { authorize = resolve; }));
    const generation = getReportCacheGeneration();
    const refresh = refreshReportData();
    await Promise.resolve();
    expect(state.tag).not.toHaveBeenCalled();
    expect(state.path).not.toHaveBeenCalled();
    expect(getReportCacheGeneration()).toBe(generation);

    authorize();
    await refresh;
    expect(state.authorize).toHaveBeenCalledWith('reports');
    expect(state.tag).toHaveBeenCalledWith(REPORT_DATA_CACHE_TAG);
    expect(state.path).toHaveBeenCalledWith('/admin/reports');
    expect(getReportCacheGeneration()).toBe(generation + 1);
  });

  it('enforces a permission revocation on a later refresh without reusing prior authorization', async () => {
    await refreshReportData();
    const generation = getReportCacheGeneration();
    state.tag.mockClear();
    state.path.mockClear();
    state.authorize.mockRejectedValue(new Error('Reports access revoked'));

    await expect(refreshReportData()).rejects.toThrow('Reports access revoked');
    expect(state.authorize).toHaveBeenCalledTimes(2);
    expect(state.tag).not.toHaveBeenCalled();
    expect(state.path).not.toHaveBeenCalled();
    expect(getReportCacheGeneration()).toBe(generation);
  });
});

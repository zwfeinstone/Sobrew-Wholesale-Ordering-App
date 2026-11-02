import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAdminAccess } from '@/lib/admin-permissions';
import type { Database } from '@/lib/supabase/schema';
import { supabaseReadStub } from '../tests/support/supabase-read-stub';

const state = vi.hoisted(() => ({
  authorize: vi.fn(), canView: vi.fn(), createClient: vi.fn(), scope: vi.fn(), commerce: vi.fn(),
  cache: new Map<string, Promise<unknown>>(),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.authorize, adminCanView: state.canView }));
vi.mock('@/lib/admin-center-scope', () => ({ getSalesScopedCenterIdsForAdmin: state.scope }));
vi.mock('@/lib/supabase/server', () => ({ createClient: state.createClient }));
vi.mock('@/lib/admin-report-commerce', () => ({ loadReportCommerce: state.commerce }));
vi.mock('next/cache', () => ({
  unstable_cache: (load: () => Promise<unknown>, keyParts: string[]) => async () => {
    const key = JSON.stringify(keyParts);
    let result = state.cache.get(key);
    if (!result) {
      result = Promise.resolve().then(load);
      state.cache.set(key, result);
      result.catch(() => state.cache.delete(key));
    }
    return structuredClone(await result);
  },
  revalidateTag: vi.fn(),
}));

import { createReportDataCache } from '@/lib/admin-report-cache';
import { loadReportProductionRuns, preloadAdminReport, reportPreloadCommerceOptions } from '@/lib/admin-report-preload';
import { addDays, parseDateInput } from '@/lib/reporting';
import { buildBaselineRanges } from '@/lib/profitability-reporting';

const authorized = (id = 'admin-a') => ({
  user: { id }, profile: { id, is_admin: true, is_active: true, is_superadmin: false, center_id: null },
  access: { reports: { canView: true, canEdit: false }, reports_profitability: { canView: true, canEdit: false } },
  isOwner: false, isSuperadmin: false, centerScope: ['center-a'], firstAllowedHref: '/admin/reports',
} as unknown as CurrentAdminAccess);
const commerceResult = { orders: { data: [{ id: 'order-a' }], error: null }, orderItems: { data: [], error: null } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T18:00:00Z'));
  vi.resetAllMocks();
  state.cache.clear();
  state.authorize.mockResolvedValue(authorized());
  state.canView.mockReturnValue(true);
  state.scope.mockResolvedValue(['center-a']);
  state.createClient.mockResolvedValue(supabaseReadStub().client);
  state.commerce.mockResolvedValue(commerceResult);
});
afterEach(() => vi.useRealTimers());

describe('authorized report data preloading', () => {
  it('warms the exact commerce and production entries reused by a report visit', async () => {
    const stub = supabaseReadStub({ tables: { production_runs: [{ id: 'run-a', product_id: 'product-a' }] } });
    state.createClient.mockResolvedValue(stub.client);
    await expect(preloadAdminReport('/admin/reports?report=overview&month=2026-10')).resolves.toBe('loaded');
    await expect(preloadAdminReport('/admin/reports?report=centers&month=2026-10')).resolves.toBe('loaded');
    const rangeStart = parseDateInput('2026-10-01')!;
    const rangeEndExclusive = addDays(parseDateInput('2026-10-31')!, 1);
    const baseline = buildBaselineRanges(rangeStart, rangeEndExclusive);
    const pageCache = createReportDataCache(authorized(), ['center-a']);
    const unexpectedRead = vi.fn(async () => { throw new Error('Report visit should reuse preloaded data'); });
    await expect(pageCache.read('commerce', {
      shippedRange: { start: new Date(Math.min(baseline.previousStart.getTime(), baseline.trailingStart.getTime())), endExclusive: rangeEndExclusive },
      recentOrders: undefined, selectedSalesRepId: '',
    }, unexpectedRead)).resolves.toEqual(commerceResult);
    await expect(pageCache.read('production_runs', { productIds: null }, unexpectedRead))
      .resolves.toMatchObject({ data: [{ id: 'run-a' }], error: null });
    expect(unexpectedRead).not.toHaveBeenCalled();
    expect(state.commerce).toHaveBeenCalledOnce();
    expect(stub.reads.filter((read) => read.table === 'production_runs')).toHaveLength(2);
    expect(state.authorize).toHaveBeenCalledTimes(2);
    expect(state.scope).toHaveBeenCalledTimes(2);
  });

  it('uses only ten recent orders and leaves historical fallback decisions to the actual visit', async () => {
    const stub = supabaseReadStub();
    state.createClient.mockResolvedValue(stub.client);
    await preloadAdminReport('/admin/reports?report=recent_order_gpm');
    expect(state.commerce).toHaveBeenCalledWith(stub.client, {
      centerScope: ['center-a'], shippedRange: undefined, recentOrders: { limit: 10 },
    });
    expect(stub.reads).toEqual([]);
  });

  it('separates actors, freshly resolved scopes, and date windows', async () => {
    await preloadAdminReport('/admin/reports?month=2026-10');
    await preloadAdminReport('/admin/reports?month=2026-09');
    state.scope.mockResolvedValue(['center-b']);
    await preloadAdminReport('/admin/reports?month=2026-10');
    state.authorize.mockResolvedValue(authorized('admin-b'));
    await preloadAdminReport('/admin/reports?month=2026-10');
    expect(state.commerce).toHaveBeenCalledTimes(4);
    expect(state.scope).toHaveBeenLastCalledWith({ current: authorized('admin-b'), selectedSalesProfileId: '', supabase: await state.createClient.mock.results.at(-1)!.value });
  });

  it('enforces newly revoked profitability permissions before clients, scope, or cache reads', async () => {
    await preloadAdminReport('/admin/reports');
    state.createClient.mockClear();
    state.scope.mockClear();
    state.commerce.mockClear();
    state.canView.mockReturnValue(false);
    await expect(preloadAdminReport('/admin/reports')).resolves.toBe('forbidden');
    expect(state.authorize).toHaveBeenLastCalledWith('reports');
    expect(state.canView).toHaveBeenLastCalledWith(authorized().access, 'reports_profitability');
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.scope).not.toHaveBeenCalled();
    expect(state.commerce).not.toHaveBeenCalled();
  });

  it('does not start query work after an authentication or reports-access failure', async () => {
    const error = new Error('access denied');
    state.authorize.mockRejectedValue(error);
    await expect(preloadAdminReport('/admin/reports')).rejects.toBe(error);
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.commerce).not.toHaveBeenCalled();
  });

  it('does no speculative work for a filtered or expensive destination', async () => {
    for (const href of ['/admin/reports?center=center-a', '/admin/reports?report=labor_paid_gpm']) {
      await expect(preloadAdminReport(href)).resolves.toBe('unsupported');
    }
    expect(state.authorize).not.toHaveBeenCalled();
    expect(state.commerce).not.toHaveBeenCalled();
  });

  it('never caches a failed commerce read and allows the next attempt to recover', async () => {
    state.commerce.mockResolvedValueOnce({ orders: { data: [], error: { message: 'Private database detail' } }, orderItems: { data: [], error: null } });
    await expect(preloadAdminReport('/admin/reports?report=recent_order_gpm')).rejects.toThrow('Report preload could not complete.');
    await expect(preloadAdminReport('/admin/reports?report=recent_order_gpm')).resolves.toBe('loaded');
    expect(state.commerce).toHaveBeenCalledTimes(2);
  });

  it('fails the optional preload if production history fails', async () => {
    state.createClient.mockResolvedValue(supabaseReadStub({ fail: () => 'production unavailable' }).client);
    await expect(preloadAdminReport('/admin/reports')).rejects.toThrow('Report preload could not complete.');
  });
});

describe('report preload windows and shared production loader', () => {
  it('matches Central-time month boundaries across daylight saving time', () => {
    const options = reportPreloadCommerceOptions('/admin/reports?report=overview&month=2026-11', null);
    expect(options.shippedRange?.start.toISOString()).toBe('2026-09-06T05:00:00.000Z');
    expect(options.shippedRange?.endExclusive.toISOString()).toBe('2026-12-01T06:00:00.000Z');
  });

  it('preserves an explicit range and the preceding comparison period when it exceeds eight weeks', () => {
    const options = reportPreloadCommerceOptions('/admin/reports?report=centers&rangeStart=2026-01-01&rangeEnd=2026-03-31', null);
    const rangeStart = parseDateInput('2026-01-01')!;
    const rangeEndExclusive = addDays(parseDateInput('2026-03-31')!, 1);
    const baseline = buildBaselineRanges(rangeStart, rangeEndExclusive);
    expect(options.shippedRange).toEqual({ start: baseline.previousStart, endExclusive: rangeEndExclusive });
  });

  it('uses the same default month end as the page for a backwards end date', () => {
    const options = reportPreloadCommerceOptions('/admin/reports?month=2026-10&rangeStart=2026-10-20&rangeEnd=2026-10-01', null);
    expect(options.shippedRange?.endExclusive.toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });

  it('does not truncate short production pages and retains every historical cost field', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ id: `run-${index}`, product_id: 'product-a', produced_at: '2020-01-01T00:00:00Z' }));
    const stub = supabaseReadStub({ tables: { production_runs: rows }, maxRows: 2 });
    const result = await loadReportProductionRuns(stub.client as unknown as SupabaseClient<Database>, ['product-a']);
    expect(result.data).toEqual(rows);
    expect(stub.reads.map((read) => read.from)).toEqual([0, 2, 4, 5]);
    for (const read of stub.reads) {
      expect(read.filters).toEqual([{ operator: 'in', column: 'product_id', value: ['product-a'] }]);
      expect(read.orders).toEqual([{ column: 'produced_at', ascending: false }, { column: 'id', ascending: undefined }]);
      for (const column of ['quantity_voided', 'status', 'estimated_unit_cost_cents', 'actual_unit_cost_cents', 'actual_labor_cost_cents', 'fixed_cost_cents', 'fixed_tape_cost_cents', 'fixed_shipping_label_cost_cents', 'fixed_branding_label_cost_cents', 'fixed_other_cost_cents']) {
        expect(read.columns.split(',')).toContain(column);
      }
    }
  });
});

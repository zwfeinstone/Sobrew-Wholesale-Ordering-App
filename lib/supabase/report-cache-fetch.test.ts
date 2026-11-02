import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));

import { getReportCacheGeneration, REPORT_DATA_CACHE_TAG } from '@/lib/report-cache-invalidation';
import { createReportInvalidatingFetch } from './report-cache-fetch';

const SUPABASE_URL = 'https://report-test.supabase.co';

describe('report-invalidating Supabase fetch', () => {
  beforeEach(() => { mocks.revalidateTag.mockReset(); });

  it.each([
    ['POST', 'orders'],
    ['PATCH', 'order_items'],
    ['PUT', 'inventory_lots'],
    ['DELETE', 'production_runs'],
    ['POST', 'admin_time_entries'],
    ['POST', 'rpc/place_portal_order'],
    ['POST', 'rpc/record_inventory_production_run'],
    ['POST', 'rpc/settle_deferred_hourly_pay'],
    ['POST', 'rpc/generate_recurring_order'],
    ['POST', 'rpc/import_shopify_order'],
  ])('invalidates a successful %s to %s and returns its original response', async (method, resource) => {
    const response = new Response(null, { status: 204 });
    const baseFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const fetch = createReportInvalidatingFetch(baseFetch, SUPABASE_URL);
    const input = `${SUPABASE_URL}/rest/v1/${resource}?id=eq.order-id`;
    const init = { method, headers: { Authorization: 'Bearer private-token' }, body: '{}' };
    const generation = getReportCacheGeneration();

    expect(await fetch(input, init)).toBe(response);
    expect(baseFetch).toHaveBeenCalledExactlyOnceWith(input, init);
    expect(mocks.revalidateTag).toHaveBeenCalledExactlyOnceWith(REPORT_DATA_CACHE_TAG);
    expect(getReportCacheGeneration()).toBe(generation + 1);
    expect(response.bodyUsed).toBe(false);
  });

  it.each([
    ['GET', `${SUPABASE_URL}/rest/v1/orders`],
    ['HEAD', `${SUPABASE_URL}/rest/v1/orders`],
    ['POST', `${SUPABASE_URL}/rest/v1/rpc/admin_prospecting_report_v1`],
    ['POST', `${SUPABASE_URL}/rest/v1/rpc/read_prospecting_receipt_v2`],
    ['POST', `${SUPABASE_URL}/rest/v1/rpc/touch_profile_last_seen`],
    ['POST', `${SUPABASE_URL}/auth/v1/token`],
    ['POST', `${SUPABASE_URL}/storage/v1/object/report-images`],
    ['POST', 'https://unrelated.example/rest/v1/orders'],
    ['POST', `${SUPABASE_URL}/rest/v1/`],
  ])('does not invalidate report data for %s %s', async (method, input) => {
    const baseFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const fetch = createReportInvalidatingFetch(baseFetch, SUPABASE_URL);
    const generation = getReportCacheGeneration();

    await fetch(input, { method });
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(getReportCacheGeneration()).toBe(generation);
  });

  it.each([400, 401, 403, 409, 500])('does not invalidate when a mutation returns HTTP %s', async (status) => {
    const response = new Response('database failure', { status });
    const fetch = createReportInvalidatingFetch(vi.fn<typeof fetch>().mockResolvedValue(response), SUPABASE_URL);
    const generation = getReportCacheGeneration();
    expect(await fetch(`${SUPABASE_URL}/rest/v1/orders`, { method: 'POST' })).toBe(response);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
    expect(getReportCacheGeneration()).toBe(generation);
  });

  it('preserves network errors and does not invalidate', async () => {
    const error = new Error('network failure');
    const fetch = createReportInvalidatingFetch(vi.fn<typeof fetch>().mockRejectedValue(error), SUPABASE_URL);
    await expect(fetch(`${SUPABASE_URL}/rest/v1/orders`, { method: 'POST' })).rejects.toBe(error);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it('uses a Request method unless overridden by init and leaves its body untouched', async () => {
    const baseFetch = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 204 }));
    const fetch = createReportInvalidatingFetch(baseFetch, SUPABASE_URL);
    const writeRequest = new Request(`${SUPABASE_URL}/rest/v1/orders`, { method: 'PATCH', body: '{}' });
    await fetch(writeRequest);
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(1);
    expect(writeRequest.bodyUsed).toBe(false);

    await fetch(writeRequest, { method: 'GET' });
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(1);
    await fetch(new Request(`${SUPABASE_URL}/rest/v1/orders`), { method: 'delete' });
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(2);
    await fetch(new URL(`${SUPABASE_URL}/rest/v1/orders`), { method: 'POST' });
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(3);
  });

  it('preserves committed write success when invalidation fails and bumps the local generation', async () => {
    mocks.revalidateTag.mockImplementation(() => { throw new Error('Next context missing'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = new Response('{"id":"saved"}', { status: 201 });
    const fetch = createReportInvalidatingFetch(vi.fn<typeof fetch>().mockResolvedValue(response), SUPABASE_URL);
    const generation = getReportCacheGeneration();
    expect(await fetch(`${SUPABASE_URL}/rest/v1/orders`, { method: 'POST' })).toBe(response);
    expect(await response.json()).toEqual({ id: 'saved' });
    expect(getReportCacheGeneration()).toBe(generation + 1);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});

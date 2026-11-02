import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ revalidateTag: vi.fn(), cookies: { getAll: () => [], set: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));
vi.mock('next/headers', () => ({ cookies: async () => mocks.cookies }));
vi.mock('@/lib/env', () => ({ env: {
  supabaseUrl: 'https://report-test.supabase.co',
  supabaseAnon: 'test-anon-key',
  serviceRole: 'test-service-role-key',
} }));

import { createClient } from './server';
import { createRouteClient } from './route';
import { getSupabaseAdmin } from './admin';
import { REPORT_DATA_CACHE_TAG } from '@/lib/report-cache-invalidation';

describe('Supabase report invalidation client wiring', () => {
  const baseFetch = vi.fn<typeof fetch>();
  beforeEach(() => {
    mocks.revalidateTag.mockReset();
    baseFetch.mockReset().mockImplementation(async (_input, init) => init?.method === 'GET'
      ? Response.json([]) : new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', baseFetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['authenticated server', () => createClient()],
    ['service role', () => getSupabaseAdmin()],
    ['route', () => createRouteClient(new NextRequest('https://portal.test/checkout'), NextResponse.next())],
  ] as const)('%s clients invalidate both consecutive mutations but never reads', async (_name, makeClient) => {
    const client = await makeClient();
    const read = await client.from('orders').select('id');
    expect(read.error).toBeNull();
    expect(mocks.revalidateTag).not.toHaveBeenCalled();

    const firstWrite = await client.from('orders').update({ status: 'Processing' }).eq('id', 'test-order');
    expect(firstWrite.error).toBeNull();
    const secondWrite = await client.from('orders').update({ status: 'Shipped' }).eq('id', 'test-order');
    expect(secondWrite.error).toBeNull();
    expect(mocks.revalidateTag.mock.calls).toEqual([[REPORT_DATA_CACHE_TAG], [REPORT_DATA_CACHE_TAG]]);
  });

  it('the singleton service client resolves global fetch at call time', async () => {
    const client = getSupabaseAdmin();
    await client.from('orders').select('id');
    const laterFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json([]));
    vi.stubGlobal('fetch', laterFetch);
    const result = await client.from('orders').select('id');
    expect(result.error).toBeNull();
    expect(laterFetch).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const preload = vi.hoisted(() => vi.fn());
vi.mock('@/lib/admin-report-preload', () => ({ preloadAdminReport: preload }));
import { GET } from '@/app/api/admin/report-preload/route';

function request(href = '/admin/reports?report=centers') {
  const url = new URL('https://portal.test/api/admin/report-preload');
  url.searchParams.set('href', href);
  return new NextRequest(url);
}

beforeEach(() => { preload.mockReset(); });

describe('optional report preload route', () => {
  it.each(['loaded', 'unsupported'])('returns no financial data or browser cache when %s', async (result) => {
    preload.mockResolvedValue(result);
    const response = await GET(request());
    expect(preload).toHaveBeenCalledWith('/admin/reports?report=centers');
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('');
  });

  it('returns a non-redirect forbidden response for denied profitability access', async () => {
    preload.mockResolvedValue('forbidden');
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get('Location')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it.each(['/login', '/admin/access-denied?section=reports'])('does not follow authorization redirect to %s', async (destination) => {
    preload.mockRejectedValue(Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${destination};307;` }));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Location')).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('returns an empty failure that the optional client preload can ignore', async () => {
    preload.mockRejectedValue(new Error('Sensitive source details'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('');
  });
});

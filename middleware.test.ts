import {
  AuthApiError,
  AuthInvalidTokenResponseError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ssrMocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getClaims: vi.fn(),
  options: undefined as
    | {
        global?: { fetch?: typeof fetch };
        cookies: {
          getAll(): Array<{ name: string; value: string }>;
          setAll(
            cookies: Array<{
              name: string;
              value: string;
              options: { httpOnly?: boolean; maxAge?: number; path?: string; sameSite?: 'lax' | 'strict' | 'none' };
            }>
          ): void;
        };
      }
    | undefined,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: ssrMocks.createServerClient,
}));

import { AUTH_VERIFICATION_TIMEOUT_MS, middleware } from './middleware';

function protectedRequest(path = '/portal/orders?status=open', headers: Record<string, string> = {}) {
  return new NextRequest(`https://app.sobrew.com${path}`, {
    headers: {
      cookie: 'sb-project-auth-token=existing-session',
      'x-vercel-id': 'iad1::middleware-test',
      ...headers,
    },
  });
}

function setRotatedCookie() {
  ssrMocks.options?.cookies.setAll([
    {
      name: 'sb-project-auth-token',
      value: 'rotated-session',
      options: { httpOnly: true, path: '/', sameSite: 'lax' },
    },
  ]);
}

describe('protected-route middleware', () => {
  beforeEach(() => {
    ssrMocks.getClaims.mockReset();
    ssrMocks.createServerClient.mockReset();
    ssrMocks.options = undefined;
    ssrMocks.createServerClient.mockImplementation((_url, _key, options) => {
      ssrMocks.options = options;
      return { auth: { getClaims: ssrMocks.getClaims } };
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('continues an authenticated request and sends rotated cookies without caching', async () => {
    ssrMocks.getClaims.mockImplementation(async () => {
      setRotatedCookie();
      return { data: { claims: { sub: 'user-123' } }, error: null };
    });

    const response = await middleware(protectedRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(ssrMocks.options?.global?.fetch).toBeTypeOf('function');
    expect(response.cookies.get('sb-project-auth-token')).toMatchObject({
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      value: 'rotated-session',
    });
  });

  it('redirects a genuinely missing session to login', async () => {
    ssrMocks.getClaims.mockResolvedValue({ data: null, error: new AuthSessionMissingError() });

    const response = await middleware(protectedRequest('/admin'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.sobrew.com/login');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(console.error).not.toHaveBeenCalled();
  });

  it('keeps non-retryable invalid-session failures on the login path', async () => {
    ssrMocks.getClaims.mockResolvedValue({
      data: null,
      error: new AuthApiError('Invalid JWT signature', 401, 'bad_jwt'),
    });

    const response = await middleware(protectedRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.sobrew.com/login');
    expect(console.error).toHaveBeenCalledWith(
      'Middleware auth claims verification failed',
      expect.objectContaining({ code: 'bad_jwt' })
    );
  });

  it('does not mistake a malformed token response for a retryable network outage', async () => {
    ssrMocks.getClaims.mockResolvedValue({
      data: null,
      error: new AuthInvalidTokenResponseError(),
    });

    const response = await middleware(protectedRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.sobrew.com/login');
  });

  it('returns a retryable 503 for a transient auth failure without clearing the session', async () => {
    ssrMocks.getClaims.mockResolvedValue({
      data: null,
      error: new AuthRetryableFetchError('temporary gateway failure', 503),
    });

    const response = await middleware(protectedRequest());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('retry-after')).toBe('5');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-sobrew-auth-reference')).toMatch(/^[A-F0-9]{12}$/);
    expect(response.cookies.get('sb-project-auth-token')).toBeUndefined();
    expect(body).toContain("We couldn't verify your sign-in just now.");
    expect(body).not.toContain('temporary gateway failure');
    expect(console.error).toHaveBeenCalledWith(
      'Middleware auth verification unavailable',
      expect.objectContaining({
        event: 'middleware_auth_unavailable',
        pathname: '/portal/orders',
        reason: 'transient_error',
      })
    );
  });

  it('redirects a Next.js client navigation to the public recovery page', async () => {
    ssrMocks.getClaims.mockResolvedValue({
      data: null,
      error: new AuthRetryableFetchError('temporary gateway failure', 503),
    });

    const response = await middleware(
      protectedRequest('/portal/orders?status=open', {
        accept: 'text/x-component',
        rsc: '1',
      })
    );
    const location = new URL(response.headers.get('location')!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe('/auth-unavailable');
    expect(location.searchParams.get('next')).toBe('/portal/orders?status=open');
    expect(location.searchParams.get('ref')).toMatch(/^[A-F0-9]{12}$/);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it('returns before the deadline and preserves cookies staged before a stalled auth call', async () => {
    vi.useFakeTimers();
    ssrMocks.getClaims.mockImplementation(() => {
      setRotatedCookie();
      return new Promise(() => undefined);
    });

    let settled = false;
    const responsePromise = middleware(protectedRequest()).then((response) => {
      settled = true;
      return response;
    });

    await vi.advanceTimersByTimeAsync(AUTH_VERIFICATION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const response = await responsePromise;
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(response.cookies.get('sb-project-auth-token')).toMatchObject({
      httpOnly: true,
      value: 'rotated-session',
    });
    expect(console.error).toHaveBeenCalledWith(
      'Middleware auth verification unavailable',
      expect.objectContaining({ reason: 'deadline' })
    );
  });

  it('converts an unexpected auth exception into the controlled 503', async () => {
    ssrMocks.getClaims.mockImplementation(async () => {
      setRotatedCookie();
      throw new Error('socket reset with internal detail');
    });

    const response = await middleware(protectedRequest());
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.cookies.get('sb-project-auth-token')?.value).toBe('rotated-session');
    expect(body).not.toContain('socket reset');
    expect(console.error).toHaveBeenCalledWith(
      'Middleware auth verification unavailable',
      expect.objectContaining({ reason: 'unexpected_error' })
    );
  });
});

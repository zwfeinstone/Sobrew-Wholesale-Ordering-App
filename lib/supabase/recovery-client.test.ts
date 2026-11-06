import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
  transport: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.createServerClient }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('@/lib/env', () => ({ env: { supabaseUrl: 'https://project.supabase.co', supabaseAnon: 'test-public-key' } }));
vi.mock('./resilient-jwks-fetch', () => ({ resilientSupabaseFetch: mocks.transport }));

import { AuthDeadlineExceededError } from './auth-deadline';
import { RECOVERY_AUTH_TIMEOUT_MS, withRecoveryClient } from './recovery-client';

function configuredFetch(): typeof fetch {
  return mocks.createServerClient.mock.calls[0][2].global.fetch;
}

describe('recovery Auth transport', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    mocks.cookies.mockResolvedValue({ getAll: () => [], set: vi.fn() });
    mocks.createServerClient.mockReturnValue({});
  });
  afterEach(() => {
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('aborts a hanging mutation and returns before the platform timeout without retrying it', async () => {
    let signal: AbortSignal | null | undefined;
    mocks.transport.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    const operation = withRecoveryClient(async () => configuredFetch()('https://project.supabase.co/auth/v1/user', { method: 'PUT' }));
    const rejected = expect(operation).rejects.toBeInstanceOf(AuthDeadlineExceededError);
    await vi.advanceTimersByTimeAsync(RECOVERY_AUTH_TIMEOUT_MS);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(mocks.transport).toHaveBeenCalledTimes(1);
  });

  it('retains provider throttling responses so the request action can remain neutral', async () => {
    mocks.transport.mockResolvedValue(new Response(JSON.stringify({ code: 'over_email_send_rate_limit' }), {
      status: 429, headers: { 'Retry-After': '60' },
    }));
    const response = await withRecoveryClient(async () => configuredFetch()('https://project.supabase.co/auth/v1/recover', { method: 'POST' }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: 'over_email_send_rate_limit' });
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('cleans up the deadline when client initialization or an operation fails', async () => {
    mocks.createServerClient.mockImplementationOnce(() => { throw new Error('Initialization failed'); });
    await expect(withRecoveryClient(async () => undefined)).rejects.toThrow('Initialization failed');
    await expect(withRecoveryClient(async () => { throw new Error('Operation failed'); })).rejects.toThrow('Operation failed');
  });

  it('uses the callback response cookie adapter to persist the verified session', async () => {
    const adapter = { getAll: vi.fn(() => []), setAll: vi.fn() };
    const sessionCookie = { name: 'sb-test-auth-token', value: 'test-session', options: { path: '/' } };
    await withRecoveryClient(async () => {
      mocks.createServerClient.mock.calls[0][2].cookies.setAll([sessionCookie]);
    }, adapter);
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(adapter.setAll).toHaveBeenCalledExactlyOnceWith([sessionCookie]);
  });

  it('blocks late SDK cookie cleanup after a timeout so it cannot overwrite a restored verifier', async () => {
    const adapter = { getAll: vi.fn(() => []), setAll: vi.fn() };
    const operation = withRecoveryClient(async () => new Promise<never>(() => undefined), adapter);
    const rejected = expect(operation).rejects.toBeInstanceOf(AuthDeadlineExceededError);
    await vi.advanceTimersByTimeAsync(RECOVERY_AUTH_TIMEOUT_MS);
    await rejected;
    mocks.createServerClient.mock.calls[0][2].cookies.setAll([
      { name: 'sb-test-auth-token-code-verifier', value: '', options: { maxAge: 0 } },
    ]);
    expect(adapter.setAll).not.toHaveBeenCalled();
  });
});

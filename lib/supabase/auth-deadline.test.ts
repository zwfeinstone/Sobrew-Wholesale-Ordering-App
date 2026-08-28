import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthDeadlineExceededError, createAuthDeadline } from './auth-deadline';

describe('Supabase auth deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts the active auth fetch when the total deadline expires', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
            once: true,
          });
        });
      })
    );

    const deadline = createAuthDeadline(4_000);
    const operation = deadline.fetch('https://project.supabase.co/auth/v1/.well-known/jwks.json');
    const result = deadline.run(operation);
    const rejection = expect(result).rejects.toBeInstanceOf(AuthDeadlineExceededError);

    await vi.advanceTimersByTimeAsync(4_000);

    await rejection;
    expect(deadline.didTimeout()).toBe(true);
    expect(observedSignal?.aborted).toBe(true);
    expect(deadline.diagnostics()).toEqual({ phase: 'jwks', upstreamStatus: null });
    deadline.dispose();
  });

  it('normalizes non-standard gateway failures so auth-js treats them as retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gateway unavailable', { status: 525 })));
    const deadline = createAuthDeadline(4_000);

    const response = await deadline.fetch('https://project.supabase.co/auth/v1/token?grant_type=refresh_token');

    expect(response.status).toBe(503);
    expect(await response.text()).toBe('gateway unavailable');
    expect(deadline.diagnostics()).toEqual({ phase: 'token_refresh', upstreamStatus: 525 });
    deadline.dispose();
  });

  it('leaves genuine authentication responses unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid refresh token', { status: 401 })));
    const deadline = createAuthDeadline(4_000);

    const response = await deadline.fetch('https://project.supabase.co/auth/v1/token?grant_type=refresh_token');

    expect(response.status).toBe(401);
    expect(deadline.diagnostics()).toEqual({ phase: 'token_refresh', upstreamStatus: null });
    deadline.dispose();
  });
});

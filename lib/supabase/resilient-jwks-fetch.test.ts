import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createResilientJwksFetch,
  JWKS_CACHE_TTL_MS,
  JWKS_RETRY_COOLDOWN_MS,
  JWKS_STALE_IF_ERROR_MS,
} from './resilient-jwks-fetch';

const JWKS_URL = 'https://project.supabase.co/auth/v1/.well-known/jwks.json';
const VALID_JWKS = JSON.stringify({
  keys: [{
    alg: 'ES256',
    crv: 'P-256',
    key_ops: ['verify'],
    kid: 'rotation-key',
    kty: 'EC',
    use: 'sig',
    x: 'xAkGF9jvdxGGJ6Uah_F7HN8xGslyskvjWtn_lvkmq5o',
    y: '8kWUZ9HwJHdyeiJsBoDmtvbikADpPXuQ2x7drZzHXnE',
  }],
});

function jwksResponse(status = 200) {
  return new Response(status === 200 ? VALID_JWKS : 'unavailable', {
    headers: { 'Content-Type': status === 200 ? 'application/json' : 'text/plain' },
    status,
  });
}

describe('resilient JWKS fetch', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('coalesces concurrent cold-key discovery and gives every caller its own response body', async () => {
    let resolveFetch!: (response: Response) => void;
    const baseFetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const successLog = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const resilientFetch = createResilientJwksFetch({ fetch: baseFetch });

    const requests = Array.from({ length: 50 }, () => resilientFetch(JWKS_URL));
    await Promise.resolve();
    expect(baseFetch).toHaveBeenCalledTimes(1);
    resolveFetch(jwksResponse());

    const responses = await Promise.all(requests);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies).toHaveLength(50);
    expect(bodies.every((body) => body.keys[0].kid === 'rotation-key')).toBe(true);
    expect(successLog).toHaveBeenCalledWith(
      'Supabase JWKS refresh succeeded',
      { event: 'supabase_jwks_refresh_succeeded' }
    );
  });

  it('opens a cooldown after a transient failure and permits one recovery probe', async () => {
    let now = 1_000;
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(jwksResponse(503))
      .mockResolvedValueOnce(jwksResponse());
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const resilientFetch = createResilientJwksFetch({ fetch: baseFetch, now: () => now });

    expect((await resilientFetch(JWKS_URL)).status).toBe(503);
    expect((await resilientFetch(JWKS_URL)).status).toBe(503);
    expect(baseFetch).toHaveBeenCalledTimes(1);

    now += JWKS_RETRY_COOLDOWN_MS + 1;
    expect((await resilientFetch(JWKS_URL)).status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('uses last-known-good keys only within the bounded stale-on-error window', async () => {
    let now = 10_000;
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(jwksResponse())
      .mockImplementation(() => Promise.resolve(jwksResponse(503)));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const resilientFetch = createResilientJwksFetch({ fetch: baseFetch, now: () => now });

    expect((await resilientFetch(JWKS_URL)).status).toBe(200);
    now += JWKS_CACHE_TTL_MS + 1;
    expect((await resilientFetch(JWKS_URL)).status).toBe(200);

    now = 10_000 + JWKS_STALE_IF_ERROR_MS + JWKS_RETRY_COOLDOWN_MS + 2;
    expect((await resilientFetch(JWKS_URL)).status).toBe(503);
  });

  it('does not cache a successful HTTP response containing invalid or private key material', async () => {
    const invalidBody = JSON.stringify({
      keys: [{ alg: 'ES256', d: 'private', key_ops: ['verify'], kid: 'bad', kty: 'EC' }],
    });
    const baseFetch = vi.fn().mockResolvedValue(new Response(invalidBody, { status: 200 }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const resilientFetch = createResilientJwksFetch({ fetch: baseFetch });

    expect((await resilientFetch(JWKS_URL)).status).toBe(503);
    expect((await resilientFetch(JWKS_URL)).status).toBe(503);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('never serves stale keys after a non-transient client response', async () => {
    let now = 50_000;
    const baseFetch = vi.fn()
      .mockResolvedValueOnce(jwksResponse())
      .mockImplementation(() => Promise.resolve(new Response('not found', { status: 404 })));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const resilientFetch = createResilientJwksFetch({ fetch: baseFetch, now: () => now });

    expect((await resilientFetch(JWKS_URL)).status).toBe(200);
    now += JWKS_CACHE_TTL_MS + 1;
    expect((await resilientFetch(JWKS_URL)).status).toBe(404);
  });

  it('lets one caller abort without canceling the shared refresh for other waiters', async () => {
    let resolveFetch!: (response: Response) => void;
    const baseFetch = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    const resilientFetch = createResilientJwksFetch({ fetch: baseFetch });
    const controller = new AbortController();

    const canceled = resilientFetch(JWKS_URL, { signal: controller.signal });
    const surviving = resilientFetch(JWKS_URL);
    controller.abort();
    resolveFetch(jwksResponse());

    await expect(canceled).rejects.toMatchObject({ name: 'AbortError' });
    await expect(surviving).resolves.toMatchObject({ status: 200 });
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});

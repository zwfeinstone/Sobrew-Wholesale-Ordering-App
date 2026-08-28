export const JWKS_CACHE_TTL_MS = 10 * 60 * 1_000;
export const JWKS_STALE_IF_ERROR_MS = 60 * 60 * 1_000;
export const JWKS_REFRESH_TIMEOUT_MS = 2_000;
export const JWKS_RETRY_COOLDOWN_MS = 30_000;

type ResponseSnapshot = {
  body: Uint8Array;
  fetchedAt: number;
  headers: Array<[string, string]>;
  isValidJwks: boolean;
  status: number;
  statusText: string;
};

type JwksEntry = {
  inFlight: Promise<ResponseSnapshot> | null;
  lastGood: ResponseSnapshot | null;
  retryAt: number;
};

type ResilientJwksFetchOptions = {
  fetch?: typeof fetch;
  now?: () => number;
  refreshTimeoutMs?: number;
  retryCooldownMs?: number;
  staleIfErrorMs?: number;
  ttlMs?: number;
};

const TRANSIENT_STATUSES = new Set([408, 425, 429]);
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

function isTransientStatus(status: number) {
  return TRANSIENT_STATUSES.has(status) || status >= 500;
}

function requestUrl(input: RequestInfo | URL) {
  return input instanceof Request ? input.url : String(input);
}

function isJwksRequest(input: RequestInfo | URL) {
  try {
    return new URL(requestUrl(input)).pathname.endsWith('/auth/v1/.well-known/jwks.json');
  } catch {
    return false;
  }
}

function requestSignal(input: RequestInfo | URL, init?: RequestInit) {
  return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}

async function validPublicJwks(body: Uint8Array) {
  try {
    const value = JSON.parse(new TextDecoder().decode(body)) as { keys?: unknown };
    if (!Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > 10) return false;

    const kids = new Set<string>();
    for (const candidate of value.keys) {
      if (!candidate || typeof candidate !== 'object') return false;
      const key = candidate as Record<string, unknown>;
      if (key.alg !== 'ES256' && key.alg !== 'RS256') return false;
      if (key.kty !== 'EC' && key.kty !== 'RSA') return false;
      if ((key.alg === 'ES256') !== (key.kty === 'EC')) return false;
      if (typeof key.kid !== 'string' || !key.kid || kids.has(key.kid)) return false;
      if (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify')) return false;
      if (key.use !== undefined && key.use !== 'sig') return false;
      if (key.kty === 'EC' && (
        key.crv !== 'P-256' || typeof key.x !== 'string' || typeof key.y !== 'string'
      )) return false;
      if (key.kty === 'RSA' && (typeof key.n !== 'string' || typeof key.e !== 'string')) return false;
      if (PRIVATE_JWK_FIELDS.some((field) => field in key)) return false;

      const algorithm: EcKeyImportParams | RsaHashedImportParams = key.alg === 'ES256'
        ? { name: 'ECDSA', namedCurve: 'P-256' }
        : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
      await crypto.subtle.importKey('jwk', key as JsonWebKey, algorithm, false, ['verify']);
      kids.add(key.kid);
    }
    return true;
  } catch {
    return false;
  }
}

function snapshotResponse(snapshot: ResponseSnapshot, status = snapshot.status) {
  return new Response(snapshot.body.slice(), {
    headers: snapshot.headers,
    status,
    statusText: status === 503 ? 'Service Unavailable' : snapshot.statusText,
  });
}

function unavailableResponse() {
  return new Response(null, {
    headers: { 'Cache-Control': 'no-store' },
    status: 503,
    statusText: 'Service Unavailable',
  });
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal | null) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Adds single-flight, a short circuit cooldown, and bounded stale-on-error only
 * to JWKS discovery. All other Supabase traffic is passed through unchanged.
 * The shared refresh owns its timeout so one aborted request cannot cancel the
 * refresh for every concurrent waiter.
 */
export function createResilientJwksFetch(options: ResilientJwksFetchOptions = {}): typeof fetch {
  const entries = new Map<string, JwksEntry>();
  const now = options.now ?? Date.now;
  const refreshTimeoutMs = options.refreshTimeoutMs ?? JWKS_REFRESH_TIMEOUT_MS;
  const retryCooldownMs = options.retryCooldownMs ?? JWKS_RETRY_COOLDOWN_MS;
  const staleIfErrorMs = options.staleIfErrorMs ?? JWKS_STALE_IF_ERROR_MS;
  const ttlMs = options.ttlMs ?? JWKS_CACHE_TTL_MS;

  const baseFetch: typeof fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);

  return async (input, init) => {
    if (!isJwksRequest(input)) return baseFetch(input, init);

    const url = requestUrl(input);
    const entry = entries.get(url) ?? { inFlight: null, lastGood: null, retryAt: 0 };
    entries.set(url, entry);

    const currentTime = now();
    if (entry.lastGood && currentTime - entry.lastGood.fetchedAt <= ttlMs) {
      return snapshotResponse(entry.lastGood);
    }

    const canUseStale = Boolean(
      entry.lastGood && currentTime - entry.lastGood.fetchedAt <= staleIfErrorMs
    );
    if (entry.retryAt > currentTime) {
      return canUseStale && entry.lastGood ? snapshotResponse(entry.lastGood) : unavailableResponse();
    }

    if (!entry.inFlight) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), refreshTimeoutMs);
      const refresh = (async () => {
        try {
          const response = await baseFetch(input, { ...init, signal: controller.signal });
          const body = new Uint8Array(await response.arrayBuffer());
          const snapshot: ResponseSnapshot = {
            body,
            fetchedAt: now(),
            headers: Array.from(response.headers.entries()),
            isValidJwks: response.ok && await validPublicJwks(body),
            status: response.status,
            statusText: response.statusText,
          };

          if (snapshot.isValidJwks) {
            entry.lastGood = snapshot;
            entry.retryAt = 0;
            console.info('Supabase JWKS refresh succeeded', {
              event: 'supabase_jwks_refresh_succeeded',
            });
          } else if (response.ok || isTransientStatus(response.status)) {
            entry.retryAt = now() + retryCooldownMs;
            console.warn('Supabase JWKS refresh unavailable', {
              event: 'supabase_jwks_refresh_unavailable',
              reason: response.ok ? 'invalid_response' : 'transient_status',
              status: response.status,
            });
          }
          return snapshot;
        } catch (error) {
          entry.retryAt = now() + retryCooldownMs;
          console.warn('Supabase JWKS refresh unavailable', {
            event: 'supabase_jwks_refresh_unavailable',
            errorName: error instanceof Error ? error.name : undefined,
            reason: 'network_error',
          });
          throw error;
        } finally {
          clearTimeout(timer);
        }
      })();
      entry.inFlight = refresh;
      void refresh.then(
        () => {
          if (entry.inFlight === refresh) entry.inFlight = null;
        },
        () => {
          if (entry.inFlight === refresh) entry.inFlight = null;
        }
      );
    }

    try {
      const snapshot = await waitForCaller(entry.inFlight, requestSignal(input, init));
      if (snapshot.isValidJwks) {
        return snapshotResponse(snapshot);
      }
      const canFallbackFromResponse =
        isTransientStatus(snapshot.status) || (snapshot.status >= 200 && snapshot.status < 300);
      if (canFallbackFromResponse && canUseStale && entry.lastGood) {
        return snapshotResponse(entry.lastGood);
      }
      return canFallbackFromResponse
        ? snapshotResponse(snapshot, 503)
        : snapshotResponse(snapshot);
    } catch (error) {
      if (requestSignal(input, init)?.aborted) throw error;
      if (canUseStale && entry.lastGood) return snapshotResponse(entry.lastGood);
      throw error;
    }
  };
}

export const resilientSupabaseFetch = createResilientJwksFetch();

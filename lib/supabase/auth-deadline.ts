export type AuthNetworkPhase = 'local' | 'jwks' | 'token_refresh' | 'user' | 'other';

type AuthDeadlineDiagnostics = {
  phase: AuthNetworkPhase;
  upstreamStatus: number | null;
};

const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429]);

function isTransientHttpStatus(status: number) {
  return TRANSIENT_HTTP_STATUSES.has(status) || status >= 500;
}

function authNetworkPhase(input: RequestInfo | URL): AuthNetworkPhase {
  try {
    const value = input instanceof Request ? input.url : String(input);
    const pathname = new URL(value).pathname;

    if (pathname.endsWith('/.well-known/jwks.json')) return 'jwks';
    if (pathname.endsWith('/auth/v1/token')) return 'token_refresh';
    if (pathname.endsWith('/auth/v1/user')) return 'user';
    return 'other';
  } catch {
    return 'other';
  }
}

function composeAbortSignals(signals: Array<AbortSignal | null | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 1) {
    return { signal: activeSignals[0], cleanup: () => undefined };
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();

  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      activeSignals.forEach((signal) => signal.removeEventListener('abort', onAbort));
    },
  };
}

export class AuthDeadlineExceededError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly phase: AuthNetworkPhase
  ) {
    super(`Authentication verification exceeded ${timeoutMs}ms`);
    this.name = 'AuthDeadlineExceededError';
  }
}

/**
 * Applies one deadline to the complete Supabase auth operation. The outer race
 * is intentional: auth-js retries transient refresh failures internally, so an
 * abortable fetch alone cannot guarantee that middleware returns before Vercel's
 * invocation limit.
 */
export function createAuthDeadline(timeoutMs: number) {
  const controller = new AbortController();
  const composedSignalCleanups = new Set<() => void>();
  let phase: AuthNetworkPhase = 'local';
  let upstreamStatus: number | null = null;
  let timedOut = false;

  let rejectDeadline: (reason: AuthDeadlineExceededError) => void = () => undefined;
  const deadlinePromise = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    rejectDeadline(new AuthDeadlineExceededError(timeoutMs, phase));
    controller.abort();
  }, timeoutMs);

  const deadlineFetch: typeof fetch = async (input, init) => {
    phase = authNetworkPhase(input);
    const requestSignal = input instanceof Request ? input.signal : undefined;
    const composed = composeAbortSignals([controller.signal, requestSignal, init?.signal]);
    composedSignalCleanups.add(composed.cleanup);

    const response = await globalThis.fetch(input, { ...init, signal: composed.signal });
    if (!isTransientHttpStatus(response.status)) return response;

    // auth-js clears sessions for some non-standard gateway errors (for example
    // 525) because it does not classify them as retryable. Normalize temporary
    // transport/service failures before the SDK sees them so a provider outage
    // cannot sign a valid user out. The outer deadline still caps SDK retries.
    upstreamStatus = response.status;
    return new Response(response.body, {
      headers: response.headers,
      status: 503,
      statusText: 'Service Unavailable',
    });
  };

  return {
    fetch: deadlineFetch,
    run<T>(operation: PromiseLike<T>) {
      return Promise.race([Promise.resolve(operation), deadlinePromise]);
    },
    didTimeout() {
      return timedOut;
    },
    diagnostics(): AuthDeadlineDiagnostics {
      return { phase, upstreamStatus };
    },
    dispose() {
      clearTimeout(timer);
      composedSignalCleanups.forEach((cleanup) => cleanup());
      composedSignalCleanups.clear();
    },
  };
}

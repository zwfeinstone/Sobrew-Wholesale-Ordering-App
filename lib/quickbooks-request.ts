import 'server-only';

export const QUICKBOOKS_TOKEN_TIMEOUT_MS = 12_000;
export const QUICKBOOKS_READ_TIMEOUT_MS = 12_000;
export const QUICKBOOKS_WRITE_TIMEOUT_MS = 30_000;
export const QUICKBOOKS_BINARY_TIMEOUT_MS = 30_000;
export const QUICKBOOKS_PAYMENTS_READ_TIMEOUT_MS = 15_000;
export const QUICKBOOKS_PAYMENTS_WRITE_TIMEOUT_MS = 45_000;
export const QUICKBOOKS_SLOW_REQUEST_MS = 3_000;

type QuickBooksService = 'oauth' | 'accounting' | 'payments' | 'payments_customer';

type QuickBooksRequestLogger = Pick<Console, 'error' | 'warn'>;

export type QuickBooksRequestResult<T> = {
  body: T;
  response: Response;
};

type QuickBooksRequestOptions = {
  logger?: QuickBooksRequestLogger;
  method?: string;
  operation: string;
  service: QuickBooksService;
  signal?: AbortSignal | null;
  slowRequestMs?: number;
  timeoutMs: number;
};

function composeAbortSignals(signals: Array<AbortSignal | null | undefined>) {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 1) {
    return { cleanup: () => undefined, signal: activeSignals[0] };
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
    cleanup: () => activeSignals.forEach((signal) => signal.removeEventListener('abort', onAbort)),
    signal: controller.signal,
  };
}

function structuredLog(logger: QuickBooksRequestLogger, level: 'error' | 'warn', data: Record<string, unknown>) {
  logger[level](JSON.stringify({ level, ...data }));
}

export class QuickBooksRequestTimeoutError extends Error {
  readonly code = 'QUICKBOOKS_REQUEST_TIMEOUT';
  readonly method: string;

  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
    method = 'GET'
  ) {
    const normalizedMethod = method.toUpperCase();
    const nextStep = normalizedMethod === 'GET'
      ? 'Try again in a moment.'
      : 'The request may have completed; check QuickBooks before retrying.';
    super(`QuickBooks ${operation.replaceAll('_', ' ')} timed out after ${Math.ceil(timeoutMs / 1000)} seconds. ${nextStep}`);
    this.name = 'QuickBooksRequestTimeoutError';
    this.method = normalizedMethod;
  }
}

/**
 * Applies one deadline to the complete QuickBooks exchange, including response
 * body parsing. The outer race guarantees a bounded result even if a fetch
 * implementation ignores AbortSignal. Callers supply only safe operation names;
 * URLs, query strings, tokens, realm IDs, and response bodies are never logged.
 */
export async function performQuickBooksRequest<T>(
  options: QuickBooksRequestOptions,
  request: (signal: AbortSignal) => Promise<QuickBooksRequestResult<T>>
) {
  const logger = options.logger ?? console;
  const method = (options.method || 'GET').toUpperCase();
  const startedAt = Date.now();
  const deadlineController = new AbortController();
  const composed = composeAbortSignals([deadlineController.signal, options.signal]);
  let timedOut = false;
  let rejectDeadline: (reason: QuickBooksRequestTimeoutError) => void = () => undefined;
  const deadlinePromise = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    deadlineController.abort();
    rejectDeadline(new QuickBooksRequestTimeoutError(options.operation, options.timeoutMs, method));
  }, options.timeoutMs);

  try {
    const result = await Promise.race([request(composed.signal), deadlinePromise]);
    const durationMs = Date.now() - startedAt;
    const intuitTid = result.response.headers.get('intuit_tid');

    if (!result.response.ok) {
      structuredLog(logger, 'error', {
        duration_ms: durationMs,
        intuit_tid: intuitTid,
        message: 'quickbooks_http_error',
        method,
        operation: options.operation,
        retry_after: result.response.headers.get('retry-after'),
        service: options.service,
        status: result.response.status,
      });
    } else if (durationMs >= (options.slowRequestMs ?? QUICKBOOKS_SLOW_REQUEST_MS)) {
      structuredLog(logger, 'warn', {
        duration_ms: durationMs,
        message: 'quickbooks_slow_request',
        method,
        operation: options.operation,
        service: options.service,
        status: result.response.status,
      });
    }

    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (timedOut || error instanceof QuickBooksRequestTimeoutError) {
      const timeoutError = error instanceof QuickBooksRequestTimeoutError
        ? error
        : new QuickBooksRequestTimeoutError(options.operation, options.timeoutMs, method);
      structuredLog(logger, 'error', {
        duration_ms: durationMs,
        message: 'quickbooks_request_timeout',
        method,
        operation: options.operation,
        service: options.service,
        timeout_ms: options.timeoutMs,
      });
      throw timeoutError;
    }

    structuredLog(logger, 'error', {
      duration_ms: durationMs,
      error_name: error instanceof Error ? error.name : 'UnknownError',
      message: 'quickbooks_transport_error',
      method,
      operation: options.operation,
      service: options.service,
    });
    throw error;
  } finally {
    clearTimeout(timer);
    composed.cleanup();
  }
}

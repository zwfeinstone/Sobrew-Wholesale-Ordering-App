import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  performQuickBooksRequest,
  QuickBooksRequestTimeoutError,
} from './quickbooks-request';

function testLogger() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
  };
}

describe('QuickBooks request deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects at the deadline even when the request ignores AbortSignal', async () => {
    vi.useFakeTimers();
    const logger = testLogger();
    const request = performQuickBooksRequest({
      logger,
      operation: 'customer_list',
      service: 'accounting',
      timeoutMs: 4_000,
    }, async () => new Promise<never>(() => undefined));
    const rejection = expect(request).rejects.toMatchObject({
      code: 'QUICKBOOKS_REQUEST_TIMEOUT',
      operation: 'customer_list',
      timeoutMs: 4_000,
    });

    await vi.advanceTimersByTimeAsync(4_000);

    await rejection;
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logger.error.mock.calls[0][0])).toMatchObject({
      message: 'quickbooks_request_timeout',
      operation: 'customer_list',
      timeout_ms: 4_000,
    });
  });

  it('aborts the active request when the deadline expires', async () => {
    vi.useFakeTimers();
    const logger = testLogger();
    let observedSignal: AbortSignal | undefined;
    const request = performQuickBooksRequest({
      logger,
      operation: 'company_info',
      service: 'accounting',
      timeoutMs: 2_000,
    }, async (signal) => {
      observedSignal = signal;
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    });
    const rejection = expect(request).rejects.toBeInstanceOf(QuickBooksRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(2_000);

    await rejection;
    expect(observedSignal?.aborted).toBe(true);
  });

  it('keeps the deadline active while the response body is being consumed', async () => {
    vi.useFakeTimers();
    const logger = testLogger();
    const request = performQuickBooksRequest({
      logger,
      operation: 'customer_list',
      service: 'accounting',
      timeoutMs: 3_000,
    }, async () => {
      const response = new Response(null, { status: 200 });
      await new Promise(() => undefined);
      return { body: null, response };
    });
    const rejection = expect(request).rejects.toBeInstanceOf(QuickBooksRequestTimeoutError);

    await vi.advanceTimersByTimeAsync(3_000);

    await rejection;
  });

  it('preserves a caller abort without labeling it as a timeout', async () => {
    const logger = testLogger();
    const controller = new AbortController();
    const request = performQuickBooksRequest({
      logger,
      operation: 'customer_list',
      service: 'accounting',
      signal: controller.signal,
      timeoutMs: 4_000,
    }, async (signal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(JSON.parse(logger.error.mock.calls[0][0])).toMatchObject({
      error_name: 'AbortError',
      message: 'quickbooks_transport_error',
    });
  });

  it('logs HTTP status and Intuit request ID without retrying', async () => {
    const logger = testLogger();
    const request = vi.fn(async () => ({
      body: null,
      response: new Response(null, {
        headers: {
          intuit_tid: 'request-123',
          'retry-after': '5',
        },
        status: 429,
      }),
    }));

    const result = await performQuickBooksRequest({
      logger,
      method: 'POST',
      operation: 'invoice_create',
      service: 'accounting',
      timeoutMs: 30_000,
    }, request);

    expect(result.response.status).toBe(429);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logger.error.mock.calls[0][0])).toMatchObject({
      intuit_tid: 'request-123',
      message: 'quickbooks_http_error',
      method: 'POST',
      operation: 'invoice_create',
      retry_after: '5',
      status: 429,
    });
  });

  it('does not retry an ambiguous timed-out write', async () => {
    vi.useFakeTimers();
    const logger = testLogger();
    const requestCallback = vi.fn(async () => new Promise<never>(() => undefined));
    const request = performQuickBooksRequest({
      logger,
      method: 'POST',
      operation: 'invoice_create',
      service: 'accounting',
      timeoutMs: 5_000,
    }, requestCallback);
    const rejection = expect(request).rejects.toMatchObject({
      method: 'POST',
      message: expect.stringContaining('may have completed'),
    });

    await vi.advanceTimersByTimeAsync(5_000);

    await rejection;
    expect(requestCallback).toHaveBeenCalledTimes(1);
  });

  it('clears the deadline after a successful request', async () => {
    vi.useFakeTimers();
    const logger = testLogger();
    const result = await performQuickBooksRequest({
      logger,
      operation: 'company_info',
      service: 'accounting',
      slowRequestMs: 10_000,
      timeoutMs: 4_000,
    }, async () => ({
      body: { ok: true },
      response: new Response(null, { status: 200 }),
    }));

    await vi.advanceTimersByTimeAsync(4_000);

    expect(result.body).toEqual({ ok: true });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, from } = vi.hoisted(() => ({ send: vi.fn(), from: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from } }));

import {
  loadAdminOrderCcByCenter,
  sendAdminNotificationEmail,
  sendCustomerWelcomeEmail,
  sendInvoicePdfEmail,
  sendOrderEmail,
  sendOrderEmails,
  sendPaymentReceiptEmail,
  sendShippedEmail,
} from './email';

const order = {
  adminCc: [],
  customerEmail: 'orders@example.com',
  customerName: 'Test Center',
  orderId: 'order-1234',
  shipping: {},
  items: [{ name: 'Coffee', qty: 1, price: 1200, line: 1200 }],
  subtotalCents: 1200,
};
const invoice = {
  customerName: 'Test Center',
  invoiceNumber: 'SO-1001',
  orderId: order.orderId,
  pdf: Buffer.from('test pdf'),
  to: order.customerEmail,
};

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  send.mockReset().mockResolvedValue({ data: { id: 'email-1' }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('email delivery acceptance', () => {
  const deliveries = [
    ['welcome', () => sendCustomerWelcomeEmail({ email: order.customerEmail, password: 'test-password' })],
    ['admin order', () => sendAdminNotificationEmail(order)],
    ['customer order', () => sendOrderEmail(order)],
    ['shipped', () => sendShippedEmail(order.customerEmail, order.items)],
    ['invoice', () => sendInvoicePdfEmail(invoice)],
    ['receipt', () => sendPaymentReceiptEmail({
      ...invoice, amountCents: 1200, paymentMethodLabel: 'Visa 1234', paymentMethodType: 'card', paymentStatus: 'CAPTURED',
    })],
  ] as const;

  it.each(deliveries)('reports a returned provider rejection for %s email', async (_name, deliver) => {
    send.mockResolvedValue({ data: null, error: { message: 'Rate limit exceeded' } });
    const result = await deliver();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(String(result.error)).toContain('Rate limit exceeded');
  });

  it('does not report acceptance without an email ID or after a transport exception', async () => {
    send.mockResolvedValueOnce({ data: {}, error: null });
    expect((await sendOrderEmail(order)).ok).toBe(false);
    send.mockRejectedValueOnce(new Error('connection closed'));
    expect((await sendOrderEmail(order)).ok).toBe(false);
  });

  it('aggregates a failed order email while still sending both notifications', async () => {
    send.mockResolvedValueOnce({ data: null, error: { message: 'Rejected admin email' } });
    expect((await sendOrderEmails(order)).ok).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retains invoice audit CC and attachments, normalizes recipients, and omits duplicate CC', async () => {
    expect(await sendInvoicePdfEmail({ ...invoice, to: 'orders@example.com; ORDERS@example.com', cc: 'orders@example.com' })).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['orders@example.com'],
      cc: ['zach@sobrew.com'],
      from: 'Sobrew Wholesale <orders@orders.sobrew.com>',
      replyTo: 'hello@sobrew.com',
      attachments: expect.arrayContaining([expect.objectContaining({ filename: 'Sobrew-Invoice-SO-1001.pdf', content: invoice.pdf })]),
    }));
    expect(send.mock.calls[0][0].attachments).toHaveLength(3);
  });

  it('passes QuickBooks invoice CC recipients to the PDF email provider', async () => {
    expect(await sendInvoicePdfEmail({
      ...invoice,
      cc: 'ap@example.com; accountant@example.com, AP@example.com; orders@example.com',
    })).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['orders@example.com'],
      cc: ['ap@example.com', 'accountant@example.com', 'zach@sobrew.com'],
    }));
  });

  it.each(['invoice', 'receipt'] as const)('passes an automatic %s idempotency key as a provider option', async (kind) => {
    const idempotencyKey = `ship-${kind}-order-1234`;
    const result = kind === 'invoice'
      ? await sendInvoicePdfEmail({ ...invoice, idempotencyKey })
      : await sendPaymentReceiptEmail({
        ...invoice, idempotencyKey, amountCents: 1200,
        paymentMethodLabel: 'Visa 1234', paymentMethodType: 'card', paymentStatus: 'CAPTURED',
      });

    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      subject: `Sobrew ${kind === 'invoice' ? 'Invoice' : 'Receipt'} SO-1001`,
      cc: ['zach@sobrew.com'],
    }), { idempotencyKey });
    expect(send.mock.calls[0][0]).not.toHaveProperty('idempotencyKey');
  });

  it.each([
    { cc: undefined, expectedCc: ['zach@sobrew.com'] },
    { cc: 'ap@example.com; accountant@example.com', expectedCc: ['ap@example.com', 'accountant@example.com', 'zach@sobrew.com'] },
    { cc: ['ap@example.com', 'ZACH@SOBREW.COM', 'zach@sobrew.com', 'orders@example.com'], expectedCc: ['ap@example.com', 'ZACH@SOBREW.COM'] },
  ])('copies Zach on the saved-payment receipt while preserving and deduping customer CCs: $cc', async ({ cc, expectedCc }) => {
    expect(await sendPaymentReceiptEmail({
      ...invoice,
      amountCents: 1200,
      paymentMethodLabel: 'Visa 1234',
      paymentMethodType: 'card',
      paymentStatus: 'CAPTURED',
      cc,
    })).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['orders@example.com'],
      cc: expectedCc,
      subject: 'Sobrew Receipt SO-1001',
      attachments: expect.arrayContaining([expect.objectContaining({ filename: 'Sobrew-Receipt-SO-1001.pdf', content: invoice.pdf })]),
    }));
  });

  it('delivers a receipt to Zach once when he is the primary recipient', async () => {
    expect(await sendPaymentReceiptEmail({
      ...invoice,
      to: 'ZACH@SOBREW.COM',
      cc: ['zach@sobrew.com', 'ap@example.com'],
      amountCents: 1200,
      paymentMethodLabel: 'Visa 1234',
      paymentMethodType: 'card',
      paymentStatus: 'CAPTURED',
    })).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ['ZACH@SOBREW.COM'],
      cc: ['ap@example.com'],
    }));
  });

  it('rejects empty recipients without invoking the provider', async () => {
    expect((await sendOrderEmail({ ...order, customerEmail: ' ; ' })).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('customer welcome delivery retries', () => {
  const welcome = { centerName: 'Test Center', email: order.customerEmail, fullName: 'Test Buyer', password: 'test-password' };
  const timeout = { message: 'Operation timed out. Please try again later.' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it('recovers from the observed timeout using the same credentials, recipients, and idempotency key', async () => {
    send.mockResolvedValueOnce({ data: null, error: timeout });
    const delivery = sendCustomerWelcomeEmail(welcome);
    await vi.runAllTimersAsync();

    expect(await delivery).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: expect.any(String) });
    expect(send.mock.calls[0][1].idempotencyKey.length).toBeGreaterThan(0);
    expect(send.mock.calls[0][0]).toMatchObject({
      to: [welcome.email],
      cc: ['haskins@sobrew.com', 'zach@sobrew.com'],
      from: 'Sobrew Wholesale <orders@orders.sobrew.com>',
      text: expect.stringContaining(`Password: ${welcome.password}`),
    });
    expect(send.mock.calls[0][0]).not.toHaveProperty('idempotencyKey');
  });

  it.each([
    'application_error', 'internal_server_error', 'rate_limit_exceeded',
    'service_unavailable', 'concurrent_idempotent_requests',
  ])('recovers from a transient %s provider response', async (name) => {
    send.mockResolvedValueOnce({ data: null, error: { name, message: 'Temporary provider failure' } });
    const delivery = sendCustomerWelcomeEmail(welcome);
    await vi.runAllTimersAsync();
    expect(await delivery).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    new TypeError('fetch failed'),
    new TypeError('fetch failed', { cause: new Error('connect ECONNRESET') }),
    Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
  ])('recovers from a thrown transport error: %s', async (error) => {
    send.mockRejectedValueOnce(error);
    const delivery = sendCustomerWelcomeEmail(welcome);
    await vi.runAllTimersAsync();
    expect(await delivery).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  });

  it('stops after three attempts with one-second then two-second backoff', async () => {
    const error = { ...timeout, name: 'application_error' };
    send.mockResolvedValue({ data: null, error });
    const delivery = sendCustomerWelcomeEmail(welcome);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const result = await delivery;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toHaveProperty('cause', error);
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]).toEqual(send.mock.calls[0]);
  });

  it.each([
    { name: 'validation_error', message: 'Sender domain is not verified' },
    { name: 'invalid_api_Key', message: 'Invalid API key' },
    { name: 'daily_quota_exceeded', message: 'Daily quota exceeded' },
    { name: 'monthly_quota_exceeded', message: 'Monthly quota exceeded' },
    { name: 'validation_error', message: 'Operation timed out. Please try again later.' },
  ])('does not retry permanent failures: $name / $message', async (error) => {
    send.mockResolvedValue({ data: null, error });
    const delivery = sendCustomerWelcomeEmail(welcome);
    await vi.runAllTimersAsync();
    expect((await delivery).ok).toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });

  it('sends each successful invocation once with a distinct idempotency key', async () => {
    expect(await sendCustomerWelcomeEmail(welcome)).toEqual({ ok: true });
    expect(await sendCustomerWelcomeEmail(welcome)).toEqual({ ok: true });
    await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(2);
    const keys = send.mock.calls.map((call) => call[1]?.idempotencyKey);
    expect(keys).toEqual([expect.any(String), expect.any(String)]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('keeps invoice delivery at one attempt so its existing recovery flow remains in control', async () => {
    send.mockResolvedValue({ data: null, error: timeout });
    const delivery = sendInvoicePdfEmail({ ...invoice, idempotencyKey: 'invoice-recovery-key' });
    await vi.runAllTimersAsync();
    expect((await delivery).ok).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'invoice-recovery-key' });
  });
});

describe('order email sales CC lookup', () => {
  it('batches unique center IDs and preserves the assigned-rep-only CC rule', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn(async (_column: string, ids: string[]) => ({
        data: ids.map((id) => ({ center_id: id, sales_profile: { email: id === 'center-1' ? 'HASKINS@SOBREW.COM' : id === 'center-2' ? 'ROB@SOBREW.COM' : id === 'center-3' ? 'THOMAS@SOBREW.COM' : 'other@sobrew.com' } })),
        error: null,
      })),
    };
    const client = { from: vi.fn(() => query) } as unknown as Parameters<typeof loadAdminOrderCcByCenter>[1];
    const ids = Array.from({ length: 201 }, (_, index) => `center-${index}`);
    const cc = await loadAdminOrderCcByCenter([...ids, ids[0]], client);
    expect(query.in.mock.calls.map((call) => call[1].length)).toEqual([200, 1]);
    expect(cc.get('center-1')).toEqual(['haskins@sobrew.com']);
    expect(cc.get('center-2')).toEqual(['rob@sobrew.com']);
    expect(cc.get('center-3')).toEqual(['thomas@sobrew.com']);
    expect(cc.get('center-4')).toEqual([]);
  });

  it('copies Thomas on the admin notification for his assigned customer', async () => {
    const assignmentQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({
        data: [{ center_id: 'thomas-center', sales_profile: { email: 'thomas@sobrew.com' } }],
        error: null,
      }),
    };
    from.mockReturnValue(assignmentQuery);

    expect(await sendOrderEmails({ ...order, adminCc: undefined, centerId: 'thomas-center' })).toEqual({ ok: true });
    expect(assignmentQuery.in).toHaveBeenCalledExactlyOnceWith('center_id', ['thomas-center']);
    expect(send).toHaveBeenCalledTimes(2);
    const adminEmail = send.mock.calls.find(([payload]) => payload.subject === `New Order ${order.orderId}`)?.[0];
    const customerEmail = send.mock.calls.find(([payload]) => payload.subject === 'Thank You For Your Order!')?.[0];
    expect(adminEmail).toMatchObject({ to: ['hello@sobrew.com'], cc: ['thomas@sobrew.com'] });
    expect(customerEmail).toMatchObject({ to: [order.customerEmail], cc: undefined });
  });
});

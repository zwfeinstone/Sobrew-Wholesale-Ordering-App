import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

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

  it('rejects empty recipients without invoking the provider', async () => {
    expect((await sendOrderEmail({ ...order, customerEmail: ' ; ' })).ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('order email sales CC lookup', () => {
  it('batches unique center IDs and preserves the assigned-rep-only CC rule', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn(async (_column: string, ids: string[]) => ({
        data: ids.map((id) => ({ center_id: id, sales_profile: { email: id === 'center-1' ? 'HASKINS@SOBREW.COM' : 'other@sobrew.com' } })),
        error: null,
      })),
    };
    const client = { from: vi.fn(() => query) } as unknown as Parameters<typeof loadAdminOrderCcByCenter>[1];
    const ids = Array.from({ length: 201 }, (_, index) => `center-${index}`);
    const cc = await loadAdminOrderCcByCenter([...ids, ids[0]], client);
    expect(query.in.mock.calls.map((call) => call[1].length)).toEqual([200, 1]);
    expect(cc.get('center-1')).toEqual(['haskins@sobrew.com']);
    expect(cc.get('center-2')).toEqual([]);
  });
});

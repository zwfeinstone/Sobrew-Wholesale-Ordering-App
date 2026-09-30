import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitPortalOrderWithContext } from '@/app/portal/checkout/submit-order';
import { sendOrderEmails } from '@/lib/email';

vi.mock('@/lib/email', () => ({ sendOrderEmails: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/analytics-server', () => ({ trackServerProductEvent: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-8444-444444444444';

function checkoutForm(cart: unknown) {
  const formData = new FormData();
  formData.set('cart_json', JSON.stringify(cart));
  formData.set('submission_id', SUBMISSION_ID);
  formData.set('notes', 'Front desk');
  return formData;
}

describe('atomic portal checkout', () => {
  it('rejects malformed carts before calling the database', async () => {
    const rpc = vi.fn();
    const result = await submitPortalOrderWithContext({
      formData: checkoutForm([{ product_id: PRODUCT_ID, qty: 0 }]),
      user: { id: USER_ID, email: 'buyer@example.com' },
      profile: { center_id: USER_ID },
      supabase: { rpc },
    });

    expect(result).toEqual({ type: 'invalid_cart' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('sends only product IDs and quantities to the atomic pricing RPC', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        order_id: ORDER_ID,
        placed_items: [],
        subtotal_cents: 1299,
        was_created: false,
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ single });

    const result = await submitPortalOrderWithContext({
      formData: checkoutForm([{ product_id: PRODUCT_ID, qty: 2, price_cents: 1_000_000 }]),
      user: { id: USER_ID, email: 'buyer@example.com' },
      profile: { center_id: USER_ID },
      supabase: { rpc },
    });

    expect(rpc).toHaveBeenCalledWith('place_portal_order', {
      submission_id: SUBMISSION_ID,
      location_id: null,
      notes: 'Front desk',
      items: [{ product_id: PRODUCT_ID, qty: 2 }],
    });
    expect(result).toEqual({
      type: 'redirect',
      location: `/portal/orders/${ORDER_ID}?toast=order_placed`,
    });
  });

  it('returns the original order on repeat submissions without duplicating email or recurring schedules', async () => {
    const placedOrder = {
      order_id: ORDER_ID,
      subtotal_cents: 16000,
      placed_items: [{ product_id: PRODUCT_ID, name: 'Coffee', qty: 4, price_cents: 4000, line_total_cents: 16000 }],
    };
    const single = vi.fn()
      .mockResolvedValueOnce({ data: { ...placedOrder, was_created: true }, error: null })
      .mockResolvedValue({ data: { ...placedOrder, was_created: false }, error: null });
    const rpc = vi.fn().mockReturnValue({ single });
    const recurringInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'recurring-id' }, error: null }),
      }),
    });
    const recurringItemsInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === 'recurring_orders') return { insert: recurringInsert };
      if (table === 'recurring_order_items') return { insert: recurringItemsInsert };
      throw new Error(`Unexpected table: ${table}`);
    });
    const formData = checkoutForm([{ product_id: PRODUCT_ID, qty: 4 }]);
    formData.set('is_recurring', 'on');
    formData.set('recurring_frequency', '2_weeks');
    const context = {
      formData,
      user: { id: USER_ID, email: 'buyer@example.com' },
      profile: { center_id: USER_ID },
      supabase: { rpc, from },
    };

    expect(await submitPortalOrderWithContext(context)).toEqual({
      type: 'redirect',
      location: `/portal/orders/${ORDER_ID}?toast=order_placed_recurring_created`,
    });
    for (let retry = 0; retry < 2; retry += 1) {
      expect(await submitPortalOrderWithContext(context)).toEqual({
        type: 'redirect',
        location: `/portal/orders/${ORDER_ID}?toast=order_placed`,
      });
    }

    expect(rpc).toHaveBeenCalledTimes(3);
    for (const [, payload] of rpc.mock.calls) expect(payload.submission_id).toBe(SUBMISSION_ID);
    expect(recurringInsert).toHaveBeenCalledTimes(1);
    expect(recurringItemsInsert).toHaveBeenCalledTimes(1);
    expect(sendOrderEmails).toHaveBeenCalledTimes(1);
  });
});

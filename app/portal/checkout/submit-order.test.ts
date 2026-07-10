import { describe, expect, it, vi } from 'vitest';
import { submitPortalOrderWithContext } from '@/app/portal/checkout/submit-order';

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
});

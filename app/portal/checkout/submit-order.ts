import { waitUntil } from '@vercel/functions';
import { trackServerProductEvent } from '@/lib/analytics-server';
import { sendOrderEmails } from '@/lib/email';
import { isRecurringFrequency } from '@/lib/recurring';

export type PortalCheckoutSubmitResult =
  | { type: 'redirect'; location: string }
  | { type: 'invalid_cart' }
  | { type: 'location_required' }
  | { type: 'checkout_error' };

type PortalCheckoutProfile = {
  center?: { id: string; name: string | null; is_active?: boolean | null } | null;
  center_id?: string | null;
  email?: string | null;
  full_name?: string | null;
};

type NormalizedCartItem = {
  product_id: string;
  qty: number;
};

type CartItemWithPricing = NormalizedCartItem & {
  line_total_cents: number;
  name: string;
  price_cents: number;
};

type PlacedOrderRow = {
  center_location_id: string | null;
  order_id: string;
  placed_items: unknown;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_name: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  subtotal_cents: number;
  was_created: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function placedItemsFrom(value: unknown): CartItemWithPricing[] | null {
  if (!Array.isArray(value) || !value.length) return null;

  const items: CartItemWithPricing[] = [];
  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== 'object') return null;
    const item = rawItem as Record<string, unknown>;
    const productId = typeof item.product_id === 'string' ? item.product_id : '';
    const name = typeof item.name === 'string' ? item.name : '';
    const qty = Number(item.qty);
    const priceCents = Number(item.price_cents);
    const lineTotalCents = Number(item.line_total_cents);
    if (
      !UUID_PATTERN.test(productId)
      || !name
      || !Number.isInteger(qty)
      || qty <= 0
      || !Number.isInteger(priceCents)
      || priceCents < 0
      || !Number.isInteger(lineTotalCents)
      || lineTotalCents !== qty * priceCents
    ) {
      return null;
    }
    items.push({
      product_id: productId,
      line_total_cents: lineTotalCents,
      name,
      price_cents: priceCents,
      qty,
    });
  }

  return items;
}

export async function submitPortalOrderWithContext({
  formData,
  user,
  profile,
  supabase,
}: {
  formData: FormData;
  user: { id: string; email?: string | null };
  profile: PortalCheckoutProfile | null;
  supabase: any;
}): Promise<PortalCheckoutSubmitResult> {
  const rawCartValue = String(formData.get('cart_json') ?? '[]');
  let parsedCart: unknown;

  try {
    parsedCart = JSON.parse(rawCartValue);
  } catch {
    return { type: 'invalid_cart' };
  }

  if (!Array.isArray(parsedCart) || !parsedCart.length) {
    return { type: 'redirect', location: '/portal/cart' };
  }

  const qtyByProductId = new Map<string, number>();
  for (const rawItem of parsedCart) {
    const productId = typeof rawItem?.product_id === 'string' ? rawItem.product_id.trim() : '';
    const qty = Number(rawItem?.qty);
    if (!UUID_PATTERN.test(productId) || !Number.isInteger(qty) || qty <= 0) {
      return { type: 'invalid_cart' };
    }
    qtyByProductId.set(productId, (qtyByProductId.get(productId) ?? 0) + qty);
  }

  const normalizedCart: NormalizedCartItem[] = [...qtyByProductId.entries()].map(([product_id, qty]) => ({ product_id, qty }));
  if (!normalizedCart.length || normalizedCart.length > 100 || normalizedCart.some((item) => item.qty > 9999)) {
    return { type: 'invalid_cart' };
  }

  const isRecurring = String(formData.get('is_recurring') ?? '') === 'on';
  const recurringFrequency = String(formData.get('recurring_frequency') ?? '');
  if (isRecurring && !isRecurringFrequency(recurringFrequency)) {
    return { type: 'checkout_error' };
  }

  const submissionId = String(formData.get('submission_id') ?? '').trim();
  if (!UUID_PATTERN.test(submissionId)) return { type: 'invalid_cart' };

  const requestedLocationId = String(formData.get('center_location_id') ?? '').trim();
  if (requestedLocationId && !UUID_PATTERN.test(requestedLocationId)) {
    return { type: 'location_required' };
  }

  const { data: placedOrderData, error: placeOrderError } = await supabase
    .rpc('place_portal_order', {
      submission_id: submissionId,
      location_id: requestedLocationId || null,
      notes: String(formData.get('notes') ?? ''),
      items: normalizedCart,
    })
    .single();

  if (placeOrderError) {
    const message = String(placeOrderError.message ?? '').toLowerCase();
    if (message.includes('delivery location')) return { type: 'location_required' };
    if (placeOrderError.code === '22023' || message.includes('cart') || message.includes('submission id')) {
      return { type: 'invalid_cart' };
    }
    console.error('[checkout] atomic order placement failed', {
      code: placeOrderError.code,
      message: placeOrderError.message,
    });
    return { type: 'checkout_error' };
  }

  const order = placedOrderData as PlacedOrderRow | null;
  if (!order?.order_id) return { type: 'checkout_error' };

  if (order.was_created === false) {
    return { type: 'redirect', location: `/portal/orders/${order.order_id}?toast=order_placed` };
  }

  const cartWithNames = placedItemsFrom(order.placed_items);
  const subtotal = Number(order.subtotal_cents);
  if (!cartWithNames || !Number.isInteger(subtotal) || subtotal < 0) {
    console.error('[checkout] order placed but its server snapshot could not be read', { orderId: order.order_id });
    const toast = isRecurring ? 'order_placed_recurring_error' : 'order_placed';
    return { type: 'redirect', location: `/portal/orders/${order.order_id}?toast=${toast}` };
  }

  let recurringResult: 'none' | 'created' | 'error' = 'none';
  if (isRecurring && isRecurringFrequency(recurringFrequency)) {
    const { data: recurringOrder, error: recurringOrderError } = await supabase
      .from('recurring_orders')
      .insert({
        center_id: profile?.center_id,
        user_id: user.id,
        source_order_id: order.order_id,
        frequency: recurringFrequency,
        amount_cents: subtotal,
        status: 'active',
      })
      .select('id')
      .single();

    if (recurringOrderError || !recurringOrder) {
      recurringResult = 'error';
      console.error('[checkout] failed to create recurring order', recurringOrderError);
    } else {
      const { error: recurringItemsError } = await supabase.from('recurring_order_items').insert(
        cartWithNames.map((item) => ({
          recurring_order_id: recurringOrder.id,
          product_id: item.product_id,
          product_name_snapshot: item.name,
          qty: item.qty,
          unit_price_cents: item.price_cents,
          line_total_cents: item.line_total_cents,
        }))
      );

      if (recurringItemsError) {
        recurringResult = 'error';
        console.error('[checkout] failed to create recurring order items', recurringItemsError);
        await supabase.from('recurring_orders').delete().eq('id', recurringOrder.id);
      } else {
        recurringResult = 'created';
      }
    }
  }

  waitUntil(sendOrderEmails({
    customerEmail: profile?.email ?? user.email ?? '',
    customerName: profile?.center?.name ?? profile?.full_name ?? profile?.email ?? user.email ?? '',
    orderId: order.order_id,
    shipping: {
      shipping_name: order.shipping_name,
      shipping_address1: order.shipping_address1,
      shipping_address2: order.shipping_address2,
      shipping_city: order.shipping_city,
      shipping_state: order.shipping_state,
      shipping_zip: order.shipping_zip,
    },
    items: cartWithNames.map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price_cents,
      line: item.line_total_cents,
    })),
    subtotalCents: subtotal,
  }));

  const toast = recurringResult === 'created'
    ? 'order_placed_recurring_created'
    : recurringResult === 'error'
      ? 'order_placed_recurring_error'
      : 'order_placed';

  trackServerProductEvent('portal_order_submitted', {
    has_recurring_schedule: recurringResult === 'created',
    item_count: cartWithNames.length,
    item_quantity: cartWithNames.reduce((sum, item) => sum + item.qty, 0),
  });
  if (recurringResult === 'created') {
    trackServerProductEvent('portal_recurring_enabled', { item_count: cartWithNames.length });
  }

  return { type: 'redirect', location: `/portal/orders/${order.order_id}?toast=${toast}` };
}

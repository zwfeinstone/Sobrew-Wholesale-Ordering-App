import { sendOrderEmails } from '@/lib/email';
import { trackServerProductEvent } from '@/lib/analytics-server';
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
  name: string;
  price_cents: number;
};

type AssignedProductRow = {
  product_id: string;
};

type PriceRow = {
  product_id: string;
  price_cents: number;
};

type ProductRow = {
  id: string;
  name: string;
};

type CenterLocationRow = {
  id: string;
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

function isDuplicateSubmissionError(error: { code?: string; message?: string } | null) {
  return error?.code === '23505' && error.message?.includes('orders_submission_id_idx');
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
  const centerId = profile?.center_id ?? user.id;
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
    if (!productId || !Number.isInteger(qty) || qty <= 0) {
      return { type: 'invalid_cart' };
    }
    qtyByProductId.set(productId, (qtyByProductId.get(productId) ?? 0) + qty);
  }

  const normalizedCart: NormalizedCartItem[] = [...qtyByProductId.entries()].map(([product_id, qty]) => ({ product_id, qty }));
  const productIds = normalizedCart.map((item) => item.product_id);
  const [{ data: assignedProducts }, { data: prices }, { data: dbProducts }] = await Promise.all([
    productIds.length
      ? supabase.from('user_products').select('product_id').eq('center_id', centerId).in('product_id', productIds)
      : Promise.resolve({ data: [] as AssignedProductRow[] }),
    productIds.length
      ? supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', centerId).in('product_id', productIds)
      : Promise.resolve({ data: [] as PriceRow[] }),
    productIds.length
      ? supabase.from('products').select('id,name').in('id', productIds).eq('active', true)
      : Promise.resolve({ data: [] as ProductRow[] }),
  ]);

  const assignedProductIds = new Set<string>((assignedProducts ?? []).map((item: AssignedProductRow) => item.product_id));
  const nameMap = new Map<string, string>((dbProducts ?? []).map((product: ProductRow) => [product.id, product.name]));
  const priceMap = new Map<string, number>((prices ?? []).map((item: PriceRow) => [item.product_id, item.price_cents]));
  const cartWithNames: CartItemWithPricing[] = normalizedCart.map((item) => ({
    product_id: item.product_id,
    name: nameMap.get(item.product_id) ?? 'Unknown product',
    price_cents: priceMap.get(item.product_id) ?? -1,
    qty: item.qty,
  }));

  const hasInvalidItems = cartWithNames.some((item) =>
    !assignedProductIds.has(item.product_id) ||
    !nameMap.has(item.product_id) ||
    !priceMap.has(item.product_id) ||
    !Number.isInteger(item.qty) ||
    item.qty <= 0
  );
  if (hasInvalidItems) {
    return { type: 'invalid_cart' };
  }

  const isRecurring = String(formData.get('is_recurring') ?? '') === 'on';
  const recurringFrequency = String(formData.get('recurring_frequency') ?? '');
  const normalizedRecurringFrequency = isRecurringFrequency(recurringFrequency) ? recurringFrequency : null;
  const submissionId = String(formData.get('submission_id') ?? '').trim() || null;
  const requestedLocationId = String(formData.get('center_location_id') ?? '').trim();
  const subtotal = cartWithNames.reduce((sum, item) => sum + item.qty * item.price_cents, 0);

  const [{ data: lastOrder }, { data: activeLocations, error: locationsError }] = await Promise.all([
    supabase
      .from('orders')
      .select('shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
      .eq('center_id', centerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('center_locations')
      .select('id,name,address1,address2,city,state,zip')
      .eq('center_id', centerId)
      .eq('is_active', true)
      .order('name', { ascending: true }),
  ]);

  if (locationsError) {
    return { type: 'checkout_error' };
  }

  const locations = (activeLocations ?? []) as CenterLocationRow[];
  let selectedLocation: CenterLocationRow | null = null;

  if (locations.length === 1) {
    selectedLocation = locations[0];
  } else if (locations.length > 1) {
    selectedLocation = locations.find((location) => location.id === requestedLocationId) ?? null;
    if (!selectedLocation) {
      return { type: 'location_required' };
    }
  }

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      center_id: centerId,
      center_location_id: selectedLocation?.id ?? null,
      submission_id: submissionId,
      user_id: user.id,
      shipping_name: selectedLocation?.name ?? lastOrder?.shipping_name ?? profile?.center?.name ?? profile?.full_name ?? profile?.email ?? user.email ?? '',
      shipping_address1: selectedLocation?.address1 ?? lastOrder?.shipping_address1 ?? '',
      shipping_address2: selectedLocation?.address2 ?? lastOrder?.shipping_address2 ?? '',
      shipping_city: selectedLocation?.city ?? lastOrder?.shipping_city ?? '',
      shipping_state: selectedLocation?.state ?? lastOrder?.shipping_state ?? '',
      shipping_zip: selectedLocation?.zip ?? lastOrder?.shipping_zip ?? '',
      notes: String(formData.get('notes') ?? ''),
      subtotal_cents: subtotal,
    })
    .select('id,center_location_id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
    .single();

  if (isDuplicateSubmissionError(error) && submissionId) {
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id')
      .eq('submission_id', submissionId)
      .maybeSingle();
    if (existingOrder) {
      return { type: 'redirect', location: `/portal/orders/${existingOrder.id}?toast=order_placed` };
    }
  }
  if (error || !order) {
    return { type: 'checkout_error' };
  }

  const { error: orderItemsError } = await supabase.from('order_items').insert(
    cartWithNames.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name_snapshot: item.name,
      qty: item.qty,
      unit_price_cents: item.price_cents,
      line_total_cents: item.price_cents * item.qty,
    }))
  );
  if (orderItemsError) {
    await supabase.from('orders').delete().eq('id', order.id);
    return { type: 'checkout_error' };
  }

  let recurringResult: 'none' | 'created' | 'error' = 'none';
  if (isRecurring && normalizedRecurringFrequency) {
    const { data: recurringOrder, error: recurringOrderError } = await supabase
      .from('recurring_orders')
      .insert({
        center_id: centerId,
        user_id: user.id,
        source_order_id: order.id,
        frequency: normalizedRecurringFrequency,
        amount_cents: subtotal,
        status: 'active',
      })
      .select('id')
      .single();

    if (recurringOrderError || !recurringOrder) {
      recurringResult = 'error';
      console.error('Failed to create recurring order', recurringOrderError);
    } else {
      const { error: recurringItemsError } = await supabase.from('recurring_order_items').insert(
        cartWithNames.map((item) => ({
          recurring_order_id: recurringOrder.id,
          product_id: item.product_id,
          product_name_snapshot: item.name,
          qty: item.qty,
          unit_price_cents: item.price_cents,
          line_total_cents: item.qty * item.price_cents,
        }))
      );

      if (recurringItemsError) {
        recurringResult = 'error';
        console.error('Failed to create recurring order items', recurringItemsError);
        await supabase.from('recurring_orders').delete().eq('id', recurringOrder.id);
      } else {
        recurringResult = 'created';
      }
    }
  }

  await sendOrderEmails({
    customerEmail: profile?.email ?? user.email ?? '',
    customerName: profile?.center?.name ?? profile?.full_name ?? profile?.email ?? user.email ?? '',
    orderId: order.id,
    shipping: order,
    items: cartWithNames.map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price_cents,
      line: item.qty * item.price_cents,
    })),
    subtotalCents: subtotal,
  });

  const toast =
    recurringResult === 'created'
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

  return { type: 'redirect', location: `/portal/orders/${order.id}?toast=${toast}` };
}

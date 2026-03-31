import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { CheckoutCartField } from '@/components/cart-client';
import CheckoutSubmitButton from '@/components/checkout-submit-button';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { sendOrderEmails } from '@/lib/email';
import { isRecurringFrequency, RECURRING_FREQUENCY_OPTIONS } from '@/lib/recurring';

function isDuplicateSubmissionError(error: { code?: string; message?: string } | null) {
  return error?.code === '23505' && error.message?.includes('orders_submission_id_idx');
}

async function placeOrder(formData: FormData) {
  'use server';
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const centerId = profile?.center_id ?? user.id;
  const cart = JSON.parse(String(formData.get('cart_json') ?? '[]')) as Array<{
    product_id: string;
    name: string;
    price_cents: number;
    qty: number;
  }>;
  if (!cart.length) redirect('/portal/cart');

  const productIds = [...new Set(cart.map((item) => item.product_id))];
  const { data: dbProducts } = productIds.length
    ? await supabase.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const nameMap = new Map((dbProducts ?? []).map((p) => [p.id, p.name]));
  const cartWithNames = cart.map((item) => ({ ...item, name: nameMap.get(item.product_id) ?? 'Unknown product' }));
  const isRecurring = String(formData.get('is_recurring') ?? '') === 'on';
  const recurringFrequency = String(formData.get('recurring_frequency') ?? '');
  const normalizedRecurringFrequency = isRecurringFrequency(recurringFrequency) ? recurringFrequency : null;
  const submissionId = String(formData.get('submission_id') ?? '').trim() || null;

  const subtotal = cartWithNames.reduce((sum, i) => sum + i.qty * i.price_cents, 0);

  const { data: lastOrder } = await supabase
    .from('orders')
    .select('shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
    .eq('center_id', centerId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      center_id: centerId,
      submission_id: submissionId,
      user_id: user.id,
      shipping_name: lastOrder?.shipping_name ?? profile?.full_name ?? profile?.email ?? user.email ?? '',
      shipping_address1: lastOrder?.shipping_address1 ?? '',
      shipping_address2: lastOrder?.shipping_address2 ?? '',
      shipping_city: lastOrder?.shipping_city ?? '',
      shipping_state: lastOrder?.shipping_state ?? '',
      shipping_zip: lastOrder?.shipping_zip ?? '',
      notes: String(formData.get('notes') ?? ''),
      subtotal_cents: subtotal
    })
    .select('id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
    .single();
  if (isDuplicateSubmissionError(error) && submissionId) {
    const { data: existingOrder } = await supabase
      .from('orders')
      .select('id')
      .eq('submission_id', submissionId)
      .maybeSingle();
    if (existingOrder) {
      redirect(`/portal/orders/${existingOrder.id}?placed=1`);
    }
  }
  if (error || !order) redirect('/portal/checkout?error=1');

  const { error: orderItemsError } = await supabase.from('order_items').insert(
    cartWithNames.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name_snapshot: item.name,
      qty: item.qty,
      unit_price_cents: item.price_cents,
      line_total_cents: item.price_cents * item.qty
    }))
  );
  if (orderItemsError) {
    await supabase.from('orders').delete().eq('id', order.id);
    redirect('/portal/checkout?error=1');
  }

  let recurringCreationFailed = false;
  if (isRecurring && normalizedRecurringFrequency) {
    const { data: recurringOrder, error: recurringOrderError } = await supabase
      .from('recurring_orders')
      .insert({
        center_id: centerId,
        user_id: user.id,
        source_order_id: order.id,
        frequency: normalizedRecurringFrequency,
        amount_cents: subtotal,
        status: 'active'
      })
      .select('id')
      .single();

    if (recurringOrderError || !recurringOrder) {
      recurringCreationFailed = true;
      console.error('Failed to create recurring order', recurringOrderError);
    } else {
      const { error: recurringItemsError } = await supabase.from('recurring_order_items').insert(
        cartWithNames.map((item) => ({
          recurring_order_id: recurringOrder.id,
          product_id: item.product_id,
          product_name_snapshot: item.name,
          qty: item.qty,
          unit_price_cents: item.price_cents,
          line_total_cents: item.qty * item.price_cents
        }))
      );

      if (recurringItemsError) {
        recurringCreationFailed = true;
        console.error('Failed to create recurring order items', recurringItemsError);
        await supabase.from('recurring_orders').delete().eq('id', recurringOrder.id);
      }
    }
  }

  await sendOrderEmails({
    customerEmail: profile?.email ?? user.email ?? '',
    customerName: profile?.center?.name ?? profile?.full_name ?? profile?.email ?? user.email ?? '',
    orderId: order.id,
    shipping: order,
    items: cartWithNames.map((item) => ({ name: item.name, qty: item.qty, price: item.price_cents, line: item.qty * item.price_cents })),
    subtotalCents: subtotal
  });

  redirect(`/portal/orders/${order.id}?placed=1${recurringCreationFailed ? '&recurring_error=1' : ''}`);
}

export default function CheckoutPage() {
  const submissionId = randomUUID();

  return (
    <form action={placeOrder} className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Checkout</span>
        <h1 className="page-title mt-4">Place your order</h1>
        <p className="page-subtitle mt-3">Add any final notes, optionally turn this into a recurring order, and submit when everything looks right.</p>
      </section>
      <section className="card space-y-5">
        <CheckoutCartField />
        <input type="hidden" name="submission_id" value={submissionId} />
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Notes</label>
          <textarea className="input min-h-28" name="notes" placeholder="Delivery notes, special handling, or anything your team should know." />
        </div>
        <div className="rounded-[1.5rem] border border-slate-200 bg-white/60 p-4">
          <label className="flex items-start gap-3 text-sm font-medium text-slate-800 sm:items-center">
            <input type="checkbox" name="is_recurring" />
            <span>Make this order recurring</span>
          </label>
          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium text-slate-700">Recurring frequency</label>
            <select className="input" name="recurring_frequency" defaultValue="2_weeks">
              {RECURRING_FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
        <CheckoutSubmitButton />
      </section>
    </form>
  );
}

import { redirect } from 'next/navigation';
import { CheckoutCartField } from '@/components/cart-client';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { sendOrderEmails } from '@/lib/email';

async function placeOrder(formData: FormData) {
  'use server';
  const { user, profile } = await requireUser();
  const supabase = await createClient();
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
  const normalizedRecurringFrequency = recurringFrequency === '2_weeks' || recurringFrequency === 'monthly' ? recurringFrequency : null;

  const subtotal = cartWithNames.reduce((sum, i) => sum + i.qty * i.price_cents, 0);

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      user_id: user.id,
      shipping_name: profile?.full_name ?? profile?.email ?? user.email ?? '',
      shipping_address1: '',
      shipping_address2: '',
      shipping_city: '',
      shipping_state: '',
      shipping_zip: '',
      notes: String(formData.get('notes') ?? ''),
      subtotal_cents: subtotal
    })
    .select('id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
    .single();
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

  if (isRecurring && normalizedRecurringFrequency) {
    const { error: recurringOrderError } = await supabase.from('recurring_orders').insert({
      user_id: user.id,
      source_order_id: order.id,
      frequency: normalizedRecurringFrequency,
      amount_cents: subtotal
    });

    if (recurringOrderError) {
      await supabase.from('order_items').delete().eq('order_id', order.id);
      await supabase.from('orders').delete().eq('id', order.id);
      redirect('/portal/checkout?error=1');
    }
  }

  await sendOrderEmails({
    customerEmail: profile?.email ?? user.email ?? '',
    customerName: profile?.full_name ?? profile?.email ?? user.email ?? '',
    orderId: order.id,
    shipping: order,
    items: cartWithNames.map((item) => ({ name: item.name, qty: item.qty, price: item.price_cents, line: item.qty * item.price_cents })),
    subtotalCents: subtotal
  });

  redirect(`/portal/orders/${order.id}?placed=1`);
}

export default function CheckoutPage() {
  return (
    <form action={placeOrder} className="card space-y-3">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <CheckoutCartField />
      <textarea className="input" name="notes" placeholder="Notes" />
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" name="is_recurring" />
        Make this order recurring
      </label>
      <select className="input" name="recurring_frequency" defaultValue="2_weeks">
        <option value="2_weeks">Every 2 weeks</option>
        <option value="monthly">Monthly</option>
      </select>
      <button className="btn-primary">Place order</button>
    </form>
  );
}

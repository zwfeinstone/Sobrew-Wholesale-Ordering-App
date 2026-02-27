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
  const subtotal = cart.reduce((sum, i) => sum + i.qty * i.price_cents, 0);

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
      user_id: user.id,
      shipping_name: String(formData.get('shipping_name') ?? ''),
      shipping_address1: String(formData.get('shipping_address1') ?? ''),
      shipping_address2: String(formData.get('shipping_address2') ?? ''),
      shipping_city: String(formData.get('shipping_city') ?? ''),
      shipping_state: String(formData.get('shipping_state') ?? ''),
      shipping_zip: String(formData.get('shipping_zip') ?? ''),
      notes: String(formData.get('notes') ?? ''),
      subtotal_cents: subtotal
    })
    .select('id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
    .single();
  if (error || !order) redirect('/portal/checkout?error=1');

  await supabase.from('order_items').insert(
    cart.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name_snapshot: item.name,
      qty: item.qty,
      unit_price_cents: item.price_cents,
      line_total_cents: item.price_cents * item.qty
    }))
  );

  await sendOrderEmails({
    customerEmail: profile?.email ?? user.email ?? '',
    customerName: profile?.full_name ?? profile?.email ?? user.email ?? '',
    orderId: order.id,
    shipping: order,
    items: cart.map((item) => ({ name: item.name, qty: item.qty, price: item.price_cents, line: item.qty * item.price_cents })),
    subtotalCents: subtotal
  });

  redirect(`/portal/orders/${order.id}?placed=1`);
}

export default function CheckoutPage() {
  return (
    <form action={placeOrder} className="card space-y-3">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <CheckoutCartField />
      <input className="input" name="shipping_name" required placeholder="Shipping Name" />
      <input className="input" name="shipping_address1" required placeholder="Address 1" />
      <input className="input" name="shipping_address2" placeholder="Address 2" />
      <input className="input" name="shipping_city" required placeholder="City" />
      <input className="input" name="shipping_state" required placeholder="State" />
      <input className="input" name="shipping_zip" required placeholder="Zip" />
      <textarea className="input" name="notes" placeholder="Notes" />
      <button className="btn-primary">Place order</button>
    </form>
  );
}

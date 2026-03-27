import { NextResponse } from 'next/server';
import { sendOrderEmails } from '@/lib/email';
import { env } from '@/lib/env';
import { daysForRecurringFrequency } from '@/lib/recurring';
import { supabaseAdmin } from '@/lib/supabase/admin';

function intervalForFrequency(frequency: string) {
  const days = daysForRecurringFrequency(frequency);
  return days ? 1000 * 60 * 60 * 24 * days : null;
}

export async function POST(req: Request) {
  const providedSecret = req.headers.get('x-cron-secret') ?? '';
  if (!env.cronSecret || providedSecret !== env.cronSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data: recurringOrders, error: recurringOrdersError } = await supabaseAdmin
    .from('recurring_orders')
    .select('id,user_id,source_order_id,frequency,amount_cents,status,created_at,last_generated_at,profiles(email,full_name)')
    .eq('status', 'active');

  if (recurringOrdersError) {
    return NextResponse.json({ error: recurringOrdersError.message }, { status: 500 });
  }

  const now = Date.now();
  let created = 0;
  const errors: Array<{ recurringOrderId: string; message: string }> = [];

  for (const recurringOrder of recurringOrders ?? []) {
    const intervalMs = intervalForFrequency(recurringOrder.frequency);
    if (!intervalMs) continue;

    const anchorDate = recurringOrder.last_generated_at ?? recurringOrder.created_at;
    if (!anchorDate) continue;

    const nextRunAt = new Date(anchorDate).getTime() + intervalMs;
    if (nextRunAt > now) continue;

    const { data: sourceOrder, error: sourceOrderError } = await supabaseAdmin
      .from('orders')
      .select('id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
      .eq('id', recurringOrder.source_order_id)
      .single();

    if (sourceOrderError || !sourceOrder) {
      errors.push({ recurringOrderId: recurringOrder.id, message: sourceOrderError?.message ?? 'Missing source order' });
      continue;
    }

    const { data: recurringItems, error: recurringItemsError } = await supabaseAdmin
      .from('recurring_order_items')
      .select('product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents')
      .eq('recurring_order_id', recurringOrder.id);

    if (recurringItemsError || !recurringItems?.length) {
      errors.push({ recurringOrderId: recurringOrder.id, message: recurringItemsError?.message ?? 'Missing recurring order items' });
      continue;
    }

    const subtotal = recurringItems.reduce((sum, item) => sum + (item.line_total_cents ?? 0), 0);

    const { data: newOrder, error: newOrderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: recurringOrder.user_id,
        shipping_name: sourceOrder.shipping_name ?? '',
        shipping_address1: sourceOrder.shipping_address1 ?? '',
        shipping_address2: sourceOrder.shipping_address2 ?? '',
        shipping_city: sourceOrder.shipping_city ?? '',
        shipping_state: sourceOrder.shipping_state ?? '',
        shipping_zip: sourceOrder.shipping_zip ?? '',
        notes: `Auto-generated recurring order (${recurringOrder.frequency})`,
        subtotal_cents: subtotal
      })
      .select('id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
      .single();

    if (newOrderError || !newOrder) {
      errors.push({ recurringOrderId: recurringOrder.id, message: newOrderError?.message ?? 'Failed to create order' });
      continue;
    }

    const { error: newItemsError } = await supabaseAdmin.from('order_items').insert(
      recurringItems.map((item) => ({
        order_id: newOrder.id,
        product_id: item.product_id,
        product_name_snapshot: item.product_name_snapshot,
        qty: item.qty,
        unit_price_cents: item.unit_price_cents,
        line_total_cents: item.line_total_cents
      }))
    );

    if (newItemsError) {
      await supabaseAdmin.from('orders').delete().eq('id', newOrder.id);
      errors.push({ recurringOrderId: recurringOrder.id, message: newItemsError.message });
      continue;
    }

    const { error: updateRecurringOrderError } = await supabaseAdmin
      .from('recurring_orders')
      .update({ last_generated_at: new Date().toISOString() })
      .eq('id', recurringOrder.id);

    if (updateRecurringOrderError) {
      await supabaseAdmin.from('order_items').delete().eq('order_id', newOrder.id);
      await supabaseAdmin.from('orders').delete().eq('id', newOrder.id);
      errors.push({ recurringOrderId: recurringOrder.id, message: updateRecurringOrderError.message });
      continue;
    }

    const recurringProfile = Array.isArray(recurringOrder.profiles) ? recurringOrder.profiles[0] : recurringOrder.profiles;

    await sendOrderEmails({
      customerEmail: recurringProfile?.email ?? '',
      customerName: recurringProfile?.full_name ?? recurringProfile?.email ?? '',
      orderId: newOrder.id,
      shipping: newOrder,
      items: recurringItems.map((item) => ({
        name: item.product_name_snapshot ?? 'Unknown product',
        qty: item.qty,
        price: item.unit_price_cents,
        line: item.line_total_cents
      })),
      subtotalCents: subtotal
    });

    created += 1;
  }

  return NextResponse.json({ created, errors });
}

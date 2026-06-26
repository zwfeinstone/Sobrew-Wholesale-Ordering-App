import { NextResponse } from 'next/server';
import { getCenterLoginEmails } from '@/lib/center-logins';
import { sendOrderEmails } from '@/lib/email';
import { env } from '@/lib/env';
import { isRecurringOrderDue } from '@/lib/recurring';
import { supabaseAdmin } from '@/lib/supabase/admin';

type RecurringCronError = { recurringOrderId: string; message: string };

function normalizeStatus(recurringOrder: { status?: string | null; active?: boolean | null }) {
  if (recurringOrder.status) return recurringOrder.status;
  if (typeof recurringOrder.active === 'boolean') return recurringOrder.active ? 'active' : 'paused';
  return 'active';
}

function isAuthorizedCronRequest(req: Request) {
  if (!env.cronSecret) return false;

  const authorization = req.headers.get('authorization');
  if (authorization === `Bearer ${env.cronSecret}`) return true;

  const providedSecret = req.headers.get('x-cron-secret');
  return providedSecret === env.cronSecret;
}

function isForcedCronRequest(req: Request) {
  const url = new URL(req.url);
  return url.searchParams.get('force') === '1' || req.headers.get('x-cron-force') === 'true';
}

async function writeCronRunLog({
  activeRecurringCount = 0,
  completedAt = new Date().toISOString(),
  created,
  dueRecurringCount = 0,
  errors,
  forceRun,
  req,
  startedAt,
  status,
}: {
  activeRecurringCount?: number;
  completedAt?: string;
  created: number;
  dueRecurringCount?: number;
  errors: RecurringCronError[];
  forceRun: boolean;
  req: Request;
  startedAt: string;
  status: 'success' | 'error';
}) {
  try {
    const { error } = await supabaseAdmin.from('cron_run_log').insert({
      active_recurring_count: activeRecurringCount,
      completed_at: completedAt,
      created_count: created,
      cron_schedule: req.headers.get('x-vercel-cron-schedule'),
      due_recurring_count: dueRecurringCount,
      error_count: errors.length,
      errors,
      force_run: forceRun,
      invoked_at: startedAt,
      job_name: 'recurring_orders',
      request_method: req.method,
      status,
      user_agent: req.headers.get('user-agent'),
    });

    if (!error) return;
    console.error('[recurring-orders-cron] log insert failed', error);
  } catch (error) {
    console.error('[recurring-orders-cron] log insert threw', error);
  }
}

async function runRecurringOrders(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const startedAt = now.toISOString();
  const forceRun = isForcedCronRequest(req);

  const { data: recurringOrders, error: recurringOrdersError } = await supabaseAdmin
    .from('recurring_orders')
    .select('id,user_id,center_id,source_order_id,frequency,amount_cents,status,active,created_at,last_generated_at,profiles(email,full_name),centers(name)');

  if (recurringOrdersError) {
    await writeCronRunLog({
      created: 0,
      errors: [{ recurringOrderId: 'recurring_orders_query', message: recurringOrdersError.message }],
      forceRun,
      req,
      startedAt,
      status: 'error',
    });
    return NextResponse.json({ error: recurringOrdersError.message }, { status: 500 });
  }

  let created = 0;
  const errors: RecurringCronError[] = [];

  const activeRecurringOrders = (recurringOrders ?? []).filter((recurringOrder) => normalizeStatus(recurringOrder) === 'active');
  const dueRecurringOrders = activeRecurringOrders.filter((recurringOrder) => {
    const anchorDate = recurringOrder.last_generated_at ?? recurringOrder.created_at;
    return isRecurringOrderDue(recurringOrder.frequency, anchorDate, now);
  });

  if (!dueRecurringOrders.length) {
    await writeCronRunLog({
      activeRecurringCount: activeRecurringOrders.length,
      created,
      dueRecurringCount: dueRecurringOrders.length,
      errors,
      forceRun,
      req,
      startedAt,
      status: 'success',
    });
    return NextResponse.json({ created, errors });
  }

  const sourceOrderIds = [...new Set(dueRecurringOrders.map((recurringOrder) => recurringOrder.source_order_id).filter(Boolean))];
  const recurringOrderIds = dueRecurringOrders.map((recurringOrder) => recurringOrder.id);

  const [{ data: sourceOrders, error: sourceOrdersError }, { data: allRecurringItems, error: recurringItemsError }] = await Promise.all([
    supabaseAdmin
      .from('orders')
      .select('id,center_location_id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
      .in('id', sourceOrderIds),
    supabaseAdmin
      .from('recurring_order_items')
      .select('recurring_order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents')
      .in('recurring_order_id', recurringOrderIds),
  ]);

  if (sourceOrdersError) {
    await writeCronRunLog({
      activeRecurringCount: activeRecurringOrders.length,
      created,
      dueRecurringCount: dueRecurringOrders.length,
      errors: [{ recurringOrderId: 'source_orders_query', message: sourceOrdersError.message }],
      forceRun,
      req,
      startedAt,
      status: 'error',
    });
    return NextResponse.json({ error: sourceOrdersError.message }, { status: 500 });
  }

  if (recurringItemsError) {
    await writeCronRunLog({
      activeRecurringCount: activeRecurringOrders.length,
      created,
      dueRecurringCount: dueRecurringOrders.length,
      errors: [{ recurringOrderId: 'recurring_items_query', message: recurringItemsError.message }],
      forceRun,
      req,
      startedAt,
      status: 'error',
    });
    return NextResponse.json({ error: recurringItemsError.message }, { status: 500 });
  }

  const sourceOrderById = new Map((sourceOrders ?? []).map((sourceOrder) => [sourceOrder.id, sourceOrder]));
  const recurringItemsByOrderId = new Map<string, NonNullable<typeof allRecurringItems>>();
  for (const item of allRecurringItems ?? []) {
    const existing = recurringItemsByOrderId.get(item.recurring_order_id) ?? [];
    existing.push(item);
    recurringItemsByOrderId.set(item.recurring_order_id, existing);
  }

  const missingRecurringItemSourceOrderIds = dueRecurringOrders
    .filter((recurringOrder) => !recurringItemsByOrderId.get(recurringOrder.id)?.length && recurringOrder.source_order_id)
    .map((recurringOrder) => recurringOrder.source_order_id);

  const { data: sourceOrderItems, error: sourceOrderItemsError } = missingRecurringItemSourceOrderIds.length
    ? await supabaseAdmin
        .from('order_items')
        .select('order_id,product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents')
        .in('order_id', [...new Set(missingRecurringItemSourceOrderIds)])
    : { data: [] as Array<{
        order_id: string;
        product_id: string | null;
        product_name_snapshot: string | null;
        qty: number;
        unit_price_cents: number;
        line_total_cents: number;
      }>, error: null as null | { message: string } };

  if (sourceOrderItemsError) {
    await writeCronRunLog({
      activeRecurringCount: activeRecurringOrders.length,
      created,
      dueRecurringCount: dueRecurringOrders.length,
      errors: [{ recurringOrderId: 'source_order_items_query', message: sourceOrderItemsError.message }],
      forceRun,
      req,
      startedAt,
      status: 'error',
    });
    return NextResponse.json({ error: sourceOrderItemsError.message }, { status: 500 });
  }

  const recurringOrderIdBySourceOrderId = new Map(
    dueRecurringOrders
      .filter((recurringOrder) => recurringOrder.source_order_id)
      .map((recurringOrder) => [recurringOrder.source_order_id, recurringOrder.id])
  );
  for (const item of sourceOrderItems ?? []) {
    const recurringOrderId = recurringOrderIdBySourceOrderId.get(item.order_id);
    if (!recurringOrderId || recurringItemsByOrderId.get(recurringOrderId)?.length) continue;
    const existing = recurringItemsByOrderId.get(recurringOrderId) ?? [];
    existing.push({
      recurring_order_id: recurringOrderId,
      product_id: item.product_id,
      product_name_snapshot: item.product_name_snapshot,
      qty: item.qty,
      unit_price_cents: item.unit_price_cents,
      line_total_cents: item.line_total_cents
    });
    recurringItemsByOrderId.set(recurringOrderId, existing);
  }

  for (const recurringOrder of dueRecurringOrders) {
    const sourceOrder = sourceOrderById.get(recurringOrder.source_order_id);
    if (!sourceOrder) {
      errors.push({ recurringOrderId: recurringOrder.id, message: 'Missing source order' });
      continue;
    }

    const recurringItems = recurringItemsByOrderId.get(recurringOrder.id);
    if (!recurringItems?.length) {
      errors.push({ recurringOrderId: recurringOrder.id, message: 'Missing recurring order items' });
      continue;
    }

    const subtotal = recurringItems.reduce((sum, item) => sum + (item.line_total_cents ?? 0), 0);

    const { data: newOrder, error: newOrderError } = await supabaseAdmin
      .from('orders')
      .insert({
        center_id: recurringOrder.center_id,
        center_location_id: sourceOrder.center_location_id ?? null,
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
      .select('id,center_location_id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
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
      .update({ last_generated_at: now.toISOString() })
      .eq('id', recurringOrder.id);

    if (updateRecurringOrderError) {
      await supabaseAdmin.from('order_items').delete().eq('order_id', newOrder.id);
      await supabaseAdmin.from('orders').delete().eq('id', newOrder.id);
      errors.push({ recurringOrderId: recurringOrder.id, message: updateRecurringOrderError.message });
      continue;
    }

    const recurringProfile = Array.isArray(recurringOrder.profiles) ? recurringOrder.profiles[0] : recurringOrder.profiles;
    const recurringCenter = Array.isArray(recurringOrder.centers) ? recurringOrder.centers[0] : recurringOrder.centers;
    const centerEmails = await getCenterLoginEmails(supabaseAdmin, recurringOrder.center_id);

    await sendOrderEmails({
      customerEmail: centerEmails.length ? centerEmails : recurringProfile?.email ?? '',
      customerName: recurringCenter?.name ?? recurringProfile?.full_name ?? recurringProfile?.email ?? '',
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

  await writeCronRunLog({
    activeRecurringCount: activeRecurringOrders.length,
    created,
    dueRecurringCount: dueRecurringOrders.length,
    errors,
    forceRun,
    req,
    startedAt,
    status: errors.length ? 'error' : 'success',
  });

  return NextResponse.json({ created, errors });
}

export async function GET(req: Request) {
  return runRecurringOrders(req);
}

export async function POST(req: Request) {
  return runRecurringOrders(req);
}

import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { sendOrderEmails } from '@/lib/email';
import { env } from '@/lib/env';
import { elapsedMilliseconds, logServerTiming, serverTimingHeader } from '@/lib/server-performance';
import { supabaseAdmin } from '@/lib/supabase/admin';

type RecurringCronError = { recurringOrderId: string; message: string };

type GeneratedRecurringItem = {
  line_total_cents: number;
  name: string;
  price_cents: number;
  product_id: string | null;
  qty: number;
};

type GeneratedRecurringOrder = {
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

function isAuthorizedCronRequest(req: Request) {
  if (!env.cronSecret) return false;

  const authorization = req.headers.get('authorization');
  if (authorization === 'Bearer ' + env.cronSecret) return true;

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

function generatedItems(value: unknown): GeneratedRecurringItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const qty = Number(item.qty);
    const price = Number(item.price_cents);
    const line = Number(item.line_total_cents);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isInteger(price) || price < 0 || !Number.isInteger(line) || line < 0) {
      return [];
    }

    return [{
      line_total_cents: line,
      name: typeof item.name === 'string' && item.name ? item.name : 'Unknown product',
      price_cents: price,
      product_id: typeof item.product_id === 'string' ? item.product_id : null,
      qty,
    }];
  });
}

async function runRecurringOrders(req: Request) {
  const cronStartedAt = performance.now();
  const respond = (body: Record<string, unknown>, status = 200, outcome = 'success') => {
    const durationMs = elapsedMilliseconds(cronStartedAt);
    logServerTiming('recurring_cron', cronStartedAt, { outcome, status });
    const response = NextResponse.json(body, { status });
    response.headers.set('Server-Timing', serverTimingHeader([{ name: 'cron', durationMs }]));
    return response;
  };

  if (!isAuthorizedCronRequest(req)) {
    return respond({ error: 'unauthorized' }, 401, 'unauthorized');
  }

  const startedAt = new Date().toISOString();
  const forceRun = isForcedCronRequest(req);

  let dueRecurringOrdersQuery = supabaseAdmin
    .from('recurring_orders')
    .select('id,center_id,next_run_at,profiles(email,full_name),centers(name)')
    .eq('status', 'active')
    .order('next_run_at', { ascending: true })
    .limit(1000);
  if (!forceRun) {
    dueRecurringOrdersQuery = dueRecurringOrdersQuery.lte('next_run_at', startedAt);
  }

  const [
    { data: recurringOrders, error: recurringOrdersError },
    { count: activeRecurringCount },
  ] = await Promise.all([
    dueRecurringOrdersQuery,
    supabaseAdmin
      .from('recurring_orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
  ]);

  if (recurringOrdersError) {
    const errors = [{ recurringOrderId: 'recurring_orders_query', message: recurringOrdersError.message }];
    await writeCronRunLog({
      created: 0,
      errors,
      forceRun,
      req,
      startedAt,
      status: 'error',
    });
    return respond({ error: recurringOrdersError.message }, 500, 'query_error');
  }

  const dueRecurringOrders = recurringOrders ?? [];
  const errors: RecurringCronError[] = [];
  let created = 0;
  let skippedDuplicates = 0;

  if (!dueRecurringOrders.length) {
    await writeCronRunLog({
      activeRecurringCount: activeRecurringCount ?? 0,
      created,
      dueRecurringCount: 0,
      errors,
      forceRun,
      req,
      startedAt,
      status: 'success',
    });
    return respond({ created, errors, skippedDuplicates }, 200, 'no_due_orders');
  }

  const dueCenterIds = [...new Set(
    dueRecurringOrders
      .map((recurringOrder) => recurringOrder.center_id)
      .filter((centerId): centerId is string => Boolean(centerId))
  )];

  const { data: centerProfiles, error: centerProfilesError } = dueCenterIds.length
    ? await supabaseAdmin
      .from('profiles')
      .select('center_id,email')
      .in('center_id', dueCenterIds)
      .eq('is_admin', false)
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1000)
    : { data: [] as Array<{ center_id: string | null; email: string | null }>, error: null };

  if (centerProfilesError) {
    console.error('[recurring-orders-cron] center login email batch query failed', centerProfilesError);
  }

  const centerEmailsByCenterId = new Map<string, string[]>();
  for (const profile of centerProfiles ?? []) {
    if (!profile.center_id || !profile.email) continue;
    const emails = centerEmailsByCenterId.get(profile.center_id) ?? [];
    if (!emails.includes(profile.email)) emails.push(profile.email);
    centerEmailsByCenterId.set(profile.center_id, emails);
  }

  const emailTasks: Array<() => Promise<void>> = [];

  for (const recurringOrder of dueRecurringOrders) {
    const scheduledFor = recurringOrder.next_run_at;
    if (!scheduledFor || Number.isNaN(new Date(scheduledFor).getTime())) {
      errors.push({ recurringOrderId: recurringOrder.id, message: 'Invalid recurring schedule' });
      continue;
    }

    const { data: generatedOrder, error: generationError } = await supabaseAdmin
      .rpc('generate_recurring_order', {
        p_recurring_order_id: recurringOrder.id,
        p_scheduled_for: scheduledFor,
      })
      .single();

    if (generationError || !generatedOrder) {
      errors.push({
        recurringOrderId: recurringOrder.id,
        message: generationError?.message ?? 'Failed to generate recurring order',
      });
      continue;
    }

    const generation = generatedOrder as GeneratedRecurringOrder;

    if (!generation.was_created) {
      skippedDuplicates += 1;
      continue;
    }

    const items = generatedItems(generation.placed_items);
    if (!items.length) {
      errors.push({
        recurringOrderId: recurringOrder.id,
        message: 'Generated order returned no valid line items',
      });
      continue;
    }

    const recurringProfile = Array.isArray(recurringOrder.profiles)
      ? recurringOrder.profiles[0]
      : recurringOrder.profiles;
    const recurringCenter = Array.isArray(recurringOrder.centers)
      ? recurringOrder.centers[0]
      : recurringOrder.centers;
    const centerEmails = recurringOrder.center_id
      ? centerEmailsByCenterId.get(recurringOrder.center_id) ?? []
      : [];

    emailTasks.push(() => sendOrderEmails({
      customerEmail: centerEmails.length ? centerEmails : recurringProfile?.email ?? '',
      customerName: recurringCenter?.name ?? recurringProfile?.full_name ?? recurringProfile?.email ?? '',
      orderId: generation.order_id,
      shipping: {
        center_location_id: generation.center_location_id,
        shipping_name: generation.shipping_name,
        shipping_address1: generation.shipping_address1,
        shipping_address2: generation.shipping_address2,
        shipping_city: generation.shipping_city,
        shipping_state: generation.shipping_state,
        shipping_zip: generation.shipping_zip,
      },
      items: items.map((item) => ({
        name: item.name,
        qty: item.qty,
        price: item.price_cents,
        line: item.line_total_cents,
      })),
      subtotalCents: generation.subtotal_cents,
    }));

    created += 1;
  }

  if (emailTasks.length) {
    const backgroundEmails = Promise.allSettled(emailTasks.map((task) => task())).then((results) => {
      const rejected = results.filter((result) => result.status === 'rejected');
      if (rejected.length) {
        console.error('[recurring-orders-cron] background email tasks rejected', { count: rejected.length });
      }
    });
    waitUntil(backgroundEmails);
  }

  await writeCronRunLog({
    activeRecurringCount: activeRecurringCount ?? dueRecurringOrders.length,
    created,
    dueRecurringCount: dueRecurringOrders.length,
    errors,
    forceRun,
    req,
    startedAt,
    status: errors.length ? 'error' : 'success',
  });

  return respond(
    { created, errors, skippedDuplicates },
    errors.length ? 207 : 200,
    errors.length ? 'partial_error' : 'success'
  );
}

export async function GET(req: Request) {
  return runRecurringOrders(req);
}

export async function POST(req: Request) {
  return runRecurringOrders(req);
}

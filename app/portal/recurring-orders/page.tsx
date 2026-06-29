import Link from 'next/link';
import { redirect } from 'next/navigation';
import ConfirmSubmitButton from '@/components/confirm-submit-button';
import PendingSubmitButton from '@/components/pending-submit-button';
import { requireUser } from '@/lib/auth';
import { daysForRecurringFrequency, formatNextRecurringOrderDate, isRecurringFrequency, labelForRecurringFrequency, RECURRING_FREQUENCY_OPTIONS } from '@/lib/recurring';
import { getCenterLoginEmails } from '@/lib/center-logins';
import { sendOrderEmails } from '@/lib/email';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

type SupabaseErrorShape = {
  message?: string;
  details?: string;
  hint?: string;
  code?: string;
};

type RecurringOrderRow = {
  id: string;
  user_id?: string | null;
  center_id?: string | null;
  frequency: string;
  status?: string | null;
  active?: boolean | null;
  created_at: string | null;
  last_generated_at: string | null;
  source_order_id?: string | null;
  amount_cents?: number | null;
  profiles?: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null;
  centers?: { name: string | null } | { name: string | null }[] | null;
};

type RecurringOrderItemSnapshot = {
  product_id: string | null;
  product_name_snapshot: string | null;
  qty: number;
  unit_price_cents: number;
  line_total_cents: number | null;
};

function logQueryError(query: string, error: SupabaseErrorShape | null, extra?: Record<string, unknown>) {
  if (!error) return;
  console.error('[recurring-orders] query failed', {
    query,
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
    ...extra
  });
}

function normalizeStatus(order: RecurringOrderRow) {
  if (order.status) return order.status;
  if (typeof order.active === 'boolean') return order.active ? 'active' : 'paused';
  return 'active';
}

function relatedOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function frequencyWeeksLabel(frequency: string) {
  const days = daysForRecurringFrequency(frequency);
  if (!days || days % 7 !== 0) return labelForRecurringFrequency(frequency).replace(/^Every\s+/i, '').toLowerCase();

  const weeks = days / 7;
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

async function reactivateRecurringOrderAndCreateOrder({
  recurringOrder,
  user,
  profile,
  now,
}: {
  recurringOrder: RecurringOrderRow & { center_id: string };
  user: { id: string; email?: string | null };
  profile: { email?: string | null; full_name?: string | null; center?: { name?: string | null } | null };
  now: Date;
}) {
  const [{ data: sourceOrder, error: sourceOrderError }, { data: storedRecurringItems, error: recurringItemsError }] = await Promise.all([
    recurringOrder.source_order_id
      ? supabaseAdmin
          .from('orders')
          .select('id,center_location_id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
          .eq('id', recurringOrder.source_order_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin
      .from('recurring_order_items')
      .select('product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents')
      .eq('recurring_order_id', recurringOrder.id),
  ]);

  if (sourceOrderError) {
    return { ok: false as const, message: sourceOrderError.message };
  }

  if (recurringItemsError) {
    return { ok: false as const, message: recurringItemsError.message };
  }

  let recurringItems = (storedRecurringItems ?? []) as RecurringOrderItemSnapshot[];
  if (!recurringItems.length && recurringOrder.source_order_id) {
    const { data: sourceOrderItems, error: sourceOrderItemsError } = await supabaseAdmin
      .from('order_items')
      .select('product_id,product_name_snapshot,qty,unit_price_cents,line_total_cents')
      .eq('order_id', recurringOrder.source_order_id);

    if (sourceOrderItemsError) {
      return { ok: false as const, message: sourceOrderItemsError.message };
    }

    recurringItems = (sourceOrderItems ?? []) as RecurringOrderItemSnapshot[];
  }

  if (!recurringItems.length) {
    return { ok: false as const, message: 'Missing recurring order items' };
  }

  let shippingSource = sourceOrder;
  if (!shippingSource) {
    const { data: lastOrder, error: lastOrderError } = await supabaseAdmin
      .from('orders')
      .select('id,center_location_id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
      .eq('center_id', recurringOrder.center_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastOrderError) {
      return { ok: false as const, message: lastOrderError.message };
    }

    shippingSource = lastOrder;
  }

  const activatedAt = now.toISOString();
  const previousLastGeneratedAt = recurringOrder.last_generated_at ?? null;
  const previousActive = recurringOrder.active === true;
  const claimResult = await supabaseAdmin
    .from('recurring_orders')
    .update({ status: 'active', active: true, last_generated_at: activatedAt })
    .eq('id', recurringOrder.id)
    .eq('center_id', recurringOrder.center_id)
    .select('id')
    .maybeSingle();

  if (claimResult.error) {
    return { ok: false as const, message: claimResult.error.message };
  }

  if (!claimResult.data) {
    return { ok: true as const, orderId: null as string | null };
  }

  const rollbackSchedule = async () => {
    await supabaseAdmin
      .from('recurring_orders')
      .update({ status: 'paused', active: previousActive, last_generated_at: previousLastGeneratedAt })
      .eq('id', recurringOrder.id)
      .eq('center_id', recurringOrder.center_id);
  };

  const subtotal = recurringItems.reduce((sum, item) => sum + (item.line_total_cents ?? item.qty * item.unit_price_cents), 0);
  const { data: newOrder, error: newOrderError } = await supabaseAdmin
    .from('orders')
    .insert({
      center_id: recurringOrder.center_id,
      center_location_id: shippingSource?.center_location_id ?? null,
      user_id: user.id,
      shipping_name: shippingSource?.shipping_name ?? profile.center?.name ?? profile.full_name ?? profile.email ?? user.email ?? '',
      shipping_address1: shippingSource?.shipping_address1 ?? '',
      shipping_address2: shippingSource?.shipping_address2 ?? '',
      shipping_city: shippingSource?.shipping_city ?? '',
      shipping_state: shippingSource?.shipping_state ?? '',
      shipping_zip: shippingSource?.shipping_zip ?? '',
      notes: `Auto-generated recurring order (${recurringOrder.frequency})`,
      subtotal_cents: subtotal,
    })
    .select('id,center_location_id,shipping_name,shipping_address1,shipping_address2,shipping_city,shipping_state,shipping_zip')
    .single();

  if (newOrderError || !newOrder) {
    await rollbackSchedule();
    return { ok: false as const, message: newOrderError?.message ?? 'Failed to create order' };
  }

  const newOrderItems = recurringItems.map((item) => ({
    order_id: newOrder.id,
    product_id: item.product_id,
    product_name_snapshot: item.product_name_snapshot,
    qty: item.qty,
    unit_price_cents: item.unit_price_cents,
    line_total_cents: item.line_total_cents ?? item.qty * item.unit_price_cents,
  }));
  const { error: newItemsError } = await supabaseAdmin.from('order_items').insert(newOrderItems);

  if (newItemsError) {
    await supabaseAdmin.from('orders').delete().eq('id', newOrder.id);
    await rollbackSchedule();
    return { ok: false as const, message: newItemsError.message };
  }

  const recurringProfile = relatedOne(recurringOrder.profiles);
  const recurringCenter = relatedOne(recurringOrder.centers);
  const centerEmails = (await getCenterLoginEmails(supabaseAdmin, recurringOrder.center_id)) as string[];

  await sendOrderEmails({
    customerEmail: centerEmails.length ? centerEmails : profile.email ?? user.email ?? recurringProfile?.email ?? '',
    customerName: recurringCenter?.name ?? profile.center?.name ?? profile.full_name ?? profile.email ?? user.email ?? '',
    orderId: newOrder.id,
    shipping: newOrder,
    items: recurringItems.map((item) => ({
      name: item.product_name_snapshot ?? 'Unknown product',
      qty: item.qty,
      price: item.unit_price_cents,
      line: item.line_total_cents ?? item.qty * item.unit_price_cents,
    })),
    subtotalCents: subtotal,
  });

  return { ok: true as const, orderId: newOrder.id as string | null };
}


function isNextFrameworkError(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'digest' in error &&
      typeof (error as { digest?: unknown }).digest === 'string' &&
      ((error as { digest: string }).digest.startsWith('NEXT_REDIRECT') ||
        (error as { digest: string }).digest === 'DYNAMIC_SERVER_USAGE')
  );
}
function statusClasses(status: string) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (status === 'paused') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-slate-200 bg-slate-100 text-slate-700';
}

async function updateRecurringFrequency(formData: FormData) {
  'use server';
  let userId = 'unknown';
  let centerId = 'unknown';
  try {
    const { user, profile } = await requireUser();
    userId = user.id;
    centerId = profile?.center_id ?? user.id;
    const supabase = await createClient();

    const recurringOrderId = String(formData.get('recurring_order_id') ?? '');
    const frequency = String(formData.get('frequency') ?? '');

    if (!recurringOrderId || !isRecurringFrequency(frequency)) {
      redirect('/portal/recurring-orders?error=invalid_input');
    }

    const orderUpdateResult = await supabase
      .from('recurring_orders')
      .update({ frequency })
      .eq('id', recurringOrderId)
      .eq('center_id', centerId);
    logQueryError('recurring_orders.update frequency', orderUpdateResult.error, { userId, centerId, recurringOrderId, frequency });
    if (orderUpdateResult.error) redirect('/portal/recurring-orders?error=save_failed');

    redirect('/portal/recurring-orders?success=saved');
  } catch (error) {
    if (isNextFrameworkError(error)) throw error;
    console.error('[recurring-orders] updateRecurringFrequency fatal', { userId, centerId, error });
    redirect('/portal/recurring-orders?error=save_failed');
  }
}

async function updateRecurringItem(formData: FormData) {
  'use server';
  let userId = 'unknown';
  let centerId = 'unknown';
  try {
    const { user, profile } = await requireUser();
    userId = user.id;
    centerId = profile?.center_id ?? user.id;
    const supabase = await createClient();

    const recurringOrderId = String(formData.get('recurring_order_id') ?? '');
    const recurringItemId = String(formData.get('recurring_item_id') ?? '');
    const qty = Number(formData.get('qty'));

    if (!recurringOrderId || !recurringItemId || !Number.isInteger(qty) || qty < 1) {
      redirect('/portal/recurring-orders?error=invalid_input');
    }

    const recurringItemResult = await supabase
      .from('recurring_order_items')
      .select('id,recurring_order_id,unit_price_cents')
      .eq('id', recurringItemId)
      .single();
    logQueryError('recurring_order_items.single for update', recurringItemResult.error, { userId, recurringOrderId, recurringItemId });
    const recurringItem = recurringItemResult.data;

    if (recurringItemResult.error || !recurringItem || recurringItem.recurring_order_id !== recurringOrderId) {
      redirect('/portal/recurring-orders?error=not_found');
    }

    const itemUpdateResult = await supabase
      .from('recurring_order_items')
      .update({ qty, line_total_cents: qty * recurringItem.unit_price_cents })
      .eq('id', recurringItemId);
    logQueryError('recurring_order_items.update qty', itemUpdateResult.error, { userId, recurringOrderId, recurringItemId, qty });
    if (itemUpdateResult.error) redirect('/portal/recurring-orders?error=save_failed');

    const allItemsResult = await supabase
      .from('recurring_order_items')
      .select('line_total_cents')
      .eq('recurring_order_id', recurringOrderId);
    logQueryError('recurring_order_items.select line_total_cents', allItemsResult.error, { userId, recurringOrderId });
    if (allItemsResult.error || !allItemsResult.data) redirect('/portal/recurring-orders?error=save_failed');

    const amount = allItemsResult.data.reduce((sum, item) => sum + (item.line_total_cents ?? 0), 0);
    const totalUpdateResult = await supabase
      .from('recurring_orders')
      .update({ amount_cents: amount })
      .eq('id', recurringOrderId)
      .eq('center_id', centerId);
    logQueryError('recurring_orders.update amount_cents', totalUpdateResult.error, { userId, centerId, recurringOrderId, amount });
    if (totalUpdateResult.error) redirect('/portal/recurring-orders?error=save_failed');

    redirect('/portal/recurring-orders?success=saved');
  } catch (error) {
    if (isNextFrameworkError(error)) throw error;
    console.error('[recurring-orders] updateRecurringItem fatal', { userId, centerId, error });
    redirect('/portal/recurring-orders?error=save_failed');
  }
}

async function removeRecurringItem(formData: FormData) {
  'use server';
  let userId = 'unknown';
  let centerId = 'unknown';
  try {
    const { user, profile } = await requireUser();
    userId = user.id;
    centerId = profile?.center_id ?? user.id;
    const supabase = await createClient();

    const recurringOrderId = String(formData.get('recurring_order_id') ?? '');
    const recurringItemId = String(formData.get('recurring_item_id') ?? '');

    if (!recurringOrderId || !recurringItemId) {
      redirect('/portal/recurring-orders?error=invalid_input');
    }

    const recurringOrderResult = await supabase
      .from('recurring_orders')
      .select('id')
      .eq('id', recurringOrderId)
      .eq('center_id', centerId)
      .maybeSingle();
    logQueryError('recurring_orders.select for item removal', recurringOrderResult.error, { userId, centerId, recurringOrderId, recurringItemId });

    if (recurringOrderResult.error || !recurringOrderResult.data) {
      redirect('/portal/recurring-orders?error=not_found');
    }

    const itemsResult = await supabaseAdmin
      .from('recurring_order_items')
      .select('id,line_total_cents')
      .eq('recurring_order_id', recurringOrderId);
    logQueryError('recurring_order_items.select for removal', itemsResult.error, { userId, centerId, recurringOrderId, recurringItemId });

    if (itemsResult.error || !itemsResult.data) {
      redirect('/portal/recurring-orders?error=save_failed');
    }

    const recurringItems = itemsResult.data as Array<{ id: string; line_total_cents: number | null }>;
    const itemToRemove = recurringItems.find((item) => item.id === recurringItemId);

    if (!itemToRemove) {
      redirect('/portal/recurring-orders?error=not_found');
    }

    if (recurringItems.length <= 1) {
      redirect('/portal/recurring-orders?error=last_item');
    }

    const deleteResult = await supabaseAdmin
      .from('recurring_order_items')
      .delete()
      .eq('id', recurringItemId)
      .eq('recurring_order_id', recurringOrderId)
      .select('id')
      .maybeSingle();
    logQueryError('recurring_order_items.delete item', deleteResult.error, { userId, centerId, recurringOrderId, recurringItemId });

    if (deleteResult.error || !deleteResult.data) {
      redirect('/portal/recurring-orders?error=save_failed');
    }

    const amount = recurringItems
      .filter((item) => item.id !== recurringItemId)
      .reduce((sum, item) => sum + (item.line_total_cents ?? 0), 0);
    const totalUpdateResult = await supabaseAdmin
      .from('recurring_orders')
      .update({ amount_cents: amount })
      .eq('id', recurringOrderId)
      .eq('center_id', centerId);
    logQueryError('recurring_orders.update amount_cents after removal', totalUpdateResult.error, { userId, centerId, recurringOrderId, amount });

    if (totalUpdateResult.error) redirect('/portal/recurring-orders?error=save_failed');

    redirect('/portal/recurring-orders?success=item_removed');
  } catch (error) {
    if (isNextFrameworkError(error)) throw error;
    console.error('[recurring-orders] removeRecurringItem fatal', { userId, centerId, error });
    redirect('/portal/recurring-orders?error=save_failed');
  }
}

async function setRecurringStatus(formData: FormData) {
  'use server';
  let userId = 'unknown';
  let centerId = 'unknown';
  try {
    const { user, profile } = await requireUser();
    userId = user.id;
    centerId = profile?.center_id ?? user.id;
    const supabase = await createClient();

    const recurringOrderId = String(formData.get('recurring_order_id') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!recurringOrderId || !['active', 'paused', 'canceled'].includes(status)) {
      redirect('/portal/recurring-orders?error=invalid_status');
    }

    if (status === 'canceled') {
      const cancelResult = await supabase
        .from('recurring_orders')
        .update({ status: 'canceled', active: false })
        .eq('id', recurringOrderId)
        .eq('center_id', centerId);
      logQueryError('recurring_orders.update canceled order', cancelResult.error, { userId, centerId, recurringOrderId, status });
      if (cancelResult.error) redirect('/portal/recurring-orders?error=status_failed');
      redirect('/portal/recurring-orders?success=status_updated');
    }

    if (status === 'active') {
      const recurringOrderResult = await supabaseAdmin
        .from('recurring_orders')
        .select('id,user_id,center_id,source_order_id,frequency,amount_cents,status,active,created_at,last_generated_at,profiles(email,full_name),centers(name)')
        .eq('id', recurringOrderId)
        .eq('center_id', centerId)
        .maybeSingle();
      logQueryError('recurring_orders.select for reactivation', recurringOrderResult.error, { userId, centerId, recurringOrderId, status });

      const recurringOrder = recurringOrderResult.data as (RecurringOrderRow & { center_id: string }) | null;
      if (recurringOrderResult.error || !recurringOrder) redirect('/portal/recurring-orders?error=status_failed');

      if (normalizeStatus(recurringOrder) === 'paused') {
        const result = await reactivateRecurringOrderAndCreateOrder({ recurringOrder, user, profile, now: new Date() });
        if (!result.ok) {
          console.error('[recurring-orders] reactivation order generation failed', { userId, centerId, recurringOrderId, message: result.message });
          redirect('/portal/recurring-orders?error=reactivation_failed');
        }

        redirect(result.orderId ? '/portal/recurring-orders?success=reactivated' : '/portal/recurring-orders?success=status_updated');
      }
    }

    const statusUpdateResult = await supabase
      .from('recurring_orders')
      .update({ status, active: status === 'active' })
      .eq('id', recurringOrderId)
      .eq('center_id', centerId);
    logQueryError('recurring_orders.update status', statusUpdateResult.error, { userId, centerId, recurringOrderId, status });

    if (statusUpdateResult.error) {
      const legacyStatusResult = await supabase
        .from('recurring_orders')
        .update({ active: status === 'active' })
        .eq('id', recurringOrderId)
        .eq('center_id', centerId);
      logQueryError('recurring_orders.update active (legacy fallback)', legacyStatusResult.error, { userId, centerId, recurringOrderId, status });
      if (legacyStatusResult.error) redirect('/portal/recurring-orders?error=status_failed');
    }

    redirect('/portal/recurring-orders?success=status_updated');
  } catch (error) {
    if (isNextFrameworkError(error)) throw error;
    console.error('[recurring-orders] setRecurringStatus fatal', { userId, centerId, error });
    redirect('/portal/recurring-orders?error=status_failed');
  }
}

export default async function RecurringOrdersPage({ searchParams }: { searchParams?: { success?: string; error?: string } }) {
  let userId = 'unknown';
  let centerId = 'unknown';
  try {
    const { user, profile } = await requireUser();
    userId = user.id;
    centerId = profile?.center_id ?? user.id;
    const supabase = await createClient();

    const recurringOrdersResult = await supabase
      .from('recurring_orders')
      .select('id,frequency,status,active,created_at,last_generated_at,source_order_id,amount_cents')
      .eq('center_id', centerId)
      .neq('status', 'canceled')
      .order('created_at', { ascending: false });
    logQueryError('recurring_orders.select recurring order summary fields', recurringOrdersResult.error, { userId, centerId });

    if (recurringOrdersResult.error) {
      return <div className="card text-sm text-red-700">Unable to load recurring orders right now.</div>;
    }

    const recurringOrders = ((recurringOrdersResult.data ?? []) as RecurringOrderRow[]).filter((order) => normalizeStatus(order) !== 'canceled');
    const recurringOrderIds = recurringOrders.map((order) => order.id);

    const recurringItemsResult = recurringOrderIds.length
      ? await supabase
          .from('recurring_order_items')
          .select('id,recurring_order_id,product_name_snapshot,qty,unit_price_cents')
          .in('recurring_order_id', recurringOrderIds)
      : { data: [] as any[], error: null as any };
    logQueryError('recurring_order_items.select by recurring_order_id', recurringItemsResult.error, {
      userId,
      centerId,
      recurringOrderCount: recurringOrderIds.length
    });

    let normalizedItems: Array<{ id: string; recurring_order_id: string; product_name_snapshot: string | null; qty: number; unit_price_cents: number }> =
      (recurringItemsResult.data ?? []) as any[];

    if (recurringItemsResult.error) {
      const sourceOrderIds = recurringOrders.map((order) => order.source_order_id).filter(Boolean) as string[];
      const sourceItemsResult = sourceOrderIds.length
        ? await supabase
            .from('order_items')
            .select('id,order_id,product_name_snapshot,qty,unit_price_cents')
            .in('order_id', sourceOrderIds)
        : { data: [] as any[], error: null as any };
      logQueryError('order_items.select legacy fallback by source order_id', sourceItemsResult.error, {
        userId,
        centerId,
        sourceOrderCount: sourceOrderIds.length
      });

      if (sourceItemsResult.error) {
        return <div className="card text-sm text-red-700">Unable to load recurring orders right now.</div>;
      }

      const recurringOrderIdBySourceOrderId = new Map(recurringOrders.map((order) => [order.source_order_id, order.id]));
      normalizedItems = (sourceItemsResult.data ?? []).map((item: any) => ({
        id: item.id,
        recurring_order_id: recurringOrderIdBySourceOrderId.get(item.order_id) ?? '',
        product_name_snapshot: item.product_name_snapshot,
        qty: item.qty,
        unit_price_cents: item.unit_price_cents
      }));
    }

    const itemsByOrderId = new Map<string, any[]>();
    for (const item of normalizedItems) {
      const existing = itemsByOrderId.get(item.recurring_order_id) ?? [];
      existing.push(item);
      itemsByOrderId.set(item.recurring_order_id, existing);
    }

    return (
      <div className="recurring-page space-y-6">
        <section className="panel recurring-hero">
          <span className="eyebrow">Recurring Orders</span>
          <h1 className="page-title recurring-title mt-4">Manage your recurring shipments</h1>
          <p className="page-subtitle recurring-subtitle mt-3">Update quantities and frequency, remove products from multi-item shipments, pause shipments, or cancel schedules whenever your center&apos;s needs change.</p>
        </section>

        {searchParams?.success ? (
          <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            {searchParams.success === 'reactivated'
              ? "Recurring shipment resumed and today's order was created."
              : searchParams.success === 'item_removed'
                ? 'Product removed from recurring shipment.'
                : 'Saved successfully.'}
          </div>
        ) : null}
        {searchParams?.error ? (
          <div className="rounded-[1.5rem] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {searchParams.error === 'reactivation_failed'
              ? "Could not resume this shipment or create today's order."
              : searchParams.error === 'last_item'
                ? 'A recurring shipment needs at least one product. Cancel the schedule if you want to stop it.'
                : 'Could not save your changes.'}
          </div>
        ) : null}

        {!recurringOrders.length ? (
          <div className="empty-state">
            <p className="text-lg font-semibold text-slate-950">No recurring shipments yet.</p>
            <p className="mt-2 text-sm text-slate-500">Create one during checkout by selecting &quot;Make this order recurring&quot; before placing the order.</p>
            <Link href="/portal" className="btn-secondary mt-4 inline-flex">Browse catalog</Link>
          </div>
        ) : null}

        {recurringOrders.map((order) => {
          const currentStatus = normalizeStatus(order);
          const orderItems = itemsByOrderId.get(order.id) ?? [];
          const projectedSubtotal = orderItems.reduce((sum, item) => sum + item.qty * item.unit_price_cents, 0) || order.amount_cents || 0;
          const resumeInterval = frequencyWeeksLabel(order.frequency);
          const resumeMessage = `This will trigger an order today. The next automatic order will be ${resumeInterval} from today.`;
          return (
            <div key={order.id} className="recurring-card recurring-order-card space-y-5">
              <div className="recurring-card-header grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                <div className="recurring-metrics grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="recurring-metric">
                    <p className="recurring-metric-label text-sm uppercase tracking-[0.18em] text-slate-500">Next order date</p>
                    <p className="recurring-metric-value mt-2 text-lg font-semibold text-slate-950">{formatNextRecurringOrderDate(order.frequency, order.last_generated_at ?? order.created_at)}</p>
                  </div>
                  <div className="recurring-metric">
                    <p className="recurring-metric-label text-sm uppercase tracking-[0.18em] text-slate-500">Frequency</p>
                    <p className="recurring-metric-value mt-2 text-lg font-semibold text-slate-950">{labelForRecurringFrequency(order.frequency)}</p>
                  </div>
                  <div className="recurring-metric">
                    <p className="recurring-metric-label text-sm uppercase tracking-[0.18em] text-slate-500">Items</p>
                    <p className="recurring-metric-value mt-2 text-lg font-semibold text-slate-950">{orderItems.length}</p>
                  </div>
                  <div className="recurring-metric">
                    <p className="recurring-metric-label text-sm uppercase tracking-[0.18em] text-slate-500">Projected subtotal</p>
                    <p className="recurring-metric-value mt-2 text-lg font-semibold text-slate-950">{usd(projectedSubtotal)}</p>
                  </div>
                </div>
                <span className={`recurring-status inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusClasses(currentStatus)}`}>{currentStatus}</span>
              </div>

              <div className="subtle-panel recurring-items-panel space-y-2">
                {(orderItems.length ? orderItems : []).map((item) => (
                  <div key={item.id} className="recurring-item-row flex flex-col gap-1 border-b border-slate-100 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <p className="recurring-item-name font-medium text-slate-950">{item.product_name_snapshot ?? 'Unknown product'}</p>
                    <p className="recurring-item-meta text-sm text-slate-500">{item.qty} x {usd(item.unit_price_cents)}</p>
                  </div>
                ))}
                {!orderItems.length ? <p className="text-sm text-slate-500">No items are attached to this recurring shipment.</p> : null}
              </div>

              <details className="recurring-edit-panel">
                <summary className="recurring-edit-summary cursor-pointer text-sm font-semibold text-slate-950">Edit schedule and quantities</summary>
                <div className="recurring-edit-content mt-4 space-y-4">
                  <form action={updateRecurringFrequency} className="recurring-frequency-form grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <input type="hidden" name="recurring_order_id" value={order.id} />
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-slate-500">Shipment frequency</span>
                      <select className="input" name="frequency" defaultValue={order.frequency}>
                        {RECURRING_FREQUENCY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                    <PendingSubmitButton
                      className="btn-secondary recurring-action-button w-full md:w-auto"
                      label="Save Schedule"
                      pendingLabel="Saving..."
                    />
                  </form>

                  <div className="recurring-item-forms space-y-3">
                    {orderItems.map((item) => (
                      <div key={item.id} className="recurring-item-form grid gap-3 rounded-2xl border border-white/70 bg-white/55 p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                        <form action={updateRecurringItem} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end">
                          <input type="hidden" name="recurring_order_id" value={order.id} />
                          <input type="hidden" name="recurring_item_id" value={item.id} />
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Product</div>
                            <div className="mt-2 text-sm font-medium text-slate-950">{item.product_name_snapshot ?? 'Unknown product'}</div>
                          </div>
                          <label className="text-sm">
                            <span className="mb-1 block text-xs text-slate-500">Quantity</span>
                            <input className="input" type="number" name="qty" min={1} defaultValue={item.qty} />
                          </label>
                          <PendingSubmitButton
                            className="btn-primary recurring-action-button w-full md:w-auto"
                            label="Save Quantity"
                            pendingLabel="Saving..."
                          />
                        </form>
                        {orderItems.length > 1 ? (
                          <form action={removeRecurringItem}>
                            <input type="hidden" name="recurring_order_id" value={order.id} />
                            <input type="hidden" name="recurring_item_id" value={item.id} />
                            <ConfirmSubmitButton
                              className="recurring-remove-button w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70 lg:w-auto"
                              confirmMessage={`Remove ${item.product_name_snapshot ?? 'this product'} from this recurring shipment?`}
                              label="Remove"
                              pendingLabel="Removing..."
                            />
                          </form>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </details>

              <div className="recurring-actions flex flex-col gap-3 sm:flex-row">
                <form action={setRecurringStatus} className="w-full sm:w-auto">
                  <input type="hidden" name="recurring_order_id" value={order.id} />
                  <input type="hidden" name="status" value={currentStatus === 'paused' ? 'active' : 'paused'} />
                  {currentStatus === 'paused' ? (
                    <ConfirmSubmitButton
                      className="btn-secondary recurring-action-button w-full"
                      confirmMessage={resumeMessage}
                      label="Resume shipment"
                      pendingLabel="Resuming..."
                    />
                  ) : (
                    <PendingSubmitButton
                      className="btn-secondary recurring-action-button w-full"
                      label="Pause shipment"
                      pendingLabel="Pausing..."
                    />
                  )}
                </form>
                <form action={setRecurringStatus} className="w-full sm:w-auto">
                  <input type="hidden" name="recurring_order_id" value={order.id} />
                  <input type="hidden" name="status" value="canceled" />
                  <ConfirmSubmitButton
                    className="recurring-cancel-button w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
                    confirmMessage="Cancel this recurring shipment schedule? This stops future automatic orders for this schedule."
                    label="Cancel schedule"
                    pendingLabel="Canceling..."
                  />
                </form>
              </div>
              {currentStatus === 'paused' ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Resuming this shipment will trigger an order today. The next automatic order will be {resumeInterval} from today.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  } catch (error) {
    if (isNextFrameworkError(error)) throw error;
    console.error('[recurring-orders] page render fatal', { userId, centerId, error });
    return <div className="card text-sm text-red-700">Unable to load recurring orders right now.</div>;
  }
}

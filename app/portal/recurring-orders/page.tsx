import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { daysForRecurringFrequency, isRecurringFrequency, labelForRecurringFrequency, RECURRING_FREQUENCY_OPTIONS } from '@/lib/recurring';
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
  frequency: string;
  status?: string | null;
  active?: boolean | null;
  created_at: string | null;
  last_generated_at: string | null;
  source_order_id?: string | null;
  amount_cents?: number | null;
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

function nextOrderDate(frequency: string, anchorDate: string | null) {
  if (!anchorDate) return 'N/A';
  const date = new Date(anchorDate);
  if (Number.isNaN(date.getTime())) return 'N/A';
  const daysToAdd = daysForRecurringFrequency(frequency);
  if (!daysToAdd) return 'N/A';
  date.setDate(date.getDate() + daysToAdd);
  return date.toLocaleDateString();
}

function normalizeStatus(order: RecurringOrderRow) {
  if (order.status) return order.status;
  if (typeof order.active === 'boolean') return order.active ? 'active' : 'paused';
  return 'active';
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
      const deleteResult = await supabase
        .from('recurring_orders')
        .delete()
        .eq('id', recurringOrderId)
        .eq('center_id', centerId);
      logQueryError('recurring_orders.delete canceled order', deleteResult.error, { userId, centerId, recurringOrderId, status });
      if (deleteResult.error) redirect('/portal/recurring-orders?error=status_failed');
      redirect('/portal/recurring-orders?success=status_updated');
    }

    const statusUpdateResult = await supabase
      .from('recurring_orders')
      .update({ status })
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
          <p className="page-subtitle recurring-subtitle mt-3">Update quantities and frequency, pause shipments, or cancel schedules whenever your center&apos;s needs change.</p>
        </section>

        {searchParams?.success ? <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">Saved successfully.</div> : null}
        {searchParams?.error ? <div className="rounded-[1.5rem] border border-red-200 bg-red-50 p-4 text-sm text-red-700">Could not save your changes.</div> : null}

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
          return (
            <div key={order.id} className="recurring-card recurring-order-card space-y-5">
              <div className="recurring-card-header grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                <div className="recurring-metrics grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="recurring-metric">
                    <p className="recurring-metric-label text-sm uppercase tracking-[0.18em] text-slate-500">Next order date</p>
                    <p className="recurring-metric-value mt-2 text-lg font-semibold text-slate-950">{nextOrderDate(order.frequency, order.last_generated_at ?? order.created_at)}</p>
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
                    <button className="btn-secondary recurring-action-button w-full md:w-auto" type="submit">Save Schedule</button>
                  </form>

                  <div className="recurring-item-forms space-y-3">
                    {orderItems.map((item) => (
                      <form key={item.id} action={updateRecurringItem} className="recurring-item-form grid gap-3 rounded-2xl border border-white/70 bg-white/55 p-3 md:grid-cols-[minmax(0,1fr)_10rem_auto] md:items-end">
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
                        <button className="btn-primary recurring-action-button w-full md:w-auto" type="submit">Save Quantity</button>
                      </form>
                    ))}
                  </div>
                </div>
              </details>

              <div className="recurring-actions flex flex-col gap-3 sm:flex-row">
                <form action={setRecurringStatus} className="w-full sm:w-auto">
                  <input type="hidden" name="recurring_order_id" value={order.id} />
                  <input type="hidden" name="status" value={currentStatus === 'paused' ? 'active' : 'paused'} />
                  <button className="btn-secondary recurring-action-button w-full" type="submit">{currentStatus === 'paused' ? 'Resume shipment' : 'Pause shipment'}</button>
                </form>
                <form action={setRecurringStatus} className="w-full sm:w-auto">
                  <input type="hidden" name="recurring_order_id" value={order.id} />
                  <input type="hidden" name="status" value="canceled" />
                  <button className="recurring-cancel-button w-full rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50" type="submit">Cancel schedule</button>
                </form>
              </div>
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

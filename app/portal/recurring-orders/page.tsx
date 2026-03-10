import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const allowedFrequencies = new Set(['2_weeks', 'monthly']);

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
  const daysToAdd = frequency === '2_weeks' ? 14 : 30;
  date.setDate(date.getDate() + daysToAdd);
  return date.toLocaleDateString();
}

function normalizeStatus(order: RecurringOrderRow) {
  if (order.status) return order.status;
  if (typeof order.active === 'boolean') return order.active ? 'active' : 'paused';
  return 'active';
}

function statusClasses(status: string) {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700';
  if (status === 'paused') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-200 text-slate-700';
}

async function updateRecurringItem(formData: FormData) {
  'use server';
  let userId = 'unknown';
  try {
    const { user } = await requireUser();
    userId = user.id;
    const supabase = await createClient();

    const recurringOrderId = String(formData.get('recurring_order_id') ?? '');
    const recurringItemId = String(formData.get('recurring_item_id') ?? '');
    const frequency = String(formData.get('frequency') ?? '');
    const qty = Number(formData.get('qty'));

    if (!recurringOrderId || !recurringItemId || !allowedFrequencies.has(frequency) || !Number.isInteger(qty) || qty < 1) {
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

    const orderUpdateResult = await supabase
      .from('recurring_orders')
      .update({ frequency })
      .eq('id', recurringOrderId)
      .eq('user_id', userId);
    logQueryError('recurring_orders.update frequency', orderUpdateResult.error, { userId, recurringOrderId, frequency });
    if (orderUpdateResult.error) redirect('/portal/recurring-orders?error=save_failed');

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
      .eq('user_id', userId);
    logQueryError('recurring_orders.update amount_cents', totalUpdateResult.error, { userId, recurringOrderId, amount });
    if (totalUpdateResult.error) redirect('/portal/recurring-orders?error=save_failed');

    redirect('/portal/recurring-orders?success=saved');
  } catch (error) {
    console.error('[recurring-orders] updateRecurringItem fatal', { userId, error });
    redirect('/portal/recurring-orders?error=save_failed');
  }
}

async function setRecurringStatus(formData: FormData) {
  'use server';
  let userId = 'unknown';
  try {
    const { user } = await requireUser();
    userId = user.id;
    const supabase = await createClient();

    const recurringOrderId = String(formData.get('recurring_order_id') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!recurringOrderId || !['active', 'paused', 'canceled'].includes(status)) {
      redirect('/portal/recurring-orders?error=invalid_status');
    }

    const statusUpdateResult = await supabase
      .from('recurring_orders')
      .update({ status })
      .eq('id', recurringOrderId)
      .eq('user_id', userId);
    logQueryError('recurring_orders.update status', statusUpdateResult.error, { userId, recurringOrderId, status });

    if (statusUpdateResult.error) {
      const legacyStatusResult = await supabase
        .from('recurring_orders')
        .update({ active: status === 'active' })
        .eq('id', recurringOrderId)
        .eq('user_id', userId);
      logQueryError('recurring_orders.update active (legacy fallback)', legacyStatusResult.error, { userId, recurringOrderId, status });
      if (legacyStatusResult.error) redirect('/portal/recurring-orders?error=status_failed');
    }

    redirect('/portal/recurring-orders?success=status_updated');
  } catch (error) {
    console.error('[recurring-orders] setRecurringStatus fatal', { userId, error });
    redirect('/portal/recurring-orders?error=status_failed');
  }
}

export default async function RecurringOrdersPage({ searchParams }: { searchParams?: { success?: string; error?: string } }) {
  let userId = 'unknown';
  try {
    const { user } = await requireUser();
    userId = user.id;
    const supabase = await createClient();

    const recurringOrdersResult = await supabase
      .from('recurring_orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    logQueryError('recurring_orders.select *', recurringOrdersResult.error, { userId });

    if (recurringOrdersResult.error) {
      return <div className="card text-sm text-red-700">Unable to load recurring orders right now.</div>;
    }

    const recurringOrders = (recurringOrdersResult.data ?? []) as RecurringOrderRow[];
    const recurringOrderIds = recurringOrders.map((order) => order.id);

    const recurringItemsResult = recurringOrderIds.length
      ? await supabase
          .from('recurring_order_items')
          .select('id,recurring_order_id,product_name_snapshot,qty,unit_price_cents')
          .in('recurring_order_id', recurringOrderIds)
      : { data: [] as any[], error: null as any };
    logQueryError('recurring_order_items.select by recurring_order_id', recurringItemsResult.error, {
      userId,
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
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Recurring orders</h1>

        {searchParams?.success ? <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">Saved successfully.</div> : null}
        {searchParams?.error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">Could not save your changes.</div> : null}

        {!recurringOrders.length ? <div className="card text-sm text-slate-600">No recurring orders yet.</div> : null}

        {recurringOrders.map((order) => {
          const currentStatus = normalizeStatus(order);
          return (
            <div key={order.id} className="card space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm text-slate-600">Next order date: {nextOrderDate(order.frequency, order.last_generated_at ?? order.created_at)}</div>
                <span className={`rounded px-2 py-1 text-xs font-medium ${statusClasses(currentStatus)}`}>{currentStatus}</span>
              </div>

              <div className="space-y-2">
                {(itemsByOrderId.get(order.id) ?? []).map((item) => (
                  <form key={item.id} action={updateRecurringItem} className="grid gap-2 rounded border p-3 md:grid-cols-5 md:items-end">
                    <input type="hidden" name="recurring_order_id" value={order.id} />
                    <input type="hidden" name="recurring_item_id" value={item.id} />
                    <div className="md:col-span-2">
                      <div className="text-xs text-slate-500">Product</div>
                      <div className="text-sm font-medium">{item.product_name_snapshot ?? 'Unknown product'}</div>
                    </div>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-slate-500">Quantity</span>
                      <input className="input" type="number" name="qty" min={1} defaultValue={item.qty} />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-slate-500">Frequency</span>
                      <select className="input" name="frequency" defaultValue={order.frequency}>
                        <option value="2_weeks">Every 2 weeks</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </label>
                    <button className="btn-primary" type="submit">Save</button>
                  </form>
                ))}
              </div>

              <div className="flex gap-2">
                <form action={setRecurringStatus}>
                  <input type="hidden" name="recurring_order_id" value={order.id} />
                  <input type="hidden" name="status" value={currentStatus === 'paused' ? 'active' : 'paused'} />
                  <button className="rounded border px-3 py-2 text-sm" type="submit">{currentStatus === 'paused' ? 'Resume' : 'Pause'}</button>
                </form>
                <form action={setRecurringStatus}>
                  <input type="hidden" name="recurring_order_id" value={order.id} />
                  <input type="hidden" name="status" value="canceled" />
                  <button className="rounded border px-3 py-2 text-sm text-red-700" type="submit">Cancel</button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    );
  } catch (error) {
    console.error('[recurring-orders] page render fatal', { userId, error });
    return <div className="card text-sm text-red-700">Unable to load recurring orders right now.</div>;
  }
}

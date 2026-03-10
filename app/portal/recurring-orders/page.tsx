import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const allowedFrequencies = new Set(['2_weeks', 'monthly']);

type RecurringOrderRow = {
  id: string;
  frequency: string;
  status?: string | null;
  active?: boolean | null;
  created_at: string | null;
  last_generated_at: string | null;
  source_order_id: string | null;
};

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
  return order.active ? 'active' : 'paused';
}

function statusClasses(status: string) {
  if (status === 'active') return 'bg-emerald-100 text-emerald-700';
  if (status === 'paused') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-200 text-slate-700';
}

function isMissingStatusColumnError(message: string | undefined) {
  return (message ?? '').toLowerCase().includes('status');
}

async function updateRecurringItem(formData: FormData) {
  'use server';
  const { user } = await requireUser();
  const supabase = await createClient();

  const recurringOrderId = String(formData.get('recurring_order_id') ?? '');
  const recurringItemId = String(formData.get('recurring_item_id') ?? '');
  const frequency = String(formData.get('frequency') ?? '');
  const qty = Number(formData.get('qty'));

  if (!recurringOrderId || !recurringItemId || !allowedFrequencies.has(frequency) || !Number.isInteger(qty) || qty < 1) {
    redirect('/portal/recurring-orders?error=invalid_input');
  }

  const { data: recurringItem, error: recurringItemError } = await supabase
    .from('recurring_order_items')
    .select('id,recurring_order_id,unit_price_cents')
    .eq('id', recurringItemId)
    .single();

  if (recurringItemError || !recurringItem || recurringItem.recurring_order_id !== recurringOrderId) {
    redirect('/portal/recurring-orders?error=not_found');
  }

  const { error: orderUpdateError } = await supabase
    .from('recurring_orders')
    .update({ frequency })
    .eq('id', recurringOrderId)
    .eq('user_id', user.id);

  if (orderUpdateError) redirect('/portal/recurring-orders?error=save_failed');

  const { error: itemUpdateError } = await supabase
    .from('recurring_order_items')
    .update({ qty, line_total_cents: qty * recurringItem.unit_price_cents })
    .eq('id', recurringItemId);

  if (itemUpdateError) redirect('/portal/recurring-orders?error=save_failed');

  const { data: allItems, error: allItemsError } = await supabase
    .from('recurring_order_items')
    .select('line_total_cents')
    .eq('recurring_order_id', recurringOrderId);

  if (allItemsError || !allItems) redirect('/portal/recurring-orders?error=save_failed');

  const amount = allItems.reduce((sum, item) => sum + (item.line_total_cents ?? 0), 0);
  const { error: totalUpdateError } = await supabase
    .from('recurring_orders')
    .update({ amount_cents: amount })
    .eq('id', recurringOrderId)
    .eq('user_id', user.id);

  if (totalUpdateError) redirect('/portal/recurring-orders?error=save_failed');

  redirect('/portal/recurring-orders?success=saved');
}

async function setRecurringStatus(formData: FormData) {
  'use server';
  const { user } = await requireUser();
  const supabase = await createClient();

  const recurringOrderId = String(formData.get('recurring_order_id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!recurringOrderId || !['active', 'paused', 'canceled'].includes(status)) {
    redirect('/portal/recurring-orders?error=invalid_status');
  }

  const statusUpdate = await supabase
    .from('recurring_orders')
    .update({ status })
    .eq('id', recurringOrderId)
    .eq('user_id', user.id);

  if (statusUpdate.error && isMissingStatusColumnError(statusUpdate.error.message)) {
    const { error: legacyStatusError } = await supabase
      .from('recurring_orders')
      .update({ active: status === 'active' })
      .eq('id', recurringOrderId)
      .eq('user_id', user.id);
    if (legacyStatusError) redirect('/portal/recurring-orders?error=status_failed');
    redirect('/portal/recurring-orders?success=status_updated');
  }

  if (statusUpdate.error) redirect('/portal/recurring-orders?error=status_failed');
  redirect('/portal/recurring-orders?success=status_updated');
}

export default async function RecurringOrdersPage({ searchParams }: { searchParams?: { success?: string; error?: string } }) {
  const { user } = await requireUser();
  const supabase = await createClient();

  const primaryQuery = await supabase
    .from('recurring_orders')
    .select('id,frequency,status,created_at,last_generated_at,source_order_id')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  let recurringOrders = primaryQuery.data as RecurringOrderRow[] | null;
  let recurringOrdersError = primaryQuery.error;

  if (recurringOrdersError && isMissingStatusColumnError(recurringOrdersError.message)) {
    const fallbackQuery = await supabase
      .from('recurring_orders')
      .select('id,frequency,active,created_at,last_generated_at,source_order_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    recurringOrders = fallbackQuery.data as RecurringOrderRow[] | null;
    recurringOrdersError = fallbackQuery.error;
  }

  if (recurringOrdersError) {
    return <div className="card text-sm text-red-700">Unable to load recurring orders right now.</div>;
  }

  const recurringOrderIds = (recurringOrders ?? []).map((order) => order.id);
  const recurringItemsResult = recurringOrderIds.length
    ? await supabase
        .from('recurring_order_items')
        .select('id,recurring_order_id,product_name_snapshot,qty,unit_price_cents')
        .in('recurring_order_id', recurringOrderIds)
    : { data: [] as any[], error: null as any };

  let normalizedItems: Array<{ id: string; recurring_order_id: string; product_name_snapshot: string | null; qty: number; unit_price_cents: number }> =
    (recurringItemsResult.data ?? []) as any[];

  if (recurringItemsResult.error) {
    const sourceOrderIds = (recurringOrders ?? []).map((order) => order.source_order_id).filter(Boolean) as string[];
    const sourceItemsResult = sourceOrderIds.length
      ? await supabase
          .from('order_items')
          .select('id,order_id,product_name_snapshot,qty,unit_price_cents')
          .in('order_id', sourceOrderIds)
      : { data: [] as any[] };

    const recurringOrderIdBySourceOrderId = new Map((recurringOrders ?? []).map((order) => [order.source_order_id, order.id]));
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

      {!recurringOrders?.length ? <div className="card text-sm text-slate-600">No recurring orders yet.</div> : null}

      {recurringOrders?.map((order) => {
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
}

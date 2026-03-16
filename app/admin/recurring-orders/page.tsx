import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

function normalizeStatus(order: { status?: string | null; active?: boolean | null }) {
  if (order.status) return order.status;
  if (typeof order.active === 'boolean') return order.active ? 'active' : 'paused';
  return 'active';
}


function isMissingStatusColumnError(error: { message?: string; details?: string; code?: string } | null) {
  if (!error) return false;
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return text.includes('status') && (text.includes('column') || text.includes('schema cache') || error.code === 'PGRST204');
}

async function updateRecurringOrder(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const recurringOrderId = String(formData.get('id') ?? '');
  const frequency = String(formData.get('frequency'));
  const status = String(formData.get('status'));
  const statusFilter = String(formData.get('statusFilter') ?? '');

  if (!recurringOrderId) redirect('/admin/recurring-orders?error=missing_id');
  if (!['2_weeks', 'monthly'].includes(frequency)) redirect('/admin/recurring-orders?error=invalid_frequency');
  if (!['active', 'paused', 'canceled'].includes(status)) redirect('/admin/recurring-orders?error=invalid_status');

  const active = status === 'active';
  const updates: { frequency: string; status: string; active: boolean } = { frequency, status, active };

  let updateResult = await supabase.from('recurring_orders').update(updates).eq('id', recurringOrderId).select('id');

  if (isMissingStatusColumnError(updateResult.error)) {
    if (status === 'canceled') {
      const statusQuery = statusFilter ? `status=${encodeURIComponent(statusFilter)}&` : '';
      redirect(`/admin/recurring-orders?${statusQuery}error=legacy_canceled_unsupported`);
    }

    const legacyResult = await supabase
      .from('recurring_orders')
      .update({ frequency, active })
      .eq('id', recurringOrderId)
      .select('id');
    updateResult = legacyResult;
  }

  const statusQuery = statusFilter ? `status=${encodeURIComponent(statusFilter)}&` : '';
  if (updateResult.error) redirect(`/admin/recurring-orders?${statusQuery}error=save_failed`);
  if (!updateResult.data?.length) redirect(`/admin/recurring-orders?${statusQuery}error=not_found`);

  const nextSearch = statusFilter ? `?status=${encodeURIComponent(statusFilter)}&success=updated` : '?success=updated';
  redirect(`/admin/recurring-orders${nextSearch}`);
}

export default async function AdminRecurringOrdersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const statusFilter = typeof searchParams.status === 'string' ? searchParams.status : '';
  const hasUnsupportedStatusFilter = Boolean(statusFilter) && !['active', 'paused'].includes(statusFilter);

  let recurringOrders: any[] = [];
  let loadError = false;
  let isLegacySchema = false;

  let recurringQuery = supabase
    .from('recurring_orders')
    .select('id,user_id,frequency,status,amount_cents,created_at,last_generated_at,profiles(email,full_name)')
    .neq('status', 'canceled')
    .order('created_at', { ascending: false });
  if (statusFilter) recurringQuery = recurringQuery.eq('status', statusFilter);

  const recurringResult = await recurringQuery.limit(200);

  if (recurringResult.error) {
    isLegacySchema = isMissingStatusColumnError(recurringResult.error);
    if (hasUnsupportedStatusFilter) {
      recurringOrders = [];
    } else {
      let legacyQuery = supabase
        .from('recurring_orders')
        .select('id,user_id,frequency,active,amount_cents,created_at,last_generated_at,profiles(email,full_name)')
        .order('created_at', { ascending: false });

      if (statusFilter === 'active') legacyQuery = legacyQuery.eq('active', true);
      if (statusFilter === 'paused') legacyQuery = legacyQuery.eq('active', false);

      const legacyResult = await legacyQuery.limit(200);
      if (legacyResult.error) {
        loadError = true;
      } else {
        recurringOrders = legacyResult.data ?? [];
      }
    }

  } else {
    recurringOrders = recurringResult.data ?? [];
  }

  const recurringOrderIds = recurringOrders.map((order: any) => order.id);
  const { data: recurringItems } = recurringOrderIds.length
    ? await supabase
        .from('recurring_order_items')
        .select('id,recurring_order_id,product_id,product_name_snapshot,qty')
        .in('recurring_order_id', recurringOrderIds)
    : { data: [] as any[] };

  const productIds = [...new Set((recurringItems ?? []).map((item: any) => item.product_id).filter(Boolean))];
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };

  const productNameById = new Map((products ?? []).map((product: any) => [product.id, product.name]));
  const itemsByRecurringOrderId = new Map<string, Array<{ id: string; name: string; qty: number }>>();

  for (const item of recurringItems ?? []) {
    const existing = itemsByRecurringOrderId.get(item.recurring_order_id) ?? [];
    const name = productNameById.get(item.product_id) || item.product_name_snapshot || 'Unknown product';
    existing.push({ id: item.id, name, qty: item.qty });
    itemsByRecurringOrderId.set(item.recurring_order_id, existing);
  }

  const error = typeof searchParams.error === 'string' ? searchParams.error : '';
  const success = typeof searchParams.success === 'string' ? searchParams.success : '';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Recurring orders</h1>
      <p className="text-sm text-slate-600">Manage recurring schedules for all centers and quickly adjust status/frequency from one page.</p>

      {success === 'updated' ? <div className="card text-sm text-green-700">Recurring order updated.</div> : null}
      {error ? <div className="card text-sm text-red-700">Unable to save recurring order ({error}).</div> : null}
      {loadError ? <div className="card text-sm text-red-700">Unable to load recurring orders right now.</div> : null}
      {error === 'legacy_canceled_unsupported' ? (
        <div className="card text-sm text-amber-700">This database uses legacy recurring-order status storage. Canceled status is unavailable until the recurring status migration is applied.</div>
      ) : null}
      {isLegacySchema ? (
        <div className="card text-sm text-amber-700">Legacy schema detected: recurring orders support Active and Paused only.</div>
      ) : null}
      {isLegacySchema && hasUnsupportedStatusFilter ? (
        <div className="card text-sm text-amber-700">Unsupported status filter for legacy schema. Showing no results.</div>
      ) : null}

      <form className="card flex gap-2">
        <select className="input" name="status" defaultValue={statusFilter}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
        <button className="btn-primary" type="submit">Filter</button>
      </form>

      {!loadError && !recurringOrders.length ? <div className="card text-sm text-slate-600">No recurring orders found.</div> : null}

      {!loadError && recurringOrders.map((order: any) => {
        const items = itemsByRecurringOrderId.get(order.id) ?? [];
        const currentStatus = normalizeStatus(order);
        return (
          <div key={order.id} className="card space-y-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm text-slate-500">Center</div>
                <div className="font-medium">{order.profiles?.full_name || order.profiles?.email || 'Unknown center'}</div>
                <div className="text-sm text-slate-600">{order.profiles?.email || 'No email on file'}</div>
              </div>
              <Link className="text-sm text-slate-700 underline" href={`/admin/users/${order.user_id}`}>
                View center profile
              </Link>
            </div>

            <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-4">
              <div>
                <div className="text-slate-500">Total</div>
                <div>${(order.amount_cents / 100).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-slate-500">Created</div>
                <div>{new Date(order.created_at).toLocaleDateString()}</div>
              </div>
              <div>
                <div className="text-slate-500">Last generated</div>
                <div>{order.last_generated_at ? new Date(order.last_generated_at).toLocaleDateString() : 'Never'}</div>
              </div>
              <div>
                <div className="text-slate-500">Items</div>
                <div>{items.length}</div>
              </div>
            </div>

            <div className="rounded border p-2 text-sm">
              <div className="mb-1 font-medium">Products</div>
              {!items.length ? <div className="text-slate-600">No items found</div> : null}
              {items.map((item) => (
                <div key={item.id} className="text-slate-700">
                  {item.name} × {item.qty}
                </div>
              ))}
            </div>

            <form action={updateRecurringOrder} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="statusFilter" value={statusFilter} />
              <label className="text-sm text-slate-600">Frequency</label>
              <select className="input" name="frequency" defaultValue={order.frequency}>
                <option value="2_weeks">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
              <label className="text-sm text-slate-600">Status</label>
              <select className="input" name="status" defaultValue={currentStatus}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                {!isLegacySchema ? <option value="canceled">Canceled</option> : null}
              </select>
              <button className="btn-primary" type="submit">Save changes</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

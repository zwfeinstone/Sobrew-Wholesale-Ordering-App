import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isRecurringFrequency, RECURRING_FREQUENCY_OPTIONS } from '@/lib/recurring';
import { createClient } from '@/lib/supabase/server';

async function updateRecurringOrder(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const recurringOrderId = String(formData.get('id') ?? '');
  const frequency = String(formData.get('frequency'));
  const status = String(formData.get('status'));
  const statusFilter = String(formData.get('statusFilter') ?? '');

  if (!recurringOrderId) redirect('/admin/recurring-orders?error=missing_id');
  if (!isRecurringFrequency(frequency)) redirect('/admin/recurring-orders?error=invalid_frequency');
  if (!['active', 'paused', 'canceled'].includes(status)) redirect('/admin/recurring-orders?error=invalid_status');

  const updates: { frequency: string; status: string; active?: boolean } = { frequency, status };
  if (status === 'active') updates.active = true;
  if (status === 'paused' || status === 'canceled') updates.active = false;

  const updateResult = await supabase.from('recurring_orders').update(updates).eq('id', recurringOrderId).select('id');

  const statusQuery = statusFilter ? `status=${encodeURIComponent(statusFilter)}&` : '';
  if (updateResult.error) redirect(`/admin/recurring-orders?${statusQuery}error=save_failed`);
  if (!updateResult.data?.length) redirect(`/admin/recurring-orders?${statusQuery}error=not_found`);

  const nextSearch = statusFilter ? `?status=${encodeURIComponent(statusFilter)}&success=updated` : '?success=updated';
  redirect(`/admin/recurring-orders${nextSearch}`);
}

export default async function AdminRecurringOrdersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const statusFilter = typeof searchParams.status === 'string' ? searchParams.status : '';

  let recurringQuery = supabase
    .from('recurring_orders')
    .select('id,user_id,frequency,status,amount_cents,created_at,last_generated_at,profiles(email,full_name)')
    .neq('status', 'canceled')
    .order('created_at', { ascending: false });

  if (statusFilter) recurringQuery = recurringQuery.eq('status', statusFilter);

  const { data: recurringOrders } = await recurringQuery.limit(200);

  const recurringOrderIds = (recurringOrders ?? []).map((order: any) => order.id);
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
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Recurring Admin</span>
        <h1 className="page-title mt-4">Recurring orders</h1>
        <p className="page-subtitle mt-3">Manage recurring schedules for all centers and quickly adjust status or frequency from one streamlined page.</p>
      </section>

      {success === 'updated' ? <div className="card text-sm text-green-700">Recurring order updated.</div> : null}
      {error ? <div className="card text-sm text-red-700">Unable to save recurring order ({error}).</div> : null}

      <form className="card flex flex-col gap-3 md:flex-row">
        <select className="input" name="status" defaultValue={statusFilter}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
        <button className="btn-primary" type="submit">Filter</button>
      </form>

      {!recurringOrders?.length ? <div className="card text-sm text-slate-600">No recurring orders found.</div> : null}

      {recurringOrders?.map((order: any) => {
        const items = itemsByRecurringOrderId.get(order.id) ?? [];
        return (
          <div key={order.id} className="card space-y-4">
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

            <div className="rounded-[1.5rem] border border-slate-200 bg-white/60 p-4 text-sm">
              <div className="mb-2 font-medium text-slate-950">Products</div>
              {!items.length ? <div className="text-slate-600">No items found</div> : null}
              {items.map((item) => (
                <div key={item.id} className="text-slate-700">
                  {item.name} × {item.qty}
                </div>
              ))}
            </div>

            <form action={updateRecurringOrder} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="id" value={order.id} />
              <input type="hidden" name="statusFilter" value={statusFilter} />
              <label className="text-sm text-slate-600">Frequency</label>
              <select className="input" name="frequency" defaultValue={order.frequency}>
                {RECURRING_FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <label className="text-sm text-slate-600">Status</label>
              <select className="input" name="status" defaultValue={order.status}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="canceled">Canceled</option>
              </select>
              <button className="btn-primary" type="submit">Save changes</button>
            </form>
          </div>
        );
      })}
    </div>
  );
}

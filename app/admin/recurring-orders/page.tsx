import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { isRecurringFrequency, labelForRecurringFrequency, RECURRING_FREQUENCY_OPTIONS } from '@/lib/recurring';
import { createClient } from '@/lib/supabase/server';
import { formatAppDate, usd } from '@/lib/utils';

type SearchParams = Record<string, string | string[] | undefined>;
type AdminRecurringView = 'manage' | 'upcoming';
type AdminRecurringOrder = {
  amount_cents: number | null;
  center_id: string | null;
  centers?: { name: string | null } | { name: string | null }[] | null;
  created_at: string | null;
  frequency: string;
  id: string;
  last_generated_at: string | null;
  next_run_at: string | null;
  profiles?: { email: string | null } | { email: string | null }[] | null;
  status: string | null;
  user_id: string | null;
};
type RecurringOrderItem = { id: string; name: string; qty: number };

const ADMIN_RECURRING_VIEWS: Array<{ description: string; id: AdminRecurringView; label: string }> = [
  {
    description: 'Edit status, frequency, and center schedules.',
    id: 'manage',
    label: 'Manage recurring orders',
  },
  {
    description: 'Grouped by the next order date.',
    id: 'upcoming',
    label: 'Upcoming recurring orders',
  },
];

function formatAdminDate(value: string | null) {
  if (!value) return 'Never';
  return formatAppDate(value, 'Unknown');
}

function searchValue(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function adminRecurringView(value: string | string[] | undefined): AdminRecurringView {
  return value === 'upcoming' ? 'upcoming' : 'manage';
}

function recurringOrdersHref({
  error,
  status,
  success,
  view,
}: {
  error?: string;
  status?: string;
  success?: string;
  view?: AdminRecurringView;
}) {
  const params = new URLSearchParams();
  if (view === 'upcoming') params.set('view', 'upcoming');
  if (view !== 'upcoming' && status) params.set('status', status);
  if (success) params.set('success', success);
  if (error) params.set('error', error);
  const query = params.toString();
  return `/admin/recurring-orders${query ? `?${query}` : ''}`;
}

function relatedOne<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function validDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nextOrderDateSortValue(order: AdminRecurringOrder) {
  return validDateTime(order.next_run_at)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function recurringOrderCenterName(order: AdminRecurringOrder) {
  return relatedOne(order.centers)?.name ?? '';
}

function upcomingDateLabel(value: string | null) {
  if (!validDateTime(value)) return 'No next order date';
  return formatAppDate(value, 'Unknown', { day: 'numeric', month: 'short', weekday: 'short', year: 'numeric' });
}

function groupByNextOrderDate(orders: AdminRecurringOrder[]) {
  const groups: Array<{ dateLabel: string; orders: AdminRecurringOrder[]; sortValue: number }> = [];

  for (const order of orders) {
    const sortValue = nextOrderDateSortValue(order);
    const dateLabel = upcomingDateLabel(order.next_run_at);
    const current = groups[groups.length - 1];
    if (current?.dateLabel === dateLabel) {
      current.orders.push(order);
    } else {
      groups.push({ dateLabel, orders: [order], sortValue });
    }
  }

  return groups;
}

async function updateRecurringOrder(formData: FormData) {
  'use server';
  const recurringOrderId = String(formData.get('id') ?? '');
  const frequency = String(formData.get('frequency'));
  const status = String(formData.get('status'));
  const statusFilter = String(formData.get('statusFilter') ?? '');
  const viewFilter = adminRecurringView(String(formData.get('viewFilter') ?? 'manage'));
  await requireAdminWriteAccess(
    recurringOrdersHref({ error: 'admin_write_denied', status: statusFilter, view: viewFilter }),
    'recurring_orders'
  );
  const supabase = await createClient();

  if (!recurringOrderId) redirect(recurringOrdersHref({ error: 'missing_id', status: statusFilter, view: viewFilter }));
  if (!isRecurringFrequency(frequency)) redirect(recurringOrdersHref({ error: 'invalid_frequency', status: statusFilter, view: viewFilter }));
  if (!['active', 'paused', 'canceled'].includes(status)) redirect(recurringOrdersHref({ error: 'invalid_status', status: statusFilter, view: viewFilter }));

  const updates: { frequency: string; status: string; active?: boolean } = { frequency, status };
  if (status === 'active') updates.active = true;
  if (status === 'paused' || status === 'canceled') updates.active = false;

  const updateResult = await supabase.from('recurring_orders').update(updates).eq('id', recurringOrderId).select('id');

  if (updateResult.error) redirect(recurringOrdersHref({ error: 'save_failed', status: statusFilter, view: viewFilter }));
  if (!updateResult.data?.length) redirect(recurringOrdersHref({ error: 'not_found', status: statusFilter, view: viewFilter }));

  redirect(recurringOrdersHref({ status: statusFilter, success: 'updated', view: viewFilter }));
}

function RecurringOrderCard({
  items,
  order,
  statusFilter,
  view,
}: {
  items: RecurringOrderItem[];
  order: AdminRecurringOrder;
  statusFilter: string;
  view: AdminRecurringView;
}) {
  const center = relatedOne(order.centers);
  const profile = relatedOne(order.profiles);

  return (
    <div className="card space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-slate-500">Center</div>
          <div className="break-words font-medium">{center?.name || 'Unknown center'}</div>
          <div className="break-all text-sm text-slate-600">{profile?.email || 'No login email on file'}</div>
        </div>
        {order.center_id ? (
          <Link className="text-sm text-slate-700 underline" href={`/admin/users/${order.center_id}`}>
            View center profile
          </Link>
        ) : null}
      </div>

      <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-6">
        <div>
          <div className="text-slate-500">Total</div>
          <div>{usd(Math.round(order.amount_cents ?? 0))}</div>
        </div>
        <div>
          <div className="text-slate-500">Status</div>
          <div className="capitalize">{order.status || 'active'}</div>
        </div>
        <div>
          <div className="text-slate-500">Frequency</div>
          <div>{labelForRecurringFrequency(order.frequency)}</div>
        </div>
        <div>
          <div className="text-slate-500">Next order date</div>
          <div>{formatAdminDate(order.next_run_at)}</div>
        </div>
        <div>
          <div className="text-slate-500">Last generated</div>
          <div>{formatAdminDate(order.last_generated_at)}</div>
        </div>
        <div>
          <div className="text-slate-500">Items</div>
          <div>{items.length}</div>
        </div>
      </div>

      <div className="subtle-panel text-sm">
        <div className="mb-2 font-medium text-slate-950">Products</div>
        {!items.length ? <div className="text-slate-600">No items found</div> : null}
        {items.map((item) => (
          <div key={item.id} className="text-slate-700">
            {item.name} x {item.qty}
          </div>
        ))}
      </div>

      <form action={updateRecurringOrder} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <input type="hidden" name="id" value={order.id} />
        <input type="hidden" name="statusFilter" value={statusFilter} />
        <input type="hidden" name="viewFilter" value={view} />
        <label className="text-sm text-slate-600">Frequency</label>
        <select className="input w-full sm:w-auto" name="frequency" defaultValue={order.frequency}>
          {RECURRING_FREQUENCY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <label className="text-sm text-slate-600">Status</label>
        <select className="input w-full sm:w-auto" name="status" defaultValue={order.status || 'active'}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="canceled">Canceled</option>
        </select>
        <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save changes" pendingLabel="Saving..." />
      </form>
    </div>
  );
}

export default async function AdminRecurringOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminSectionView('recurring_orders');
  const supabase = await createClient();
  const activeView = adminRecurringView(searchParams.view);
  const statusFilter = activeView === 'manage' ? searchValue(searchParams.status) : '';

  const recurringQuery = supabase
    .from('recurring_orders')
    .select('id,user_id,center_id,frequency,status,amount_cents,created_at,last_generated_at,next_run_at,profiles(email),centers(name)')
    .neq('status', 'canceled')
    .order('created_at', { ascending: false });

  const { data: allRecurringOrders } = await recurringQuery.limit(500);
  const recurringOrders = ((allRecurringOrders ?? []) as AdminRecurringOrder[])
    .filter((order) => !statusFilter || order.status === statusFilter);
  const upcomingOrders = [...((allRecurringOrders ?? []) as AdminRecurringOrder[])]
    .sort((left, right) => nextOrderDateSortValue(left) - nextOrderDateSortValue(right) || recurringOrderCenterName(left).localeCompare(recurringOrderCenterName(right)));
  const upcomingGroups = groupByNextOrderDate(upcomingOrders);

  const recurringOrderIds = (allRecurringOrders ?? []).map((order: AdminRecurringOrder) => order.id);
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
  const itemsByRecurringOrderId = new Map<string, RecurringOrderItem[]>();

  for (const item of recurringItems ?? []) {
    const existing = itemsByRecurringOrderId.get(item.recurring_order_id) ?? [];
    const name = productNameById.get(item.product_id) || item.product_name_snapshot || 'Unknown product';
    existing.push({ id: item.id, name, qty: item.qty });
    itemsByRecurringOrderId.set(item.recurring_order_id, existing);
  }

  const error = typeof searchParams.error === 'string' ? searchParams.error : '';
  const success = typeof searchParams.success === 'string' ? searchParams.success : '';
  const activeCount = ((allRecurringOrders ?? []) as AdminRecurringOrder[]).filter((order) => order.status === 'active').length;

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Recurring Admin</span>
        <h1 className="page-title mt-4">Recurring orders</h1>
        <p className="page-subtitle mt-3">Manage recurring schedules for all centers and quickly adjust status or frequency from one streamlined page.</p>
      </section>

      {success === 'updated' ? <div className="card text-sm text-green-700">Recurring order updated.</div> : null}
      {error ? (
        <div className="card text-sm text-red-700">
          {error === 'admin_write_denied' ? 'Only superadmins can change admin data.' : `Unable to save recurring order (${error}).`}
        </div>
      ) : null}

      <nav className="grid gap-3 md:grid-cols-2" aria-label="Recurring order categories">
        {ADMIN_RECURRING_VIEWS.map((view) => {
          const isActive = activeView === view.id;
          const count = view.id === 'upcoming' ? upcomingOrders.length : (allRecurringOrders ?? []).length;
          return (
            <Link
              key={view.id}
              className={`rounded-xl border px-4 py-3 text-sm transition-colors ${
                isActive
                  ? 'border-teal-200 bg-teal-50 text-teal-950 shadow-sm'
                  : 'border-slate-200 bg-white/80 text-slate-700 hover:border-teal-100 hover:bg-teal-50/60'
              }`}
              href={recurringOrdersHref({ status: statusFilter, view: view.id })}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="font-semibold">{view.label}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${isActive ? 'bg-teal-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {count}
                </span>
              </span>
              <span className="mt-1 block text-sm opacity-75">{view.description}</span>
            </Link>
          );
        })}
      </nav>

      {activeView === 'manage' ? (
        <>
          <form className="card flex flex-col gap-3 md:flex-row">
            <input type="hidden" name="view" value="manage" />
            <select className="input" name="status" defaultValue={statusFilter}>
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
            <button className="btn-primary w-full md:w-auto" type="submit">Filter</button>
          </form>

          {!recurringOrders.length ? <div className="card text-sm text-slate-600">No recurring orders found.</div> : null}

          {recurringOrders.map((order) => (
            <RecurringOrderCard
              key={order.id}
              items={itemsByRecurringOrderId.get(order.id) ?? []}
              order={order}
              statusFilter={statusFilter}
              view={activeView}
            />
          ))}
        </>
      ) : (
        <section className="space-y-5">
          <div className="card space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Upcoming recurring orders</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Next order dates</h2>
              </div>
              <p className="text-sm text-slate-500">{activeCount} active schedules</p>
            </div>
            {!upcomingGroups.length ? <p className="text-sm text-slate-600">No recurring orders found.</p> : null}
            {upcomingGroups.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {upcomingGroups.map((group) => (
                  <div key={group.dateLabel} className="rounded-xl border border-slate-200 bg-white/80 p-3">
                    <p className="text-sm font-semibold text-slate-950">{group.dateLabel}</p>
                    <p className="mt-1 text-sm text-slate-500">{group.orders.length} recurring {group.orders.length === 1 ? 'order' : 'orders'}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {upcomingGroups.map((group) => (
            <section key={group.dateLabel} className="space-y-3" aria-labelledby={`recurring-date-${group.sortValue}`}>
              <div className="flex items-center justify-between gap-3">
                <h3 id={`recurring-date-${group.sortValue}`} className="text-lg font-semibold tracking-tight text-slate-950">{group.dateLabel}</h3>
                <span className="text-sm text-slate-500">{group.orders.length} {group.orders.length === 1 ? 'order' : 'orders'}</span>
              </div>
              {group.orders.map((order) => (
                <RecurringOrderCard
                  key={order.id}
                  items={itemsByRecurringOrderId.get(order.id) ?? []}
                  order={order}
                  statusFilter=""
                  view={activeView}
                />
              ))}
            </section>
          ))}
        </section>
      )}
    </div>
  );
}

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default async function ArchivedOrdersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const sort = typeof searchParams?.sort === 'string' ? searchParams.sort : 'archived_desc';
  const nameFilter = typeof searchParams?.name === 'string' ? searchParams.name.trim() : '';

  let ordersQuery = supabase
    .from('orders')
    .select('id,status,created_at,archived_at,profiles(email,full_name)')
    .not('archived_at', 'is', null);

  if (nameFilter) {
    ordersQuery = ordersQuery.or(`full_name.ilike.%${nameFilter}%,email.ilike.%${nameFilter}%`, { foreignTable: 'profiles' });
  }

  switch (sort) {
    case 'created_asc':
      ordersQuery = ordersQuery.order('created_at', { ascending: true });
      break;
    case 'created_desc':
      ordersQuery = ordersQuery.order('created_at', { ascending: false });
      break;
    case 'archived_asc':
      ordersQuery = ordersQuery.order('archived_at', { ascending: true });
      break;
    default:
      ordersQuery = ordersQuery.order('archived_at', { ascending: false });
      break;
  }

  const { data: orders } = await ordersQuery.limit(200);

  const orderIds = (orders ?? []).map((order: any) => order.id);
  const { data: items } = orderIds.length
    ? await supabase.from('order_items').select('order_id,product_id,product_name_snapshot,qty').in('order_id', orderIds)
    : { data: [] as any[] };

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const { data: products } = productIds.length
    ? await supabase.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const productNameById = new Map((products ?? []).map((product: any) => [product.id, product.name]));

  const itemLabelsByOrderId = new Map<string, string[]>();
  for (const item of items ?? []) {
    const label = `${productNameById.get(item.product_id) || item.product_name_snapshot || 'Unknown product'} x ${item.qty}`;
    const existing = itemLabelsByOrderId.get(item.order_id) ?? [];
    existing.push(label);
    itemLabelsByOrderId.set(item.order_id, existing);
  }

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Archived Orders</span>
        <h1 className="page-title mt-4">Archived order history</h1>
        <p className="page-subtitle mt-3">Review fulfilled orders that have been removed from the main queue without losing access to their details.</p>
      </section>

      <form className="card flex flex-col gap-3 md:flex-row">
        <input className="input" name="name" defaultValue={nameFilter} placeholder="Filter by center name or email" />
        <select className="input" name="sort" defaultValue={sort}>
          <option value="archived_desc">Recently archived</option>
          <option value="archived_asc">Oldest archived</option>
          <option value="created_desc">Newest ordered</option>
          <option value="created_asc">Oldest ordered</option>
        </select>
        <button className="btn-primary" type="submit">Apply</button>
      </form>

      {!orders?.length ? <div className="card text-sm text-slate-600">No archived orders yet.</div> : null}

      {orders?.map((order: any) => (
        <Link
          key={order.id}
          href={`/admin/orders/${order.id}`}
          className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95"
        >
          <p className="text-lg font-semibold text-slate-950">{(itemLabelsByOrderId.get(order.id) ?? ['Unknown product']).join(', ')}</p>
          <p className="mt-2 text-sm font-medium text-slate-700">{order.profiles?.full_name || 'Unknown center'}</p>
          <p className="mt-1 text-sm text-slate-500">{order.profiles?.email}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            <span>Placed {formatOrderTimestamp(order.created_at)}</span>
            <span>Archived {formatOrderTimestamp(order.archived_at)}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">{order.status}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

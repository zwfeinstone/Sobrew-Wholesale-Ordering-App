import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

const PAGE_SIZE = 25;

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function buildPageHref(page: number, sort: string, nameFilter: string) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('sort', sort);
  if (nameFilter) params.set('name', nameFilter);
  return `/admin/archived-orders?${params.toString()}`;
}

export default async function ArchivedOrdersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const sort = typeof searchParams?.sort === 'string' ? searchParams.sort : 'archived_desc';
  const nameFilter = typeof searchParams?.name === 'string' ? searchParams.name.trim() : '';
  const pageParam = typeof searchParams?.page === 'string' ? Number(searchParams.page) : 1;
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE;
  const [matchingCenters, matchingProfiles] = nameFilter
    ? await Promise.all([
        supabase.from('centers').select('id').ilike('name', `%${nameFilter}%`),
        supabase.from('profiles').select('id').ilike('email', `%${nameFilter}%`).eq('is_admin', false),
      ])
    : [{ data: [] as any[] }, { data: [] as any[] }];

  let ordersQuery = supabase
    .from('orders')
    .select('id,status,created_at,archived_at,profiles(email),centers(name)')
    .not('archived_at', 'is', null);

  if (nameFilter) {
    const centerIds = (matchingCenters.data ?? []).map((center: any) => center.id);
    const userIds = (matchingProfiles.data ?? []).map((profile: any) => profile.id);
    const filters = [
      centerIds.length ? `center_id.in.(${centerIds.join(',')})` : '',
      userIds.length ? `user_id.in.(${userIds.join(',')})` : '',
    ].filter(Boolean);

    if (!filters.length) {
      ordersQuery = ordersQuery.eq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      ordersQuery = ordersQuery.or(filters.join(','));
    }
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

  const { data: orderRows } = await ordersQuery.range(from, to);
  const orders = (orderRows ?? []).slice(0, PAGE_SIZE);
  const hasNextPage = (orderRows?.length ?? 0) > PAGE_SIZE;

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
        <button className="btn-primary w-full md:w-auto" type="submit">Apply</button>
      </form>

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Page {page}</p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          {page > 1 ? <Link href={buildPageHref(page - 1, sort, nameFilter)} className="btn-secondary w-full sm:w-auto">Previous</Link> : null}
          {hasNextPage ? <Link href={buildPageHref(page + 1, sort, nameFilter)} className="btn-secondary w-full sm:w-auto">Next</Link> : null}
        </div>
      </div>

      {!orders?.length ? <div className="card text-sm text-slate-600">No archived orders yet.</div> : null}

      {orders?.map((order: any) => (
        <Link
          key={order.id}
          href={`/admin/orders/${order.id}`}
          className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95"
        >
          <p className="break-words text-lg font-semibold text-slate-950">{(itemLabelsByOrderId.get(order.id) ?? ['Unknown product']).join(', ')}</p>
          <p className="mt-2 text-sm font-medium text-slate-700">{order.centers?.name || 'Unknown center'}</p>
          <p className="mt-1 break-all text-sm text-slate-500">{order.profiles?.email || 'No login email on file'}</p>
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

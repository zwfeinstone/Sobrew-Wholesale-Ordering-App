import Link from 'next/link';
import { ReorderButton } from '@/components/cart-client';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { usd } from '@/lib/utils';

const PAGE_SIZE = 25;

function formatOrderTimestamp(value: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const centerId = profile?.center_id ?? user.id;
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const pageParam = typeof searchParams?.page === 'string' ? Number(searchParams.page) : 1;
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE;

  const { data: orderRows } = await supabase
    .from('orders')
    .select('id,status,subtotal_cents,created_at')
    .eq('center_id', centerId)
    .order('created_at', { ascending: false })
    .range(from, to);

  const orders = (orderRows ?? []).slice(0, PAGE_SIZE);
  const hasNextPage = (orderRows?.length ?? 0) > PAGE_SIZE;

  const orderIds = (orders ?? []).map((order) => order.id);
  const { data: items } = orderIds.length
    ? await supabase.from('order_items').select('order_id,product_id,product_name_snapshot,qty,unit_price_cents').in('order_id', orderIds)
    : { data: [] as any[] };

  const productIds = [...new Set((items ?? []).map((item: any) => item.product_id))];
  const { data: products } = productIds.length
    ? await supabaseAdmin.from('products').select('id,name').in('id', productIds)
    : { data: [] as any[] };
  const { data: currentPrices } = productIds.length
    ? await supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', centerId).in('product_id', productIds)
    : { data: [] as any[] };
  const productNameById = new Map((products ?? []).map((p: any) => [p.id, p.name]));
  const currentPriceById = new Map((currentPrices ?? []).map((row) => [row.product_id, row.price_cents]));

  const lineItemsByOrderId = new Map<string, string[]>();
  const reorderItemsByOrderId = new Map<string, Array<{ product_id: string; name: string; price_cents: number; qty: number }>>();
  for (const item of items ?? []) {
    const mappedName = productNameById.get(item.product_id);
    const name = mappedName || item.product_name_snapshot || 'Unknown product';
    const itemLabel = `${name} x ${item.qty}`;
    const existingItems = lineItemsByOrderId.get(item.order_id) ?? [];
    existingItems.push(itemLabel);
    lineItemsByOrderId.set(item.order_id, existingItems);

    const reorderItems = reorderItemsByOrderId.get(item.order_id) ?? [];
    reorderItems.push({
      product_id: item.product_id,
      name,
      price_cents: currentPriceById.get(item.product_id) ?? item.unit_price_cents ?? 0,
      qty: item.qty,
    });
    reorderItemsByOrderId.set(item.order_id, reorderItems);
  }

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Past Orders</span>
        <h1 className="page-title mt-4">Order history</h1>
        <p className="page-subtitle mt-3">Track previous purchases, review line items, and quickly reorder when you need to restock.</p>
      </section>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">Page {page}</p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          {page > 1 ? <Link href={`/portal/orders?page=${page - 1}`} className="btn-secondary w-full sm:w-auto">Previous</Link> : null}
          {hasNextPage ? <Link href={`/portal/orders?page=${page + 1}`} className="btn-secondary w-full sm:w-auto">Next</Link> : null}
        </div>
      </div>
      {orders?.map((order) => (
        <div key={order.id} className="card transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <Link href={`/portal/orders/${order.id}`} className="block flex-1 min-w-0">
              <p className="break-words text-lg font-semibold text-slate-950">{(lineItemsByOrderId.get(order.id) ?? ['Unknown product']).join(', ')}</p>
              <p className="mt-2 text-sm text-slate-500">Placed {formatOrderTimestamp(order.created_at)}</p>
            </Link>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">{order.status}</span>
              <span className="text-lg font-semibold text-slate-950">{usd(order.subtotal_cents)}</span>
              <ReorderButton items={reorderItemsByOrderId.get(order.id) ?? []} storageKey={cartStorageKey} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

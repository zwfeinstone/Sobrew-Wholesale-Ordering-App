import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function AdminCanceledRecurringOrdersPage() {
  const supabase = await createClient();

  const { data: recurringOrders } = await supabase
    .from('recurring_orders')
    .select('id,user_id,frequency,status,amount_cents,created_at,last_generated_at,profiles(email,full_name)')
    .eq('status', 'canceled')
    .order('created_at', { ascending: false })
    .limit(200);

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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Canceled recurring orders</h1>
      <p className="text-sm text-slate-600">Only canceled recurring orders are shown on this page.</p>

      {!recurringOrders?.length ? <div className="card text-sm text-slate-600">No canceled recurring orders found.</div> : null}

      {recurringOrders?.map((order: any) => {
        const items = itemsByRecurringOrderId.get(order.id) ?? [];
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
                <div className="text-slate-500">Status</div>
                <div className="font-medium text-red-700">Canceled</div>
              </div>
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
          </div>
        );
      })}
    </div>
  );
}

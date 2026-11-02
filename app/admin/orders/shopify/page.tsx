import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { retryShopifyImport } from '@/lib/shopify-import';
import { importShopifyOrdersByNames } from '@/lib/shopify-order-backfill';
import { getShopifyConfig, hasShopifyConfiguration } from '@/lib/shopify';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { formatAppDateTime } from '@/lib/utils';

export const maxDuration = 300;

async function importExistingOrders(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/orders/shopify?toast=admin_write_denied', 'orders');
  let results;
  try {
    results = await importShopifyOrdersByNames(String(formData.get('order_names') ?? ''));
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'The orders could not be imported.').slice(0, 500);
    redirect(`/admin/orders/shopify?toast=backfill_error&message=${encodeURIComponent(message)}`);
  }
  revalidatePath('/admin/orders');
  revalidatePath('/admin/orders/shopify');
  revalidatePath('/admin/planning');
  revalidatePath('/admin/products');
  const params = new URLSearchParams({
    view: 'all', toast: 'backfill_complete',
    imported: String(results.filter(result => result.status === 'imported').length),
    skipped: String(results.filter(result => result.status === 'ignored').length),
    failed: String(results.filter(result => result.status === 'error').length),
  });
  const issues = results.filter(result => result.status !== 'imported');
  if (issues.length) params.set('message', issues.map(result => `${result.name}: ${result.error || 'Review this order in Shopify.'}`).join(' ').slice(0, 1000));
  redirect(`/admin/orders/shopify?${params}`);
}

async function retryImport(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/orders/shopify?toast=admin_write_denied', 'orders');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/admin/orders/shopify');
  try {
    const result = await retryShopifyImport(id);
    if (result.status === 'error') redirect('/admin/orders/shopify?toast=retry_failed');
  } catch {
    redirect('/admin/orders/shopify?toast=retry_failed');
  }
  redirect('/admin/orders/shopify?toast=retry_complete');
}

export default async function ShopifyImportsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await requireAdminSectionView('orders');
  const params = await searchParams;
  const { toast, view } = params;
  const all = view === 'all';
  // The webhook inbox contains customer payloads and is service-role only.
  // Authorize above and only send summary fields to the page.
  let query = getSupabaseAdmin().from('shopify_order_imports')
    .select('id,shopify_order_name,status,error,order_id,received_at,updated_at');
  if (!all) query = query.in('status', ['pending', 'error']);
  const { data, error } = await query.order('updated_at', { ascending: false }).limit(100);
  const config = getShopifyConfig();
  const configured = hasShopifyConfiguration() && Boolean(config.webhookSecret);
  const count = (key: string) => Math.min(10, Math.max(0, Number.parseInt(String(params[key] ?? '0'), 10) || 0));

  return <div className="space-y-6">
    <header className="workspace-page-heading"><div><Link href="/admin/orders" className="text-sm text-slate-500">Orders</Link><h1 className="page-title mt-2">Shopify imports</h1><p>Paid Shopify orders and import issues</p></div></header>
    {toast === 'retry_complete' ? <StatusToast message="Import retried. Check its status below." tone="success" /> : null}
    {toast === 'retry_failed' ? <StatusToast message="Import could not be completed. Check the issue below before retrying." tone="error" /> : null}
    {toast === 'admin_write_denied' ? <StatusToast message="You do not have permission to import orders." tone="error" /> : null}
    {toast === 'backfill_complete' ? <StatusToast message={`${count('imported')} orders imported, ${count('skipped')} skipped, ${count('failed')} need attention.`} tone={count('failed') || count('skipped') ? 'error' : 'success'} actionHref="/admin/orders" actionLabel="View orders" /> : null}
    {(toast === 'backfill_error' || toast === 'backfill_complete') && typeof params.message === 'string' ? <p className="workspace-notice warning" role="alert">{params.message.slice(0, 1000)}</p> : null}
    {!configured ? <p className="workspace-notice warning">Shopify is not connected yet. Configure the store domain, app credentials, and webhook secret on the server, then register the paid-order webhook.</p> : null}
    <p className="text-sm text-slate-600"><Link className="workspace-text-link" href="/admin/products/shopify">Shopify products &amp; COGS</Link>. Products match by Shopify variant. Missing products are imported automatically so you can set up their COGS in Products. Imported orders appear in Orders as paid and do not need an invoice.</p>
    {current.access.orders.canEdit && configured ? <section className="card space-y-3" aria-labelledby="existing-shopify-orders">
      <h2 id="existing-shopify-orders" className="text-lg font-semibold">Import existing paid orders</h2>
      <p className="text-sm text-slate-600">Bring in orders paid before automatic sync was enabled. Only paid, unfulfilled orders can be imported. Orders already imported will not be duplicated.</p>
      <form action={importExistingOrders} className="space-y-3">
        <label className="block space-y-1"><span className="text-sm font-medium">Shopify order numbers</span><textarea name="order_names" className="input min-h-24 w-full" rows={3} maxLength={500} required placeholder="#1160, #1161, #1162" aria-describedby="shopify-order-numbers-help" /></label>
        <p id="shopify-order-numbers-help" className="text-sm text-slate-500">Enter up to 10 order numbers, separated by commas or new lines.</p>
        <PendingSubmitButton className="btn-primary" label="Import paid orders" pendingLabel="Importing orders..." />
      </form>
    </section> : null}
    <nav className="flex gap-4" aria-label="Shopify import views"><Link className="workspace-text-link" href="/admin/orders/shopify" aria-current={!all ? 'page' : undefined}>Needs attention</Link><Link className="workspace-text-link" href="/admin/orders/shopify?view=all" aria-current={all ? 'page' : undefined}>All imports</Link></nav>
    {error ? <p className="workspace-notice warning" role="alert">Import history is unavailable. Confirm the Shopify database migration has been applied.</p> : !data?.length ? <p className="workspace-notice">{all ? 'No Shopify order webhooks received yet.' : 'No Shopify imports need attention.'}</p> : <div className="overflow-x-auto"><table className="order-items-table w-full text-sm">
      <thead><tr><th>Shopify order</th><th>Status</th><th>Last update</th><th>Details</th><th>Action</th></tr></thead>
      <tbody>{data.map((receipt) => <tr key={receipt.id}>
        <td>{receipt.shopify_order_name || 'Shopify order'}</td><td>{receipt.status}</td><td>{formatAppDateTime(receipt.updated_at)}</td>
        <td>{receipt.error || (receipt.status === 'imported' ? 'Paid order imported' : 'Awaiting import')}</td>
        <td>{receipt.order_id ? <Link className="workspace-text-link" href={`/admin/orders/${receipt.order_id}`}>View order</Link> : current.access.orders.canEdit && ['pending', 'error'].includes(receipt.status) ? <form action={retryImport}><input type="hidden" name="id" value={receipt.id} /><PendingSubmitButton className="btn-secondary" label="Retry import" pendingLabel="Importing..." /></form> : null}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="text-xs text-slate-500">Showing up to 100 recent imports. Shipment sync issues can be retried from the order’s fulfillment page.</p>
  </div>;
}

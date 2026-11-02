import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { getShopifyConfig, hasShopifyConfiguration, registerShopifyWebhooks } from '@/lib/shopify';
import { syncShopifyCatalog } from '@/lib/shopify-catalog';
import { retryShopifyProductImport } from '@/lib/shopify-product-webhooks';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllPages } from '@/lib/supabase/pagination';
import { formatAppDateTime } from '@/lib/utils';

export const maxDuration = 300;

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : 'Shopify could not complete this request.').slice(0, 500);
}

async function pullCatalog() {
  'use server';
  await requireAdminWriteAccess('/admin/products/shopify?toast=admin_write_denied', 'products');
  let result;
  try {
    result = await syncShopifyCatalog();
  } catch (error) {
    redirect(`/admin/products/shopify?toast=error&message=${encodeURIComponent(errorText(error))}`);
  }
  revalidatePath('/admin/products');
  revalidatePath('/admin/products/shopify');
  const params = new URLSearchParams({ toast: result.errorCount ? 'partial' : 'synced', imported: String(result.importedCount), updated: String(result.updatedCount) });
  if (result.errors.length) params.set('message', result.errors.slice(0, 3).join(' ').slice(0, 500));
  redirect(`/admin/products/shopify?${params}`);
}

async function enableAutomaticSync() {
  'use server';
  await requireAdminWriteAccess('/admin/products/shopify?toast=admin_write_denied', 'products');
  await requireAdminWriteAccess('/admin/products/shopify?toast=admin_write_denied', 'orders');
  try {
    await registerShopifyWebhooks(process.env.NEXT_PUBLIC_SITE_URL ?? '');
  } catch (error) {
    redirect(`/admin/products/shopify?toast=error&message=${encodeURIComponent(errorText(error))}`);
  }
  redirect('/admin/products/shopify?toast=webhooks_enabled');
}

async function retryProduct(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/products/shopify?toast=admin_write_denied', 'products');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/admin/products/shopify');
  let failure: string | undefined;
  try {
    const result = await retryShopifyProductImport(id);
    if (result.status === 'error') failure = result.error || 'Product sync failed.';
  } catch (error) {
    failure = errorText(error);
  }
  revalidatePath('/admin/products');
  redirect(`/admin/products/shopify?toast=${failure ? `error&message=${encodeURIComponent(failure)}` : 'retried'}`);
}

export default async function ShopifyCatalogPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await requireAdminSectionView('products');
  const params = await searchParams;
  const config = getShopifyConfig();
  const configured = hasShopifyConfiguration();
  const admin = getSupabaseAdmin();
  const [products, receipts] = await Promise.all([
    fetchAllPages((from, to) => admin.from('products').select('id,name,sku,active,shopify_sku,shopify_synced_at,product_recipes(id)')
      .eq('shopify_shop_domain', config.shopDomain).not('shopify_variant_id', 'is', null).order('name').order('id').range(from, to)),
    admin.from('shopify_product_imports').select('id,shopify_product_id,status,error,updated_at')
      .in('status', ['pending', 'error']).order('updated_at').limit(100),
  ]);
  const canEdit = current.isOwner || current.access.products.canEdit;
  const canEnable = canEdit && (current.isOwner || current.access.orders.canEdit);
  const needsRecipe = (value: unknown) => Array.isArray(value) ? value.length === 0 : !value;
  const missingCogs = (products.data ?? []).filter((product) => needsRecipe(product.product_recipes));
  const count = (key: string) => Math.max(0, Number.parseInt(String(params[key] ?? '0'), 10) || 0);

  return <div className="space-y-6">
    <header className="workspace-page-heading"><div><Link href="/admin/products" className="text-sm text-slate-500">Products</Link><h1 className="page-title mt-2">Shopify products</h1><p>{config.shopDomain || 'Store not configured'}</p></div><Link className="btn-secondary" href="/admin/orders/shopify">Order imports</Link></header>
    {params.toast === 'synced' || params.toast === 'partial' ? <StatusToast message={`${count('imported')} products imported, ${count('updated')} updated.${params.toast === 'partial' ? ' Some products need another sync.' : ''}`} tone={params.toast === 'partial' ? 'error' : 'success'} /> : null}
    {params.toast === 'webhooks_enabled' ? <StatusToast message="Automatic product imports and paid-order imports are enabled in Shopify." tone="success" /> : null}
    {params.toast === 'retried' ? <StatusToast message="Product import completed." tone="success" /> : null}
    {params.toast === 'error' || params.toast === 'partial' ? <StatusToast message={typeof params.message === 'string' ? params.message.slice(0, 500) : 'Shopify sync failed. Check the connection and retry.'} tone="error" /> : null}
    {params.toast === 'admin_write_denied' ? <StatusToast message="You do not have permission to perform this action." tone="error" /> : null}

    <section className="card space-y-4">
      <h2 className="text-lg font-semibold">Import products and set up COGS</h2>
      <p className="text-sm text-slate-600">Each Shopify variant gets its own portal product. Set up its category, production recipe, materials, and labor in Products. Future Shopify updates preserve your recipes and COGS.</p>
      <p className="text-sm text-slate-600">Orders match by Shopify variant, so changing a SKU will not break the link. Existing portal products with the same SKU are kept separate to avoid mixing different package sizes.</p>
      {!configured ? <p className="workspace-notice warning">Add this store’s Shopify app credentials to the server environment to connect. Then import the catalog and enable automatic sync below.</p> : <p className="text-sm text-slate-600">App credentials are configured. Importing or enabling sync verifies the connection.</p>}
      {canEdit ? <div className="flex flex-wrap gap-3"><form action={pullCatalog}><PendingSubmitButton className="btn-primary" label="Import / refresh Shopify products" pendingLabel="Importing products..." disabled={!configured} disabledLabel="Shopify credentials required" /></form>{canEnable ? <form action={enableAutomaticSync}><PendingSubmitButton className="btn-secondary" label="Enable automatic product & order sync" pendingLabel="Enabling sync..." disabled={!configured} disabledLabel="Shopify credentials required" /></form> : null}</div> : null}
    </section>

    {receipts.error ? <p className="workspace-notice warning">Product import history is unavailable. Confirm the Shopify migration has been applied.</p> : receipts.data?.length ? <section className="card space-y-3"><h2 className="text-lg font-semibold">Product imports needing attention</h2>{receipts.data.map((receipt) => <div key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><div className="text-sm"><p>Shopify product {receipt.shopify_product_id.split('/').at(-1)}</p><p className="text-rose-700">{receipt.error || 'Import is pending.'}</p></div>{canEdit ? <form action={retryProduct}><input type="hidden" name="id" value={receipt.id} /><PendingSubmitButton className="btn-secondary" label="Retry product import" pendingLabel="Importing..." /></form> : null}</div>)}</section> : null}
    {products.error ? <p className="workspace-notice warning">Shopify products could not be loaded. Confirm the Shopify migration has been applied.</p> : <section className="space-y-4">
      <h2 className="text-lg font-semibold">Imported products · {products.data?.length ?? 0}</h2>
      {missingCogs.length ? <p className="workspace-notice warning">{missingCogs.length} product{missingCogs.length === 1 ? '' : 's'} need a production recipe and COGS setup.</p> : null}
      {!products.data?.length ? <p className="text-sm text-slate-600">Imported products will appear here and in your Products list.</p> : <div className="overflow-x-auto"><table className="order-items-table w-full text-sm"><thead><tr><th>Product</th><th>Portal SKU</th><th>Shopify SKU</th><th>COGS setup</th><th>Last synced</th></tr></thead><tbody>{products.data.map((product) => <tr key={product.id}><td><Link className="workspace-text-link" href={`/admin/products/${product.id}#recipe`}>{product.name}</Link>{product.active === false ? <span className="ml-2 workspace-badge">Inactive</span> : null}</td><td>{product.sku}</td><td>{product.shopify_sku || 'Not set in Shopify'}</td><td><Link className="workspace-text-link" href={`/admin/products/${product.id}#recipe`}>{needsRecipe(product.product_recipes) ? 'Set up COGS' : 'Edit recipe / COGS'}</Link></td><td>{formatAppDateTime(product.shopify_synced_at)}</td></tr>)}</tbody></table></div>}
    </section>}
  </div>;
}

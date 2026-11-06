import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  createMissingQuickBooksProductsFromPortal,
  getQuickBooksConnectionStatus,
  QuickBooksConfigurationError,
  type QuickBooksPortalProduct,
  type QuickBooksProductCreateResult,
} from '@/lib/quickbooks';
import {
  PRODUCT_CATEGORY_OPTIONS,
  UNCATEGORIZED_PRODUCT_CATEGORY,
  isProductCategory,
  productCategoryGroupKey,
  productCategoryLabel,
  type ProductCategoryGroup
} from '@/lib/product-categories';
import { CATALOG_ROAST_OPTIONS, getProductPackInfo, groupCatalogProducts, isPackCategory, matchesCatalogSearch } from '@/lib/product-catalog';
import { createClient } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/supabase/pagination';
import { supabaseAdmin } from '@/lib/supabase/admin';

type ProductRow = {
  id: string;
  name: string | null;
  quickbooks_item_id: string | null;
  quickbooks_sync_error: string | null;
  quickbooks_sync_status: string | null;
  sku: string | null;
  category: string | null;
  active: boolean | null;
  shopify_variant_id?: string | null;
  product_recipes?: { id: string } | { id: string }[] | null;
};

type RecipeLaborRow = {
  id: string;
  product_id: string | null;
  labor_minutes: number | string | null;
  labor_rate_cents: number | string | null;
};


function normalizeCategoryFilter(value: string | string[] | undefined): ProductCategoryGroup | 'all' {
  if (value === UNCATEGORIZED_PRODUCT_CATEGORY) return UNCATEGORIZED_PRODUCT_CATEGORY;
  return typeof value === 'string' && isProductCategory(value) ? value : 'all';
}

function productDisplayName(product: ProductRow) {
  return product.name?.trim() || 'Unnamed product';
}

function productMatchesCategory(product: ProductRow, categoryFilter: ProductCategoryGroup | 'all') {
  return categoryFilter === 'all' || productCategoryGroupKey(product.category) === categoryFilter;
}



function buildProductsHref(category: ProductCategoryGroup | 'all', search: string, roast = 'all') {
  const params = new URLSearchParams();
  if (category !== 'all') params.set('category', category);
  if (search) params.set('q', search);
  if (roast !== 'all' && (category === 'all' || isPackCategory(category))) params.set('roast', roast);
  const query = params.toString();
  return query ? `/admin/products?${query}` : '/admin/products';
}

function safeProductsReturnHref(formData: FormData) {
  const value = String(formData.get('return_to') ?? '');
  return value.startsWith('/admin/products') ? value : '/admin/products';
}

function productsToastHref(returnTo: string, toast: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(returnTo, 'http://localhost');
  url.searchParams.set('toast', toast);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function parsePercentAdjustment(value: FormDataEntryValue | null) {
  const raw = String(value ?? '').trim();
  if (!raw) return { invalid: false, value: null };
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < -100 || parsed > 500) {
    return { invalid: true, value: null };
  }
  return { invalid: false, value: parsed };
}

function numericValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundRecipeNumber(value: number) {
  return Math.round(value * 10000) / 10000;
}

async function massAdjustRecipeLabor(formData: FormData) {
  'use server';
  const returnTo = safeProductsReturnHref(formData);
  await requireAdminWriteAccess(productsToastHref(returnTo, 'admin_write_denied'), 'products');

  const minutesAdjustment = parsePercentAdjustment(formData.get('labor_minutes_percent'));
  const rateAdjustment = parsePercentAdjustment(formData.get('labor_rate_percent'));
  const confirmed = formData.get('confirm_bulk_labor_adjustment') === 'on';

  const hasNoAdjustment = [minutesAdjustment.value, rateAdjustment.value].every((value) => value === null || value === 0);
  if (minutesAdjustment.invalid || rateAdjustment.invalid || hasNoAdjustment) {
    redirect(productsToastHref(returnTo, 'bulk_labor_invalid'));
  }
  if (!confirmed) {
    redirect(productsToastHref(returnTo, 'bulk_labor_confirm_required'));
  }

  const { data: recipes, error } = await supabaseAdmin
    .from('product_recipes')
    .select('id,product_id,labor_minutes,labor_rate_cents')
    .limit(50000);
  if (error) {
    console.error('[admin-products] bulk labor recipe load failed', { error });
    redirect(productsToastHref(returnTo, 'bulk_labor_error'));
  }

  const now = new Date().toISOString();
  const rows = ((recipes ?? []) as RecipeLaborRow[]).map((recipe) => {
    const minutesMultiplier = minutesAdjustment.value === null ? 1 : 1 + minutesAdjustment.value / 100;
    const rateMultiplier = rateAdjustment.value === null ? 1 : 1 + rateAdjustment.value / 100;
    return {
      id: recipe.id,
      product_id: recipe.product_id,
      labor_minutes: roundRecipeNumber(Math.max(0, numericValue(recipe.labor_minutes) * minutesMultiplier)),
      labor_rate_cents: Math.round(Math.max(0, numericValue(recipe.labor_rate_cents) * rateMultiplier)),
      updated_at: now,
    };
  });

  if (!rows.length) {
    redirect(productsToastHref(returnTo, 'bulk_labor_none'));
  }

  let updatedCount = 0;
  const batchSize = 20;
  for (let index = 0; index < rows.length; index += batchSize) {
    const chunk = rows.slice(index, index + batchSize);
    const results = await Promise.all(
      chunk.map((row) =>
        supabaseAdmin
          .from('product_recipes')
          .update({
            labor_minutes: row.labor_minutes,
            labor_rate_cents: row.labor_rate_cents,
            updated_at: row.updated_at,
          })
          .eq('id', row.id)
          .select('id')
      )
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      console.error('[admin-products] bulk labor update failed', { error: failed.error });
      redirect(productsToastHref(returnTo, 'bulk_labor_error'));
    }
    updatedCount += results.reduce((sum, result) => sum + (result.data?.length ?? 0), 0);
  }

  revalidatePath('/admin/products');
  revalidatePath('/admin/reports');
  revalidatePath('/admin/inventory');
  revalidatePath('/admin/production');
  for (const productId of [...new Set(rows.map((row) => row.product_id).filter(Boolean))].slice(0, 250)) {
    revalidatePath(`/admin/products/${productId}`);
  }

  redirect(productsToastHref(returnTo, 'bulk_labor_saved', { count: updatedCount }));
}

async function syncNewQuickBooksProducts(formData: FormData) {
  'use server';
  const returnTo = safeProductsReturnHref(formData);
  await requireAdminWriteAccess(productsToastHref(returnTo, 'admin_write_denied'), 'products');

  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('id,name,sku,description,active,quickbooks_item_id')
    .neq('active', false)
    .is('quickbooks_item_id', null)
    .order('name', { ascending: true });

  if (error) {
    console.error('[admin-products] QuickBooks product load failed', { error });
    redirect(productsToastHref(returnTo, 'quickbooks_sync_failed'));
  }

  if (!products?.length) {
    redirect(productsToastHref(returnTo, 'quickbooks_sync_none'));
  }

  let result: QuickBooksProductCreateResult;
  try {
    result = await createMissingQuickBooksProductsFromPortal(products as QuickBooksPortalProduct[]);
  } catch (error) {
    if (error instanceof QuickBooksConfigurationError) {
      redirect(productsToastHref(returnTo, 'quickbooks_sync_not_connected'));
    }
    console.error('[admin-products] QuickBooks product sync failed', { error });
    redirect(productsToastHref(returnTo, 'quickbooks_sync_failed'));
  }

  revalidatePath('/admin/products');
  revalidatePath('/admin/invoicing');
  const toast = result.productErrorCount ? 'quickbooks_sync_with_errors' : result.createdCount ? 'quickbooks_sync_saved' : 'quickbooks_sync_none';
  redirect(productsToastHref(returnTo, toast, { count: result.createdCount, errors: result.productErrorCount }));
}

export default async function ProductsPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  await requireAdminSectionView('products');
  const supabase = await createClient();
  const [{ data, error: productsError }, { count: recipeCount }, quickBooksStatus] = await Promise.all([
    fetchAllPages((from, to) => supabase.from('products').select('id,name,sku,category,active,quickbooks_item_id,quickbooks_sync_status,quickbooks_sync_error,shopify_variant_id,product_recipes(id)').order('name', { ascending: true }).order('id').range(from, to)),
    supabase.from('product_recipes').select('id', { count: 'exact', head: true }),
    getQuickBooksConnectionStatus(),
  ]);
  const products = (data ?? []) as ProductRow[];
  const categoryFilter = normalizeCategoryFilter(searchParams?.category);
  const search = typeof searchParams?.q === 'string' ? searchParams.q.trim() : '';
  const requestedRoast = typeof searchParams?.roast === 'string' ? searchParams.roast : '';
  const showRoastFilter = categoryFilter === 'all' || isPackCategory(categoryFilter);
  const roastFilter = showRoastFilter && CATALOG_ROAST_OPTIONS.some((roast) => roast === requestedRoast) ? requestedRoast : 'all';
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const adjustedCount = typeof searchParams?.count === 'string' ? Number.parseInt(searchParams.count, 10) : 0;
  const currentHref = buildProductsHref(categoryFilter, search, roastFilter);
  const filteredProducts = products.filter((product) => productMatchesCategory(product, categoryFilter)
    && matchesCatalogSearch(product, search)
    && (roastFilter === 'all' || (isPackCategory(product.category) && (getProductPackInfo(product).roast ?? 'Other') === roastFilter)));
  const groupedProducts = groupCatalogProducts(filteredProducts);
  const activeUnmappedQuickBooksCount = products.filter((product) => product.active !== false && !product.quickbooks_item_id).length;
  const quickBooksErrorCount = products.filter((product) => product.quickbooks_sync_status === 'sync_error').length;
  const uncategorizedCount = products.filter((product) => productCategoryGroupKey(product.category) === UNCATEGORIZED_PRODUCT_CATEGORY).length;
  const categoryCounts = new Map<ProductCategoryGroup | 'all', number>([
    ['all', products.length],
    [UNCATEGORIZED_PRODUCT_CATEGORY, uncategorizedCount],
  ]);

  for (const category of PRODUCT_CATEGORY_OPTIONS) {
    categoryCounts.set(category.value, products.filter((product) => product.category === category.value).length);
  }

  const categoryFilters: Array<{ value: ProductCategoryGroup | 'all'; label: string; count: number }> = [
    { value: 'all', label: 'All', count: categoryCounts.get('all') ?? 0 },
    { value: UNCATEGORIZED_PRODUCT_CATEGORY, label: 'Needs category', count: categoryCounts.get(UNCATEGORIZED_PRODUCT_CATEGORY) ?? 0 },
    ...PRODUCT_CATEGORY_OPTIONS.map((category) => ({
      value: category.value,
      label: category.label,
      count: categoryCounts.get(category.value) ?? 0,
    })),
  ];

  return (
    <div className="space-y-6">
      {productsError ? <StatusToast message="The product catalog could not be loaded completely. Please retry." tone="error" /> : null}
      {toast === 'bulk_labor_saved' ? <StatusToast message={`Updated labor on ${Number.isFinite(adjustedCount) ? adjustedCount : recipeCount ?? 0} product recipe${adjustedCount === 1 ? '' : 's'}.`} tone="success" /> : null}
      {toast === 'bulk_labor_invalid' ? <StatusToast message="Enter at least one non-zero percentage between -100 and 500." tone="error" /> : null}
      {toast === 'bulk_labor_confirm_required' ? <StatusToast message="Confirm the bulk labor adjustment before applying it." tone="error" /> : null}
      {toast === 'bulk_labor_none' ? <StatusToast message="No product recipes were found to update." tone="error" /> : null}
      {toast === 'bulk_labor_error' ? <StatusToast message="Unable to update product recipe labor." tone="error" /> : null}
      {toast === 'quickbooks_sync_saved' ? <StatusToast message={`${Number.isFinite(adjustedCount) ? adjustedCount : 0} new product${adjustedCount === 1 ? '' : 's'} pushed to QuickBooks.`} tone="success" /> : null}
      {toast === 'quickbooks_sync_with_errors' ? <StatusToast message={`${Number.isFinite(adjustedCount) ? adjustedCount : 0} product${adjustedCount === 1 ? '' : 's'} pushed to QuickBooks. Review products marked QuickBooks error.`} tone="error" /> : null}
      {toast === 'quickbooks_sync_none' ? <StatusToast message="No new active products need to be pushed to QuickBooks." tone="success" /> : null}
      {toast === 'quickbooks_sync_not_connected' ? <StatusToast message="QuickBooks is not connected or needs setup before products can sync." tone="error" /> : null}
      {toast === 'quickbooks_sync_failed' ? <StatusToast message="Unable to push new products to QuickBooks." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="You do not have permission to edit products." tone="error" /> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="eyebrow">Catalog Admin</span>
          <h1 className="page-title mt-4">Products</h1>
          <p className="page-subtitle mt-2">Browse by category. Frac and filter packs are grouped by roast, then smallest pack size first.</p>
        </div>
        <div className="flex flex-wrap gap-3"><Link href="/admin/products/shopify" className="btn-secondary">Shopify products &amp; COGS</Link><Link href="/admin/products/new" className="btn-primary w-full sm:w-auto">New product</Link></div>
      </div>

      <section className="card space-y-4">
        <form key={`${categoryFilter}:${search}:${roastFilter}`} className="flex flex-col gap-3 lg:flex-row lg:items-end">
          {categoryFilter !== 'all' ? <input type="hidden" name="category" value={categoryFilter} /> : null}
          <label className="min-w-0 flex-1 space-y-1.5 text-sm font-medium text-slate-700">
            <span>Find a product</span>
            <input className="input" name="q" defaultValue={search} placeholder="Search name, size, or SKU" />
          </label>
          {showRoastFilter ? <label className="space-y-1.5 text-sm font-medium text-slate-700 lg:w-52">
            <span>Pack roast</span>
            <select className="input" name="roast" defaultValue={roastFilter}>
              <option value="all">All roasts</option>
              {CATALOG_ROAST_OPTIONS.map((roast) => <option key={roast} value={roast}>{roast}</option>)}
            </select>
          </label> : null}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button className="btn-secondary w-full sm:w-auto" type="submit">Search</button>
            {search || roastFilter !== 'all' ? <Link className="btn-secondary w-full sm:w-auto" href={buildProductsHref(categoryFilter, '')}>Clear filters</Link> : null}
          </div>
        </form>
        <div className="flex flex-wrap gap-2">
          {categoryFilters.map((category) => {
            const isActive = categoryFilter === category.value;
            return (
              <Link
                key={category.value}
                href={buildProductsHref(category.value, search, roastFilter)}
                aria-current={isActive ? 'page' : undefined}
                className={`rounded-full border px-3 py-2 text-sm font-semibold transition-all duration-200 ${
                  isActive
                    ? 'border-teal-200 bg-teal-50 text-teal-800'
                    : 'border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-white'
                }`}
              >
                {category.label} ({category.count})
              </Link>
            );
          })}
        </div>
      </section>

      <p className="text-sm text-slate-500" role="status">Showing {filteredProducts.length} of {products.length} products</p>
      {!filteredProducts.length ? <div className="card space-y-3 text-sm text-slate-600">
        <p>No products match these filters.</p>
        <Link href="/admin/products" className="workspace-text-link">Show all products</Link>
      </div> : null}
      {groupedProducts.map((group) => (
        <details key={`${group.category}:${search}:${roastFilter}`} open className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80">
          <summary className="cursor-pointer bg-slate-50 px-4 py-3 font-semibold text-slate-900 sm:px-5">
            {productCategoryLabel(group.category)} <span className="ml-2 text-sm font-normal text-slate-500">{group.products.length} products</span>
          </summary>
          <div className="border-t border-slate-200">
            {group.roasts.map((roast) => (
              <section key={roast.label ?? 'products'} aria-label={roast.label ? `${productCategoryLabel(group.category)} · ${roast.label}` : productCategoryLabel(group.category)}>
                {roast.label ? <div className={`flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-2.5 sm:px-5 ${roast.label === 'Medium Roast' ? 'bg-amber-50' : roast.label === 'Dark Roast' ? 'bg-slate-100' : 'bg-teal-50/60'}`}>
                  <h2 className="text-sm font-semibold text-slate-900">{roast.label}</h2>
                  <span className="text-xs text-slate-500">{roast.products.length} products</span>
                </div> : null}
                <div className="divide-y divide-slate-100">
                  {roast.products.map((product) => {
                    const pack = getProductPackInfo(product);
                    return <Link className="block px-4 py-3 transition-colors hover:bg-teal-50/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 sm:px-5" key={product.id} href={`/admin/products/${product.id}`}>
                      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between xl:gap-5">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-semibold leading-6 text-slate-950">{productDisplayName(product)}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            {pack.sizeOz !== null ? <span className="font-semibold text-slate-700">{pack.sizeOz} oz / pack</span> : null}
                            {pack.count !== null ? <span className="text-slate-600">{pack.count} packs / case</span> : null}
                            {pack.withFilters ? <span className="rounded bg-teal-50 px-2 py-0.5 font-semibold text-teal-800">With filters</span> : null}
                            <span className="break-all text-slate-500">SKU: {product.sku || 'No SKU'}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5 xl:max-w-sm xl:justify-end">
                          {product.shopify_variant_id ? <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Shopify</span> : null}
                          {product.shopify_variant_id && (!product.product_recipes || (Array.isArray(product.product_recipes) && !product.product_recipes.length)) ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Needs COGS setup</span> : null}
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${product.active ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {product.active ? 'Active' : 'Inactive'}
                          </span>
                          <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                            product.quickbooks_item_id
                              ? 'bg-teal-100 text-teal-700'
                              : product.quickbooks_sync_status === 'sync_error'
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-slate-100 text-slate-600'
                          }`}>
                            {product.quickbooks_item_id ? 'QuickBooks' : product.quickbooks_sync_status === 'sync_error' ? 'QuickBooks error' : 'Not in QuickBooks'}
                          </span>
                        </div>
                      </div>
                      {product.quickbooks_sync_status === 'sync_error' && product.quickbooks_sync_error ? (
                        <p className="mt-2 text-sm font-medium text-rose-700">{product.quickbooks_sync_error}</p>
                      ) : null}
                    </Link>;
                  })}
                </div>
              </section>
            ))}
          </div>
        </details>
      ))}

      <details className="rounded-2xl border border-slate-200 bg-white/70" open={toast.startsWith('bulk_labor_') || toast.startsWith('quickbooks_sync_')}>
        <summary className="cursor-pointer px-4 py-3 font-semibold text-slate-700 sm:px-5">Catalog management <span className="ml-2 text-sm font-normal text-slate-500">QuickBooks sync &amp; recipe labor</span></summary>
        <div className="space-y-4 border-t border-slate-200 p-3 sm:p-5">
          <section className="card space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <span className="eyebrow">QuickBooks</span>
                <h2 className="mt-3 text-xl font-semibold text-slate-950">Product sync</h2>
                <p className="mt-2 text-sm text-slate-500">
                  {activeUnmappedQuickBooksCount} active portal product{activeUnmappedQuickBooksCount === 1 ? '' : 's'} not linked to QuickBooks.
                  {quickBooksErrorCount ? ` ${quickBooksErrorCount} product${quickBooksErrorCount === 1 ? '' : 's'} currently need review.` : ''}
                </p>
              </div>
              <form action={syncNewQuickBooksProducts}>
                <input name="return_to" type="hidden" value={currentHref} />
                <PendingSubmitButton
                  className="btn-primary w-full lg:w-auto"
                  disabled={!quickBooksStatus.connected || activeUnmappedQuickBooksCount === 0}
                  disabledLabel={!quickBooksStatus.connected ? 'Connect QuickBooks first' : 'No new products'}
                  label="Push new products"
                  pendingLabel="Pushing..."
                />
              </form>
            </div>
          </section>

          <section className="card space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div>
                <span className="eyebrow">Recipe Labor</span>
                <h2 className="mt-3 text-xl font-semibold text-slate-950">Mass adjust labor</h2>
                <p className="mt-2 text-sm text-slate-500">{recipeCount ?? 0} existing product recipe{recipeCount === 1 ? '' : 's'} will be eligible for this adjustment.</p>
              </div>
            </div>
            <form action={massAdjustRecipeLabor} className="grid gap-3 lg:grid-cols-[11rem_11rem_minmax(0,1fr)_auto] lg:items-end">
              <input name="return_to" type="hidden" value={currentHref} />
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Labor minutes %
                <input className="input" name="labor_minutes_percent" max="500" min="-100" placeholder="10 or -5" step="0.01" type="number" />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Labor rate %
                <input className="input" name="labor_rate_percent" max="500" min="-100" placeholder="10 or -5" step="0.01" type="number" />
              </label>
              <label className="flex min-h-[3.25rem] items-center gap-3 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm font-semibold text-slate-700">
                <input name="confirm_bulk_labor_adjustment" type="checkbox" />
                Apply to every existing product recipe
              </label>
              <PendingSubmitButton className="btn-primary w-full lg:w-auto" label="Apply Adjustment" pendingLabel="Applying..." />
            </form>
          </section>
        </div>
      </details>
    </div>
  );
}

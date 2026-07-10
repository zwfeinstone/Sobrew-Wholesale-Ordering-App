import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  PRODUCT_CATEGORY_OPTIONS,
  UNCATEGORIZED_PRODUCT_CATEGORY,
  isProductCategory,
  productCategoryGroupKey,
  productCategoryLabel,
  productCategorySortRank,
  type ProductCategoryGroup
} from '@/lib/product-categories';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

type ProductRow = {
  id: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  active: boolean | null;
};

type RecipeLaborRow = {
  id: string;
  product_id: string | null;
  labor_minutes: number | string | null;
  labor_rate_cents: number | string | null;
};

const productNameCollator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

function normalizeCategoryFilter(value: string | string[] | undefined): ProductCategoryGroup | 'all' {
  if (value === UNCATEGORIZED_PRODUCT_CATEGORY) return UNCATEGORIZED_PRODUCT_CATEGORY;
  return typeof value === 'string' && isProductCategory(value) ? value : 'all';
}

function productDisplayName(product: ProductRow) {
  return product.name?.trim() || 'Unnamed product';
}

function productMatchesSearch(product: ProductRow, search: string) {
  if (!search) return true;
  const normalizedSearch = search.toLocaleLowerCase('en-US');
  return [product.name, product.sku]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase('en-US').includes(normalizedSearch));
}

function productMatchesCategory(product: ProductRow, categoryFilter: ProductCategoryGroup | 'all') {
  return categoryFilter === 'all' || productCategoryGroupKey(product.category) === categoryFilter;
}

function sortProducts(products: ProductRow[]) {
  return [...products].sort((a, b) => {
    const categoryComparison = productCategorySortRank(a.category) - productCategorySortRank(b.category);
    if (categoryComparison !== 0) return categoryComparison;
    return productNameCollator.compare(productDisplayName(a), productDisplayName(b));
  });
}

function groupProductsByCategory(products: ProductRow[]) {
  const groups: Array<{ category: ProductCategoryGroup; products: ProductRow[] }> = [];
  for (const product of sortProducts(products)) {
    const category = productCategoryGroupKey(product.category);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup?.category === category) {
      currentGroup.products.push(product);
    } else {
      groups.push({ category, products: [product] });
    }
  }
  return groups;
}

function buildProductsHref(category: ProductCategoryGroup | 'all', search: string) {
  const params = new URLSearchParams();
  if (category !== 'all') params.set('category', category);
  if (search) params.set('q', search);
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

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireAdminSectionView('products');
  const supabase = await createClient();
  const [{ data }, { count: recipeCount }] = await Promise.all([
    supabase.from('products').select('id,name,sku,category,active').order('name', { ascending: true }),
    supabase.from('product_recipes').select('id', { count: 'exact', head: true }),
  ]);
  const products = (data ?? []) as ProductRow[];
  const categoryFilter = normalizeCategoryFilter(searchParams?.category);
  const search = typeof searchParams?.q === 'string' ? searchParams.q.trim() : '';
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const adjustedCount = typeof searchParams?.count === 'string' ? Number.parseInt(searchParams.count, 10) : 0;
  const currentHref = buildProductsHref(categoryFilter, search);
  const filteredProducts = products.filter((product) => productMatchesCategory(product, categoryFilter) && productMatchesSearch(product, search));
  const groupedProducts = groupProductsByCategory(filteredProducts);
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
      {toast === 'bulk_labor_saved' ? <StatusToast message={`Updated labor on ${Number.isFinite(adjustedCount) ? adjustedCount : recipeCount ?? 0} product recipe${adjustedCount === 1 ? '' : 's'}.`} tone="success" /> : null}
      {toast === 'bulk_labor_invalid' ? <StatusToast message="Enter at least one non-zero percentage between -100 and 500." tone="error" /> : null}
      {toast === 'bulk_labor_confirm_required' ? <StatusToast message="Confirm the bulk labor adjustment before applying it." tone="error" /> : null}
      {toast === 'bulk_labor_none' ? <StatusToast message="No product recipes were found to update." tone="error" /> : null}
      {toast === 'bulk_labor_error' ? <StatusToast message="Unable to update product recipe labor." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="You do not have permission to edit products." tone="error" /> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="eyebrow">Catalog Admin</span>
          <h1 className="page-title mt-4">Products</h1>
        </div>
        <Link href="/admin/products/new" className="btn-primary w-full sm:w-auto">New product</Link>
      </div>

      <section className="card space-y-4">
        <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          {categoryFilter !== 'all' ? <input type="hidden" name="category" value={categoryFilter} /> : null}
          <input className="input" name="q" defaultValue={search} placeholder="Search by product name or SKU" />
          <div className="flex flex-col gap-3 sm:flex-row">
            <button className="btn-secondary w-full sm:w-auto" type="submit">Search</button>
            {search ? <Link className="btn-secondary w-full sm:w-auto" href={buildProductsHref(categoryFilter, '')}>Clear</Link> : null}
          </div>
        </form>
        <div className="flex flex-wrap gap-2">
          {categoryFilters.map((category) => {
            const isActive = categoryFilter === category.value;
            return (
              <Link
                key={category.value}
                href={buildProductsHref(category.value, search)}
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

      {!filteredProducts.length ? <div className="card text-sm text-slate-600">No products found.</div> : null}
      {groupedProducts.map((group) => (
        <section key={group.category} className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{productCategoryLabel(group.category)}</h2>
            <span className="text-sm text-slate-500">{group.products.length}</span>
          </div>
          {group.products.map((product) => (
            <Link className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95" key={product.id} href={`/admin/products/${product.id}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-lg font-semibold text-slate-950">{productDisplayName(product)}</p>
                  <p className="mt-2 break-all text-sm text-slate-500">SKU: {product.sku || 'No SKU'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-600">
                    {productCategoryLabel(product.category)}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${product.active ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {product.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </section>
      ))}
    </div>
  );
}

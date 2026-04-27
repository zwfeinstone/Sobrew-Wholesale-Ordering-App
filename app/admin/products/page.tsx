import Link from 'next/link';
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

type ProductRow = {
  id: string;
  name: string | null;
  sku: string | null;
  category: string | null;
  active: boolean | null;
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

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.from('products').select('id,name,sku,category,active').order('name', { ascending: true });
  const products = (data ?? []) as ProductRow[];
  const categoryFilter = normalizeCategoryFilter(searchParams?.category);
  const search = typeof searchParams?.q === 'string' ? searchParams.q.trim() : '';
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

import Link from 'next/link';
import Image from 'next/image';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';
import { nextRecurringOrderDate } from '@/lib/recurring';
import {
  PRODUCT_CATEGORY_OPTIONS,
  isProductCategory,
  productCategoryGroupKey,
  productCategoryLabel,
  productCategorySortRank,
  type ProductCategory,
  type ProductCategoryGroup
} from '@/lib/product-categories';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';
import { AddToCartQuantityControls, CartCatalogSync, CartPreviewBar, CartSummaryMetric, ReorderButton } from '@/components/cart-client';

type PortalProduct = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category: string | null;
};

type RecentOrder = {
  id: string;
  status: string | null;
  subtotal_cents: number;
  created_at: string | null;
};

type RecentOrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  product_name_snapshot: string | null;
  qty: number;
  unit_price_cents: number | null;
};

type RecurringOrderSummary = {
  id: string;
  frequency: string;
  status: string | null;
  active: boolean | null;
  created_at: string | null;
  last_generated_at: string | null;
  amount_cents: number | null;
};

const productNameCollator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });
const shortDateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const DEFAULT_PRODUCT_IMAGE_SRC = '/sobrew-product-default.png';

function normalizeCategoryFilter(value: string | string[] | undefined): ProductCategory | 'all' {
  return typeof value === 'string' && isProductCategory(value) ? value : 'all';
}

function normalizeSearch(value: string | string[] | undefined) {
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

function productMatchesSearch(product: PortalProduct, search: string) {
  if (!search) return true;
  const query = search.toLowerCase();
  return [product.name, product.description, productCategoryLabel(productCategoryGroupKey(product.category))]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(query));
}

function sortProducts(products: PortalProduct[]) {
  return [...products].sort((a, b) => {
    const categoryComparison = productCategorySortRank(a.category) - productCategorySortRank(b.category);
    if (categoryComparison !== 0) return categoryComparison;
    return productNameCollator.compare(a.name, b.name);
  });
}

function groupProductsByCategory(products: PortalProduct[]) {
  const groups: Array<{ category: ProductCategoryGroup; products: PortalProduct[] }> = [];
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

function buildCatalogHref(category: ProductCategory | 'all', search = '') {
  const query = new URLSearchParams();
  if (category !== 'all') query.set('category', category);
  if (search) query.set('q', search);
  const queryString = query.toString();
  return queryString ? `/portal?${queryString}` : '/portal';
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : shortDateFormatter.format(date);
}

function recurringStatus(order: RecurringOrderSummary) {
  if (order.status) return order.status;
  if (typeof order.active === 'boolean') return order.active ? 'active' : 'paused';
  return 'active';
}

function nextRecurringDate(order: RecurringOrderSummary) {
  const anchor = order.last_generated_at ?? order.created_at;
  return nextRecurringOrderDate(order.frequency, anchor);
}

export default async function PortalPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const { user, profile } = await requireUser();
  const supabase = await createClient();
  const centerId = profile?.center_id ?? user.id;
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const categoryFilter = normalizeCategoryFilter(searchParams?.category);
  const searchQuery = normalizeSearch(searchParams?.q);

  const [{ data: assigned }, { data: prices }, { data: recentOrderRows }, { data: recurringOrderRows }] = await Promise.all([
    supabase.from('user_products').select('product_id').eq('center_id', centerId),
    supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', centerId),
    supabase.from('orders').select('id,status,subtotal_cents,created_at').eq('center_id', centerId).order('created_at', { ascending: false }).limit(1),
    supabase.from('recurring_orders').select('id,frequency,status,active,created_at,last_generated_at,amount_cents').eq('center_id', centerId).order('created_at', { ascending: false }),
  ]);

  const productIds = (assigned ?? []).map((row) => row.product_id);
  const recentOrders = (recentOrderRows ?? []) as RecentOrder[];
  const recentOrderIds = recentOrders.map((order) => order.id);
  const [{ data: products }, { data: recentOrderItems }] = await Promise.all([
    productIds.length
      ? supabase.from('products').select('id,name,description,image_url,category').in('id', productIds).eq('active', true)
      : Promise.resolve({ data: [] as any[] }),
    recentOrderIds.length
      ? supabase
          .from('order_items')
          .select('id,order_id,product_id,product_name_snapshot,qty,unit_price_cents')
          .in('order_id', recentOrderIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const priceMap = new Map((prices ?? []).map((row) => [row.product_id, row.price_cents]));
  const availableProducts = (products ?? []) as PortalProduct[];
  const productNameById = new Map(availableProducts.map((product) => [product.id, product.name]));
  const recentItemsByOrderId = new Map<string, RecentOrderItem[]>();
  for (const item of (recentOrderItems ?? []) as RecentOrderItem[]) {
    const current = recentItemsByOrderId.get(item.order_id) ?? [];
    current.push(item);
    recentItemsByOrderId.set(item.order_id, current);
  }
  const quickOrders = recentOrders
    .map((order) => {
      const items = (recentItemsByOrderId.get(order.id) ?? []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        name: productNameById.get(item.product_id) ?? item.product_name_snapshot ?? 'Unknown product',
        price_cents: priceMap.get(item.product_id) ?? item.unit_price_cents ?? 0,
        qty: item.qty,
      }));
      return { ...order, items };
    })
    .filter((order) => order.items.length);
  const activeRecurringOrders = ((recurringOrderRows ?? []) as RecurringOrderSummary[]).filter((order) => recurringStatus(order) !== 'canceled');
  const nextRecurringDates = activeRecurringOrders
    .map((order) => nextRecurringDate(order))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime());
  const centerName = !profile?.is_admin ? profile?.center?.name?.trim() : '';
  const searchedProducts = availableProducts.filter((product) => productMatchesSearch(product, searchQuery));
  const filteredProducts = categoryFilter === 'all'
    ? searchedProducts
    : searchedProducts.filter((product) => product.category === categoryFilter);
  const groupedProducts = groupProductsByCategory(filteredProducts);
  const cartProducts = availableProducts.map((product) => ({
    product_id: product.id,
    name: product.name,
    price_cents: priceMap.get(product.id) ?? 0,
  }));
  const categoryFilters = [
    { value: 'all' as const, label: 'All', count: searchedProducts.length },
    ...PRODUCT_CATEGORY_OPTIONS.map((category) => ({
      value: category.value,
      label: category.label,
      count: searchedProducts.filter((product) => product.category === category.value).length,
    })),
  ];

  return (
    <div className="space-y-6">
      <CartCatalogSync products={cartProducts} storageKey={cartStorageKey} />
      <section className="panel portal-hero overflow-hidden">
        <div className="portal-hero-grid grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.92fr)] xl:items-center">
          <div className="portal-hero-intro max-w-2xl space-y-4">
            <span className="eyebrow">Sobrew Catalog</span>
            <div>
              <h1 className="page-title portal-hero-title">Welcome</h1>
              {centerName ? <p className="portal-center-name mt-2 text-lg font-semibold text-slate-800">{centerName}</p> : null}
              <p className="page-subtitle portal-hero-description mt-3">Build your next wholesale order, review recurring shipments, and keep your center stocked with coffee that supports recovery.</p>
            </div>
          </div>
          <div className="portal-stats-grid grid gap-3 sm:grid-cols-2">
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Last Order</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{formatShortDate(recentOrders[0]?.created_at)}</p>
              <p className="mt-1 text-sm text-slate-500">{recentOrders[0] ? usd(recentOrders[0].subtotal_cents) : 'No orders yet'}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Next Recurring</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{nextRecurringDates[0] ? shortDateFormatter.format(nextRecurringDates[0]) : 'None'}</p>
              <p className="mt-1 text-sm text-slate-500">{activeRecurringOrders.length} active schedule{activeRecurringOrders.length === 1 ? '' : 's'}</p>
            </div>
            <div className="stat-card">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Available Products</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{availableProducts.length}</p>
            </div>
            <CartSummaryMetric storageKey={cartStorageKey} />
          </div>
        </div>
      </section>

      {quickOrders.length ? (
        <section className="premium-section quick-reorder-section space-y-4">
          <div className="quick-reorder-header flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div className="quick-reorder-copy">
              <span className="eyebrow">Quick Reorder</span>
              <h2 className="quick-reorder-title mt-3 text-2xl font-semibold tracking-tight text-slate-950">Start from your last order</h2>
            </div>
            <Link href="/portal/orders" className="btn-secondary quick-reorder-view inline-flex w-full sm:w-auto">View all orders</Link>
          </div>
          <div className="quick-reorder-grid grid gap-4">
            {quickOrders.map((order) => (
              <div key={order.id} className="quick-order-card">
                <div className="quick-order-summary">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Placed {formatShortDate(order.created_at)}</p>
                  <p className="mt-2 text-xl font-semibold text-slate-950">{usd(order.subtotal_cents)}</p>
                </div>
                <div className="quick-order-items">
                  {order.items.slice(0, 3).map((item) => (
                    <div key={item.id} className="quick-order-line">
                      <span className="min-w-0 text-slate-700">{item.name}</span>
                      <span className="quick-order-qty">x {item.qty}</span>
                    </div>
                  ))}
                  {order.items.length > 3 ? <p className="text-sm text-slate-500">+ {order.items.length - 3} more item{order.items.length - 3 === 1 ? '' : 's'}</p> : null}
                </div>
                <ReorderButton
                  items={order.items}
                  label="Add all to cart"
                  storageKey={cartStorageKey}
                  toastMessage="Recent order added to cart."
                  className="btn-primary catalog-card-button w-full"
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="catalog-toolbar space-y-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Browse by product type</p>
            <p className="mt-2 text-sm text-slate-500">
              {searchQuery ? `${filteredProducts.length} result${filteredProducts.length === 1 ? '' : 's'} for "${searchQuery}"` : 'Search or filter your assigned catalog.'}
            </p>
          </div>
          <form action="/portal" className="catalog-search-form flex flex-col gap-2 sm:flex-row">
            {categoryFilter !== 'all' ? <input type="hidden" name="category" value={categoryFilter} /> : null}
            <label className="sr-only" htmlFor="catalog-search">Search products</label>
            <input id="catalog-search" className="input" name="q" type="search" defaultValue={searchQuery} placeholder="Search products" />
            <button className="btn-secondary shrink-0" type="submit">Search</button>
            {searchQuery ? <Link className="btn-secondary shrink-0" href={buildCatalogHref(categoryFilter)}>Clear</Link> : null}
          </form>
        </div>
        <div className="catalog-category-filter-grid">
          {categoryFilters.map((category) => (
            <Link
              key={category.value}
              className={`catalog-category-filter-pill ${categoryFilter === category.value ? 'is-active' : ''}`}
              href={buildCatalogHref(category.value, searchQuery)}
            >
              {category.label} ({category.count})
            </Link>
          ))}
        </div>
      </section>

      {!filteredProducts.length ? (
        <div className="empty-state">
          <p className="text-lg font-semibold text-slate-950">
            {searchQuery
              ? 'No products match your search.'
              : availableProducts.length
              ? 'No products in this category yet.'
              : 'No products are assigned yet.'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {searchQuery
              ? 'Try a different search or clear the current search.'
              : availableProducts.length
              ? 'Try another product type or browse the full catalog.'
              : 'Ask your Sobrew admin to assign products and pricing to this center.'}
          </p>
          {searchQuery ? <Link href={buildCatalogHref(categoryFilter)} className="btn-secondary mt-4 inline-flex">Clear search</Link> : null}
          {!searchQuery && availableProducts.length && categoryFilter !== 'all' ? <Link href="/portal" className="btn-secondary mt-4 inline-flex">Browse all products</Link> : null}
        </div>
      ) : null}
      {groupedProducts.map((group) => (
        <section key={group.category} className="product-category-section space-y-3">
          <div className="product-category-heading flex items-center justify-between border-b border-slate-200 pb-2">
            <h2 className="product-category-title text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
              {group.category === 'uncategorized' ? 'Other products' : productCategoryLabel(group.category)}
            </h2>
            <span className="text-sm text-slate-500">{group.products.length}</span>
          </div>
          <div className="product-grid grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {group.products.map((product) => {
              const price = priceMap.get(product.id) ?? 0;
              const productImageSrc = product.image_url || DEFAULT_PRODUCT_IMAGE_SRC;
              return (
                <div key={product.id} className="product-card catalog-product-card flex h-full flex-col justify-between gap-5">
                  <div className="catalog-product-media">
                    <Image
                      src={productImageSrc}
                      alt={product.name}
                      fill
                      sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                      className="object-contain p-3"
                    />
                  </div>
                  <div className="catalog-product-copy space-y-4">
                    <div className="catalog-product-heading flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="catalog-product-title text-xl font-semibold tracking-tight text-slate-950">{product.name}</h3>
                        <p className="catalog-product-description mt-2 text-sm leading-6 text-slate-500">{product.description || 'No description available.'}</p>
                      </div>
                      <div className="catalog-product-price self-start rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">{usd(price)}</div>
                    </div>
                  </div>
                  <AddToCartQuantityControls product={{ product_id: product.id, name: product.name, price_cents: price }} storageKey={cartStorageKey} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <CartPreviewBar storageKey={cartStorageKey} />
    </div>
  );
}

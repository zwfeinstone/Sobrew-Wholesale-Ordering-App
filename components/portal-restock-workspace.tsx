'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  CartCatalogSync,
  CatalogQuantityControl,
  ReorderButton,
  useCart,
  type Item,
} from '@/components/cart-client';
import {
  PRODUCT_CATEGORY_OPTIONS,
  UNCATEGORIZED_PRODUCT_CATEGORY,
  productCategoryGroupKey,
  productCategoryLabel,
  productCategorySortRank,
  type ProductCategoryGroup,
} from '@/lib/product-categories';

export type PortalRestockProduct = {
  product_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  category: string | null;
  price_cents: number;
};

export type PortalRecentOrder = {
  createdAtLabel: string;
  historicalSubtotalLabel: string;
  itemCount: number;
  items: Item[];
  reorderSubtotalLabel: string;
  reorderTotalChanged: boolean;
  unavailableItemCount: number;
};

export type PortalRecurringSummary = {
  activeCount: number;
  nextDateLabel: string | null;
};

type PortalRestockWorkspaceProps = {
  cartStorageKey: string;
  centerName: string;
  products: PortalRestockProduct[];
  recentOrder: PortalRecentOrder | null;
  recurringSummary: PortalRecurringSummary;
};

const DEFAULT_PRODUCT_IMAGE_SRC = '/sobrew-product-default.png';
const productNameCollator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function productMatchesSearch(product: PortalRestockProduct, query: string) {
  if (!query) return true;
  const normalizedQuery = query.toLocaleLowerCase();
  return [product.name, product.description, productCategoryLabel(product.category)]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
}

function categoryOptions(products: PortalRestockProduct[]) {
  const productCategories = new Set(products.map((product) => productCategoryGroupKey(product.category)));
  const options: Array<{ label: string; value: ProductCategoryGroup }> = PRODUCT_CATEGORY_OPTIONS
    .filter((option) => productCategories.has(option.value))
    .map((option) => option);
  if (productCategories.has(UNCATEGORIZED_PRODUCT_CATEGORY)) {
    options.push({ label: 'Other', value: UNCATEGORIZED_PRODUCT_CATEGORY });
  }
  return options;
}

export function PortalRestockWorkspace({
  cartStorageKey,
  centerName,
  products,
  recentOrder,
  recurringSummary,
}: PortalRestockWorkspaceProps) {
  const [greeting, setGreeting] = useState('Welcome back');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProductCategoryGroup | 'all'>('all');
  const deferredQuery = useDeferredValue(query.trim());
  const { itemCount, items, subtotalCents } = useCart(cartStorageKey);

  useEffect(() => {
    setGreeting(greetingForHour(new Date().getHours()));
  }, []);

  const availableCategories = useMemo(() => categoryOptions(products), [products]);
  const filteredProducts = useMemo(
    () => products
      .filter((product) => productMatchesSearch(product, deferredQuery))
      .filter((product) => category === 'all' || productCategoryGroupKey(product.category) === category)
      .sort((left, right) => {
        const categoryRank = productCategorySortRank(left.category) - productCategorySortRank(right.category);
        return categoryRank || productNameCollator.compare(left.name, right.name);
      }),
    [category, deferredQuery, products]
  );

  const groupedProducts = useMemo(() => {
    const groups = new Map<ProductCategoryGroup, PortalRestockProduct[]>();
    for (const product of filteredProducts) {
      const productCategory = productCategoryGroupKey(product.category);
      const group = groups.get(productCategory);
      if (group) group.push(product);
      else groups.set(productCategory, [product]);
    }
    return [...groups.entries()];
  }, [filteredProducts]);

  const productSnapshots = useMemo(
    () => products.map(({ product_id, name, price_cents }) => ({ product_id, name, price_cents })),
    [products]
  );

  return (
    <div className="restock-workspace">
      <CartCatalogSync products={productSnapshots} storageKey={cartStorageKey} />

      <section className="restock-welcome" aria-labelledby="restock-title">
        <div className="min-w-0">
          <p className="restock-greeting">{greeting}{centerName ? `, ${centerName}` : ''}</p>
          <h1 id="restock-title" className="restock-title">Build this week&apos;s restock.</h1>
        </div>
        {recentOrder ? (
          <div className="recent-order-action">
            <div className="min-w-0">
              <p className="recent-order-label">
                Last order · {recentOrder.createdAtLabel} · {recentOrder.historicalSubtotalLabel}
              </p>
              {recentOrder.itemCount > 0 ? (
                <p className="recent-order-total">
                  {recentOrder.itemCount} item{recentOrder.itemCount === 1 ? '' : 's'} ready
                  {recentOrder.reorderTotalChanged || recentOrder.unavailableItemCount > 0
                    ? ` · ${recentOrder.reorderSubtotalLabel} at today’s prices`
                    : ''}
                  {recentOrder.unavailableItemCount > 0
                    ? ` · ${recentOrder.unavailableItemCount} unavailable`
                    : ''}
                </p>
              ) : (
                <p className="recent-order-total">Products from this order are not currently available.</p>
              )}
            </div>
            {recentOrder.itemCount > 0 ? (
              <ReorderButton
                className="btn-primary recent-order-button"
                items={recentOrder.items}
                label="Reorder & review"
                storageKey={cartStorageKey}
              />
            ) : (
              <Link className="btn-secondary recent-order-button inline-flex" href="/portal/orders">
                View orders
              </Link>
            )}
          </div>
        ) : (
          <p className="restock-first-order">Choose products below to build your first order.</p>
        )}
      </section>

      <section
        aria-label="Recurring shipment summary"
        className="subtle-panel flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
      >
        <div className="min-w-0">
          <p className="font-semibold text-slate-950">
            {recurringSummary.activeCount > 0
              ? `${recurringSummary.activeCount} active recurring shipment${recurringSummary.activeCount === 1 ? '' : 's'}`
              : 'No active recurring shipments'}
          </p>
          {recurringSummary.nextDateLabel ? (
            <p className="mt-0.5 text-slate-500">Next expected order · {recurringSummary.nextDateLabel}</p>
          ) : null}
        </div>
        <Link className="font-semibold text-teal-800 underline-offset-4 hover:underline" href="/portal/recurring-orders">
          Manage recurring
        </Link>
      </section>

      <section className="restock-filter-bar" aria-label="Filter products">
        <div className="restock-search-wrap">
          <svg aria-hidden="true" className="restock-search-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35m1.35-5.4a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Z" />
          </svg>
          <label className="sr-only" htmlFor="restock-search">Search products</label>
          <input
            id="restock-search"
            className="restock-search"
            type="search"
            placeholder="Search products…"
            value={query}
            onChange={(event) => setQuery(event.target.value.slice(0, 80))}
          />
          {query ? (
            <button className="restock-search-clear" type="button" onClick={() => setQuery('')}>
              Clear<span className="sr-only"> product search</span>
            </button>
          ) : null}
        </div>
        <div className="restock-category-tabs" role="group" aria-label="Product category">
          <button
            aria-pressed={category === 'all'}
            className={`restock-category-tab ${category === 'all' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setCategory('all')}
          >
            All
          </button>
          {availableCategories.map((option) => (
            <button
              key={option.value}
              aria-pressed={category === option.value}
              className={`restock-category-tab ${category === option.value ? 'is-active' : ''}`}
              type="button"
              onClick={() => setCategory(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <div id="catalog-start" className="restock-layout">
        <div className="restock-catalog" aria-label="Product catalog">
          <p className="sr-only" aria-live="polite">
            {filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'} shown.
          </p>
          {!filteredProducts.length ? (
            <div className="empty-state">
              <p className="text-lg font-semibold text-slate-950">No products match those filters.</p>
              <p className="mt-2 text-sm text-slate-500">Try a different search or browse all product types.</p>
              <button
                className="btn-secondary mt-4"
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
              >
                Reset filters
              </button>
            </div>
          ) : null}
          {groupedProducts.map(([groupCategory, groupProducts]) => (
            <section key={groupCategory} className="restock-product-group" aria-labelledby={`category-${groupCategory}`}>
              <div className="restock-product-group-heading">
                <h2 id={`category-${groupCategory}`}>{groupCategory === UNCATEGORIZED_PRODUCT_CATEGORY ? 'Other products' : productCategoryLabel(groupCategory)}</h2>
                <span>{groupProducts.length}</span>
              </div>
              <div className="restock-product-list">
                {groupProducts.map((product) => (
                  <article key={product.product_id} className="restock-product-row">
                    <div className="restock-product-image">
                      <Image
                        src={product.image_url || DEFAULT_PRODUCT_IMAGE_SRC}
                        alt=""
                        width={80}
                        height={80}
                        sizes="80px"
                        className="h-full w-full object-contain"
                      />
                    </div>
                    <div className="restock-product-copy">
                      <h3>{product.name}</h3>
                      <p>{product.description || productCategoryLabel(product.category)}</p>
                    </div>
                    <p className="restock-product-price">${(product.price_cents / 100).toFixed(2)}</p>
                    <CatalogQuantityControl
                      compact
                      product={{ product_id: product.product_id, name: product.name, price_cents: product.price_cents }}
                      storageKey={cartStorageKey}
                    />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="restock-order-sidebar" aria-labelledby="restock-order-heading">
          <div className="restock-order-sidebar-card">
            <p className="restock-order-kicker">Your order</p>
            <h2 id="restock-order-heading" className="sr-only">Current order</h2>
            {!items.length ? (
              <div className="restock-order-empty">
                <p>Your order is ready when you are.</p>
                <span>Add products to see them here.</span>
              </div>
            ) : (
              <div className="restock-order-items">
                {items.map((item) => (
                  <div key={item.product_id} className="restock-order-item">
                    <span>{item.name}</span>
                    <strong>{item.qty}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="restock-order-total" aria-live="polite">
              <span>{itemCount} item{itemCount === 1 ? '' : 's'}</span>
              <strong>${(subtotalCents / 100).toFixed(2)}</strong>
            </div>
            {itemCount ? (
              <Link className="btn-primary restock-review-button" href="/portal/cart">Review order</Link>
            ) : (
              <button className="btn-primary restock-review-button" type="button" disabled>Review order</button>
            )}
          </div>
        </aside>
      </div>

      {itemCount ? (
        <div className="restock-mobile-review" aria-live="polite">
          <div>
            <strong>{itemCount} item{itemCount === 1 ? '' : 's'}</strong>
            <span>${(subtotalCents / 100).toFixed(2)}</span>
          </div>
          <Link className="btn-primary" href="/portal/cart">Review order</Link>
        </div>
      ) : null}
    </div>
  );
}

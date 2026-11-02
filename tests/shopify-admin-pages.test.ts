import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  database: null as unknown,
  write: vi.fn(), view: vi.fn(), catalog: vi.fn(), register: vi.fn(), retry: vi.fn(), backfill: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ prefetch: _prefetch, ...props }: Record<string, unknown>) => createElement('a', props) }));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.write }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.view }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => state.database }));
vi.mock('@/lib/shopify', () => ({
  getShopifyConfig: () => ({ shopDomain: 'store.myshopify.com', webhookSecret: 'configured' }),
  hasShopifyConfiguration: () => true,
  registerShopifyWebhooks: state.register,
}));
vi.mock('@/lib/shopify-catalog', () => ({ syncShopifyCatalog: state.catalog }));
vi.mock('@/lib/shopify-product-webhooks', () => ({ retryShopifyProductImport: state.retry }));
vi.mock('@/lib/shopify-import', () => ({ retryShopifyImport: state.retry }));
vi.mock('@/lib/shopify-order-backfill', () => ({ importShopifyOrdersByNames: state.backfill }));

import CatalogPage from '@/app/admin/products/shopify/page';
import OrderImportsPage from '@/app/admin/orders/shopify/page';
import PendingSubmitButton from '@/components/pending-submit-button';

type Action = (data: FormData) => Promise<void>;
function findAction(node: ReactNode, label: string): Action | undefined {
  if (Array.isArray(node)) return node.map((child) => findAction(child, label)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode; action?: Action; label?: string }>(node)) return;
  if (node.type === 'form') {
    const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    if (children.some((child) => isValidElement<{ label?: string }>(child) && child.type === PendingSubmitButton && child.props.label === label)) return node.props.action;
  }
  return findAction(node.props.children, label);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.database = supabaseReadStub().client;
  state.view.mockResolvedValue({ isOwner: true, access: { products: { canEdit: true }, orders: { canEdit: true } } });
  state.write.mockResolvedValue(undefined);
  state.catalog.mockResolvedValue({ importedCount: 2, updatedCount: 1, errorCount: 0, errors: [], productIds: [] });
  state.register.mockResolvedValue({ registered: 3, existing: 0, updated: 0 });
  state.retry.mockResolvedValue({ status: 'imported' });
  state.backfill.mockResolvedValue([{ name: '#1160', status: 'imported', orderId: 'order-1' }]);
});

describe('Shopify admin catalog and import pages', () => {
  it('shows imported variants and COGS setup without requiring matching SKUs', async () => {
    state.database = supabaseReadStub({ tables: { products: [{
      id: 'product-1', name: 'Retail coffee – 12 oz', sku: 'SHOPIFY-123', active: true,
      shopify_sku: 'COFFEE-12', shopify_synced_at: '2026-10-09T12:00:00Z', product_recipes: [],
    }] } }).client;
    const html = renderToStaticMarkup(await CatalogPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Retail coffee – 12 oz');
    expect(html).toContain('SHOPIFY-123');
    expect(html).toContain('COFFEE-12');
    expect(html).toContain('Set up COGS');
    expect(html).toContain('/admin/products/product-1#recipe');
    expect(html).toContain('Future Shopify updates preserve your recipes and COGS.');
    expect(html).not.toContain('Shopify credentials required');
  });

  it('requires Products edit permission before catalog writes', async () => {
    const tree = await CatalogPage({ searchParams: Promise.resolve({}) });
    const action = findAction(tree, 'Import / refresh Shopify products')!;
    expect(action).toBeTypeOf('function');
    state.write.mockRejectedValue(new Error('Denied'));
    await expect(action(new FormData())).rejects.toThrow('Denied');
    expect(state.catalog).not.toHaveBeenCalled();
  });

  it('loads every imported variant for COGS even when Supabase caps each page', async () => {
    const stub = supabaseReadStub({ maxRows: 7, tables: { products: Array.from({ length: 21 }, (_, index) => ({
      id: `product-${index}`, name: `Variant ${index}`, sku: `SHOPIFY-${index}`, active: true,
      shopify_sku: null, shopify_synced_at: null, product_recipes: [],
    })) } });
    state.database = stub.client;
    const html = renderToStaticMarkup(await CatalogPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Variant 20');
    expect(html).toContain('/admin/products/product-20#recipe');
    expect(stub.reads.filter((read) => read.table === 'products').map((read) => read.from)).toEqual([0, 7, 14, 21]);
  });

  it('reports catalog imported and updated counts', async () => {
    const tree = await CatalogPage({ searchParams: Promise.resolve({}) });
    await expect(findAction(tree, 'Import / refresh Shopify products')!(new FormData())).rejects.toThrow('toast=synced&imported=2&updated=1');
    expect(state.catalog).toHaveBeenCalledOnce();
  });

  it('requires both Products and Orders edit permission before enabling automatic sync', async () => {
    const tree = await CatalogPage({ searchParams: Promise.resolve({}) });
    const action = findAction(tree, 'Enable automatic product & order sync')!;
    state.write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Orders denied'));
    await expect(action(new FormData())).rejects.toThrow('Orders denied');
    expect(state.write.mock.calls.map((call) => call[1])).toEqual(['products', 'orders']);
    expect(state.register).not.toHaveBeenCalled();
  });

  it('prioritizes unresolved imports so successful deliveries cannot hide retry controls', async () => {
    const stub = supabaseReadStub();
    state.database = stub.client;
    await OrderImportsPage({ searchParams: Promise.resolve({}) });
    expect(stub.reads[0].filters).toContainEqual({ operator: 'in', column: 'status', value: ['pending', 'error'] });
    expect(stub.reads[0].columns).not.toContain('payload');
  });

  it('requires Orders edit permission before importing existing paid orders', async () => {
    const tree = await OrderImportsPage({ searchParams: Promise.resolve({}) });
    const action = findAction(tree, 'Import paid orders')!;
    expect(action).toBeTypeOf('function');
    state.write.mockRejectedValue(new Error('Denied'));
    await expect(action(new FormData())).rejects.toThrow('Denied');
    expect(state.backfill).not.toHaveBeenCalled();
  });

  it('does not expose the import form to read-only Orders users', async () => {
    state.view.mockResolvedValue({ isOwner: false, access: { orders: { canEdit: false } } });
    const tree = await OrderImportsPage({ searchParams: Promise.resolve({}) });
    expect(findAction(tree, 'Import paid orders')).toBeUndefined();
  });

  it('imports only the supplied numbers and reports partial failures with all import history visible', async () => {
    state.backfill.mockResolvedValue([
      { name: '#1160', status: 'imported', orderId: 'order-1' },
      { name: '#1161', status: 'error', error: 'Order was not found.' },
    ]);
    const tree = await OrderImportsPage({ searchParams: Promise.resolve({}) });
    const form = new FormData();
    form.set('order_names', '#1160, #1161');
    await expect(findAction(tree, 'Import paid orders')!(form)).rejects.toThrow('view=all&toast=backfill_complete&imported=1&skipped=0&failed=1');
    expect(state.backfill).toHaveBeenCalledExactlyOnceWith('#1160, #1161');
    expect(state.write).toHaveBeenCalledWith('/admin/orders/shopify?toast=admin_write_denied', 'orders');
  });

  it('shows invalid import input without claiming success', async () => {
    state.backfill.mockRejectedValue(new Error('Enter up to 10 order numbers.'));
    const tree = await OrderImportsPage({ searchParams: Promise.resolve({}) });
    await expect(findAction(tree, 'Import paid orders')!(new FormData())).rejects.toThrow('toast=backfill_error&message=Enter%20up%20to%2010%20order%20numbers.');
  });

  it('shows catalog failures as errors with a retry and no false success', async () => {
    const tree = await CatalogPage({ searchParams: Promise.resolve({}) });
    state.catalog.mockRejectedValue(new Error('Access to products denied'));
    await expect(findAction(tree, 'Import / refresh Shopify products')!(new FormData())).rejects.toThrow('toast=error&message=Access%20to%20products%20denied');
  });
});

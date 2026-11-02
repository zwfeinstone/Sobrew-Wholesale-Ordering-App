import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';
import { buildDeferredPayAccountingSummary } from '@/lib/deferred-pay-accounting';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  commerce: vi.fn(),
  scope: vi.fn(),
  deferred: vi.fn(),
  authorize: vi.fn(),
  cache: new Map<string, Promise<unknown>>(),
  actorId: 'owner',
  reportsAccess: true,
  payrollAccess: true,
  accountingAccess: true,
  isOwner: true,
  profitabilityAccess: true,
}));
vi.mock('@/lib/admin-permissions', () => ({
  adminCanView: (_access: unknown, section: string) => section === 'payroll' ? state.payrollAccess : section === 'accounting' ? state.accountingAccess : section === 'reports_profitability' ? state.profitabilityAccess : true,
  requireAdminSectionView: state.authorize,
}));
vi.mock('next/cache', () => ({
  unstable_cache: (load: (...args: unknown[]) => Promise<unknown>, keyParts: string[] = []) => async (...args: unknown[]) => {
    const key = JSON.stringify([keyParts, args]);
    let pending = state.cache.get(key);
    if (!pending) {
      pending = Promise.resolve().then(() => load(...args));
      state.cache.set(key, pending);
      pending.catch(() => state.cache.delete(key));
    }
    // Next's data cache serializes query results; do not share mutable fixtures.
    return structuredClone(await pending);
  },
  revalidateTag: vi.fn(() => state.cache.clear()),
  revalidatePath: vi.fn(),
}));
vi.mock('@/lib/admin-center-scope', () => ({
  getSalesScopedCenterIdsForAdmin: state.scope,
  scopeCentersForAdmin: (query: unknown) => query,
  scopeCenterRelatedQueryForAdmin: (query: unknown) => query,
}));
vi.mock('@/lib/admin-report-commerce', () => ({ loadReportCommerce: state.commerce }));
vi.mock('@/lib/deferred-pay-accounting-data', () => ({ loadDeferredPayAccounting: state.deferred }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => state.client }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/components/report-detail-pagination', () => ({ default: () => null }));
vi.mock('@/components/report-date-range-fields', () => ({ default: () => null }));
vi.mock('@/components/pending-submit-button', () => ({ default: ({ label }: { label: string }) => createElement('button', { type: 'submit' }, label) }));

import ReportsPage from '@/app/admin/reports/page';
import { invalidateReportData } from '@/lib/report-cache-invalidation';
import { createReportInvalidatingFetch } from '@/lib/supabase/report-cache-fetch';

beforeEach(() => {
  state.cache.clear();
  state.actorId = 'owner';
  state.reportsAccess = true;
  state.authorize.mockReset().mockImplementation(async () => {
    if (!state.reportsAccess) throw new Error('Reports permission revoked');
    return {
      isOwner: state.isOwner, isSuperadmin: state.isOwner, access: {}, centerScope: null,
      user: { id: state.actorId },
      profile: { id: state.actorId, email: `${state.actorId}@example.com`, full_name: 'Owner', is_active: true, is_admin: true },
    };
  });
  state.commerce.mockReset().mockResolvedValue({ orders: { data: [], error: null }, orderItems: { data: [], error: null } });
  state.scope.mockReset().mockResolvedValue(null);
  state.deferred.mockReset().mockResolvedValue({ data: null, error: null });
  state.payrollAccess = true;
  state.accountingAccess = true;
  state.isOwner = true;
  state.profitabilityAccess = true;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('deferred payroll report integration', () => {
  const entries = ['production', 'sales'].map((workType, index) => ({
    id: `entry-${workType}`, profile_id: 'employee', status: 'approved', work_type: workType,
    clock_in_at: `2026-10-0${7 + index}T13:00:00Z`, clock_out_at: `2026-10-0${7 + index}T21:00:00Z`,
    hourly_rate_cents_snapshot: 1500, admin_time_breaks: [],
  }));
  const summary = () => buildDeferredPayAccountingSummary({
    plans: [{ id: 'plan', profile_id: 'employee', label: 'Deferred pay', start_date: '2026-10-07', end_date: '2027-01-03', payout_date: '2027-01-04', accrual_rate_cents: 500, weekly_rate_cents: 1500, paid_at: null, paid_amount_cents: null }],
    entries, start: '2026-10-01', end: '2026-10-31', now: new Date('2026-10-09T18:00:00Z'),
  });
  const render = async (report = 'overview', params: Record<string, string> = {}) => renderToStaticMarkup(await ReportsPage({
    searchParams: Promise.resolve({ report, rangeStart: '2026-10-01', rangeEnd: '2026-10-31', ...params }),
  }));

  it.each(['overview', 'production', 'inventory'])('keeps the payroll summary and its data load out of %s', async (report) => {
    state.client = supabaseReadStub().client;
    state.deferred.mockResolvedValue({ data: summary(), error: null });
    const html = await render(report, { product: 'filtered-product', center: 'filtered-customer' });
    expect(state.deferred).not.toHaveBeenCalled();
    expect(html).not.toContain('Earned pay and balance owed');
    expect(html).not.toContain('$80.00');
    expect(html).not.toContain('covers the whole company');
    expect(html).not.toContain('Separately accrued deferred payroll expense');
  });

  it('does not load or expose payroll balances or Accounting links without the corresponding permissions', async () => {
    state.client = supabaseReadStub().client;
    state.payrollAccess = false;
    state.accountingAccess = false;
    state.deferred.mockResolvedValue({ data: summary(), error: null });
    const html = await render();
    expect(state.deferred).not.toHaveBeenCalled();
    expect(html).not.toContain('Earned pay and balance owed');
    expect(html).not.toContain('$80.00');
    expect(html).not.toContain('View Accounting P&amp;L');
    expect(html).not.toContain('Separately accrued deferred payroll expense');
  });

  it('withholds the payroll GPM comparison when deferred payroll data cannot be loaded', async () => {
    state.client = supabaseReadStub().client;
    state.deferred.mockResolvedValue({ data: null, error: { message: 'A later payroll page failed' } });
    const html = await render('labor_paid_gpm');
    expect(html).toContain('Deferred payroll expense and liability could not be loaded');
    expect(html).not.toContain('Where product cost is landing');
  });

  it('adds only the production share to the GPM comparison and keeps the existing trend explicit', async () => {
    state.client = supabaseReadStub({ tables: { admin_time_entries: entries, products: [{ id: 'product', name: 'Coffee', active: true }] } }).client;
    state.deferred.mockResolvedValue({ data: summary(), error: null });
    state.commerce.mockResolvedValue({
      orders: { data: [{ id: 'order', center_id: null, status: 'Shipped', subtotal_cents: 100000, created_at: '2026-10-07T14:00:00Z', shipped_at: '2026-10-07T18:00:00Z' }], error: null },
      orderItems: { data: [{ id: 'item', order_id: 'order', product_id: 'product', qty: 1, unit_price_cents: 100000, line_total_cents: 100000, cogs_snapshot_at: '2026-10-07T18:00:00Z', cogs_material_cents: 20000, cogs_labor_cents: 10000, cogs_product_cents: 30000, cogs_total_cents: 30000 }], error: null },
    });
    const html = await render('labor_paid_gpm');
    expect(html).toContain('Completed Payroll Labor');
    expect(html).toContain('shifts awaiting approval or payment');
    expect(html).toContain('before deferred pay accrual');
    expect(html).toMatch(/Deferred Production Pay Earned<\/p><p[^>]*>\$40\.00/);
    expect(html).toMatch(/Production Labor Including Deferred Pay<\/p><p[^>]*>\$160\.00/);
    expect(html).toMatch(/GPM Including Deferred Production Pay<\/p><p[^>]*>64%/);
    expect(html).not.toContain('Earned pay and balance owed');
    expect(state.deferred).toHaveBeenCalledOnce();
    expect(state.deferred).toHaveBeenCalledWith(expect.objectContaining({ start: '2026-10-01', end: '2026-10-31', supabase: state.client }));
    expect(state.deferred.mock.calls[0][0]).not.toHaveProperty('profileId');
  });

  it('does not load private payroll into the shared AI report view', async () => {
    state.client = supabaseReadStub().client;
    const html = await render('ai_overview');
    expect(state.deferred).not.toHaveBeenCalled();
    expect(html).not.toContain('Earned pay and balance owed');
    expect(html).not.toContain('Separately accrued deferred payroll expense');
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('report scope failures', () => {
  it.each([
    ['joined sales-rep profiles', 0],
    ['a later sales-rep profile page', 1],
  ] as const)('stops before querying commerce when %s cannot be loaded for a requested rep', async (_label, failedOffset) => {
    const stub = supabaseReadStub({
      maxRows: 1,
      tables: {
        profiles: [{ id: 'rep-1', full_name: 'First Rep' }, { id: 'rep-2', full_name: 'Second Rep' }],
      },
      fail: (read) => read.table === 'profiles' && read.from === failedOffset ? 'Rep lookup unavailable' : undefined,
    });
    state.client = stub.client;

    const markup = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ report: 'sales', sales_rep: 'rep-1' }) }));

    expect(markup).toContain('Unable to load reporting data.');
    expect(markup).toContain('Rep lookup unavailable');
    expect(markup).not.toContain('Customer revenue and status');
    expect(state.scope).not.toHaveBeenCalled();
    expect(state.commerce).not.toHaveBeenCalled();
    expect(stub.reads.every((read) => read.table === 'profiles')).toBe(true);
    expect(stub.reads[0].columns).toContain('sales_settings:admin_commission_settings!admin_commission_settings_profile_id_fkey!inner(profile_id)');
    expect(stub.reads[0].filters).toEqual([
      { operator: 'eq', column: 'is_admin', value: true },
      { operator: 'eq', column: 'sales_settings.is_sales_rep', value: true },
    ]);
  });

  it('withholds an unfiltered report if its overlapping rep lookup fails', async () => {
    const stub = supabaseReadStub({ fail: (read) => read.table === 'profiles' ? 'Rep lookup unavailable' : undefined });
    state.client = stub.client;

    const markup = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ report: 'overview' }) }));

    expect(markup).toContain('Rep lookup unavailable');
    expect(markup).not.toContain('Where product cost is landing');
    expect(state.commerce).toHaveBeenCalledOnce();
  });
});

describe('report loading scope and completeness', () => {
  const render = async (report = 'overview', params: Record<string, string> = {}) => renderToStaticMarkup(await ReportsPage({
    searchParams: Promise.resolve({ report, rangeStart: '2026-10-01', rangeEnd: '2026-10-31', ...params }),
  }));
  const lookupTables = {
    profiles: [{ id: 'rep-1', full_name: 'Inactive Sales Rep', is_active: false }],
    products: [{ id: 'coffee', name: 'Coffee', active: true }],
    centers: [{ id: 'customer', name: 'Customer', is_active: true }],
  };

  it.each(['labor_paid_gpm', 'ai_overview', 'ai_qa'])('skips unused rep lookups for unfiltered %s', async (report) => {
    const stub = supabaseReadStub({ tables: lookupTables });
    state.client = stub.client;
    await render(report, report === 'labor_paid_gpm' ? { sales_rep: 'rep-1' } : {});
    expect(stub.reads.some((read) => ['profiles', 'admin_commission_settings'].includes(read.table))).toBe(false);
    expect(state.scope).toHaveBeenCalledWith(expect.objectContaining({ selectedSalesProfileId: '' }));
  });

  it.each(['ai_overview', 'ai_qa'])('preserves a validated owner rep selection when navigating through %s', async (report) => {
    const stub = supabaseReadStub({ tables: lookupTables });
    state.client = stub.client;
    const markup = await render(report, { sales_rep: 'rep-1' });
    const reportLinks = [...markup.matchAll(/href="([^"]+)"/g)]
      .map(([, href]) => new URL(href.replaceAll('&amp;', '&'), 'https://portal.test'));
    for (const destination of ['overview', 'centers', 'recent_order_gpm']) {
      const link = reportLinks.find((url) => url.searchParams.get('report') === destination);
      expect(link?.searchParams.get('sales_rep')).toBe('rep-1');
    }
    expect(stub.reads.some((read) => read.table === 'profiles')).toBe(true);
    expect(state.scope).toHaveBeenCalledWith(expect.objectContaining({ selectedSalesProfileId: 'rep-1' }));
    expect(state.commerce).not.toHaveBeenCalled();
  });

  it.each(['ai_overview', 'ai_qa'])('omits an unknown rep selection from %s navigation', async (report) => {
    const stub = supabaseReadStub({ tables: lookupTables });
    state.client = stub.client;
    const markup = await render(report, { sales_rep: 'unknown-rep' });
    expect(stub.reads.some((read) => read.table === 'profiles')).toBe(true);
    expect(state.scope).toHaveBeenCalledWith(expect.objectContaining({ selectedSalesProfileId: '' }));
    expect(markup).not.toContain('sales_rep=unknown-rep');
  });

  it('uses all joined lookup pages to validate a selected rep, including inactive reps outside prospecting', async () => {
    const stub = supabaseReadStub({ maxRows: 1, tables: {
      ...lookupTables,
      profiles: [{ id: 'rep-0', full_name: 'First Rep' }, ...lookupTables.profiles],
    } });
    state.client = stub.client;
    state.scope.mockImplementation(async ({ selectedSalesProfileId }) => {
      expect(stub.reads.filter((read) => read.table === 'profiles').map((read) => read.from)).toEqual([0, 1, 2]);
      return selectedSalesProfileId === 'rep-1' ? ['customer'] : null;
    });

    const markup = await render('recent_order_gpm', { sales_rep: 'rep-1', product: 'coffee', center: 'customer' });
    expect(markup).toContain('Inactive Sales Rep');
    expect(state.scope).toHaveBeenCalledWith(expect.objectContaining({ selectedSalesProfileId: 'rep-1' }));
    expect(state.commerce).toHaveBeenCalledWith(state.client, {
      centerScope: ['customer'], shippedRange: undefined,
      recentOrders: { limit: 10, productId: 'coffee', centerId: 'customer' },
    });
  });

  it('ignores unknown rep, product and customer IDs while preserving the authorized scope', async () => {
    const stub = supabaseReadStub({ tables: lookupTables });
    state.client = stub.client;
    state.scope.mockResolvedValue(['customer']);
    await render('recent_order_gpm', { sales_rep: 'unknown-rep', product: 'unknown-product', center: 'inaccessible-customer' });
    expect(state.scope).toHaveBeenCalledWith(expect.objectContaining({ selectedSalesProfileId: '' }));
    expect(state.commerce).toHaveBeenCalledWith(state.client, {
      centerScope: ['customer'], shippedRange: undefined,
      recentOrders: { limit: 10, productId: undefined, centerId: undefined },
    });
  });

  it('never loads the owner rep list or honors a supplied rep ID for nonowners', async () => {
    const stub = supabaseReadStub({ tables: lookupTables });
    state.client = stub.client;
    state.isOwner = false;
    state.scope.mockResolvedValue(['customer']);
    const markup = await render('recent_order_gpm', { sales_rep: 'rep-1' });
    expect(stub.reads.some((read) => ['profiles', 'admin_commission_settings'].includes(read.table))).toBe(false);
    expect(markup).not.toContain('Inactive Sales Rep');
    expect(state.scope).toHaveBeenCalledWith(expect.objectContaining({ current: expect.objectContaining({ isOwner: false }), selectedSalesProfileId: '' }));
    expect(state.commerce).toHaveBeenCalledWith(state.client, expect.objectContaining({ centerScope: ['customer'], recentOrders: { limit: 10 } }));
  });

  it('redirects unauthorized profitability access before any report data is queried', async () => {
    const stub = supabaseReadStub({ tables: lookupTables });
    state.client = stub.client;
    state.profitabilityAccess = false;
    await expect(render('recent_order_gpm')).rejects.toThrow('NEXT_REDIRECT');
    expect(stub.reads).toEqual([]);
    expect(state.scope).not.toHaveBeenCalled();
    expect(state.commerce).not.toHaveBeenCalled();
  });

  it('keeps sales commerce unbounded for lifetime and unshipped-order metrics', async () => {
    state.client = supabaseReadStub().client;
    await render('sales');
    expect(state.commerce).toHaveBeenCalledWith(state.client, { centerScope: null, shippedRange: undefined, recentOrders: undefined });
  });

  it.each(['overview', 'margin'])('preserves the prior and trailing comparison windows and historical production runs for %s', async (report) => {
    const stub = supabaseReadStub();
    state.client = stub.client;
    await render(report);
    const options = state.commerce.mock.calls[0][1];
    expect(options.recentOrders).toBeUndefined();
    expect(options.shippedRange.start.toISOString()).toBe('2026-08-06T05:00:00.000Z');
    expect(options.shippedRange.endExclusive.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    const productionReads = stub.reads.filter((read) => read.table === 'production_runs');
    expect(productionReads).toHaveLength(1);
    expect(productionReads[0].filters).toEqual([]);
  });

  it('loads all historical fallback pages only for unsnapshotted positive-quantity products', async () => {
    const baseRun = { product_id: 'legacy', quantity_produced: 10, quantity_voided: 0, status: 'completed', actual_unit_cost_cents: 100, actual_labor_cost_cents: 0, fixed_cost_cents: 0 };
    const stub = supabaseReadStub({ maxRows: 1, tables: {
      ...lookupTables,
      production_runs: [
        { ...baseRun, id: 'new-void', produced_at: '2026-10-10T00:00:00Z', status: 'void', actual_unit_cost_cents: 9999 },
        { ...baseRun, id: 'new-empty', produced_at: '2026-10-09T00:00:00Z', quantity_voided: 10, actual_unit_cost_cents: 9999 },
        { ...baseRun, id: 'new-zero-cost', produced_at: '2026-10-08T00:00:00Z', actual_unit_cost_cents: 0 },
        { ...baseRun, id: 'old-viable', produced_at: '2020-01-01T00:00:00Z' },
      ],
    } });
    state.client = stub.client;
    state.commerce.mockResolvedValue({
      orders: { data: [{ id: 'order-1', center_id: 'customer', status: 'Shipped', created_at: '2026-10-10T00:00:00Z', shipped_at: '2026-10-11T00:00:00Z' }], error: null },
      orderItems: { data: [
        { id: 'legacy-line', order_id: 'order-1', product_id: 'legacy', qty: 2, unit_price_cents: 500 },
        { id: 'snapshot-line', order_id: 'order-1', product_id: 'snapshot', qty: 1, unit_price_cents: 1000, cogs_snapshot_at: '2026-10-11T00:00:00Z', cogs_material_cents: 300, cogs_product_cents: 300, cogs_total_cents: 300 },
        { id: 'zero-line', order_id: 'order-1', product_id: 'zero', qty: 0, unit_price_cents: 500 },
        { id: 'no-product-line', order_id: 'order-1', product_id: null, qty: 1, unit_price_cents: 100 },
      ], error: null },
    });
    const markup = await render('recent_order_gpm');
    const productionReads = stub.reads.filter((read) => read.table === 'production_runs');
    expect(productionReads.map((read) => read.from)).toEqual([0, 1, 2, 3, 4]);
    for (const read of productionReads) {
      expect(read.filters).toEqual([{ operator: 'in', column: 'product_id', value: ['legacy'] }]);
      expect(read.orders).toEqual([{ column: 'produced_at', ascending: false }, { column: 'id', ascending: undefined }]);
    }
    expect(markup).toContain('$21.00');
    expect(markup).toContain('$5.00');
    expect(markup).toContain('$16.00');
  });

  it('skips production history when all recent lines have saved cost snapshots', async () => {
    const stub = supabaseReadStub();
    state.client = stub.client;
    state.commerce.mockResolvedValue({
      orders: { data: [], error: null },
      orderItems: { data: [{ product_id: 'coffee', qty: 1, cogs_snapshot_at: '2026-10-11T00:00:00Z' }], error: null },
    });
    await render('recent_order_gpm');
    expect(stub.reads.some((read) => read.table === 'production_runs')).toBe(false);
  });

  it('withholds recent financial totals when a later historical cost page fails', async () => {
    const stub = supabaseReadStub({ maxRows: 1, tables: {
      production_runs: [{ id: 'void-run', product_id: 'coffee', status: 'void', quantity_produced: 1, actual_unit_cost_cents: 9999 }],
    }, fail: (read) => read.table === 'production_runs' && read.from === 1 ? 'Historical costs unavailable' : undefined });
    state.client = stub.client;
    state.commerce.mockResolvedValue({
      orders: { data: [{ id: 'order-1', status: 'Shipped', created_at: '2026-10-10T00:00:00Z', shipped_at: '2026-10-11T00:00:00Z' }], error: null },
      orderItems: { data: [{ id: 'line', order_id: 'order-1', product_id: 'coffee', qty: 1, unit_price_cents: 1000 }], error: null },
    });
    const markup = await render('recent_order_gpm');
    expect(markup).toContain('Historical costs unavailable');
    expect(markup).not.toContain('Last 10 shipped orders');
    expect(markup).not.toContain('$10.00');
  });

  it('keeps inventory adjustments complete without loading unrelated inventory valuation', async () => {
    const stub = supabaseReadStub();
    state.client = stub.client;
    await render('inventory_adjustments');
    expect(stub.reads.some((read) => ['inventory_items', 'inventory_lots'].includes(read.table))).toBe(false);
    expect(state.commerce).not.toHaveBeenCalled();
    expect(stub.reads.find((read) => read.table === 'inventory_adjustments')?.columns).toContain('inventory_items(id,name,sku,item_type,base_unit)');
  });
});

describe('report data reuse and authorization', () => {
  const render = async (report = 'overview', params: Record<string, string> = {}) => renderToStaticMarkup(await ReportsPage({
    searchParams: Promise.resolve({ report, rangeStart: '2026-10-01', rangeEnd: '2026-10-31', ...params }),
  }));
  const tables = () => ({
    profiles: [{ id: 'rep-1', full_name: 'Current Rep', is_active: true }],
    centers: [{ id: 'customer', name: 'Test Customer', is_active: true }],
    products: [{ id: 'coffee', name: 'Coffee', active: true }, { id: 'tea', name: 'Tea', active: true }],
  });
  const commerce = (price = 10000) => ({
    orders: { data: [{ id: 'order-1', center_id: 'customer', status: 'Shipped', subtotal_cents: price, created_at: '2026-10-07T14:00:00Z', shipped_at: '2026-10-07T18:00:00Z' }], error: null },
    orderItems: { data: [{ id: 'line-1', order_id: 'order-1', product_id: 'coffee', qty: 1, unit_price_cents: price, line_total_cents: price, cogs_snapshot_at: '2026-10-07T18:00:00Z', cogs_material_cents: 2000, cogs_labor_cents: 1000, cogs_product_cents: 3000, cogs_total_cents: 3000 }], error: null },
  });

  beforeEach(() => {
    // Keep each multi-navigation test inside one cache window deterministically.
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-15T18:00:01Z').getTime());
    state.commerce.mockResolvedValue(commerce());
  });

  it('shares complete commerce and lookup data between related tabs while checking authorization and scope on every visit', async () => {
    const stub = supabaseReadStub({ tables: tables(), maxRows: 1 });
    state.client = stub.client;
    const overview = await render();
    const firstReads = structuredClone(stub.reads);
    const centers = await render('centers');
    const repeatedOverview = await render();

    expect(state.authorize).toHaveBeenCalledTimes(3);
    expect(state.authorize).toHaveBeenNthCalledWith(3, 'reports');
    expect(state.scope).toHaveBeenCalledTimes(3);
    expect(state.commerce).toHaveBeenCalledOnce();
    expect(stub.reads).toEqual(firstReads);
    expect(overview).toContain('$100.00');
    expect(centers).toContain('$100.00');
    expect(centers).toContain('$70.00');
    expect(repeatedOverview).toBe(overview);
    // All pages, including an empty terminal page, were cached together.
    expect(firstReads.filter((read) => read.table === 'products').map((read) => read.from)).toEqual([0, 1, 2]);
  });

  it.each(['reports', 'profitability'])('enforces revoked %s access before reading warm report data', async (permission) => {
    const stub = supabaseReadStub({ tables: tables() });
    state.client = stub.client;
    await render();
    const reads = stub.reads.length;
    if (permission === 'reports') state.reportsAccess = false;
    else state.profitabilityAccess = false;

    await expect(render()).rejects.toThrow(permission === 'reports' ? 'Reports permission revoked' : 'NEXT_REDIRECT');
    expect(state.authorize).toHaveBeenCalledTimes(2);
    expect(state.scope).toHaveBeenCalledOnce();
    expect(state.commerce).toHaveBeenCalledOnce();
    expect(stub.reads).toHaveLength(reads);
  });

  it('isolates another actor and a changed current center scope from warmed query results', async () => {
    state.client = supabaseReadStub({ tables: tables() }).client;
    await render();
    state.actorId = 'different-admin';
    await render();
    state.scope.mockResolvedValue(['customer']);
    await render();
    state.scope.mockResolvedValue([]);
    await render();

    expect(state.authorize).toHaveBeenCalledTimes(4);
    expect(state.scope).toHaveBeenCalledTimes(4);
    expect(state.commerce).toHaveBeenCalledTimes(4);
    expect(state.commerce.mock.calls.map(([, options]) => options.centerScope)).toEqual([null, null, ['customer'], []]);
  });

  it('separates source date ranges, lifetime data, and each recent-order database filter', async () => {
    state.client = supabaseReadStub({ tables: tables() }).client;
    await render();
    await render('centers'); // Same source range as Overview.
    await render('overview', { rangeStart: '2026-09-01', rangeEnd: '2026-09-30' });
    await render('sales');
    await render('recent_order_gpm');
    await render('recent_order_gpm', { product: 'coffee' });
    await render('recent_order_gpm', { product: 'tea' });
    await render('recent_order_gpm', { center: 'customer' });
    await render('recent_order_gpm', { product: 'coffee' });

    expect(state.commerce).toHaveBeenCalledTimes(7);
    const queries = state.commerce.mock.calls.map(([, options]) => options);
    expect(queries[0].shippedRange.start.toISOString()).not.toBe(queries[1].shippedRange.start.toISOString());
    expect(queries[2]).toEqual({ centerScope: null, shippedRange: undefined, recentOrders: undefined });
    expect(queries.slice(3).map((query) => query.recentOrders)).toEqual([
      { limit: 10 }, { limit: 10, productId: 'coffee', centerId: undefined },
      { limit: 10, productId: 'tea', centerId: undefined }, { limit: 10, productId: undefined, centerId: 'customer' },
    ]);
  });

  it('reapplies product display filters to shared source rows rather than reusing a rendered total', async () => {
    state.client = supabaseReadStub({ tables: tables() }).client;
    const coffee = await render('overview', { product: 'coffee' });
    const tea = await render('overview', { product: 'tea' });
    const coffeeAgain = await render('overview', { product: 'coffee' });

    expect(state.commerce).toHaveBeenCalledOnce();
    expect(coffee).toContain('$100.00');
    expect(tea).not.toContain('$100.00');
    expect(tea).toContain('$0.00');
    expect(coffeeAgain).toBe(coffee);
  });

  it('reapplies center display filters to shared source rows without including another customer’s sales', async () => {
    const rows = tables();
    rows.centers.push({ id: 'other-customer', name: 'Other Customer', is_active: true });
    state.client = supabaseReadStub({ tables: rows }).client;
    const withOrder = await render('centers', { center: 'customer' });
    const withoutOrder = await render('centers', { center: 'other-customer' });
    const withOrderAgain = await render('centers', { center: 'customer' });

    expect(state.commerce).toHaveBeenCalledOnce();
    expect(withOrder).toContain('$100.00');
    expect(withoutOrder).not.toContain('$100.00');
    expect(withoutOrder).toContain('No shipped center profitability found for the selected range.');
    expect(withOrderAgain).toBe(withOrder);
  });

  it('validates a selected rep afresh even after its dropdown was cached', async () => {
    const rows = tables();
    const stub = supabaseReadStub({ tables: rows });
    state.client = stub.client;
    await render();
    rows.profiles.length = 0;
    await render('overview', { sales_rep: 'rep-1' });

    expect(stub.reads.filter((read) => read.table === 'profiles').map((read) => read.from)).toEqual([0, 1, 0]);
    expect(state.scope).toHaveBeenLastCalledWith(expect.objectContaining({ selectedSalesProfileId: '' }));
  });

  it('fails closed on fresh rep validation errors even when dropdown and commerce results are warm', async () => {
    let unavailable = false;
    const stub = supabaseReadStub({ tables: tables(), fail: (read) => unavailable && read.table === 'profiles' ? 'Current rep membership unavailable' : undefined });
    state.client = stub.client;
    await render();
    unavailable = true;
    const markup = await render('overview', { sales_rep: 'rep-1' });

    expect(markup).toContain('Current rep membership unavailable');
    expect(markup).not.toContain('$100.00');
    expect(state.scope).toHaveBeenCalledOnce();
    expect(state.commerce).toHaveBeenCalledOnce();
  });

  it('reloads changed financial values after invalidation instead of serving the warm result', async () => {
    state.client = supabaseReadStub({ tables: tables() }).client;
    const initial = await render('recent_order_gpm');
    state.commerce.mockResolvedValue(commerce(20000));
    const cached = await render('recent_order_gpm');
    invalidateReportData();
    const refreshed = await render('recent_order_gpm');

    expect(initial).toContain('$100.00');
    expect(cached).toBe(initial);
    expect(refreshed).toContain('$200.00');
    expect(refreshed).toContain('$170.00');
    expect(state.commerce).toHaveBeenCalledTimes(2);
  });

  it.each(['orders', 'inventory_lots', 'production_runs', 'admin_time_entries'])('refreshes warm financial results after a successful application write to %s', async (table) => {
    state.client = supabaseReadStub({ tables: tables() }).client;
    const initial = await render('recent_order_gpm');
    state.commerce.mockResolvedValue(commerce(20000));
    const cached = await render('recent_order_gpm');
    const response = new Response(null, { status: 204 });
    const baseFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const applicationFetch = createReportInvalidatingFetch(baseFetch, 'https://report-test.supabase.co');

    expect(await applicationFetch(`https://report-test.supabase.co/rest/v1/${table}?id=eq.test-record`, { method: 'PATCH', body: '{}' })).toBe(response);
    const refreshed = await render('recent_order_gpm');

    expect(initial).toContain('$100.00');
    expect(cached).toBe(initial);
    expect(refreshed).toContain('$200.00');
    expect(refreshed).toContain('$170.00');
    expect(state.commerce).toHaveBeenCalledTimes(2);
    expect(state.authorize).toHaveBeenCalledTimes(3);
  });

  it('withholds stale totals after a failed refresh and exposes a retry that can load recovered results', async () => {
    state.client = supabaseReadStub({ tables: tables() }).client;
    const initial = await render('recent_order_gpm');
    expect(initial).toContain('$100.00');
    state.commerce.mockResolvedValue({ orders: { data: [], error: { message: 'Fresh orders unavailable' } }, orderItems: { data: [], error: null } });
    vi.mocked(Date.now).mockReturnValue(new Date('2026-10-15T18:02:01Z').getTime());
    const failedRefresh = await render('recent_order_gpm');

    expect(failedRefresh).toContain('Fresh orders unavailable');
    expect(failedRefresh).not.toContain('$100.00');
    expect(failedRefresh).toContain('role="alert"');
    expect(failedRefresh).toMatch(/<button\b[^>]*type="button"[^>]*>Try again<\/button>/);
    expect(state.commerce).toHaveBeenCalledTimes(2);

    state.commerce.mockResolvedValue(commerce(20000));
    const retried = await render('recent_order_gpm');
    expect(retried).toContain('$200.00');
    expect(retried).not.toContain('Fresh orders unavailable');
    expect(state.commerce).toHaveBeenCalledTimes(3);
  });
});

/** Read successful input controls from the rendered form as a browser GET would. */
function submittedInputs(form: string) {
  const values = new URLSearchParams();
  for (const [input] of form.matchAll(/<input\b[^>]*>/g)) {
    const attribute = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(input)?.[1];
    const name = attribute('name');
    const type = attribute('type');
    if (!name || /\sdisabled(?:[\s=>])/.test(input)) continue;
    if ((type === 'checkbox' || type === 'radio') && !/\schecked(?:[\s=>])/.test(input)) continue;
    values.append(name, attribute('value') ?? '');
  }
  return values;
}

describe('simulator form feature retention', () => {
  it('submits all 125 labor overrides and keeps the selected read-only detail page', async () => {
    const products = Array.from({ length: 125 }, (_, index) => ({
      id: `product-${index}`, name: `Coffee ${String(index).padStart(3, '0')}`, sku: `COFFEE-${index}`, active: true,
    }));
    const stub = supabaseReadStub({ tables: {
      centers: [{ id: 'center-1', name: 'Test Center', is_active: true }],
      products,
      product_recipes: products.map((product) => ({
        product_id: product.id, output_qty: 1, labor_minutes: 10, labor_rate_cents: 2000,
        waste_percent: 0, product_recipe_components: [],
      })),
    } });
    state.client = stub.client;
    state.commerce.mockResolvedValue({
      orders: { data: [{
        id: 'order-1', center_id: 'center-1', status: 'Shipped', subtotal_cents: 125000,
        created_at: '2026-08-15T12:00:00.000Z', shipped_at: '2026-08-16T12:00:00.000Z',
      }], error: null },
      orderItems: { data: products.map((product) => ({
        id: `line-${product.id}`, order_id: 'order-1', product_id: product.id,
        product_name_snapshot: product.name, qty: 1, unit_price_cents: 1000, line_total_cents: 1000,
        cogs_labor_cents: 100, cogs_product_cents: 100, cogs_total_cents: 100,
      })), error: null },
    });
    const searchParams: Record<string, string> = {
      report: 'simulator', month: '2026-08', rangeStart: '2026-08-01', rangeEnd: '2026-08-31',
      sim_tab: 'labor', detail_page: '2',
    };
    for (const [index, product] of products.entries()) {
      searchParams[`sim_labor_minutes_${product.id}`] = String(index + 1);
      searchParams[`sim_labor_rate_${product.id}`] = String(20 + index);
    }

    const markup = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve(searchParams) }));
    const form = [...markup.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
      .map(([html]) => html)
      .find((html) => html.includes('Run simulation'));
    expect(form, 'The simulator form should render with actual computed labor rows').toBeDefined();
    const submitted = submittedInputs(form!);
    expect([...submitted.keys()].filter((name) => name.startsWith('sim_labor_minutes_'))).toHaveLength(125);
    expect([...submitted.keys()].filter((name) => name.startsWith('sim_labor_rate_'))).toHaveLength(125);
    for (const product of products) {
      for (const prefix of ['sim_labor_minutes_', 'sim_labor_rate_']) {
        expect(submitted.get(`${prefix}${product.id}`)).toBe(searchParams[`${prefix}${product.id}`]);
      }
    }
    expect(submitted.get('detail_page')).toBe('2');
    expect(submitted.get('report')).toBe('simulator');
  });
});

import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  commerce: vi.fn(),
  scope: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({
  adminCanView: () => true,
  requireAdminSectionView: async () => ({
    isOwner: true, access: {}, profile: { id: 'owner', email: 'owner@example.com', full_name: 'Owner' },
  }),
}));
vi.mock('@/lib/admin-center-scope', () => ({
  getSalesScopedCenterIdsForAdmin: state.scope,
  scopeCentersForAdmin: (query: unknown) => query,
  scopeCenterRelatedQueryForAdmin: (query: unknown) => query,
}));
vi.mock('@/lib/admin-report-commerce', () => ({ loadReportCommerce: state.commerce }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => state.client }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('@/components/report-detail-pagination', () => ({ default: () => null }));
vi.mock('@/components/report-date-range-fields', () => ({ default: () => null }));
vi.mock('@/components/pending-submit-button', () => ({ default: ({ label }: { label: string }) => createElement('button', { type: 'submit' }, label) }));

import ReportsPage from '@/app/admin/reports/page';

beforeEach(() => {
  state.commerce.mockReset().mockResolvedValue({ orders: { data: [], error: null }, orderItems: { data: [], error: null } });
  state.scope.mockReset().mockResolvedValue(null);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('report scope failures', () => {
  it.each([
    ['sales-rep settings', 'admin_commission_settings', 0],
    ['sales-rep profiles', 'profiles', 0],
    ['a later sales-rep profile page', 'profiles', 1],
  ] as const)('stops before querying commerce when %s cannot be loaded', async (_label, failedTable, failedOffset) => {
    const stub = supabaseReadStub({
      maxRows: 1,
      tables: {
        admin_commission_settings: [{ profile_id: 'rep-1' }, { profile_id: 'rep-2' }],
        profiles: [{ id: 'rep-1', full_name: 'First Rep' }, { id: 'rep-2', full_name: 'Second Rep' }],
      },
      fail: (read) => read.table === failedTable && read.from === failedOffset ? 'Rep lookup unavailable' : undefined,
    });
    state.client = stub.client;

    const markup = renderToStaticMarkup(await ReportsPage({ searchParams: Promise.resolve({ report: 'sales', sales_rep: 'rep-1' }) }));

    expect(markup).toContain('Unable to load reporting data.');
    expect(markup).toContain('Rep lookup unavailable');
    expect(markup).not.toContain('Customer revenue and status');
    expect(state.scope).not.toHaveBeenCalled();
    expect(state.commerce).not.toHaveBeenCalled();
    expect(stub.reads.every((read) => ['admin_commission_settings', 'profiles'].includes(read.table))).toBe(true);
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

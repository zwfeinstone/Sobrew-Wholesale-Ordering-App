import { createElement } from 'react';
import { readFile, writeFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningOrderInput, PlanningProductInput, PlanningScheduleInput } from '@/lib/production-planning';
import type { ProductionPlanningData } from '@/lib/production-planning-data';

const state = vi.hoisted(() => ({
  canEdit: true,
  load: vi.fn(),
  requireView: vi.fn(async () => ({ access: {} })),
  production: vi.fn(async () => undefined),
  target: vi.fn(async () => undefined),
  refresh: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.requireView, adminCanEdit: () => state.canEdit }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ planningClient: true }) }));
vi.mock('@/lib/production-planning-data', () => ({ loadProductionPlanningData: state.load }));
vi.mock('@/app/admin/planning/actions', () => ({ producePlannedInventory: state.production, updateCenterParLevel: state.target }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: state.refresh, replace: vi.fn() }),
  usePathname: () => '/admin/planning',
  useSearchParams: () => new URLSearchParams(),
}));

import PlanningPage from '@/app/admin/planning/page';
import ProductionPlanningWorkspace, { sortWorkspaceRows } from '@/app/admin/planning/workspace';
import { buildProductionPlan } from '@/lib/production-planning';
import { planningView, planningViewHref } from '@/lib/production-planning-view';

const NOW = new Date('2026-09-23T16:00:00.000Z');

function product(id: string, name: string, category: string, sku: string): PlanningProductInput {
  return { id, name, category, sku, active: true };
}

function openOrder(id: string, productId: string, quantity: number, createdAt: string): PlanningOrderInput {
  return {
    id, status: 'New', created_at: createdAt, customer_name: 'Northside Cafe',
    order_items: [{ product_id: productId, qty: quantity }],
  };
}

function schedule(id: string, productId: string, quantity: number, nextRunAt: string): PlanningScheduleInput {
  return {
    id, status: 'active', active: true, frequency: '1_week', center_active: true,
    customer_name: 'Lakeview Market', next_run_at: nextRunAt,
    recurring_order_items: [{ product_id: productId, qty: quantity }],
  };
}

function history(productId: string, weeks: number, quantity: number): PlanningOrderInput[] {
  return Array.from({ length: weeks }, (_, index) => ({
    id: `history-${productId}-${index}`, status: 'Shipped', created_at: '2026-01-01T12:00:00.000Z',
    shipped_at: new Date(Date.UTC(2026, 8, 18 - index * 7, 12)).toISOString(),
    order_items: [{ product_id: productId, qty: quantity }],
  }));
}

function fixture(): ProductionPlanningData {
  const products = [
    product('alpha', 'Alpha House Blend 2 lb', 'whole_bean', 'WB-ALPHA'),
    product('brazil', 'Brazil Filter Packs', 'filter_packs', 'FP-BRAZIL'),
    product('decaf', 'Decaf House Blend 2 lb', 'whole_bean', 'WB-DECAF'),
    product('zulu', 'Zulu French Roast 5 lb', 'whole_bean', 'WB-ZULU'),
    product('seasonal', 'Seasonal Retail Coffee', 'retail', 'RTL-SEASONAL'),
    product('covered-tea', 'Covered Tea Case', 'tea', 'TEA-COVERED'),
    product('next-week', 'Next Week Ground Coffee', 'ground', 'GR-NEXT'),
  ];
  const bean = { id: 'bean', name: 'Roasted coffee', sku: 'RAW-COFFEE', item_type: 'raw_material', base_unit: 'lb' as const, product_id: null, active: true };
  const pars = [
    { center_id: 'customer', customer_name: 'Northside Cafe', product_id: 'alpha', par_qty: 10, minimum_qty: 0, notes: null, center_active: true },
    { center_id: 'customer', customer_name: 'Northside Cafe', product_id: 'seasonal', par_qty: 2, minimum_qty: 0, notes: null, center_active: true },
  ];
  return {
    input: {
      now: NOW, products, stockByProductId: { 'covered-tea': 10 }, pars,
      orders: [
        openOrder('order-alpha', 'alpha', 8, '2026-09-20T12:00:00.000Z'),
        openOrder('order-brazil', 'brazil', 5, '2026-09-21T12:00:00.000Z'),
        openOrder('order-decaf', 'decaf', 1, '2026-09-22T12:00:00.000Z'),
        openOrder('order-tea', 'covered-tea', 2, '2026-09-22T12:00:00.000Z'),
        ...history('brazil', 3, 8), ...history('zulu', 6, 24), ...history('seasonal', 1, 64),
      ],
      schedules: [
        schedule('weekly-zulu', 'zulu', 3, '2026-09-25T13:00:00.000Z'),
        schedule('weekly-alpha', 'alpha', 4, '2026-09-28T13:00:00.000Z'),
        schedule('weekly-ground', 'next-week', 6, '2026-09-30T13:00:00.000Z'),
      ],
      generatedOccurrences: [],
    },
    items: [bean],
    recipes: products.filter((item) => item.id !== 'decaf').map((item) => ({
      id: `recipe-${item.id}`, product_id: item.id, output_qty: 1, waste_percent: 0,
      labor_minutes: 2, labor_rate_cents: 2000, shipping_label_qty: 0, branding_label_qty: 0,
      product_recipe_components: [{
        id: `component-${item.id}`, inventory_item_id: 'bean', quantity: 0.125, unit: 'lb', component_role: 'coffee', inventory_items: bean,
      }],
    })),
    centers: [{ id: 'customer', name: 'Northside Cafe', is_active: true }],
    parLevels: pars,
    onHandByItemId: { bean: 500 },
    materialStockByItemId: { bean: 500 },
  };
}

function workspace(data: ProductionPlanningData, params: Record<string, string> = {}, canEdit = true) {
  const view = planningView(params);
  return renderToStaticMarkup(createElement(ProductionPlanningWorkspace, {
    data, plan: buildProductionPlan(data.input), view, canEdit, returnTo: planningViewHref(view),
  }));
}

function articles(markup: string) {
  return [...markup.matchAll(/<article\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/article>/g)]
    .map(([html, id]) => ({ id, html }));
}

function article(markup: string, id: string) {
  const match = articles(markup).find((item) => item.id === id);
  expect(match, `Expected product card ${id}`).toBeDefined();
  return match!.html;
}

function articleIds(markup: string) { return articles(markup).map((item) => item.id); }
function text(markup: string) { return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }
function productionForms(markup: string, productId: string) {
  return [...markup.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([html]) => html)
    .filter((html) => html.includes(`name="product_id" value="${productId}"`));
}

function input(markup: string, field: string) {
  return [...markup.matchAll(/<input\b[^>]*>/g)].map(([html]) => html)
    .find((html) => html.includes(`name="${field}"`)) ?? '';
}

function materialCells(markup: string) {
  const section = /<section\b[^>]*id="materials"[^>]*>[\s\S]*?<\/section>/.exec(markup)?.[0] ?? '';
  return [...section.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, content]) => text(content));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.canEdit = true;
  state.load.mockReset().mockResolvedValue({ data: fixture(), error: null });
  state.requireView.mockClear();
  state.production.mockClear();
  state.target.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe('production planning page access and loading', () => {
  it('renders editable production and stock-target forms with a current snapshot', async () => {
    const markup = renderToStaticMarkup(await PlanningPage({ searchParams: Promise.resolve({}) }));
    expect(productionForms(markup, 'alpha')).toHaveLength(1);
    expect(markup).toContain('name="par_qty"');
    expect(markup).toContain('name="minimum_qty"');
    expect(markup).toContain('dateTime="2026-09-23T16:00:00.000Z"');
    const previewPath = process.env.PLANNING_PREVIEW_HTML;
    if (previewPath) {
      if (!previewPath.startsWith('/tmp/') && !previewPath.startsWith('/private/tmp/')) throw new Error('Planning previews must stay in the temporary directory.');
      const css = process.env.PLANNING_PREVIEW_CSS ? await readFile(process.env.PLANNING_PREVIEW_CSS, 'utf8') : '';
      await writeFile(previewPath, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Production planning · synthetic verification fixture</title>${css ? `<style>${css}</style>` : '<link rel="stylesheet" href="./planning-preview.css">'}</head><body><main class="mx-auto max-w-7xl px-4 py-8 sm:px-6">${markup}</main></body></html>`);
    }
  });

  it('renders the working plan for view-only staff without mutation forms', async () => {
    state.canEdit = false;
    const markup = renderToStaticMarkup(await PlanningPage({ searchParams: Promise.resolve({}) }));
    expect(state.requireView).toHaveBeenCalledWith('planning');
    expect(state.load).toHaveBeenCalledWith({ planningClient: true }, NOW);
    expect(markup).toContain('View only.');
    expect(articleIds(markup)).toContain('now-alpha');
    expect(markup).not.toContain('name="quantity_produced"');
    expect(markup).not.toContain('name="par_qty"');
    expect(markup).not.toMatch(/<button[^>]*>Record completed production/);
    expect(markup).toContain('Refresh plan');
    expect(markup).toContain('Updated at');
    expect(state.production).not.toHaveBeenCalled();
    expect(state.target).not.toHaveBeenCalled();
  });

  it('shows an explicit load error and withholds recommendations on incomplete data', async () => {
    state.load.mockResolvedValue({ data: null, error: { message: 'Inventory lots page failed.' } });
    const markup = renderToStaticMarkup(await PlanningPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('Unable to load a complete production plan');
    expect(markup).toContain('Inventory lots page failed.');
    expect(articleIds(markup)).toEqual([]);
    expect(markup).not.toContain('Filter production plan');
    expect(markup).not.toContain('name="quantity_produced"');
    expect(markup).not.toContain('Updated at');
  });

  it('keeps legacy week URLs on the current rolling plan and preserves selected filters in completion forms', async () => {
    const markup = renderToStaticMarkup(await PlanningPage({ searchParams: Promise.resolve({
      week_start: '2024-01-01', q: 'WB-ALPHA', sort: 'quantity', covered: '1',
    }) }));
    expect(markup).toContain('Wed, Sep 23');
    expect(markup).toContain('Tue, Oct 6');
    expect(articleIds(markup)).toEqual(['now-alpha', 'upcoming-alpha']);
    const form = productionForms(markup, 'alpha')[0];
    expect(form).toContain('name="return_to" value="/admin/planning?q=WB-ALPHA&amp;sort=quantity&amp;covered=1"');
    expect(markup).not.toContain('2024-01-01');
  });
});

describe('production workspace choices and ordering', () => {
  it.each([
    ['priority', ['alpha', 'brazil', 'decaf', 'zulu']],
    ['confidence_desc', ['zulu', 'brazil', 'alpha', 'decaf']],
    ['confidence_asc', ['alpha', 'decaf', 'brazil', 'zulu']],
    ['quantity', ['alpha', 'brazil', 'zulu', 'decaf']],
    ['name', ['alpha', 'brazil', 'decaf', 'zulu']],
  ] as const)('sorts immediate work by %s without moving later work into that queue', (sort, expected) => {
    const data = fixture();
    const rows = buildProductionPlan(data.input).products.filter((row) => row.makeNowQty > 0);
    const original = rows.map((row) => row.product.id);
    expect(sortWorkspaceRows(rows, sort, 'now').map((row) => row.product.id)).toEqual(expected);
    expect(rows.map((row) => row.product.id)).toEqual(original);
    const ids = articleIds(workspace(data, { sort }));
    expect(ids.filter((id) => id.startsWith('now-'))).toEqual(expected.map((id) => `now-${id}`));
    expect(ids.indexOf('upcoming-next-week')).toBeGreaterThan(ids.indexOf(`now-${expected.at(-1)}`));
  });

  it('sorts upcoming work by its first uncovered preparation date', () => {
    const data = fixture();
    data.input.stockByProductId.zulu = 3;
    const rows = buildProductionPlan(data.input).products.filter((row) => row.outlookQty > 0);
    expect(sortWorkspaceRows(rows, 'date', 'upcoming').map((row) => row.product.id)).toEqual(['alpha', 'next-week', 'zulu']);
    expect(articleIds(workspace(data, { sort: 'date' })).filter((id) => id.startsWith('upcoming-')))
      .toEqual(['upcoming-alpha', 'upcoming-next-week', 'upcoming-zulu']);
  });

  it.each([
    [{ q: 'wb-alpha' }, ['now-alpha', 'upcoming-alpha']],
    [{ category: 'filter_packs' }, ['now-brazil']],
    [{ focus: 'recurring' }, ['now-alpha', 'now-zulu', 'upcoming-alpha', 'upcoming-next-week', 'upcoming-zulu']],
    [{ focus: 'attention' }, ['now-decaf', 'replenishment-seasonal']],
    [{ q: 'nonexistent coffee' }, []],
  ])('filters product cards using %j while labeling full-plan totals', (params, expected) => {
    const markup = workspace(fixture(), params);
    expect(articleIds(markup)).toEqual(expected);
    expect(markup).toContain('Product lists are filtered.');
    expect(markup).toContain('Summary counts and Make now material totals describe the full plan.');
  });

  it('hides covered products by default and reveals them without a production form when requested', () => {
    const data = fixture();
    expect(articleIds(workspace(data))).not.toContain('covered-covered-tea');
    const markup = workspace(data, { covered: '1' });
    const covered = article(markup, 'covered-covered-tea');
    expect(covered).toContain('Covered by stock');
    expect(covered).toContain('TEA-COVERED');
    expect(covered).not.toContain('name="quantity_produced"');
    expect(markup).toMatch(/type="checkbox"[^>]*name="covered"[^>]*checked=""/);
  });
});

describe('worker explanations and completed production', () => {
  it('explains recurring preparation dates, customers and stock coverage with order links', () => {
    const data = fixture();
    data.input.stockByProductId.zulu = 1;
    const markup = workspace(data);
    const recurring = text(article(markup, 'now-zulu'));
    expect(recurring).toContain('Recurring');
    expect(recurring).toContain('Make 2 units');
    expect(recurring).toContain('Prepare from Wed, Sep 23');
    expect(recurring).toContain('Scheduled order Fri, Sep 25');
    expect(recurring).toContain('Lakeview Market');
    expect(recurring).toContain('1 unit covered by recorded stock · 2 units uncovered');
    expect(text(article(markup, 'upcoming-alpha'))).toContain('Prepare from Thu, Sep 24 · Scheduled order Mon, Sep 28');
    expect(article(markup, 'now-alpha')).toContain('href="/admin/orders/order-alpha"');
    expect(article(markup, 'now-zulu')).toContain('href="/admin/recurring-orders"');
  });

  it('keeps confirmed low-history orders actionable and makes only the forecast addition reviewable', () => {
    const markup = workspace(fixture());
    const confirmed = article(markup, 'now-alpha');
    expect(confirmed).toContain('Confirmed order');
    expect(confirmed).toContain('Forecast confidence');
    expect(confirmed).toContain('Low');
    expect(input(confirmed, 'quantity_produced')).toContain('value="8"');
    expect(input(confirmed, 'quantity_produced')).not.toContain('disabled=""');
    expect(confirmed).not.toContain('I reviewed the low-confidence forecast');
    const replenishment = article(markup, 'replenishment-seasonal');
    expect(text(replenishment)).toContain('Replenish 2 units');
    expect(text(replenishment)).toContain('I reviewed the low-confidence forecast; include 6 additional units');
    expect(input(replenishment, 'quantity_produced')).toContain('value="2"');
    expect(replenishment).not.toContain('checked=""');
    expect(text(replenishment)).toContain('Average 8 units per week; shipped in 1 of the last 8 weeks.');
  });

  it('has one completion form for a product needing immediate work plus replenishment and future work', () => {
    const markup = workspace(fixture());
    expect(productionForms(markup, 'alpha')).toHaveLength(1);
    expect(articleIds(markup)).not.toContain('replenishment-alpha');
    expect(article(markup, 'now-alpha')).toContain('Include 2 additional units for replenishment in this run');
    expect(article(markup, 'upcoming-alpha')).not.toContain('name="quantity_produced"');
    expect(article(markup, 'upcoming-alpha')).toContain('href="#now-alpha"');
    expect(article(markup, 'now-alpha')).toContain('Record completed production');
    expect(article(markup, 'now-alpha')).toContain('Record only after the work is finished.');
  });

  it('keeps blocked urgent work visible with a disabled completion form', () => {
    const markup = workspace(fixture());
    const blocked = article(markup, 'now-decaf');
    expect(blocked).toContain('Make 1 unit');
    expect(blocked).toContain('Recipe missing.');
    expect(input(blocked, 'quantity_produced')).toContain('disabled=""');
    expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*>Record completed production/);
    expect(markup).toContain('This estimate is incomplete');
  });

  it('recomputes immediate and later shortages from recorded stock while retaining the worker view', async () => {
    const data = fixture();
    const params = { q: 'WB-ALPHA', sort: 'quantity' };
    state.load.mockResolvedValue({ data, error: null });
    const before = renderToStaticMarkup(await PlanningPage({ searchParams: Promise.resolve(params) }));
    expect(article(before, 'now-alpha')).toContain('Make 8 units');
    expect(text(article(before, 'upcoming-alpha'))).toContain('8 units short with recorded stock');
    data.input.stockByProductId.alpha = 10;
    const after = renderToStaticMarkup(await PlanningPage({ searchParams: Promise.resolve(params) }));
    expect(articleIds(after)).toEqual(['upcoming-alpha']);
    expect(text(article(after, 'upcoming-alpha'))).toContain('6 units short with recorded stock');
    expect(productionForms(after, 'alpha')).toHaveLength(0);
    expect(after).toContain('name="q" value="WB-ALPHA"');
    expect(after).toContain('value="quantity" selected=""');
    expect(state.load).toHaveBeenCalledTimes(2);
    expect(state.production).not.toHaveBeenCalled();
  });

  it('shows fractional coffee shortages in both the product explanation and total requirements', () => {
    const data = fixture();
    data.input.products = data.input.products.filter((item) => item.id === 'alpha');
    data.input.orders = [openOrder('small-run', 'alpha', 1, '2026-09-22T12:00:00.000Z')];
    data.input.schedules = [];
    data.input.pars = [];
    data.recipes = data.recipes.filter((recipe) => recipe.product_id === 'alpha');
    data.recipes[0].product_recipe_components![0].quantity = 0.002;
    data.materialStockByItemId.bean = 0.001;
    const markup = workspace(data);
    expect(text(article(markup, 'now-alpha'))).toContain('Short 0.001 lb');
    expect(text(markup)).toContain('Material short: Roasted coffee — 0.001 lb for 1 unit.');
    expect(markup).toContain('The full Make now queue exceeds stock for Roasted coffee.');
    expect(materialCells(markup).slice(-3)).toEqual(['0.002 lb', '0.001 lb', '0.001 lb']);
  });

  it('flags both competing runs when individually covered material needs exceed the shared stock', () => {
    const data = fixture();
    data.input.products = data.input.products.filter((item) => ['alpha', 'brazil'].includes(item.id));
    data.input.orders = [
      openOrder('alpha-run', 'alpha', 1, '2026-09-20T12:00:00.000Z'),
      openOrder('brazil-run', 'brazil', 1, '2026-09-21T12:00:00.000Z'),
    ];
    data.input.schedules = [];
    data.input.pars = [];
    data.recipes = data.recipes.filter((recipe) => ['alpha', 'brazil'].includes(recipe.product_id));
    for (const recipe of data.recipes) recipe.product_recipe_components![0].quantity = 4;
    data.materialStockByItemId.bean = 5;
    const markup = workspace(data, { focus: 'attention' });
    expect(articleIds(markup)).toEqual(['now-alpha', 'now-brazil']);
    for (const id of ['alpha', 'brazil']) {
      const card = article(markup, `now-${id}`);
      expect(text(card)).toContain('Roasted coffee');
      expect(text(card)).toContain('3 lb');
      expect(text(card)).toContain('Material estimate covered for this quantity');
    }
    expect(markup).toContain('The full Make now queue exceeds stock for Roasted coffee.');
    expect(materialCells(markup).slice(-3)).toEqual(['8 lb', '5 lb', '3 lb']);
  });
});

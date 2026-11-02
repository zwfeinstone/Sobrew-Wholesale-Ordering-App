import { describe, expect, it } from 'vitest';
import { buildMachineBagSummary } from '@/lib/machine-bag-summary';
import { buildProductionPlan, type PlanningProductInput, type ProductionPlanningInput } from '@/lib/production-planning';
import type { PlanningRecipe, ProductionPlanningData } from '@/lib/production-planning-data';
import type { ProductionMaterialComponent } from '@/lib/production-materials';

const product: PlanningProductInput = { id: 'medium', name: 'Medium Roast 100 x 2 oz', category: 'fraction_packs', active: true };
const raw = { id: 'raw-medium', name: 'Raw Coffee - Medium Roast', sku: 'RAW-MED', base_unit: 'lb' as const };
function component(overrides: Partial<ProductionMaterialComponent> = {}): ProductionMaterialComponent {
  return { id: 'coffee', inventory_item_id: raw.id, quantity: 200, unit: 'oz', component_role: 'raw_coffee', inventory_items: raw, ...overrides };
}
function recipe(productId = product.id, overrides: Partial<PlanningRecipe> = {}): PlanningRecipe {
  return {
    id: `recipe-${productId}`, product_id: productId, output_qty: 1, waste_percent: 5,
    labor_minutes: 0, labor_rate_cents: 0, shipping_label_qty: 0, branding_label_qty: 0,
    product_recipe_components: [component(), component({ id: 'bags', inventory_item_id: 'fraction-bag', inventory_items: null, quantity: 100, unit: 'each', component_role: 'fraction_bag' })],
    ...overrides,
  };
}
function fixture(overrides: Partial<ProductionPlanningInput> = {}, recipes = [recipe()]) {
  const input: ProductionPlanningInput = {
    now: '2026-10-12T17:00:00Z', products: [product], stockByProductId: {},
    orders: [{ id: 'open', status: 'New', created_at: '2026-10-12T16:00:00Z', order_items: [{ product_id: product.id, qty: 1 }] }],
    schedules: [], pars: [], ...overrides,
  };
  const data: ProductionPlanningData = {
    input, recipes, items: [], centers: [], parLevels: [], onHandByItemId: {}, materialStockByItemId: {},
  };
  return { data, plan: buildProductionPlan(input) };
}
function calculate(overrides: Partial<ProductionPlanningInput> = {}, recipes = [recipe()], includeForecast = true) {
  const { data, plan } = fixture(overrides, recipes);
  return buildMachineBagSummary(data, plan, includeForecast);
}

describe('machine bag summary', () => {
  it('uses overlapping two-week forecast, known demand and saved targets, then subtracts stock once', () => {
    const { data, plan } = fixture({ stockByProductId: { medium: 3 }, pars: [{ product_id: 'medium', par_qty: 8, minimum_qty: 12 }] });
    Object.assign(plan.products[0], { confidence: 'High', historyWeeklyAverageQty: 10 });
    const result = buildMachineBagSummary(data, plan);
    expect(result.rows[0]).toMatchObject({ roast: 'Medium Roast', sizeOz: 2, bagCount: 1700, coffeeLb: 212.5 });
    expect(result.rows[0].sources[0].unitsToMake).toBe(17);
    expect(buildMachineBagSummary(data, plan, false).totalBags).toBe(0);
  });

  it('includes future recurring demand throughout fourteen Chicago dates and excludes the next day', () => {
    const result = calculate({ orders: [], schedules: [
      { id: 'due-last-day', status: 'active', frequency: '2_weeks', next_run_at: '2026-10-25T12:00:00Z', recurring_order_items: [{ product_id: 'medium', qty: 2 }] },
      { id: 'after-window', status: 'active', frequency: '2_weeks', next_run_at: '2026-10-26T12:00:00Z', recurring_order_items: [{ product_id: 'medium', qty: 9 }] },
    ] });
    expect(result).toMatchObject({ today: '2026-10-12', horizonEnd: '2026-10-25', totalBags: 200 });
  });

  it('does not manufacture speculative low-confidence demand or missed recurring cycles', () => {
    const { data, plan } = fixture({ orders: [], schedules: [{ id: 'missed', customer_name: 'Cafe', status: 'active', frequency: '1_week', next_run_at: '2026-09-28T12:00:00Z', recurring_order_items: [{ product_id: 'medium', qty: 2 }] }] });
    Object.assign(plan.products[0], { confidence: 'Low', historyWeeklyAverageQty: 50 });
    const result = buildMachineBagSummary(data, plan);
    expect(result.totalBags).toBe(400); // October 12 and 19; past September 28 / October 5 need review.
    expect(result.reviewMessages.some((message) => message.includes('past recurring dates'))).toBe(true);
    expect(result.reviewMessages.some((message) => message.includes('forecast is excluded'))).toBe(true);
  });

  it('includes signed inventory debt once and does not create production for sufficient stock', () => {
    expect(calculate({ stockByProductId: { medium: -2 } }).totalBags).toBe(300);
    expect(calculate({ stockByProductId: { medium: 4 } }).totalBags).toBe(0);
  });

  it('converts pounds, respects recipe output and excludes waste from count and fill weight', () => {
    const scaled = recipe('medium', { output_qty: 2, waste_percent: 25, product_recipe_components: [
      component({ quantity: 25, unit: 'lb' }),
      component({ id: 'bag', inventory_item_id: 'bag', quantity: 200, unit: 'each', component_role: 'fraction_bag' }),
    ] });
    expect(calculate({}, [scaled]).rows[0]).toMatchObject({ sizeOz: 2, bagCount: 100, coffeeLb: 12.5 });
  });

  it('rounds required bags up and ignores the outer bag in filter packs', () => {
    const filter = { ...product, name: 'Medium Roast Filter Pack', category: 'filter_packs' };
    const filterRecipe = recipe('medium', { output_qty: 3, product_recipe_components: [
      component({ quantity: 14 }),
      component({ id: 'filter', inventory_item_id: 'filter', quantity: 10, unit: 'each', component_role: 'filter_pack' }),
      component({ id: 'outer', inventory_item_id: 'outer', quantity: 1, unit: 'each', component_role: 'bag' }),
    ] });
    expect(calculate({ products: [filter] }, [filterRecipe]).rows[0]).toMatchObject({ bagType: 'filter', sizeOz: 1.4, bagCount: 4, coffeeLb: 0.35 });
  });

  it('merges matching roast and size across case counts, while retaining product sources', () => {
    const second = { ...product, id: 'medium40', name: 'Medium Roast 40 x 2 oz with Filters' };
    const result = calculate({ products: [product, second], orders: [{ id: 'open', status: 'Processing', created_at: null, order_items: [{ product_id: 'medium', qty: 1 }, { product_id: 'medium40', qty: 2 }] }] }, [recipe(), recipe('medium40', { product_recipe_components: [component({ quantity: 80 }), component({ id: 'bags', inventory_item_id: 'bag', quantity: 40, unit: 'each', component_role: 'fraction_bag' })] })]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ bagType: 'fraction', bagCount: 180, coffeeLb: 22.5 });
    expect(result.rows[0].sources).toHaveLength(2);
  });

  it('keeps French, Espresso and Dark separate even when their recipes share dark coffee', () => {
    const products = ['French', 'Espresso', 'Dark'].map((roast) => ({ ...product, id: roast, name: `${roast} Roast 100 x 2 oz` }));
    const dark = { ...raw, id: 'raw-dark', name: 'Raw Coffee - Dark Roast' };
    const recipes = products.map((entry) => recipe(entry.id, { product_recipe_components: [component({ inventory_item_id: dark.id, inventory_items: dark }), component({ id: 'bags', inventory_item_id: 'bag', quantity: 100, unit: 'each', component_role: 'fraction_bag' })] }));
    const result = calculate({ products, orders: [{ id: 'open', status: 'New', created_at: null, order_items: products.map((entry) => ({ product_id: entry.id, qty: 1 })) }] }, recipes);
    expect(result.rows.map((row) => row.roast)).toEqual(['Dark Roast', 'Espresso Roast', 'French Roast']);
  });

  it('keeps genuine blends as one run with composition, without doubling bag counts', () => {
    const blend = { ...product, name: 'House Blend 100 x 2 oz' };
    const blendedRecipe = recipe('medium', { product_recipe_components: [
      component({ quantity: 100 }),
      component({ id: 'dark', inventory_item_id: 'raw-dark', quantity: 100, inventory_items: { ...raw, id: 'raw-dark', name: 'Raw Coffee - Dark Roast' } }),
      component({ id: 'bag', inventory_item_id: 'bag', quantity: 100, unit: 'each', component_role: 'fraction_bag' }),
    ] });
    const result = calculate({ products: [blend] }, [blendedRecipe]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ bagCount: 100, coffeeLb: 12.5 });
    expect(result.rows[0].roast).toContain('50% Dark Roast + 50% Medium Roast');
  });

  it('uses one user-confirmed 6oz ground dark and medium bag for every sample box, without a recipe', () => {
    const sample = { ...product, category: 'sample_boxes', name: 'Sample Box Whole Bean W/ 12oz Whole Bean in FD Bag' };
    const result = calculate({ products: [sample], stockByProductId: { medium: -1 } }, []);
    expect(result.issues).toEqual([]);
    expect(result.rows.map(({ bagType, roast, sizeOz, bagCount, coffeeLb }) => ({ bagType, roast, sizeOz, bagCount, coffeeLb }))).toEqual([
      { bagType: 'sample', roast: 'Dark Roast', sizeOz: 6, bagCount: 2, coffeeLb: 0.75 },
      { bagType: 'sample', roast: 'Medium Roast', sizeOz: 6, bagCount: 2, coffeeLb: 0.75 },
    ]);
  });

  it('keeps a named medium run and warns when the recipe unexpectedly uses dark coffee', () => {
    const mismatch = recipe('medium', { product_recipe_components: [
      component({ inventory_items: { ...raw, name: 'Raw Coffee - Dark Roast' } }),
      component({ id: 'bag', inventory_item_id: 'bag', quantity: 100, unit: 'each', component_role: 'fraction_bag' }),
    ] });
    const result = calculate({}, [mismatch]);
    expect(result.rows[0].roast).toBe('Medium Roast');
    expect(result.reviewMessages[0]).toContain('verify the recipe');
    expect(result.issues).toEqual([]);
  });

  it('excludes label conflicts so an operator is not instructed to fill the wrong bag size', () => {
    const wrongSize = recipe('medium', { product_recipe_components: [
      component({ quantity: 140 }),
      component({ id: 'bag', inventory_item_id: 'bag', quantity: 100, unit: 'each', component_role: 'fraction_bag' }),
    ] });
    const result = calculate({}, [wrongSize]);
    expect(result.rows).toEqual([]);
    expect(result.issues[0].message).toContain('conflicts with the product label');
  });

  it('keeps different blend proportions in separate runs', () => {
    const first = { ...product, name: 'House Blend 100 x 2 oz' };
    const second = { ...first, id: 'blend75', name: 'Another House Blend 100 x 2 oz' };
    const blendRecipe = (id: string, mediumOz: number) => recipe(id, { product_recipe_components: [
      component({ quantity: mediumOz }),
      component({ id: 'dark', inventory_item_id: 'raw-dark', quantity: 200 - mediumOz, inventory_items: { ...raw, id: 'raw-dark', name: 'Raw Coffee - Dark Roast' } }),
      component({ id: 'bag', inventory_item_id: 'bag', quantity: 100, unit: 'each', component_role: 'fraction_bag' }),
    ] });
    const result = calculate({ products: [first, second], orders: [{ id: 'open', status: 'New', created_at: null, order_items: [{ product_id: first.id, qty: 1 }, { product_id: second.id, qty: 1 }] }] }, [blendRecipe(first.id, 100), blendRecipe(second.id, 150)]);
    expect(result.rows).toHaveLength(2);
    expect(result.totalBags).toBe(200);
  });

  it.each([
    recipe('medium', { output_qty: 0 }),
    recipe('medium', { product_recipe_components: [] }),
    recipe('medium', { product_recipe_components: [component({ quantity: Infinity })] }),
  ])('reports invalid recipe inputs without adding guessed bags', (invalidRecipe) => {
    const result = calculate({}, [invalidRecipe]);
    expect(result.totalBags).toBe(0);
    expect(result.issues).toHaveLength(1);
  });
});

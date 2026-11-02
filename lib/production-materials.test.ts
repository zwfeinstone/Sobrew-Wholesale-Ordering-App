import { describe, expect, it } from 'vitest';
import {
  buildProductionMaterialPreview,
  type ProductionMaterialComponent,
  type ProductionMaterialItem,
  type ProductionMaterialRecipe,
} from '@/lib/production-materials';

const coffee: ProductionMaterialItem = { id: 'coffee', base_unit: 'lb', sku: 'COFFEE' };
const primaryBox: ProductionMaterialItem = { id: 'primary-box', base_unit: 'each', sku: 'MAT-BOX-12X7X4' };
const fallbackBox: ProductionMaterialItem = { id: 'fallback-box', base_unit: 'each', sku: 'MAT-BOX-12X6X4', active: true };
const rollStock: ProductionMaterialItem = { id: 'roll-stock', base_unit: 'each', sku: 'MAT-BAG-FRAC-ROLL', active: true, item_type: 'material_supply' };
const regularBag: ProductionMaterialItem = { id: 'regular-bag', base_unit: 'each', active: true, item_type: 'material_supply' };
const sixOzBag: ProductionMaterialItem = { id: 'six-ounce-bag', base_unit: 'each', active: true, item_type: 'material_supply' };

function component(item: ProductionMaterialItem, overrides: Partial<ProductionMaterialComponent> = {}): ProductionMaterialComponent {
  return {
    id: `component-${item.id}`,
    inventory_item_id: item.id,
    inventory_items: item,
    quantity: 1,
    unit: item.base_unit,
    component_role: item === coffee ? 'raw_coffee' : 'box',
    ...overrides,
  };
}

function recipe(components: ProductionMaterialComponent[], overrides: Partial<ProductionMaterialRecipe> = {}): ProductionMaterialRecipe {
  return { output_qty: 1, waste_percent: 0, product_recipe_components: components, ...overrides };
}

describe('production material previews', () => {
  it('preserves fractional coffee shortages through unit conversion and recipe waste', () => {
    const result = buildProductionMaterialPreview({
      recipe: recipe([component(coffee, { quantity: 12, unit: 'oz' })], { waste_percent: 10, output_qty: 2 }),
      quantity: 2,
      onHandByItemId: new Map([[coffee.id, 0.5]]),
    });
    expect(result.lines[0].requiredQty).toBeCloseTo(0.825);
    expect(result.lines[0].shortageQty).toBeCloseTo(0.325);
    expect(result.hasShortages).toBe(true);
    expect(result.remainingOnHandByItemId.get(coffee.id)).toBe(0);
  });

  it('rounds whole-count packaging without applying raw-coffee waste', () => {
    const result = buildProductionMaterialPreview({
      recipe: recipe([component(primaryBox, { quantity: 0.75 })], { waste_percent: 30 }),
      quantity: 2,
      onHandByItemId: new Map([[primaryBox.id, 5]]),
    });
    expect(result.lines[0]).toMatchObject({ requiredQty: 2, expectedQty: 2, shortageQty: 0 });
    expect(result.remainingOnHandByItemId.get(primaryBox.id)).toBe(3);
  });

  it('aggregates repeated ingredient lines before comparing against stock', () => {
    const stock = new Map([[coffee.id, 1]]);
    const result = buildProductionMaterialPreview({
      recipe: recipe([component(coffee, { id: 'first', quantity: 0.7 }), component(coffee, { id: 'second', quantity: 0.8 })]),
      quantity: 1,
      onHandByItemId: stock,
    });
    expect(result.lines).toEqual([{ inventoryItemId: coffee.id, unit: 'lb', requiredQty: 1.5, expectedQty: 1.5, availableQty: 1, shortageQty: 0.5 }]);
    expect(stock.get(coffee.id)).toBe(1);
  });

  it('uses primary sample boxes before eligible substitutes', () => {
    const result = buildProductionMaterialPreview({
      recipe: recipe([component(primaryBox)]),
      productCategory: 'sample_boxes',
      quantity: 3,
      onHandByItemId: new Map([[primaryBox.id, 1], [fallbackBox.id, 4]]),
      fallbackItems: [fallbackBox],
    });
    expect(result.lines.map((line) => [line.inventoryItemId, line.requiredQty])).toEqual([[primaryBox.id, 1], [fallbackBox.id, 2]]);
    expect(result.hasShortages).toBe(false);
    expect(result.remainingOnHandByItemId.get(fallbackBox.id)).toBe(2);
  });

  it('does not reuse substituted stock across planned rows', () => {
    const input = { recipe: recipe([component(primaryBox)]), productCategory: 'sample_boxes', quantity: 2, fallbackItems: [fallbackBox] };
    const first = buildProductionMaterialPreview({ ...input, onHandByItemId: new Map([[fallbackBox.id, 3]]) });
    const second = buildProductionMaterialPreview({ ...input, onHandByItemId: first.remainingOnHandByItemId });
    expect(first.hasShortages).toBe(false);
    expect(second.hasShortages).toBe(true);
    expect(second.lines).toEqual([{ inventoryItemId: primaryBox.id, unit: 'each', requiredQty: 2, expectedQty: 2, availableQty: 0, shortageQty: 2 }]);
  });

  it.each([
    { category: 'coffee', fallback: fallbackBox },
    { category: 'sample_boxes', fallback: { ...fallbackBox, active: false } },
    { category: 'sample_boxes', fallback: { ...fallbackBox, base_unit: 'case' as const } },
  ])('does not substitute incompatible category or packaging: $category', ({ category, fallback }) => {
    const result = buildProductionMaterialPreview({
      recipe: recipe([component(primaryBox)]),
      productCategory: category,
      quantity: 1,
      onHandByItemId: new Map([[fallback.id, 5]]),
      fallbackItems: [fallback],
    });
    expect(result.lines[0]).toMatchObject({ inventoryItemId: primaryBox.id, shortageQty: 1 });
  });

  it('uses actual inputs for requirements while preserving estimated consumption', () => {
    const result = buildProductionMaterialPreview({
      recipe: recipe([component(coffee, { quantity: 8, unit: 'oz' })]),
      quantity: 2,
      onHandByItemId: new Map([[coffee.id, 1.25]]),
      actualQuantityByComponentId: new Map([['component-coffee', 24]]),
    });
    expect(result.lines[0]).toMatchObject({ requiredQty: 1.5, expectedQty: 1, shortageQty: 0.25 });
    expect(result.components[0]).toMatchObject({ quantity_expected: 1, quantity_used: 1.5 });
  });

  it('distinguishes a missing recipe from an invalid empty recipe', () => {
    const input = { quantity: 1, onHandByItemId: new Map<string, number>() };
    expect(buildProductionMaterialPreview({ ...input, recipe: null })).toMatchObject({ missingRecipe: true, invalidRecipe: false, lines: [] });
    expect(buildProductionMaterialPreview({ ...input, recipe: recipe([]) })).toMatchObject({ missingRecipe: false, invalidRecipe: true, lines: [] });
  });

  it('returns no partial ready result for missing component metadata or incompatible units', () => {
    const stock = new Map([[coffee.id, 10], [primaryBox.id, 5]]);
    const good = component(coffee);
    const invalidRecipe = buildProductionMaterialPreview({
      recipe: recipe([good, component(primaryBox, { inventory_items: null })]), quantity: 1, onHandByItemId: stock,
    });
    expect(invalidRecipe).toMatchObject({ invalidRecipe: true, lines: [], components: [] });
    expect(invalidRecipe.remainingOnHandByItemId).toEqual(stock);
    const invalidUnits = buildProductionMaterialPreview({
      recipe: recipe([good, component(primaryBox, { unit: 'lb' })]), quantity: 1, onHandByItemId: stock,
    });
    expect(invalidUnits).toMatchObject({ invalidUnit: true, lines: [], components: [] });
    expect(invalidUnits.remainingOnHandByItemId).toEqual(stock);
  });

  it('rejects invalid run sizes or recipe output rather than offering false coverage', () => {
    const input = { recipe: recipe([component(coffee)]), quantity: 1, onHandByItemId: new Map<string, number>() };
    expect(buildProductionMaterialPreview({ ...input, quantity: NaN }).invalidRecipe).toBe(true);
    expect(buildProductionMaterialPreview({ ...input, recipe: { ...input.recipe, output_qty: 0 } }).invalidRecipe).toBe(true);
  });
});

describe('explicit product material fallbacks', () => {
  const bagRecipe = (fallbackItem = regularBag, quantity = 100) => recipe([
    component(rollStock, { component_role: 'fraction_bag', quantity }),
  ], {
    material_fallbacks: [{ primary_inventory_item_id: rollStock.id, fallback_inventory_item_id: fallbackItem.id }],
  });

  it.each([
    { primary: 150, required: [[rollStock.id, 100]], remaining: 50 },
    { primary: 40, required: [[rollStock.id, 40], [regularBag.id, 60]], remaining: 0 },
    { primary: 0, required: [[regularBag.id, 100]], remaining: 0 },
  ])('uses primary bags first with $primary roll-stock bags available', ({ primary, required, remaining }) => {
    const result = buildProductionMaterialPreview({
      recipe: bagRecipe(), quantity: 1,
      onHandByItemId: new Map([[rollStock.id, primary], [regularBag.id, 200]]),
      fallbackItems: [regularBag, sixOzBag],
    });
    expect(result.components.map((line) => [line.inventory_item_id, line.quantity_used])).toEqual(required);
    expect(result.hasShortages).toBe(false);
    expect(result.remainingOnHandByItemId.get(rollStock.id) ?? 0).toBe(remaining);
    expect(result.components.every((line) => Number.isInteger(line.quantity_used))).toBe(true);
  });

  it('uses only the original six-ounce bag for sample boxes, independently of carton fallback', () => {
    const sample = bagRecipe(sixOzBag, 2);
    sample.product_recipe_components?.push(component(primaryBox));
    const result = buildProductionMaterialPreview({
      recipe: sample, quantity: 2, productCategory: 'sample_boxes',
      onHandByItemId: new Map([[rollStock.id, 1], [regularBag.id, 100], [sixOzBag.id, 3], [fallbackBox.id, 2]]),
      fallbackItems: [regularBag, sixOzBag, fallbackBox],
    });
    expect(result.components.map((line) => [line.inventory_item_id, line.quantity_used])).toEqual([
      [rollStock.id, 1], [sixOzBag.id, 3], [fallbackBox.id, 2],
    ]);
    expect(result.hasShortages).toBe(false);
    expect(result.remainingOnHandByItemId.get(regularBag.id)).toBe(100);
  });

  it.each([
    { label: 'wrong bag', item: sixOzBag },
    { label: 'inactive bag', item: { ...regularBag, active: false } },
    { label: 'unknown activity', item: { ...regularBag, active: undefined } },
    { label: 'incompatible unit', item: { ...regularBag, base_unit: 'lb' as const } },
    { label: 'non-material item', item: { ...regularBag, item_type: 'finished_good' } },
  ])('rejects a configured $label regardless of primary stock', ({ item }) => {
    for (const primaryStock of [0, 200]) {
      const stock = new Map([[item.id, 200], [rollStock.id, primaryStock]]);
      const result = buildProductionMaterialPreview({
        recipe: bagRecipe(), quantity: 1, onHandByItemId: stock, fallbackItems: [item],
      });
      expect(result).toMatchObject({ invalidRecipe: true, components: [], lines: [] });
      expect(result.remainingOnHandByItemId).toEqual(stock);
    }
  });

  it.each([
    { active: false, item_type: 'material_supply' },
    { active: true, item_type: 'finished_good' },
  ])('rejects incompatible primary material metadata: %j', (metadata) => {
    const inputRecipe = bagRecipe();
    inputRecipe.product_recipe_components![0].inventory_items = { ...rollStock, ...metadata };
    const result = buildProductionMaterialPreview({ recipe: inputRecipe, quantity: 1, onHandByItemId: new Map([[rollStock.id, 200]]), fallbackItems: [regularBag] });
    expect(result).toMatchObject({ invalidRecipe: true, components: [], lines: [] });
  });

  it('ignores stale rules only when their primary is absent from the recipe', () => {
    const inputRecipe = recipe([component(coffee)], {
      material_fallbacks: [{ primary_inventory_item_id: rollStock.id, fallback_inventory_item_id: regularBag.id }],
    });
    const result = buildProductionMaterialPreview({ recipe: inputRecipe, quantity: 1, onHandByItemId: new Map([[coffee.id, 2]]) });
    expect(result).toMatchObject({ invalidRecipe: false, hasShortages: false });
    expect(result.components[0].inventory_item_id).toBe(coffee.id);
  });

  it('rejects a self-referencing fallback rule even when primary stock is sufficient', () => {
    const result = buildProductionMaterialPreview({ recipe: bagRecipe(rollStock), quantity: 1, onHandByItemId: new Map([[rollStock.id, 200]]), fallbackItems: [rollStock] });
    expect(result).toMatchObject({ invalidRecipe: true, components: [], lines: [] });
  });

  it('reports the remaining deficit on the exact fallback and shares stock across queued products', () => {
    const stock = new Map([[rollStock.id, 150], [regularBag.id, 30], [sixOzBag.id, 50]]);
    const input = { recipe: bagRecipe(), quantity: 1, fallbackItems: [regularBag, sixOzBag] };
    const first = buildProductionMaterialPreview({ ...input, onHandByItemId: stock });
    const second = buildProductionMaterialPreview({ ...input, onHandByItemId: first.remainingOnHandByItemId });
    const sample = buildProductionMaterialPreview({ recipe: bagRecipe(sixOzBag, 2), quantity: 1, fallbackItems: [regularBag, sixOzBag], onHandByItemId: second.remainingOnHandByItemId });
    expect(first.hasShortages).toBe(false);
    expect(second.lines).toEqual([
      { inventoryItemId: rollStock.id, unit: 'each', requiredQty: 50, expectedQty: 50, availableQty: 50, shortageQty: 0 },
      { inventoryItemId: regularBag.id, unit: 'each', requiredQty: 50, expectedQty: 50, availableQty: 30, shortageQty: 20 },
    ]);
    expect(second.hasShortages).toBe(true);
    expect(second.remainingOnHandByItemId.get(regularBag.id)).toBe(0);
    expect(sample.components[0]).toMatchObject({ inventory_item_id: sixOzBag.id, quantity_used: 2 });
    expect(sample.hasShortages).toBe(false);
    expect(stock.get(rollStock.id)).toBe(150);
  });

  it('keeps bag usage whole when remaining stock is fractional and preserves actual quantities', () => {
    const result = buildProductionMaterialPreview({
      recipe: bagRecipe(regularBag, 2), quantity: 1,
      onHandByItemId: new Map([[rollStock.id, 1.5], [regularBag.id, 10]]), fallbackItems: [regularBag],
      actualQuantityByComponentId: new Map([['component-roll-stock', 3]]),
    });
    expect(result.components.map((line) => [line.inventory_item_id, line.quantity_used])).toEqual([[rollStock.id, 1], [regularBag.id, 2]]);
    expect(result.components.reduce((sum, line) => sum + line.quantity_expected, 0)).toBe(2);
  });

  it.each([
    { primaryStock: 0.9999, expected: [[regularBag.id, 2]] },
    { primaryStock: 0.7 + 0.1 + 0.2, expected: [[rollStock.id, 1], [regularBag.id, 1]] },
  ])('matches database whole-bag allocation for primary stock $primaryStock', ({ primaryStock, expected }) => {
    const result = buildProductionMaterialPreview({
      recipe: bagRecipe(regularBag, 2), quantity: 1,
      onHandByItemId: new Map([[rollStock.id, primaryStock], [regularBag.id, 2]]), fallbackItems: [regularBag],
    });
    expect(result.components.map((line) => [line.inventory_item_id, line.quantity_used])).toEqual(expected);
    expect(result.hasShortages).toBe(false);
  });
});

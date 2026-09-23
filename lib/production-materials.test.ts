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

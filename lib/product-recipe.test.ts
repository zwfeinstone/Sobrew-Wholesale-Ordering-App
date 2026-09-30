import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { parseProductRecipe, saveNewProductRecipe, type ParsedProductRecipe } from '@/lib/product-recipe';
import type { Database } from '@/lib/supabase/schema';

function recipeForm(values: Record<string, string> = {}) {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) formData.set(name, value);
  return formData;
}

function parsedRecipe(values: Record<string, string> = {}): ParsedProductRecipe {
  const result = parseProductRecipe(recipeForm(values));
  if (!result.ok) throw new Error(result.error);
  return { recipe: result.recipe, components: result.components };
}

describe('product recipe form validation', () => {
  it('allows empty optional recipe fields without inventing ingredient rows', () => {
    expect(parseProductRecipe(recipeForm({ labor_rate: ' ', recipe_notes: ' ' }))).toEqual({
      ok: true,
      recipe: {
        output_qty: 1,
        waste_percent: 0,
        labor_minutes: 0,
        labor_rate_cents: 0,
        shipping_label_qty: 0,
        branding_label_qty: 0,
        notes: null,
      },
      components: [],
    });
  });

  it('retains all recipe costs, ingredient roles, units and notes in the first save', () => {
    const parsed = parsedRecipe({
      output_qty: '12', waste_percent: '3.5', labor_minutes: '20', labor_rate: '24.25',
      shipping_label_qty: '1', branding_label_qty: '12', recipe_notes: '  Roast weekly  ',
      raw_coffee_item_id_0: 'green-coffee', raw_coffee_qty_0: '1.5', raw_coffee_unit_0: 'lb',
      fraction_bag_item_id: 'fraction-bag', fraction_bag_qty: '12',
      box_item_id: 'shipping-box', box_qty: '1',
      filter_pack_item_id: 'filter', filter_pack_qty: '12',
      bag_item_id: 'bag', bag_qty: '2',
      extra_item_id_3: 'ribbon', extra_qty_3: '.5', extra_unit_3: 'case', extra_note_3: '  Gift wrap  ',
    });
    expect(parsed.recipe).toEqual({
      output_qty: 12, waste_percent: 3.5, labor_minutes: 20, labor_rate_cents: 2425,
      shipping_label_qty: 1, branding_label_qty: 12, notes: 'Roast weekly',
    });
    expect(parsed.components).toEqual([
      { inventory_item_id: 'green-coffee', quantity: 1.5, unit: 'lb', component_role: 'raw_coffee', sort_order: 0, notes: 'Raw coffee' },
      { inventory_item_id: 'fraction-bag', quantity: 12, unit: 'each', component_role: 'fraction_bag', sort_order: 1, notes: 'Fraction bag' },
      { inventory_item_id: 'shipping-box', quantity: 1, unit: 'each', component_role: 'box', sort_order: 2, notes: 'Box' },
      { inventory_item_id: 'filter', quantity: 12, unit: 'each', component_role: 'filter_pack', sort_order: 3, notes: 'Filter pack' },
      { inventory_item_id: 'bag', quantity: 2, unit: 'each', component_role: 'bag', sort_order: 4, notes: 'Bag' },
      { inventory_item_id: 'ribbon', quantity: .5, unit: 'case', component_role: 'material_supply', sort_order: 5, notes: 'Gift wrap' },
    ]);
  });

  it('merges repeated role/item/unit rows while retaining separate units and roles', () => {
    const { components } = parsedRecipe({
      raw_coffee_item_id_0: 'coffee', raw_coffee_qty_0: '2', raw_coffee_unit_0: 'oz',
      raw_coffee_item_id_1: 'coffee', raw_coffee_qty_1: '3', raw_coffee_unit_1: 'oz',
      raw_coffee_item_id_3: 'coffee', raw_coffee_qty_3: '1', raw_coffee_unit_3: 'lb',
      extra_item_id_0: 'coffee', extra_qty_0: '4', extra_unit_0: 'oz', extra_note_0: 'First note',
      extra_item_id_2: 'coffee', extra_qty_2: '5', extra_unit_2: 'oz', extra_note_2: 'Updated note',
      extra_item_id_3: 'coffee', extra_qty_3: '1', extra_unit_3: 'oz',
    });
    expect(components).toEqual([
      { inventory_item_id: 'coffee', quantity: 5, unit: 'oz', component_role: 'raw_coffee', sort_order: 0, notes: 'Raw coffee' },
      { inventory_item_id: 'coffee', quantity: 1, unit: 'lb', component_role: 'raw_coffee', sort_order: 1, notes: 'Raw coffee' },
      { inventory_item_id: 'coffee', quantity: 10, unit: 'oz', component_role: 'material_supply', sort_order: 2, notes: 'Updated note' },
    ]);
  });

  it.each(['output_qty', 'waste_percent', 'labor_minutes', 'labor_rate', 'shipping_label_qty', 'branding_label_qty', 'raw_coffee_qty_0', 'extra_qty_0', 'box_qty'])
    ('rejects negative and nonfinite values in %s', (field) => {
      for (const value of ['-1', 'Infinity', 'NaN', '2 ounces']) {
        expect(parseProductRecipe(recipeForm({ [field]: value }))).toMatchObject({ ok: false, error: expect.any(String) });
      }
    });

  it.each([
    ['raw_coffee_item_id_0', 'raw_coffee_qty_0'],
    ['extra_item_id_0', 'extra_qty_0'],
    ['fraction_bag_item_id', 'fraction_bag_qty'],
    ['box_item_id', 'box_qty'],
    ['filter_pack_item_id', 'filter_pack_qty'],
    ['bag_item_id', 'bag_qty'],
  ])('requires both item and positive quantity for %s', (itemField, quantityField) => {
    expect(parseProductRecipe(recipeForm({ [itemField]: 'item' })))
      .toMatchObject({ ok: false, error: expect.stringContaining('quantity greater than zero') });
    expect(parseProductRecipe(recipeForm({ [itemField]: 'item', [quantityField]: '0' })))
      .toMatchObject({ ok: false, error: expect.stringContaining('quantity greater than zero') });
    expect(parseProductRecipe(recipeForm({ [quantityField]: '1' })))
      .toMatchObject({ ok: false, error: expect.stringContaining('Choose an inventory item') });
  });

  it.each(['fraction_bag', 'box', 'filter_pack', 'bag'])('rejects fractional %s packaging quantities', (role) => {
    expect(parseProductRecipe(recipeForm({ [`${role}_item_id`]: 'packaging', [`${role}_qty`]: '1.5' })))
      .toMatchObject({ ok: false, error: expect.stringContaining('whole number') });
  });

  it('rejects incompatible raw coffee units and unknown supply units', () => {
    expect(parseProductRecipe(recipeForm({ raw_coffee_item_id_0: 'coffee', raw_coffee_qty_0: '1', raw_coffee_unit_0: 'each' })))
      .toEqual({ ok: false, error: 'Raw coffee 1 must use oz or lb.' });
    expect(parseProductRecipe(recipeForm({ extra_item_id_0: 'supply', extra_qty_0: '1', extra_unit_0: 'gallon' })))
      .toMatchObject({ ok: false, error: expect.stringContaining('Extra material 1 must use') });
  });

  it('rejects overflow after converting dollars and combining quantities', () => {
    expect(parseProductRecipe(recipeForm({ labor_rate: '1e308' }))).toEqual({ ok: false, error: 'Labor rate is too large.' });
    expect(parseProductRecipe(recipeForm({
      raw_coffee_item_id_0: 'coffee', raw_coffee_qty_0: '1e308',
      raw_coffee_item_id_1: 'coffee', raw_coffee_qty_1: '1e308',
    }))).toEqual({ ok: false, error: 'Raw coffee 2 quantity is too large.' });
  });
});

function fakeSupabase({ recipeError = null, componentError = null, recipeId = 'recipe-id' }: {
  recipeError?: { message: string } | null;
  componentError?: { message: string } | null;
  recipeId?: string | null;
} = {}) {
  const single = vi.fn().mockResolvedValue({ data: recipeId ? { id: recipeId } : null, error: recipeError });
  const select = vi.fn().mockReturnValue({ single });
  const insertRecipe = vi.fn().mockReturnValue({ select });
  const insertComponents = vi.fn().mockResolvedValue({ error: componentError });
  const from = vi.fn((table: string) => {
    if (table === 'product_recipes') return { insert: insertRecipe };
    if (table === 'product_recipe_components') return { insert: insertComponents };
    throw new Error(`Unexpected table: ${table}`);
  });
  return { client: { from } as unknown as SupabaseClient<Database>, insertRecipe, insertComponents, single, select };
}

describe('saving a new product recipe', () => {
  it('persists recipe values and attaches every component to the returned recipe ID', async () => {
    const parsed = parsedRecipe({
      raw_coffee_item_id_0: 'coffee', raw_coffee_qty_0: '12',
      box_item_id: 'box', box_qty: '1',
      labor_minutes: '3', labor_rate: '20',
    });
    const db = fakeSupabase();
    expect(await saveNewProductRecipe(db.client, 'new-product', parsed)).toEqual({ error: null });
    expect(db.insertRecipe).toHaveBeenCalledExactlyOnceWith({ product_id: 'new-product', ...parsed.recipe });
    expect(db.select).toHaveBeenCalledExactlyOnceWith('id');
    expect(db.insertComponents).toHaveBeenCalledExactlyOnceWith([
      { inventory_item_id: 'coffee', quantity: 12, unit: 'oz', component_role: 'raw_coffee', sort_order: 0, notes: 'Raw coffee', recipe_id: 'recipe-id' },
      { inventory_item_id: 'box', quantity: 1, unit: 'each', component_role: 'box', sort_order: 1, notes: 'Box', recipe_id: 'recipe-id' },
    ]);
  });

  it('skips the component insert for an empty recipe', async () => {
    const db = fakeSupabase();
    expect(await saveNewProductRecipe(db.client, 'new-product', parsedRecipe())).toEqual({ error: null });
    expect(db.insertComponents).not.toHaveBeenCalled();
  });

  it('reports a recipe insert failure before attempting components', async () => {
    const error = { message: 'Recipe insert denied' };
    const db = fakeSupabase({ recipeError: error });
    const parsed = parsedRecipe({ box_item_id: 'box', box_qty: '1' });
    expect(await saveNewProductRecipe(db.client, 'new-product', parsed)).toEqual({ error });
    expect(db.insertComponents).not.toHaveBeenCalled();
  });

  it('reports a missing recipe record even without a database error', async () => {
    const db = fakeSupabase({ recipeId: null });
    expect(await saveNewProductRecipe(db.client, 'new-product', parsedRecipe()))
      .toEqual({ error: { message: 'The product recipe could not be saved.' } });
    expect(db.insertComponents).not.toHaveBeenCalled();
  });

  it('returns component failures to the caller so it can roll back the new product', async () => {
    const error = { message: 'Inventory item no longer exists' };
    const db = fakeSupabase({ componentError: error });
    const parsed = parsedRecipe({ box_item_id: 'box', box_qty: '1' });
    expect(await saveNewProductRecipe(db.client, 'new-product', parsed)).toEqual({ error });
  });

  it('propagates unexpected persistence failures to the caller', async () => {
    const db = fakeSupabase();
    db.single.mockRejectedValue(new Error('Connection interrupted'));
    await expect(saveNewProductRecipe(db.client, 'new-product', parsedRecipe())).rejects.toThrow('Connection interrupted');
  });
});

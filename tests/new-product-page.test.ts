import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  requireView: vi.fn(),
  requireWrite: vi.fn(),
  revalidate: vi.fn(),
  routerPush: vi.fn(),
  from: vi.fn(),
  inventorySelect: vi.fn(),
  inventoryNotEqual: vi.fn(),
  inventoryEqual: vi.fn(),
  inventoryOrder: vi.fn(),
  insertProduct: vi.fn(),
  insertRecipe: vi.fn(),
  insertComponents: vi.fn(),
  removeProduct: vi.fn(),
  syncProducts: vi.fn(),
  events: [] as string[],
}));

vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.requireView }));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.requireWrite }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: state.from }) }));
vi.mock('@/lib/quickbooks', () => ({ createMissingQuickBooksProductsFromPortal: state.syncProducts }));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.routerPush, refresh: vi.fn() }),
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
}));
vi.mock('next/link', () => ({ default: 'a' }));

import NewProductPage from '@/app/admin/products/new/page';
import NewProductForm from '@/components/new-product-form';

type FormProps = ComponentProps<typeof NewProductForm>;
const PRODUCT_ID = '5e5ff3bf-9f5c-407b-bd6b-ad050bf50f2c';
const RECIPE_ID = 'ccfb3d81-a825-45b1-b631-3b3d27b2d740';
const product = {
  id: PRODUCT_ID,
  name: 'House coffee 2 lb',
  sku: 'WB-HOUSE-2',
  description: 'House blend',
  active: true,
  quickbooks_item_id: null,
};
const items = [
  { id: 'raw-coffee', name: 'House roasted coffee', sku: 'RAW-HOUSE', item_type: 'raw_coffee', base_unit: 'lb', active: true },
  { id: 'bag', name: 'Two pound bag', sku: 'SUP-2LB-BAG', item_type: 'material_supply', base_unit: 'each', active: true },
  { id: 'box', name: 'Shipping box', sku: 'BOX-SMALL', item_type: 'material_supply', base_unit: 'each', active: true },
];

function formElement(node: ReactNode): ReactElement<FormProps> | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) {
    if (Array.isArray(node)) return node.map(formElement).find(Boolean);
    return undefined;
  }
  if (node.type === NewProductForm) return node as ReactElement<FormProps>;
  return Children.toArray(node.props.children).map(formElement).find(Boolean);
}

async function createAction() {
  const element = formElement(await NewProductPage({ searchParams: Promise.resolve({}) }));
  if (!element) throw new Error('The new product page must render its creation form.');
  return element.props.action;
}

function productForm() {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    name: product.name,
    sku: product.sku,
    description: product.description,
    category: 'whole_bean',
    active: 'on',
    shipping_box_count_required: 'on',
    output_qty: '2',
    waste_percent: '3',
    labor_minutes: '10',
    labor_rate: '18.50',
    shipping_label_qty: '1',
    branding_label_qty: '2',
    raw_coffee_item_id_0: 'raw-coffee',
    raw_coffee_qty_0: '4',
    raw_coffee_unit_0: 'lb',
    bag_item_id: 'bag',
    bag_qty: '2',
    box_item_id: 'box',
    box_qty: '1',
    recipe_notes: 'Package each finished unit in a two pound bag.',
  })) form.set(name, value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  state.events = [];
  state.requireView.mockResolvedValue({});
  state.requireWrite.mockResolvedValue({});
  state.inventoryOrder.mockResolvedValue({ data: items, error: null });
  const inventoryQuery = {
    select: state.inventorySelect,
    neq: state.inventoryNotEqual,
    eq: state.inventoryEqual,
    order: state.inventoryOrder,
  };
  state.inventorySelect.mockReturnValue(inventoryQuery);
  state.inventoryNotEqual.mockReturnValue(inventoryQuery);
  state.inventoryEqual.mockReturnValue(inventoryQuery);
  state.insertProduct.mockImplementation(() => {
    state.events.push('product');
    return { select: () => ({ single: async () => ({ data: product, error: null }) }) };
  });
  state.insertRecipe.mockImplementation(() => {
    state.events.push('recipe');
    return { select: () => ({ single: async () => ({ data: { id: RECIPE_ID }, error: null }) }) };
  });
  state.insertComponents.mockImplementation(async () => {
    state.events.push('components');
    return { error: null };
  });
  state.removeProduct.mockImplementation(() => {
    state.events.push('cleanup');
    return { select: () => ({ single: async () => ({ data: { id: PRODUCT_ID }, error: null }) }) };
  });
  state.syncProducts.mockImplementation(async () => {
    state.events.push('quickbooks');
    return { productErrorCount: 0, createdCount: 1 };
  });
  state.from.mockImplementation((table: string) => {
    if (table === 'inventory_items') return inventoryQuery;
    if (table === 'products') return {
      insert: state.insertProduct,
      delete: () => ({ eq: state.removeProduct }),
    };
    if (table === 'product_recipes') return { insert: state.insertRecipe };
    if (table === 'product_recipe_components') return { insert: state.insertComponents };
    throw new Error(`Unexpected Supabase table: ${table}`);
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('new product setup', () => {
  it('puts product details, ingredients, packaging, and all COGS fields in the same creation form', async () => {
    const markup = renderToStaticMarkup(await NewProductPage({ searchParams: Promise.resolve({}) }));
    expect(state.requireView).toHaveBeenCalledWith('products');
    expect(state.inventoryNotEqual).toHaveBeenCalledWith('item_type', 'finished_good');
    expect(state.inventoryEqual).toHaveBeenCalledWith('active', true);
    const forms = [...markup.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([html]) => html);
    expect(forms).toHaveLength(1);
    const form = forms[0];
    for (const name of [
      'name', 'sku', 'description', 'category', 'active', 'receivable_finished_good', 'shipping_box_count_required',
      'output_qty', 'waste_percent', 'labor_minutes', 'labor_rate', 'shipping_label_qty', 'branding_label_qty', 'recipe_notes',
      'fraction_bag_item_id', 'fraction_bag_qty', 'box_item_id', 'box_qty', 'filter_pack_item_id', 'filter_pack_qty', 'bag_item_id', 'bag_qty',
    ]) expect(form).toContain(`name="${name}"`);
    for (const index of [0, 1, 2, 3]) {
      for (const prefix of ['raw_coffee_item_id', 'raw_coffee_qty', 'raw_coffee_unit', 'extra_item_id', 'extra_qty', 'extra_unit', 'extra_note']) {
        expect(form).toContain(`name="${prefix}_${index}"`);
      }
    }
    expect(form).toContain('House roasted coffee (RAW-HOUSE)');
    expect(form).toContain('Two pound bag (SUP-2LB-BAG)');
    expect(form).toContain('Create product');
    expect(form).not.toContain('Save product recipe');
  });

  it('shows an ingredient load error and withholds the creation form when inventory cannot load', async () => {
    state.inventoryOrder.mockResolvedValue({ data: null, error: { message: 'Inventory unavailable' } });
    const markup = renderToStaticMarkup(await NewProductPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain('<form');
    expect(state.insertProduct).not.toHaveBeenCalled();
  });
});

describe('new product submission', () => {
  it('saves the selected recipe and quantities before syncing the new product to QuickBooks', async () => {
    const action = await createAction();
    const result = await action(productForm());
    expect(state.requireWrite).toHaveBeenCalledWith(expect.stringContaining('admin_write_denied'), 'products');
    expect(state.events).toEqual(['product', 'recipe', 'components', 'quickbooks']);
    expect(state.insertProduct).toHaveBeenCalledWith(expect.objectContaining({
      name: product.name, sku: product.sku, active: true, shipping_box_count_required: true,
    }));
    expect(state.insertRecipe).toHaveBeenCalledWith(expect.objectContaining({
      product_id: PRODUCT_ID, output_qty: 2, waste_percent: 3, labor_minutes: 10, labor_rate_cents: 1850,
      shipping_label_qty: 1, branding_label_qty: 2, notes: 'Package each finished unit in a two pound bag.',
    }));
    expect(state.insertComponents).toHaveBeenCalledWith([
      expect.objectContaining({ recipe_id: RECIPE_ID, inventory_item_id: 'raw-coffee', quantity: 4, unit: 'lb', component_role: 'raw_coffee' }),
      expect.objectContaining({ recipe_id: RECIPE_ID, inventory_item_id: 'box', quantity: 1, unit: 'each', component_role: 'box' }),
      expect.objectContaining({ recipe_id: RECIPE_ID, inventory_item_id: 'bag', quantity: 2, unit: 'each', component_role: 'bag' }),
    ]);
    expect(result).toEqual(expect.objectContaining({ successHref: `/admin/products/${PRODUCT_ID}?toast=created_quickbooks_synced` }));
    expect(result.error).toBeUndefined();
    expect(state.revalidate).toHaveBeenCalledWith('/admin/products');
  });

  it('cleans up a product after recipe failure and returns an error so the creation form stays available', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.insertComponents.mockImplementation(async () => {
      state.events.push('components');
      return { error: { message: 'Recipe components could not be saved.' } };
    });
    const action = await createAction();
    const result = await action(productForm());
    expect(state.events).toEqual(['product', 'recipe', 'components', 'cleanup']);
    expect(state.removeProduct).toHaveBeenCalledWith('id', PRODUCT_ID);
    expect(result.error).toEqual(expect.any(String));
    expect(result.successHref).toBeUndefined();
    expect(result.productId).toBeUndefined();
    expect(state.syncProducts).not.toHaveBeenCalled();
  });

  it('returns the saved product ID if cleanup fails, allowing recovery without another product insert', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.insertComponents.mockResolvedValue({ error: { message: 'Could not save recipe.' } });
    state.removeProduct.mockReturnValue({
      select: () => ({ single: async () => ({ data: null, error: { message: 'Could not clean up product.' } }) }),
    });
    const action = await createAction();
    const result = await action(productForm());
    expect(result).toEqual(expect.objectContaining({ error: expect.any(String), productId: PRODUCT_ID }));
    expect(result.successHref).toBeUndefined();
    expect(state.syncProducts).not.toHaveBeenCalled();
  });

  it('rejects partial ingredient entries before creating any product', async () => {
    const action = await createAction();
    const form = productForm();
    form.delete('raw_coffee_qty_0');
    const result = await action(form);
    expect(result.error).toContain('quantity');
    expect(state.insertProduct).not.toHaveBeenCalled();
    expect(state.syncProducts).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProductWithQuickBooks, syncSavedProductToQuickBooks } from '@/lib/product-create';
import type { QuickBooksPortalProduct } from '@/lib/quickbooks';

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const savedProduct: QuickBooksPortalProduct = {
  id: PRODUCT_ID,
  name: 'Saved coffee name',
  sku: 'COFFEE-12',
  description: '12 oz bag',
  active: true,
  quickbooks_item_id: null,
};

function productForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const values = { name: '  Coffee  ', sku: '  COFFEE-12  ', description: '  12 oz bag  ', category: ' retail ', active: 'on', ...overrides };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

const saveRecipe = vi.fn(async () => ({ error: null }));
const removeProduct = vi.fn(async () => ({ error: null }));

afterEach(() => { vi.restoreAllMocks(); saveRecipe.mockClear(); removeProduct.mockClear(); });

describe('new product with automatic QuickBooks sync', () => {
  it('saves validated fields first, then syncs the returned database record and ID', async () => {
    const events: string[] = [];
    const insertProduct = vi.fn(async () => {
      events.push('saved');
      return { data: savedProduct, error: null };
    });
    const syncProducts = vi.fn(async () => {
      events.push('synced');
      return { createdCount: 1, productErrorCount: 0 };
    });
    const result = await createProductWithQuickBooks(productForm(), { insertProduct, saveRecipe, removeProduct, syncProducts });

    expect(insertProduct).toHaveBeenCalledWith({ name: 'Coffee', sku: 'COFFEE-12', description: '12 oz bag', category: 'retail', active: true, receivable_finished_good: false, shipping_box_count_required: false });
    expect(saveRecipe).toHaveBeenCalledWith(PRODUCT_ID, expect.objectContaining({ recipe: expect.objectContaining({ output_qty: 1 }), components: [] }));
    expect(removeProduct).not.toHaveBeenCalled();
    expect(syncProducts).toHaveBeenCalledWith([savedProduct]);
    expect(events).toEqual(['saved', 'synced']);
    expect(result).toEqual({ ok: true, productId: PRODUCT_ID, syncStatus: 'synced' });
  });

  it.each([
    [{ name: '  ' }, 'invalid_name'],
    [{ sku: '\n\t' }, 'invalid_sku'],
    [{ category: 'missing-category' }, 'invalid_category'],
  ])('rejects invalid fields before either persistence or QuickBooks work: %j', async (overrides, error) => {
    const insertProduct = vi.fn();
    const syncProducts = vi.fn();
    expect(await createProductWithQuickBooks(productForm(overrides), { insertProduct, saveRecipe, removeProduct, syncProducts })).toEqual({ ok: false, error });
    expect(insertProduct).not.toHaveBeenCalled();
    expect(syncProducts).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: '23505' }, 'duplicate_sku'],
    [{ code: '42501' }, 'create_failed'],
    [null, 'create_failed'],
  ])('never syncs without a successfully saved product: %j', async (error, expected) => {
    const insertProduct = vi.fn().mockResolvedValue({ data: null, error });
    const syncProducts = vi.fn();
    expect(await createProductWithQuickBooks(productForm(), { insertProduct, saveRecipe, removeProduct, syncProducts })).toEqual({ ok: false, error: expected });
    expect(syncProducts).not.toHaveBeenCalled();
  });

  it('preserves the saved ID and can retry sync without inserting another product', async () => {
    const insertProduct = vi.fn().mockResolvedValue({ data: savedProduct, error: null });
    const syncProducts = vi.fn()
      .mockResolvedValueOnce({ createdCount: 0, productErrorCount: 1 })
      .mockResolvedValueOnce({ createdCount: 1, productErrorCount: 0 });
    expect(await createProductWithQuickBooks(productForm(), { insertProduct, saveRecipe, removeProduct, syncProducts }))
      .toEqual({ ok: true, productId: PRODUCT_ID, syncStatus: 'needs_attention' });

    expect(await syncSavedProductToQuickBooks(savedProduct, syncProducts)).toBe('synced');
    expect(insertProduct).toHaveBeenCalledTimes(1);
    expect(syncProducts).toHaveBeenNthCalledWith(2, [savedProduct]);
  });

  it('treats disconnected QuickBooks as a partial success with the saved product ID', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const insertProduct = vi.fn().mockResolvedValue({ data: savedProduct, error: null });
    const syncProducts = vi.fn().mockRejectedValue(new Error('QuickBooks is not connected'));
    expect(await createProductWithQuickBooks(productForm(), { insertProduct, saveRecipe, removeProduct, syncProducts }))
      .toEqual({ ok: true, productId: PRODUCT_ID, syncStatus: 'needs_attention' });
  });

  it('does not report success when QuickBooks silently skips an unmapped product', async () => {
    const syncProducts = vi.fn().mockResolvedValue({ createdCount: 0, productErrorCount: 0 });
    expect(await syncSavedProductToQuickBooks(savedProduct, syncProducts)).toBe('needs_attention');
  });

  it('returns success for an already linked product without another create request', async () => {
    const syncProducts = vi.fn();
    expect(await syncSavedProductToQuickBooks({ ...savedProduct, quickbooks_item_id: '217' }, syncProducts)).toBe('synced');
    expect(syncProducts).not.toHaveBeenCalled();
  });
});

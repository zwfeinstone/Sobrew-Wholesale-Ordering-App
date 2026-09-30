import { isProductCategory, type ProductCategory } from '@/lib/product-categories';
import { parseProductRecipe, type ParsedProductRecipe } from '@/lib/product-recipe';
import type { QuickBooksPortalProduct, QuickBooksProductCreateResult } from '@/lib/quickbooks';

type NewProductInput = {
  name: string;
  sku: string;
  description: string | null;
  category: ProductCategory;
  active: boolean;
  receivable_finished_good: boolean;
  shipping_box_count_required: boolean;
};

type ProductSync = (products: QuickBooksPortalProduct[]) => Promise<QuickBooksProductCreateResult>;
type ProductCreateError = 'invalid_name' | 'invalid_sku' | 'invalid_category' | 'invalid_recipe' | 'duplicate_sku' | 'create_failed' | 'recipe_save_failed';
export type ProductSyncStatus = 'synced' | 'needs_attention';
export type ProductCreateResult =
  | { ok: false; error: ProductCreateError; message?: string; productId?: string }
  | { ok: true; productId: string; syncStatus: ProductSyncStatus };

export async function syncSavedProductToQuickBooks(product: QuickBooksPortalProduct, syncProducts: ProductSync): Promise<ProductSyncStatus> {
  if (product.quickbooks_item_id?.trim()) return 'synced';
  try {
    const result = await syncProducts([product]);
    return result.productErrorCount === 0 && result.createdCount > 0 ? 'synced' : 'needs_attention';
  } catch (error) {
    console.error('[admin-products] saved product QuickBooks sync failed', { productId: product.id, error });
    return 'needs_attention';
  }
}

export async function createProductWithQuickBooks(
  formData: FormData,
  {
    insertProduct,
    saveRecipe,
    removeProduct,
    syncProducts,
  }: {
    insertProduct: (input: NewProductInput) => Promise<{
      data: QuickBooksPortalProduct | null;
      error: { code?: string } | null;
    }>;
    saveRecipe: (productId: string, recipe: ParsedProductRecipe) => Promise<{ error: { message: string } | null }>;
    removeProduct: (productId: string) => Promise<{ error: { message: string } | null }>;
    syncProducts: ProductSync;
  }
): Promise<ProductCreateResult> {
  const name = String(formData.get('name') ?? '').trim();
  const sku = String(formData.get('sku') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  if (!name) return { ok: false, error: 'invalid_name' };
  if (!sku) return { ok: false, error: 'invalid_sku' };
  if (!isProductCategory(category)) return { ok: false, error: 'invalid_category' };
  const parsedRecipe = parseProductRecipe(formData);
  if (!parsedRecipe.ok) return { ok: false, error: 'invalid_recipe', message: parsedRecipe.error };

  let product: QuickBooksPortalProduct;
  try {
    const { data, error } = await insertProduct({
      name,
      sku,
      category,
      description: String(formData.get('description') ?? '').trim() || null,
      active: formData.get('active') === 'on',
      receivable_finished_good: formData.get('receivable_finished_good') === 'on',
      shipping_box_count_required: formData.get('shipping_box_count_required') === 'on',
    });
    if (error || !data?.id) return { ok: false, error: error?.code === '23505' ? 'duplicate_sku' : 'create_failed' };
    product = data;
  } catch (error) {
    console.error('[admin-products] product creation failed', { error });
    return { ok: false, error: 'create_failed' };
  }

  try {
    const { error } = await saveRecipe(product.id, parsedRecipe);
    if (error) throw error;
  } catch (error) {
    console.error('[admin-products] new product recipe failed', { productId: product.id, error });
    // This product has not reached QuickBooks. Deleting it also removes its new recipe.
    // Keep the submitted form available for correction/retry after a failed save.
    try {
      const { error: cleanupError } = await removeProduct(product.id);
      if (cleanupError) throw cleanupError;
    } catch (cleanupError) {
      console.error('[admin-products] incomplete product cleanup failed', { productId: product.id, error: cleanupError });
      return { ok: false, error: 'recipe_save_failed', productId: product.id };
    }
    return { ok: false, error: 'recipe_save_failed' };
  }

  // Once saved, every outcome returns to this product. A sync retry must never insert it again.
  const syncStatus = await syncSavedProductToQuickBooks(product, syncProducts);
  return { ok: true, productId: product.id, syncStatus };
}

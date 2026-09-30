import { isProductCategory, type ProductCategory } from '@/lib/product-categories';
import type { QuickBooksPortalProduct, QuickBooksProductCreateResult } from '@/lib/quickbooks';

type NewProductInput = {
  name: string;
  sku: string;
  description: string | null;
  category: ProductCategory;
};

type ProductSync = (products: QuickBooksPortalProduct[]) => Promise<QuickBooksProductCreateResult>;
type ProductCreateError = 'invalid_name' | 'invalid_sku' | 'invalid_category' | 'duplicate_sku' | 'create_failed';
export type ProductSyncStatus = 'synced' | 'needs_attention';
export type ProductCreateResult =
  | { ok: false; error: ProductCreateError }
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
    syncProducts,
  }: {
    insertProduct: (input: NewProductInput) => Promise<{
      data: QuickBooksPortalProduct | null;
      error: { code?: string } | null;
    }>;
    syncProducts: ProductSync;
  }
): Promise<ProductCreateResult> {
  const name = String(formData.get('name') ?? '').trim();
  const sku = String(formData.get('sku') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  if (!name) return { ok: false, error: 'invalid_name' };
  if (!sku) return { ok: false, error: 'invalid_sku' };
  if (!isProductCategory(category)) return { ok: false, error: 'invalid_category' };

  let product: QuickBooksPortalProduct;
  try {
    const { data, error } = await insertProduct({
      name,
      sku,
      category,
      description: String(formData.get('description') ?? '').trim() || null,
    });
    if (error || !data?.id) return { ok: false, error: error?.code === '23505' ? 'duplicate_sku' : 'create_failed' };
    product = data;
  } catch (error) {
    console.error('[admin-products] product creation failed', { error });
    return { ok: false, error: 'create_failed' };
  }

  // Once saved, every outcome returns to this product. A sync retry must never insert it again.
  const syncStatus = await syncSavedProductToQuickBooks(product, syncProducts);
  return { ok: true, productId: product.id, syncStatus };
}

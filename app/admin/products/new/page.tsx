import { revalidatePath } from 'next/cache';
import NewProductForm, { type NewProductFormResult } from '@/components/new-product-form';
import type { ProductRecipeInventoryItem } from '@/components/product-recipe-fields';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { createProductWithQuickBooks } from '@/lib/product-create';
import { saveNewProductRecipe } from '@/lib/product-recipe';
import { createMissingQuickBooksProductsFromPortal } from '@/lib/quickbooks';
import { createClient } from '@/lib/supabase/server';

const ERROR_MESSAGES: Record<string, string> = {
  admin_write_denied: 'You do not have permission to create products.',
  invalid_name: 'Enter a product name before saving.',
  invalid_sku: 'Enter a SKU before saving.',
  invalid_category: 'Choose a product category before saving.',
  invalid_recipe: 'Review the recipe quantities before saving.',
  duplicate_sku: 'A product with this SKU already exists. Open the existing product to review it.',
  create_failed: 'The product could not be saved. Review the catalog before trying again.',
  recipe_save_failed: 'The recipe could not be saved, so the new product was removed. Your entries are still here; please try again.',
};

async function createProduct(formData: FormData): Promise<NewProductFormResult> {
  'use server';
  await requireAdminWriteAccess('/admin/products/new?error=admin_write_denied', 'products');

  const supabase = await createClient();
  const result = await createProductWithQuickBooks(formData, {
    insertProduct: async (input) => supabase.from('products').insert(input)
      .select('id,name,sku,description,active,quickbooks_item_id').single(),
    saveRecipe: (productId, recipe) => saveNewProductRecipe(supabase, productId, recipe),
    removeProduct: async (productId) => {
      const { data, error } = await supabase.from('products').delete().eq('id', productId).select('id').single();
      return { error: error ?? (data ? null : { message: 'Product cleanup could not be confirmed.' }) };
    },
    syncProducts: createMissingQuickBooksProductsFromPortal,
  });
  if (!result.ok) {
    if (result.productId) {
      revalidatePath('/admin/products');
      return { error: 'The product was created, but its recipe could not be completed. Open the saved product to finish setup before creating another.', productId: result.productId };
    }
    return { error: result.message ?? ERROR_MESSAGES[result.error] };
  }
  revalidatePath('/admin/products');
  revalidatePath('/admin/invoicing');
  revalidatePath('/admin/inventory');
  revalidatePath('/admin/production');
  return { successHref: `/admin/products/${result.productId}?toast=${result.syncStatus === 'synced' ? 'created_quickbooks_synced' : 'created_quickbooks_attention'}` };
}

export default async function NewProductPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  await requireAdminSectionView('products');
  const supabase = await createClient();
  const { data: items, error: inventoryError } = await supabase.from('inventory_items')
    .select('id,name,sku,item_type,base_unit,active').neq('item_type', 'finished_good').eq('active', true).order('name', { ascending: true });
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Catalog Admin</span>
        <h1 className="page-title mt-4">Create a new product</h1>
        <p className="page-subtitle mt-3">Set up the product, ingredients, and COGS in one place. We’ll also create its matching product in QuickBooks.</p>
      </section>
      {inventoryError ? <div className="card text-sm text-red-700" role="alert">Ingredients and materials could not be loaded. Refresh this page to try again.</div> : (
        <NewProductForm action={createProduct} inventoryItems={(items ?? []) as ProductRecipeInventoryItem[]} initialError={ERROR_MESSAGES[error]} />
      )}
    </div>
  );
}

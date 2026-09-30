import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import PendingSubmitButton from '@/components/pending-submit-button';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { PRODUCT_CATEGORY_OPTIONS } from '@/lib/product-categories';
import { createProductWithQuickBooks } from '@/lib/product-create';
import { createMissingQuickBooksProductsFromPortal } from '@/lib/quickbooks';
import { createClient } from '@/lib/supabase/server';

async function createProduct(formData: FormData) {
  'use server';
  await requireAdminWriteAccess('/admin/products/new?error=admin_write_denied', 'products');

  const supabase = await createClient();
  const result = await createProductWithQuickBooks(formData, {
    insertProduct: async (input) => supabase.from('products').insert(input)
      .select('id,name,sku,description,active,quickbooks_item_id').single(),
    syncProducts: createMissingQuickBooksProductsFromPortal,
  });
  if (!result.ok) redirect(`/admin/products/new?error=${result.error}`);
  revalidatePath('/admin/products');
  revalidatePath('/admin/invoicing');
  redirect(`/admin/products/${result.productId}?toast=${result.syncStatus === 'synced' ? 'created_quickbooks_synced' : 'created_quickbooks_attention'}`);
}

export default async function NewProductPage(
  props: {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
  }
) {
  const searchParams = await props.searchParams;
  await requireAdminSectionView('products');
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';
  const errorMessage = {
    admin_write_denied: 'You do not have permission to create products.',
    invalid_name: 'Enter a product name before saving.',
    invalid_sku: 'Enter a SKU before saving.',
    invalid_category: 'Choose a product category before saving.',
    duplicate_sku: 'A product with this SKU already exists. Open the existing product to review it.',
    create_failed: 'The product could not be saved. Review the catalog before trying again.',
  }[error] ?? '';

  return (
    <form action={createProduct} className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Catalog Admin</span>
        <h1 className="page-title mt-4">Create a new product</h1>
        <p className="page-subtitle mt-3">Add a new catalog item. We’ll also create its matching product in QuickBooks.</p>
      </section>
      {errorMessage ? (
        <div className="card text-sm text-red-700" role="alert">
          {errorMessage}
        </div>
      ) : null}
      <section className="card space-y-4">
        <input className="input" name="name" required placeholder="Name" />
        <input className="input" name="sku" required placeholder="SKU" />
        <select className="input" name="category" required defaultValue="">
          <option value="" disabled>Select product category</option>
          {PRODUCT_CATEGORY_OPTIONS.map((category) => (
            <option key={category.value} value={category.value}>{category.label}</option>
          ))}
        </select>
        <textarea className="input min-h-28" name="description" placeholder="Description" />
        <PendingSubmitButton className="btn-primary" label="Create product" pendingLabel="Creating and syncing..." />
      </section>
    </form>
  );
}

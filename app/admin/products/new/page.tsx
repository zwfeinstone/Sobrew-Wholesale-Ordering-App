import { redirect } from 'next/navigation';
import { PRODUCT_CATEGORY_OPTIONS, isProductCategory } from '@/lib/product-categories';
import { createClient } from '@/lib/supabase/server';

async function createProduct(formData: FormData) {
  'use server';
  const supabase = await createClient();
  const category = String(formData.get('category') ?? '');
  if (!isProductCategory(category)) redirect('/admin/products/new?error=invalid_category');

  await supabase.from('products').insert({
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    sku: String(formData.get('sku') ?? ''),
    category
  });
  redirect('/admin/products');
}

export default function NewProductPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';

  return (
    <form action={createProduct} className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Catalog Admin</span>
        <h1 className="page-title mt-4">Create a new product</h1>
        <p className="page-subtitle mt-3">Add a new item to the wholesale catalog with a clear name, SKU, and description.</p>
      </section>
      {error ? <div className="card text-sm text-red-700">Choose a product category before saving.</div> : null}
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
        <button className="btn-primary">Create</button>
      </section>
    </form>
  );
}

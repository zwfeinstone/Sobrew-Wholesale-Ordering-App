import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

async function createProduct(formData: FormData) {
  'use server';
  const supabase = await createClient();
  await supabase.from('products').insert({
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    sku: String(formData.get('sku') ?? '')
  });
  redirect('/admin/products');
}

export default function NewProductPage() {
  return (
    <form action={createProduct} className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Catalog Admin</span>
        <h1 className="page-title mt-4">Create a new product</h1>
        <p className="page-subtitle mt-3">Add a new item to the wholesale catalog with a clear name, SKU, and description.</p>
      </section>
      <section className="card space-y-4">
        <input className="input" name="name" required placeholder="Name" />
        <input className="input" name="sku" required placeholder="SKU" />
        <textarea className="input min-h-28" name="description" placeholder="Description" />
        <button className="btn-primary">Create</button>
      </section>
    </form>
  );
}

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
    <form action={createProduct} className="card space-y-3">
      <h1 className="text-2xl font-semibold">New product</h1>
      <input className="input" name="name" required placeholder="Name" />
      <input className="input" name="sku" required placeholder="SKU" />
      <textarea className="input" name="description" placeholder="Description" />
      <button className="btn-primary">Create</button>
    </form>
  );
}

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

async function updateProduct(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const supabase = await createClient();
  const file = formData.get('image') as File;
  let image_url;
  if (file?.size) {
    const path = `${id}/${Date.now()}-${file.name}`;
    await supabaseAdmin.storage.from('products').upload(path, file, { upsert: true });
    image_url = supabaseAdmin.storage.from('products').getPublicUrl(path).data.publicUrl;
  }
  await supabase.from('products').update({
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    active: formData.get('active') === 'on',
    ...(image_url ? { image_url } : {})
  }).eq('id', id);
  redirect(`/admin/products/${id}`);
}

async function removeProduct(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const supabase = await createClient();
  await supabase.from('products').delete().eq('id', id);
  redirect('/admin/products');
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: product } = await supabase.from('products').select('*').eq('id', params.id).single();
  if (!product) return notFound();
  return (
    <div className="space-y-4">
      <form action={updateProduct} className="card space-y-2">
        <input type="hidden" name="id" value={product.id} />
        <input className="input" name="name" defaultValue={product.name} required />
        <textarea className="input" name="description" defaultValue={product.description ?? ''} />
        <label><input type="checkbox" name="active" defaultChecked={product.active} /> Active</label>
        <input type="file" name="image" accept="image/*" />
        <button className="btn-primary">Save</button>
      </form>
      <form action={removeProduct}><input type="hidden" name="id" value={product.id} /><button className="rounded border px-3 py-2">Delete</button></form>
    </div>
  );
}

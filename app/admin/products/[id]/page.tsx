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
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Catalog Admin</span>
        <h1 className="page-title mt-4">Edit product</h1>
        <p className="page-subtitle mt-3">Update availability, refresh product copy, or upload a cleaner product image.</p>
      </section>
      <form action={updateProduct} className="card space-y-4">
        <input type="hidden" name="id" value={product.id} />
        <input className="input" name="name" defaultValue={product.name} required />
        <textarea className="input min-h-28" name="description" defaultValue={product.description ?? ''} />
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700"><input type="checkbox" name="active" defaultChecked={product.active} /> Active</label>
        <input className="input" type="file" name="image" accept="image/*" />
        <button className="btn-primary">Save</button>
      </form>
      <form action={removeProduct}><input type="hidden" name="id" value={product.id} /><button className="rounded-full border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition-all duration-200 hover:bg-rose-50">Delete</button></form>
    </div>
  );
}

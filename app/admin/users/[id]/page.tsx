import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCents } from '@/lib/utils';

async function updateUser(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const supabase = await createClient();
  await supabase.from('profiles').update({
    full_name: String(formData.get('full_name') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    is_active: formData.get('is_active') === 'on'
  }).eq('id', id);

  const selected = formData.getAll('product_id').map(String);
  await supabaseAdmin.from('user_products').delete().eq('user_id', id);
  if (selected.length) {
    await supabaseAdmin.from('user_products').insert(selected.map((product_id) => ({ user_id: id, product_id })));
    await supabaseAdmin.from('user_product_prices').upsert(
      selected.map((product_id) => ({ user_id: id, product_id, price_cents: toCents(String(formData.get(`price_${product_id}`) ?? '0')) })),
      { onConflict: 'user_id,product_id' }
    );
  }
  redirect(`/admin/users/${id}`);
}

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const supabase = await createClient();
  const [{ data: user }, { data: products }, { data: assigned }, { data: prices }] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', params.id).single(),
    supabase.from('products').select('id,name').eq('active', true),
    supabase.from('user_products').select('product_id').eq('user_id', params.id),
    supabase.from('user_product_prices').select('product_id,price_cents').eq('user_id', params.id)
  ]);
  if (!user) return notFound();
  const assignedSet = new Set((assigned ?? []).map((a) => a.product_id));
  const priceMap = new Map((prices ?? []).map((p) => [p.product_id, p.price_cents]));

  return (
    <form action={updateUser} className="space-y-3">
      <input type="hidden" name="id" value={user.id} />
      <h1 className="text-2xl font-semibold">{user.email}</h1>
      <input className="input" name="full_name" defaultValue={user.full_name ?? ''} />
      <textarea className="input" name="notes" defaultValue={user.notes ?? ''} />
      <label><input type="checkbox" name="is_active" defaultChecked={user.is_active} /> Active (uncheck to Deactivate)</label>
      <div className="card space-y-2">
        <h2 className="font-semibold">Product visibility + pricing</h2>
        {products?.map((p) => (
          <div key={p.id} className="grid grid-cols-2 gap-2">
            <label><input type="checkbox" name="product_id" value={p.id} defaultChecked={assignedSet.has(p.id)} /> {p.name}</label>
            <input className="input" name={`price_${p.id}`} type="number" step="0.01" min="0" defaultValue={((priceMap.get(p.id) ?? 0) / 100).toFixed(2)} />
          </div>
        ))}
      </div>
      <button className="btn-primary">Save</button>
    </form>
  );
}

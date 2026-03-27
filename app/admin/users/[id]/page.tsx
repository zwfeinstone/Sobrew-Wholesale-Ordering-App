import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCents } from '@/lib/utils';

async function updateUser(formData: FormData) {
  'use server';
  const id = String(formData.get('id'));
  const supabase = await createClient();
  const password = String(formData.get('password') ?? '');
  await supabase.from('profiles').update({
    full_name: String(formData.get('full_name') ?? ''),
    notes: String(formData.get('notes') ?? ''),
    is_active: formData.get('is_active') === 'on'
  }).eq('id', id);

  if (password) {
    await supabaseAdmin.auth.admin.updateUserById(id, { password });
  }

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
    <form action={updateUser} className="space-y-6">
      <input type="hidden" name="id" value={user.id} />
      <section className="panel">
        <span className="eyebrow">Customer Admin</span>
        <h1 className="page-title mt-4">{user.email}</h1>
        <p className="page-subtitle mt-3">Update customer details, deactivate access, and control which products and prices this center sees.</p>
      </section>
      <section className="card space-y-4">
        <input className="input" name="full_name" defaultValue={user.full_name ?? ''} />
        <textarea className="input min-h-28" name="notes" defaultValue={user.notes ?? ''} />
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Set new password</label>
          <input className="input" name="password" type="password" minLength={8} placeholder="Leave blank to keep current password" />
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700"><input type="checkbox" name="is_active" defaultChecked={user.is_active} /> Active (uncheck to deactivate)</label>
      </section>
      <div className="card space-y-4">
        <h2 className="text-xl font-semibold text-slate-950">Product visibility + pricing</h2>
        {products?.map((p) => (
          <div key={p.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 md:grid-cols-2">
            <label className="flex items-center gap-3 font-medium text-slate-900"><input type="checkbox" name="product_id" value={p.id} defaultChecked={assignedSet.has(p.id)} /> {p.name}</label>
            <input className="input" name={`price_${p.id}`} type="number" step="0.01" min="0" defaultValue={((priceMap.get(p.id) ?? 0) / 100).toFixed(2)} />
          </div>
        ))}
      </div>
      <button className="btn-primary">Save</button>
    </form>
  );
}

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCents } from '@/lib/utils';

async function syncCenterCatalog(centerId: string, formData: FormData) {
  const selected = formData.getAll('product_id').map(String);

  await supabaseAdmin.from('user_products').delete().eq('center_id', centerId);
  await supabaseAdmin.from('user_product_prices').delete().eq('center_id', centerId);

  if (!selected.length) {
    return;
  }

  await supabaseAdmin.from('user_products').insert(selected.map((product_id) => ({ center_id: centerId, product_id })));
  await supabaseAdmin.from('user_product_prices').upsert(
    selected.map((product_id) => ({
      center_id: centerId,
      product_id,
      price_cents: toCents(String(formData.get(`price_${product_id}`) ?? '0')),
    })),
    { onConflict: 'center_id,product_id' }
  );
}

async function updateCenter(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  if (!centerId) redirect('/admin/users');

  await supabaseAdmin
    .from('centers')
    .update({
      name: String(formData.get('name') ?? '').trim() || 'Unnamed center',
      notes: String(formData.get('notes') ?? ''),
      is_active: formData.get('is_active') === 'on',
    })
    .eq('id', centerId);

  await syncCenterCatalog(centerId, formData);
  redirect(`/admin/users/${centerId}?success=center_saved`);
}

async function addCenterLogin(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const full_name = String(formData.get('full_name') ?? '').trim();
  const password = String(formData.get('password') ?? '').trim();

  if (!centerId || !email || !password) {
    redirect(`/admin/users/${centerId}?error=login_missing`);
  }

  const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    redirect(`/admin/users/${centerId}?error=login_create_failed`);
  }

  await supabaseAdmin.from('profiles').upsert(
    {
      id: created.data.user.id,
      email,
      full_name,
      is_active: true,
      is_admin: false,
      center_id: centerId,
    },
    { onConflict: 'id' }
  );

  redirect(`/admin/users/${centerId}?success=login_added`);
}

async function updateCenterLogin(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  const memberId = String(formData.get('member_id') ?? '');
  if (!centerId || !memberId) redirect('/admin/users');

  await supabaseAdmin
    .from('profiles')
    .update({
      full_name: String(formData.get('full_name') ?? '').trim(),
      is_active: formData.get('is_active') === 'on',
    })
    .eq('id', memberId)
    .eq('center_id', centerId)
    .eq('is_admin', false);

  const password = String(formData.get('password') ?? '').trim();
  if (password) {
    await supabaseAdmin.auth.admin.updateUserById(memberId, { password });
  }

  redirect(`/admin/users/${centerId}?success=login_saved`);
}

async function removeCenterLogin(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  const memberId = String(formData.get('member_id') ?? '');
  if (!centerId || !memberId) redirect('/admin/users');

  await supabaseAdmin
    .from('profiles')
    .update({ center_id: null, is_active: false })
    .eq('id', memberId)
    .eq('center_id', centerId)
    .eq('is_admin', false);

  redirect(`/admin/users/${centerId}?success=login_removed`);
}

async function updateAdminAccount(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  if (!id) redirect('/admin/users');

  await supabaseAdmin
    .from('profiles')
    .update({
      full_name: String(formData.get('full_name') ?? ''),
      notes: String(formData.get('notes') ?? ''),
      is_active: formData.get('is_active') === 'on',
    })
    .eq('id', id)
    .eq('is_admin', true);

  const password = String(formData.get('password') ?? '');
  if (password) {
    await supabaseAdmin.auth.admin.updateUserById(id, { password });
  }

  redirect(`/admin/users/${id}?success=admin_saved`);
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const success = typeof searchParams?.success === 'string' ? searchParams.success : '';
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';

  const { data: center } = await supabase.from('centers').select('*').eq('id', params.id).maybeSingle();

  if (center) {
    const [{ data: products }, { data: assigned }, { data: prices }, { data: members }] = await Promise.all([
      supabase.from('products').select('id,name').eq('active', true),
      supabase.from('user_products').select('product_id').eq('center_id', center.id),
      supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', center.id),
      supabase
        .from('profiles')
        .select('id,email,full_name,is_active,created_at')
        .eq('center_id', center.id)
        .eq('is_admin', false)
        .order('created_at', { ascending: true }),
    ]);

    const assignedSet = new Set((assigned ?? []).map((row) => row.product_id));
    const priceMap = new Map((prices ?? []).map((row) => [row.product_id, row.price_cents]));

    return (
      <div className="space-y-6">
        {success === 'center_saved' ? <div className="card text-sm text-green-700">Center settings saved.</div> : null}
        {success === 'login_added' ? <div className="card text-sm text-green-700">Login added to center.</div> : null}
        {success === 'login_saved' ? <div className="card text-sm text-green-700">Login updated.</div> : null}
        {success === 'login_removed' ? <div className="card text-sm text-green-700">Login removed from center.</div> : null}
        {error ? <div className="card text-sm text-red-700">Could not complete that action ({error}).</div> : null}

        <section className="panel">
          <span className="eyebrow">Center Admin</span>
          <h1 className="page-title mt-4">{center.name}</h1>
          <p className="page-subtitle mt-3">Manage shared pricing, add or remove center logins, and keep center history intact even when staff changes.</p>
        </section>

        <form action={updateCenter} className="space-y-6">
          <input type="hidden" name="center_id" value={center.id} />
          <section className="card space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Center name</label>
                <input className="input" name="name" defaultValue={center.name ?? ''} />
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700">
                <input type="checkbox" name="is_active" defaultChecked={center.is_active} />
                Active center
              </label>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">Center notes</label>
              <textarea className="input min-h-28" name="notes" defaultValue={center.notes ?? ''} />
            </div>
          </section>

          <section className="card space-y-4">
            <h2 className="text-xl font-semibold text-slate-950">Shared product visibility + pricing</h2>
            {products?.map((product: any) => (
              <div key={product.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 md:grid-cols-2">
                <label className="flex items-center gap-3 font-medium text-slate-900">
                  <input type="checkbox" name="product_id" value={product.id} defaultChecked={assignedSet.has(product.id)} />
                  {product.name}
                </label>
                <input className="input" name={`price_${product.id}`} type="number" step="0.01" min="0" defaultValue={((priceMap.get(product.id) ?? 0) / 100).toFixed(2)} />
              </div>
            ))}
          </section>

          <button className="btn-primary">Save Center</button>
        </form>

        <section className="card space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Add login</h2>
            <p className="mt-1 text-sm text-slate-500">Create another login for this center. Every login will share the same catalog, order history, and recurring orders.</p>
          </div>
          <form action={addCenterLogin} className="grid gap-3 md:grid-cols-4">
            <input type="hidden" name="center_id" value={center.id} />
            <input className="input" name="full_name" placeholder="Login name" />
            <input className="input" name="email" type="email" required placeholder="Email address" />
            <input className="input" name="password" type="password" minLength={8} required placeholder="Temporary password" />
            <button className="btn-primary" type="submit">Add Login</button>
          </form>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Center logins</h2>
            <p className="mt-1 text-sm text-slate-500">Update login names, deactivate access, reset passwords, or remove a login from this center.</p>
          </div>
          {!members?.length ? <div className="card text-sm text-slate-600">No logins are attached to this center yet.</div> : null}
          {members?.map((member: any) => (
            <div key={member.id} className="card space-y-4">
              <div>
                <p className="text-lg font-semibold text-slate-950">{member.full_name || member.email}</p>
                <p className="mt-1 text-sm text-slate-500">{member.email}</p>
              </div>
              <form action={updateCenterLogin} className="grid gap-3 md:grid-cols-[1.2fr_1fr_auto_auto] md:items-center">
                <input type="hidden" name="center_id" value={center.id} />
                <input type="hidden" name="member_id" value={member.id} />
                <input className="input" name="full_name" defaultValue={member.full_name ?? ''} placeholder="Login name" />
                <input className="input" name="password" type="password" minLength={8} placeholder="Leave blank to keep password" />
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700">
                  <input type="checkbox" name="is_active" defaultChecked={member.is_active} />
                  Active
                </label>
                <button className="btn-primary" type="submit">Save Login</button>
              </form>
              <form action={removeCenterLogin}>
                <input type="hidden" name="center_id" value={center.id} />
                <input type="hidden" name="member_id" value={member.id} />
                <button className="btn-secondary" type="submit">Remove Login</button>
              </form>
            </div>
          ))}
        </section>
      </div>
    );
  }

  const { data: adminUser } = await supabase.from('profiles').select('*').eq('id', params.id).eq('is_admin', true).maybeSingle();
  if (!adminUser) return notFound();

  return (
    <form action={updateAdminAccount} className="space-y-6">
      {success === 'admin_saved' ? <div className="card text-sm text-green-700">Admin account updated.</div> : null}
      <input type="hidden" name="id" value={adminUser.id} />
      <section className="panel">
        <span className="eyebrow">Admin Account</span>
        <h1 className="page-title mt-4">{adminUser.email}</h1>
        <p className="page-subtitle mt-3">Update admin account details and reset passwords without affecting center ownership records.</p>
      </section>
      <section className="card space-y-4">
        <input className="input" name="full_name" defaultValue={adminUser.full_name ?? ''} />
        <textarea className="input min-h-28" name="notes" defaultValue={adminUser.notes ?? ''} />
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Set new password</label>
          <input className="input" name="password" type="password" minLength={8} placeholder="Leave blank to keep current password" />
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700">
          <input type="checkbox" name="is_active" defaultChecked={adminUser.is_active} />
          Active (uncheck to deactivate)
        </label>
      </section>
      <button className="btn-primary">Save</button>
    </form>
  );
}

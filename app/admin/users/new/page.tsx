import { redirect } from 'next/navigation';
import { UserWizard } from '@/components/user-wizard';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCents } from '@/lib/utils';

async function createUserAction(formData: FormData) {
  'use server';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('is_admin,is_active')
    .eq('id', user.id)
    .single();

  if (!adminProfile?.is_admin || !adminProfile.is_active) {
    redirect('/portal');
  }

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const full_name = String(formData.get('full_name') ?? '').trim();
  const password = String(formData.get('password') ?? '').trim();
  const notes = String(formData.get('notes') ?? '');
  const is_admin = String(formData.get('is_admin') ?? 'false') === 'true';
  const selected: string[] = JSON.parse(String(formData.get('selected_json') ?? '[]'));

  if (!email || !password) {
    redirect('/admin/users/new?error=missing');
  }

  const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    redirect('/admin/users/new?error=1');
  }

  const userId = created.data.user.id;
  await supabaseAdmin.from('profiles').insert({ id: userId, email, full_name, notes, is_active: true, is_admin });

  if (selected.length) {
    await supabaseAdmin.from('user_products').insert(selected.map((product_id) => ({ user_id: userId, product_id })));
    await supabaseAdmin.from('user_product_prices').insert(
      selected.map((product_id) => ({
        user_id: userId,
        product_id,
        price_cents: toCents(String(formData.get(`price_${product_id}`) ?? '0')),
      }))
    );
  }

  redirect(`/admin/users/${userId}`);
}

export default async function NewUserWizardPage() {
  const supabase = await createClient();
  const { data: products } = await supabase.from('products').select('id,name').eq('active', true);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Create user wizard</h1>
      <UserWizard products={products ?? []} createUserAction={createUserAction} />
    </div>
  );
}

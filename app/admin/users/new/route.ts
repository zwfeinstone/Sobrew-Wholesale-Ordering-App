import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCents } from '@/lib/utils';

export async function POST(request: Request) {
  const formData = await request.formData();
  const email = String(formData.get('email') ?? '');
  const full_name = String(formData.get('full_name') ?? '');
  const password = String(formData.get('password') ?? 'TempPass123!');
  const notes = String(formData.get('notes') ?? '');
  const selected: string[] = JSON.parse(String(formData.get('selected_json') ?? '[]'));

  const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    return Response.redirect(new URL('/admin/users/new?error=1', request.url));
  }

  const userId = created.data.user.id;
  await supabaseAdmin.from('profiles').insert({ id: userId, email, full_name, notes, is_active: true, is_admin: false });
  if (selected.length) {
    await supabaseAdmin.from('user_products').insert(selected.map((product_id) => ({ user_id: userId, product_id })));
    await supabaseAdmin.from('user_product_prices').insert(
      selected.map((product_id) => ({ user_id: userId, product_id, price_cents: toCents(String(formData.get(`price_${product_id}`) ?? '0')) }))
    );
  }
  redirect(`/admin/users/${userId}`);
}

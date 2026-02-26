import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { toCents } from '@/lib/utils';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('is_admin,is_active')
    .eq('id', user.id)
    .single();

  if (!adminProfile?.is_admin || !adminProfile.is_active) {
    return new Response('Forbidden', { status: 403 });
  }

  const formData = await request.formData();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const full_name = String(formData.get('full_name') ?? '').trim();
  const password = String(formData.get('password') ?? '').trim();
  const notes = String(formData.get('notes') ?? '');
  const is_admin = String(formData.get('is_admin') ?? 'false') === 'true';
  const selected: string[] = JSON.parse(String(formData.get('selected_json') ?? '[]'));

  if (!email || !password) {
    return Response.redirect(new URL('/admin/users/new?error=missing', request.url));
  }

  const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    return Response.redirect(new URL('/admin/users/new?error=1', request.url));
  }

  const userId = created.data.user.id;
  await supabaseAdmin.from('profiles').insert({ id: userId, email, full_name, notes, is_active: true, is_admin });
  if (selected.length) {
    await supabaseAdmin.from('user_products').insert(selected.map((product_id) => ({ user_id: userId, product_id })));
    await supabaseAdmin.from('user_product_prices').insert(
      selected.map((product_id) => ({ user_id: userId, product_id, price_cents: toCents(String(formData.get(`price_${product_id}`) ?? '0')) }))
    );
  }
  redirect(`/admin/users/${userId}`);
}

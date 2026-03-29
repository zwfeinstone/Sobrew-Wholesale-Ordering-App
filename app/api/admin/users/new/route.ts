import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { toCents } from '@/lib/utils';
import { NextResponse } from 'next/server';

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
  const centerName = String(formData.get('center_name') ?? '').trim();
  const centerNotes = String(formData.get('center_notes') ?? '');
  const email = String(formData.get('login_email') ?? '').trim().toLowerCase();
  const full_name = String(formData.get('login_name') ?? '').trim();
  const password = String(formData.get('password') ?? '').trim();
  const selected: string[] = JSON.parse(String(formData.get('selected_json') ?? '[]'));

  if (!centerName || !email || !password) {
    return NextResponse.redirect(new URL('/admin/users/new?error=missing', request.url));
  }

  const { data: center, error: centerError } = await supabaseAdmin
    .from('centers')
    .insert({ name: centerName, notes: centerNotes, is_active: true })
    .select('id')
    .single();

  if (centerError || !center) {
    return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url));
  }

  const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    await supabaseAdmin.from('centers').delete().eq('id', center.id);
    return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url));
  }

  const userId = created.data.user.id;
  const profileResult = await supabaseAdmin.from('profiles').upsert(
    { id: userId, email, full_name, notes: centerNotes, is_active: true, is_admin: false, center_id: center.id },
    { onConflict: 'id' }
  );
  if (profileResult.error) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    await supabaseAdmin.from('centers').delete().eq('id', center.id);
    return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url));
  }
  if (selected.length) {
    const userProductsResult = await supabaseAdmin.from('user_products').insert(selected.map((product_id) => ({ center_id: center.id, product_id })));
    const userPricesResult = await supabaseAdmin.from('user_product_prices').insert(
      selected.map((product_id) => ({ center_id: center.id, product_id, price_cents: toCents(String(formData.get(`price_${product_id}`) ?? '0')) }))
    );
    if (userProductsResult.error || userPricesResult.error) {
      await supabaseAdmin.from('user_products').delete().eq('center_id', center.id);
      await supabaseAdmin.from('user_product_prices').delete().eq('center_id', center.id);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      await supabaseAdmin.from('centers').delete().eq('id', center.id);
      return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url));
    }
  }
  return NextResponse.redirect(new URL(`/admin/users/${center.id}`, request.url));
}

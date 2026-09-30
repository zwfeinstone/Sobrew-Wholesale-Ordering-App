import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireAdminSectionEdit } from '@/lib/admin-permissions';
import { recordAdminAuditLog } from '@/lib/admin-audit';
import { parseBillingEmail, parseBillingEmailCc } from '@/lib/billing-email';
import { sendCustomerWelcomeEmail } from '@/lib/email';
import { customerAddressError, normalizeCustomerAddress } from '@/lib/customer-address';
import { createQuickBooksCustomerFromPortalCenter } from '@/lib/quickbooks';
import { toCents } from '@/lib/utils';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const current = await requireAdminSectionEdit('centers', '/admin/users/new?error=admin_write_denied');
  const { profile: adminProfile } = current;

  const formData = await request.formData();
  const centerName = String(formData.get('center_name') ?? '').trim();
  const centerNotes = String(formData.get('center_notes') ?? '');
  const email = String(formData.get('login_email') ?? '').trim().toLowerCase();
  const full_name = String(formData.get('login_name') ?? '').trim();
  const password = String(formData.get('password') ?? '').trim();
  const address = normalizeCustomerAddress({
    address1: String(formData.get('address1') ?? ''),
    address2: String(formData.get('address2') ?? ''),
    city: String(formData.get('city') ?? ''),
    state: String(formData.get('state') ?? ''),
    zip: String(formData.get('zip') ?? ''),
  });
  let selected: string[];
  try {
    const value: unknown = JSON.parse(String(formData.get('selected_json') ?? '[]'));
    if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) throw new Error('Invalid catalog');
    selected = [...new Set(value)];
  } catch {
    return NextResponse.redirect(new URL('/admin/users/new?error=catalog_invalid', request.url), 303);
  }

  if (!centerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return NextResponse.redirect(new URL('/admin/users/new?error=missing', request.url), 303);
  }
  if (customerAddressError(address)) {
    return NextResponse.redirect(new URL('/admin/users/new?error=address_required', request.url), 303);
  }
  let billingEmail: string;
  try {
    billingEmail = parseBillingEmail(formData.get('billing_email'));
  } catch {
    return NextResponse.redirect(new URL('/admin/users/new?error=billing_email_invalid', request.url), 303);
  }
  let billingEmailCc: string[];
  try {
    billingEmailCc = parseBillingEmailCc(formData.get('billing_email_cc'));
  } catch {
    return NextResponse.redirect(new URL('/admin/users/new?error=billing_cc_invalid', request.url), 303);
  }

  const { data: center, error: centerError } = await supabaseAdmin
    .from('centers')
    .insert({
      name: centerName,
      notes: centerNotes,
      is_active: true,
      billing_email: billingEmail,
      billing_email_cc: billingEmailCc,
      billing_email_cc_reviewed_at: new Date().toISOString(),
      invoice_recipients_configured_at: new Date().toISOString(),
      billing_address1: address.address1,
      billing_address2: address.address2 || null,
      billing_city: address.city,
      billing_state: address.state,
      billing_zip: address.zip,
    })
    .select('id')
    .single();

  if (centerError || !center) {
    return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url), 303);
  }

  // Persist a usable delivery address before creating a login or sending email.
  const locationResult = await supabaseAdmin.from('center_locations').insert({
    center_id: center.id,
    name: centerName,
    ...address,
    address2: address.address2 || null,
    is_active: true,
  });
  if (locationResult.error) {
    await supabaseAdmin.from('centers').delete().eq('id', center.id);
    return NextResponse.redirect(new URL('/admin/users/new?error=address_save_failed', request.url), 303);
  }

  const { data: creatorCommissionSetting } = await supabaseAdmin
    .from('admin_commission_settings')
    .select('is_sales_rep')
    .eq('profile_id', adminProfile.id)
    .maybeSingle();
  const creatorIsSalesRep = Boolean(creatorCommissionSetting?.is_sales_rep);

  const creatorIsSuperadmin = current.isOwner;

  if (!creatorIsSuperadmin) {
    const assignmentResult = await supabaseAdmin.from('admin_center_assignments').insert({
      assigned_by: adminProfile.id,
      center_id: center.id,
      profile_id: adminProfile.id,
      updated_by: adminProfile.id,
    });

    if (assignmentResult.error) {
      await supabaseAdmin.from('centers').delete().eq('id', center.id);
      return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url), 303);
    }
  }

  if (creatorIsSalesRep) {
    const salesAssignmentResult = await supabaseAdmin.from('center_sales_assignments').insert({
      assigned_by: adminProfile.id,
      center_id: center.id,
      sales_profile_id: adminProfile.id,
      updated_by: adminProfile.id,
    });

    if (salesAssignmentResult.error) {
      await supabaseAdmin.from('centers').delete().eq('id', center.id);
      return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url), 303);
    }
  }

  const created = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    await supabaseAdmin.from('centers').delete().eq('id', center.id);
    return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url), 303);
  }

  const userId = created.data.user.id;
  const profileResult = await supabaseAdmin.from('profiles').upsert(
    { id: userId, email, full_name, notes: centerNotes, is_active: true, is_admin: false, center_id: center.id },
    { onConflict: 'id' }
  );
  if (profileResult.error) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    await supabaseAdmin.from('centers').delete().eq('id', center.id);
    return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url), 303);
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
      return NextResponse.redirect(new URL('/admin/users/new?error=1', request.url), 303);
    }
  }
  await recordAdminAuditLog({
    action: 'center_created',
    actorProfileId: adminProfile.id,
    after: { center_id: center.id, assigned_to_creator: !creatorIsSuperadmin, sales_assigned_to_creator: creatorIsSalesRep },
    sectionKey: 'centers',
    supabase: supabaseAdmin,
    targetProfileId: adminProfile.id,
  });
  let quickBooksPending = false;
  try {
    await createQuickBooksCustomerFromPortalCenter(center.id);
  } catch (error) {
    // The local customer is complete. Keep it and retry its mapping, rather than
    // asking the admin to repeat customer creation and risk duplicate accounts.
    quickBooksPending = true;
    console.error('[admin-centers] automatic QuickBooks sync failed', { centerId: center.id, error });
  }
  const welcomeResult = await sendCustomerWelcomeEmail({
    centerName,
    email,
    fullName: full_name,
    password,
  });
  const destination = new URL(`/admin/users/${center.id}?success=center_created`, request.url);
  if (!welcomeResult.ok) destination.searchParams.set('warning', 'welcome_email_failed');
  if (quickBooksPending) destination.searchParams.set('quickbooks', 'pending');
  return NextResponse.redirect(destination, 303);
}

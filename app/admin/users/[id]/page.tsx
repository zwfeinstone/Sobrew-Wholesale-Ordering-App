import { notFound, redirect } from 'next/navigation';
import { AdminPermissionEditor } from '@/components/admin-permission-editor';
import PendingSubmitButton from '@/components/pending-submit-button';
import { recordAdminAuditLog } from '@/lib/admin-audit';
import { requireCenterAccess } from '@/lib/admin-center-scope';
import { isOwnerEmail } from '@/lib/admin-permission-definitions';
import { loadSavedAdminPermissions, parseAdminPermissionsForm, saveAdminPermissions, serializePermissionSnapshot } from '@/lib/admin-permission-save';
import { requireAdminSectionView, requireManageAdmins } from '@/lib/admin-permissions';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import { productCategoryGroupKey, productCategoryLabel, productCategorySortRank, type ProductCategoryGroup } from '@/lib/product-categories';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCents } from '@/lib/utils';

type CenterProductRow = {
  id: string;
  name: string | null;
  category: string | null;
};

type CenterLocationRow = {
  id: string;
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  is_active: boolean | null;
};

const productNameCollator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

function isNextRedirectError(error: unknown) {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'digest' in error &&
      typeof (error as { digest?: unknown }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

function productDisplayName(product: CenterProductRow) {
  return product.name?.trim() || 'Unnamed product';
}

function locationDisplayName(location: CenterLocationRow) {
  return location.name?.trim() || 'Unnamed location';
}

function locationAddressLine(location: CenterLocationRow) {
  return [location.address1, location.address2, location.city, location.state, location.zip]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(', ');
}

function groupProductsByCategory(products: CenterProductRow[]) {
  const sortedProducts = [...products].sort((a, b) => {
    const categoryComparison = productCategorySortRank(a.category) - productCategorySortRank(b.category);
    if (categoryComparison !== 0) return categoryComparison;
    return productNameCollator.compare(productDisplayName(a), productDisplayName(b));
  });

  const groups: Array<{ category: ProductCategoryGroup; products: CenterProductRow[] }> = [];
  for (const product of sortedProducts) {
    const category = productCategoryGroupKey(product.category);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup?.category === category) {
      currentGroup.products.push(product);
    } else {
      groups.push({ category, products: [product] });
    }
  }
  return groups;
}

function adminUserDeniedHref(id: string) {
  return id ? `/admin/users/${id}?error=admin_write_denied` : '/admin/users';
}

function adminActionErrorMessage(error: string) {
  if (error === 'admin_write_denied') return 'You do not have edit access to this section.';
  if (error === 'admin_permission_denied') return 'Only superadmins can manage admin accounts and permissions.';
  if (error === 'admin_save_failed') return 'The admin account could not be saved.';
  if (error === 'admin_permissions_failed') return 'The admin permissions could not be saved.';
  return `Could not complete that action (${error}).`;
}

async function syncCenterCatalog(centerId: string, formData: FormData) {
  const selected = formData.getAll('product_id').map(String);

  const deleteProductsResult = await supabaseAdmin.from('user_products').delete().eq('center_id', centerId);
  if (deleteProductsResult.error) {
    throw deleteProductsResult.error;
  }

  const deletePricesResult = await supabaseAdmin.from('user_product_prices').delete().eq('center_id', centerId);
  if (deletePricesResult.error) {
    throw deletePricesResult.error;
  }

  if (!selected.length) {
    return;
  }

  const insertProductsResult = await supabaseAdmin.from('user_products').insert(selected.map((product_id) => ({ center_id: centerId, product_id })));
  if (insertProductsResult.error) {
    throw insertProductsResult.error;
  }

  const upsertPricesResult = await supabaseAdmin.from('user_product_prices').upsert(
    selected.map((product_id) => ({
      center_id: centerId,
      product_id,
      price_cents: toCents(String(formData.get(`price_${product_id}`) ?? '0')),
    })),
    { onConflict: 'center_id,product_id' }
  );
  if (upsertPricesResult.error) {
    throw upsertPricesResult.error;
  }
}

async function updateCenter(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  await requireAdminWriteAccess(adminUserDeniedHref(centerId), 'centers');

  if (!centerId) redirect('/admin/users');
  await requireCenterAccess(centerId, adminUserDeniedHref(centerId));

  try {
    const centerUpdateResult = await supabaseAdmin
      .from('centers')
      .update({
        name: String(formData.get('name') ?? '').trim() || 'Unnamed center',
        notes: String(formData.get('notes') ?? ''),
        is_active: formData.get('is_active') === 'on',
      })
      .eq('id', centerId);
    if (centerUpdateResult.error) {
      throw centerUpdateResult.error;
    }

    await syncCenterCatalog(centerId, formData);
    redirect(`/admin/users/${centerId}?success=center_saved`);
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    console.error('[admin-centers] updateCenter failed', { centerId, error });
    redirect(`/admin/users/${centerId}?error=center_save_failed`);
  }
}

function locationFieldsFromForm(formData: FormData) {
  return {
    name: String(formData.get('location_name') ?? '').trim(),
    address1: String(formData.get('address1') ?? '').trim(),
    address2: String(formData.get('address2') ?? '').trim() || null,
    city: String(formData.get('city') ?? '').trim(),
    state: String(formData.get('state') ?? '').trim(),
    zip: String(formData.get('zip') ?? '').trim(),
    notes: String(formData.get('location_notes') ?? '').trim() || null,
    is_active: formData.get('is_active') === 'on',
  };
}

function hasRequiredLocationFields(location: ReturnType<typeof locationFieldsFromForm>) {
  return Boolean(location.name && location.address1 && location.city && location.state && location.zip);
}

async function addCenterLocation(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  await requireAdminWriteAccess(adminUserDeniedHref(centerId), 'centers');

  if (!centerId) redirect('/admin/users');
  await requireCenterAccess(centerId, adminUserDeniedHref(centerId));

  const location = locationFieldsFromForm(formData);
  if (!hasRequiredLocationFields(location)) {
    redirect(`/admin/users/${centerId}?error=location_missing`);
  }

  const result = await supabaseAdmin.from('center_locations').insert({
    center_id: centerId,
    ...location,
  });

  redirect(`/admin/users/${centerId}?${result.error ? 'error=location_add_failed' : 'success=location_added'}`);
}

async function updateCenterLocation(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  const locationId = String(formData.get('location_id') ?? '');
  await requireAdminWriteAccess(adminUserDeniedHref(centerId), 'centers');

  if (!centerId || !locationId) redirect('/admin/users');
  await requireCenterAccess(centerId, adminUserDeniedHref(centerId));

  const location = locationFieldsFromForm(formData);
  if (!hasRequiredLocationFields(location)) {
    redirect(`/admin/users/${centerId}?error=location_missing`);
  }

  const result = await supabaseAdmin
    .from('center_locations')
    .update({
      ...location,
      updated_at: new Date().toISOString(),
    })
    .eq('id', locationId)
    .eq('center_id', centerId);

  redirect(`/admin/users/${centerId}?${result.error ? 'error=location_save_failed' : 'success=location_saved'}`);
}

async function removeCenterLocation(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  const locationId = String(formData.get('location_id') ?? '');
  await requireAdminWriteAccess(adminUserDeniedHref(centerId), 'centers');

  if (!centerId || !locationId) redirect('/admin/users');
  await requireCenterAccess(centerId, adminUserDeniedHref(centerId));

  const result = await supabaseAdmin
    .from('center_locations')
    .delete()
    .eq('id', locationId)
    .eq('center_id', centerId);

  redirect(`/admin/users/${centerId}?${result.error ? 'error=location_remove_failed' : 'success=location_removed'}`);
}

async function addCenterLogin(formData: FormData) {
  'use server';
  const centerId = String(formData.get('center_id') ?? '');
  await requireAdminWriteAccess(adminUserDeniedHref(centerId), 'centers');
  if (centerId) await requireCenterAccess(centerId, adminUserDeniedHref(centerId));

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
  await requireAdminWriteAccess(adminUserDeniedHref(centerId), 'centers');

  if (!centerId || !memberId) redirect('/admin/users');
  await requireCenterAccess(centerId, adminUserDeniedHref(centerId));

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
  await requireAdminWriteAccess(adminUserDeniedHref(centerId), 'centers');

  if (!centerId || !memberId) redirect('/admin/users');
  await requireCenterAccess(centerId, adminUserDeniedHref(centerId));

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
  const current = await requireManageAdmins(adminUserDeniedHref(id));

  if (!id) redirect('/admin/users');

  const { data: beforeProfile } = await supabaseAdmin
    .from('profiles')
    .select('id,email,full_name,notes,is_active,is_admin,is_superadmin')
    .eq('id', id)
    .eq('is_admin', true)
    .maybeSingle();

  if (!beforeProfile) redirect('/admin/users');

  const beforePermissions = await loadSavedAdminPermissions(supabaseAdmin, id, beforeProfile.email, beforeProfile.is_superadmin);
  const isPrimaryOwnerAdmin = isOwnerEmail(beforeProfile.email);
  const isSuperadmin = isPrimaryOwnerAdmin || formData.get('is_superadmin') === 'on';
  const afterProfile = {
    full_name: String(formData.get('full_name') ?? ''),
    is_active: isPrimaryOwnerAdmin ? true : formData.get('is_active') === 'on',
    is_superadmin: isSuperadmin,
    notes: String(formData.get('notes') ?? ''),
  };
  const updateResult = await supabaseAdmin
    .from('profiles')
    .update(afterProfile)
    .eq('id', id)
    .eq('is_admin', true);

  if (updateResult.error) {
    redirect(`${adminUserDeniedHref(id).replace('admin_write_denied', 'admin_save_failed')}`);
  }

  const password = String(formData.get('password') ?? '');
  if (password) {
    const passwordResult = await supabaseAdmin.auth.admin.updateUserById(id, { password });
    if (passwordResult.error) {
      redirect(`${adminUserDeniedHref(id).replace('admin_write_denied', 'admin_save_failed')}`);
    }
    await recordAdminAuditLog({
      action: 'admin_password_reset',
      actorProfileId: current.profile.id,
      after: { passwordReset: true },
      sectionKey: 'manage_admins',
      supabase: supabaseAdmin,
      targetProfileId: id,
    });
  }

  const permissionsResult = await saveAdminPermissions({
    access: parseAdminPermissionsForm(formData),
    email: beforeProfile.email,
    isSuperadmin,
    profileId: id,
    supabase: supabaseAdmin,
  });

  if (permissionsResult.error) {
    redirect(`${adminUserDeniedHref(id).replace('admin_write_denied', 'admin_permissions_failed')}`);
  }

  await recordAdminAuditLog({
    action: 'admin_profile_updated',
    actorProfileId: current.profile.id,
    after: afterProfile,
    before: {
      full_name: beforeProfile.full_name,
      is_active: beforeProfile.is_active,
      is_superadmin: beforeProfile.is_superadmin,
      notes: beforeProfile.notes,
    },
    sectionKey: 'manage_admins',
    supabase: supabaseAdmin,
    targetProfileId: id,
  });
  await recordAdminAuditLog({
    action: 'admin_permissions_updated',
    actorProfileId: current.profile.id,
    after: serializePermissionSnapshot(permissionsResult.access),
    before: serializePermissionSnapshot(beforePermissions),
    sectionKey: 'manage_admins',
    supabase: supabaseAdmin,
    targetProfileId: id,
  });

  redirect(`/admin/users/${id}?success=admin_saved`);
}

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const currentAccess = await requireAdminSectionView('centers');
  const supabase = await createClient();
  const success = typeof searchParams?.success === 'string' ? searchParams.success : '';
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';

  const { data: center } = await supabase.from('centers').select('*').eq('id', params.id).maybeSingle();

  if (center) {
    if (currentAccess.centerScope !== null && !currentAccess.centerScope.includes(center.id)) {
      redirect('/admin/access-denied?section=centers');
    }

    const [{ data: products }, { data: assigned }, { data: prices }, { data: members }, { data: locations }] = await Promise.all([
      supabase.from('products').select('id,name,category').eq('active', true).order('name', { ascending: true }),
      supabase.from('user_products').select('product_id').eq('center_id', center.id),
      supabase.from('user_product_prices').select('product_id,price_cents').eq('center_id', center.id),
      supabase
        .from('profiles')
        .select('id,email,full_name,is_active,created_at')
        .eq('center_id', center.id)
        .eq('is_admin', false)
        .order('created_at', { ascending: true }),
      supabase
        .from('center_locations')
        .select('id,name,address1,address2,city,state,zip,notes,is_active')
        .eq('center_id', center.id)
        .order('is_active', { ascending: false })
        .order('name', { ascending: true }),
    ]);

    const assignedSet = new Set((assigned ?? []).map((row) => row.product_id));
    const priceMap = new Map((prices ?? []).map((row) => [row.product_id, row.price_cents]));
    const groupedProducts = groupProductsByCategory((products ?? []) as CenterProductRow[]);
    const centerLocations = (locations ?? []) as CenterLocationRow[];

    return (
      <div className="space-y-6">
        {success === 'center_saved' ? <div className="card text-sm text-green-700">Center settings saved.</div> : null}
        {success === 'login_added' ? <div className="card text-sm text-green-700">Login added to center.</div> : null}
        {success === 'login_saved' ? <div className="card text-sm text-green-700">Login updated.</div> : null}
        {success === 'login_removed' ? <div className="card text-sm text-green-700">Login removed from center.</div> : null}
        {success === 'location_added' ? <div className="card text-sm text-green-700">Delivery location added.</div> : null}
        {success === 'location_saved' ? <div className="card text-sm text-green-700">Delivery location updated.</div> : null}
        {success === 'location_removed' ? <div className="card text-sm text-green-700">Delivery location removed.</div> : null}
        {error ? <div className="card text-sm text-red-700">{adminActionErrorMessage(error)}</div> : null}

        <section className="panel">
          <span className="eyebrow">Center Admin</span>
          <h1 className="page-title mt-4 break-words">{center.name}</h1>
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
            {!groupedProducts.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No active products found.</div> : null}
            {groupedProducts.map((group) => (
              <div key={group.category} className="space-y-3">
                <h3 className="border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{productCategoryLabel(group.category)}</h3>
                {group.products.map((product) => (
                  <div key={product.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 md:grid-cols-2">
                    <label className="flex items-center gap-3 font-medium text-slate-900">
                      <input type="checkbox" name="product_id" value={product.id} defaultChecked={assignedSet.has(product.id)} />
                      {productDisplayName(product)}
                    </label>
                    <input className="input" name={`price_${product.id}`} type="number" step="0.01" min="0" defaultValue={((priceMap.get(product.id) ?? 0) / 100).toFixed(2)} />
                  </div>
                ))}
              </div>
            ))}
          </section>

          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save Center" pendingLabel="Saving..." />
        </form>

        <section className="card space-y-5">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Delivery locations</h2>
            <p className="mt-1 text-sm text-slate-500">Add each delivery address this center can choose during checkout.</p>
          </div>

          <form action={addCenterLocation} className="grid gap-3 lg:grid-cols-2">
            <input type="hidden" name="center_id" value={center.id} />
            <input className="input" name="location_name" required placeholder="Location name" />
            <input className="input" name="address1" required placeholder="Address line 1" />
            <input className="input" name="address2" placeholder="Address line 2" />
            <input className="input" name="city" required placeholder="City" />
            <input className="input" name="state" required placeholder="State" />
            <input className="input" name="zip" required placeholder="ZIP" />
            <textarea className="input min-h-24 lg:col-span-2" name="location_notes" placeholder="Location notes" />
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700">
              <input type="checkbox" name="is_active" defaultChecked />
              Active location
            </label>
            <PendingSubmitButton className="btn-primary w-full lg:w-auto" label="Add Location" pendingLabel="Adding..." />
          </form>

          <div className="space-y-4">
            {!centerLocations.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No delivery locations have been added yet.</div> : null}
            {centerLocations.map((location) => (
              <div key={location.id} className="rounded-2xl border border-slate-200 bg-white/60 p-4">
                <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{locationDisplayName(location)}</p>
                    <p className="mt-1 text-sm text-slate-500">{locationAddressLine(location) || 'No address on file'}</p>
                  </div>
                  <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${location.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                    {location.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <form action={updateCenterLocation} className="grid gap-3 lg:grid-cols-2">
                  <input type="hidden" name="center_id" value={center.id} />
                  <input type="hidden" name="location_id" value={location.id} />
                  <input className="input" name="location_name" required defaultValue={location.name ?? ''} placeholder="Location name" />
                  <input className="input" name="address1" required defaultValue={location.address1 ?? ''} placeholder="Address line 1" />
                  <input className="input" name="address2" defaultValue={location.address2 ?? ''} placeholder="Address line 2" />
                  <input className="input" name="city" required defaultValue={location.city ?? ''} placeholder="City" />
                  <input className="input" name="state" required defaultValue={location.state ?? ''} placeholder="State" />
                  <input className="input" name="zip" required defaultValue={location.zip ?? ''} placeholder="ZIP" />
                  <textarea className="input min-h-24 lg:col-span-2" name="location_notes" defaultValue={location.notes ?? ''} placeholder="Location notes" />
                  <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700">
                    <input type="checkbox" name="is_active" defaultChecked={location.is_active !== false} />
                  Active location
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save Location" pendingLabel="Saving..." />
                  </div>
                </form>
                <form action={removeCenterLocation} className="mt-3">
                  <input type="hidden" name="center_id" value={center.id} />
                  <input type="hidden" name="location_id" value={location.id} />
                  <PendingSubmitButton className="btn-secondary w-full sm:w-auto" label="Remove Location" pendingLabel="Removing..." />
                </form>
              </div>
            ))}
          </div>
        </section>

        <section className="card space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Add login</h2>
            <p className="mt-1 text-sm text-slate-500">Create another login for this center. Every login will share the same catalog, order history, and recurring orders.</p>
          </div>
          <form action={addCenterLogin} className="grid gap-3 md:grid-cols-4">
            <input type="hidden" name="center_id" value={center.id} />
            <input className="input" name="full_name" placeholder="Login name" />
            <input className="input" name="email" type="email" required placeholder="Email address" />
            <input className="input" name="password" type="password" minLength={8} required placeholder="Temporary password" autoComplete="new-password" />
            <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Add Login" pendingLabel="Adding..." />
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
                <p className="mt-1 break-all text-sm text-slate-500">{member.email}</p>
              </div>
              <form action={updateCenterLogin} className="grid gap-3 md:grid-cols-[1.2fr_1fr_auto_auto] md:items-center">
                <input type="hidden" name="center_id" value={center.id} />
                <input type="hidden" name="member_id" value={member.id} />
                <input className="input" name="full_name" defaultValue={member.full_name ?? ''} placeholder="Login name" />
                <input className="input" name="password" type="password" minLength={8} placeholder="Leave blank to keep password" autoComplete="new-password" />
                <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700">
                  <input type="checkbox" name="is_active" defaultChecked={member.is_active} />
                  Active
                </label>
                <PendingSubmitButton className="btn-primary w-full md:w-auto" label="Save Login" pendingLabel="Saving..." />
              </form>
              <form action={removeCenterLogin} className="w-full md:w-auto">
                <input type="hidden" name="center_id" value={center.id} />
                <input type="hidden" name="member_id" value={member.id} />
                <PendingSubmitButton className="btn-secondary w-full md:w-auto" label="Remove Login" pendingLabel="Removing..." />
              </form>
            </div>
          ))}
        </section>
      </div>
    );
  }

  await requireManageAdmins('/admin/access-denied?section=manage_admins');
  const { data: adminUser } = await supabase.from('profiles').select('*').eq('id', params.id).eq('is_admin', true).maybeSingle();
  if (!adminUser) return notFound();
  const canManageAdmins = currentAccess.isOwner;
  const isPrimaryOwnerAdmin = isOwnerEmail(adminUser.email);
  const isSuperadmin = isPrimaryOwnerAdmin || Boolean(adminUser.is_superadmin);
  const adminPermissions = await loadSavedAdminPermissions(supabase, adminUser.id, adminUser.email, isSuperadmin);
  const { data: auditRows } = canManageAdmins
    ? await supabase
        .from('admin_audit_log')
        .select('id,action,section_key,created_at')
        .eq('target_profile_id', adminUser.id)
        .order('created_at', { ascending: false })
        .limit(8)
    : { data: [] };

  return (
    <form action={updateAdminAccount} className="space-y-6">
      {success === 'admin_created' ? <div className="card text-sm text-green-700">Admin account created. Permissions are saved below.</div> : null}
      {success === 'admin_saved' ? <div className="card text-sm text-green-700">Admin account updated.</div> : null}
      {error ? <div className="card text-sm text-red-700">{adminActionErrorMessage(error)}</div> : null}
      <input type="hidden" name="id" value={adminUser.id} />
      <section className="panel">
        <span className="eyebrow">Admin Account</span>
        <h1 className="page-title mt-4 break-all">{adminUser.email}</h1>
        <p className="page-subtitle mt-3">Update admin account details and reset passwords without affecting center ownership records.</p>
      </section>
      <section className="card space-y-4">
        {isPrimaryOwnerAdmin ? (
          <div className="rounded-2xl border border-teal-100 bg-teal-50/70 p-4 text-sm font-medium text-teal-900">
            The primary owner has permanent superadmin access and cannot be restricted or deactivated.
          </div>
        ) : null}
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Name
          <input className="input" name="full_name" defaultValue={adminUser.full_name ?? ''} />
        </label>
        <label className="space-y-2 text-sm font-medium text-slate-700">
          Notes
          <textarea className="input min-h-28" name="notes" defaultValue={adminUser.notes ?? ''} />
        </label>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Set new password</label>
          <input className="input" name="password" type="password" minLength={8} placeholder="Leave blank to keep current password" autoComplete="new-password" />
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-medium text-slate-700">
          <input type="checkbox" name="is_active" defaultChecked={adminUser.is_active} disabled={isPrimaryOwnerAdmin} />
          Active (uncheck to deactivate)
        </label>
      </section>
      <section className="card space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Permissions</h2>
          <p className="mt-1 text-sm text-slate-500">Checking Edit automatically includes View. Removing View removes Edit.</p>
        </div>
        <AdminPermissionEditor
          allowManageAdmins={canManageAdmins}
          disabled={isPrimaryOwnerAdmin}
          initialAccess={adminPermissions}
          initialSuperadmin={isSuperadmin}
          showSuperadminToggle
          superadminDisabled={isPrimaryOwnerAdmin}
        />
      </section>
      <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save" pendingLabel="Saving..." />
      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Audit log</h2>
          <p className="mt-1 text-sm text-slate-500">Recent admin account and permission changes.</p>
        </div>
        {!auditRows?.length ? <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm text-slate-600">No audit entries yet.</div> : null}
        <div className="space-y-2">
          {auditRows?.map((row: any) => (
            <div key={row.id} className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-3 text-sm">
              <p className="font-semibold text-slate-950">{row.action.replaceAll('_', ' ')}</p>
              <p className="mt-1 text-slate-500">
                {row.section_key ?? 'admin'} - {row.created_at ? new Date(row.created_at).toLocaleString('en-US') : 'Unknown time'}
              </p>
            </div>
          ))}
        </div>
      </section>
    </form>
  );
}

import { redirect } from 'next/navigation';
import { AdminPermissionEditor } from '@/components/admin-permission-editor';
import { recordAdminAuditLog } from '@/lib/admin-audit';
import { isOwnerEmail, legacyReadOnlyAccessMap } from '@/lib/admin-permission-definitions';
import { parseAdminPermissionsForm, saveAdminPermissions, serializePermissionSnapshot } from '@/lib/admin-permission-save';
import { requireManageAdmins } from '@/lib/admin-permissions';
import { supabaseAdmin } from '@/lib/supabase/admin';

function errorMessage(error: string) {
  if (error === 'missing') return 'Name, email, and temporary password are required.';
  if (error === 'create_failed') return 'The admin login could not be created.';
  if (error === 'profile_failed') return 'The admin profile could not be saved.';
  if (error === 'permissions_failed') return 'The admin was created, but permissions could not be saved.';
  return 'Could not create that admin account.';
}

async function createAdminAccount(formData: FormData) {
  'use server';

  const current = await requireManageAdmins('/admin/users?error=admin_permission_denied');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const fullName = String(formData.get('full_name') ?? '').trim();
  const password = String(formData.get('password') ?? '').trim();

  if (!email || !fullName || !password) {
    redirect('/admin/admins/new?error=missing');
  }

  const access = parseAdminPermissionsForm(formData);
  const isSuperadmin = formData.get('is_superadmin') === 'on' || isOwnerEmail(email);
  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (created.error || !created.data.user) {
    redirect('/admin/admins/new?error=create_failed');
  }

  const adminId = created.data.user.id;
  const profile = {
    center_id: null,
    email,
    full_name: fullName,
    id: adminId,
    is_active: true,
    is_admin: true,
    is_superadmin: isSuperadmin,
  };
  const profileResult = await supabaseAdmin.from('profiles').upsert(profile, { onConflict: 'id' });

  if (profileResult.error) {
    await supabaseAdmin.auth.admin.deleteUser(adminId);
    redirect('/admin/admins/new?error=profile_failed');
  }

  const permissionsResult = await saveAdminPermissions({
    access,
    email,
    isSuperadmin,
    profileId: adminId,
    supabase: supabaseAdmin,
  });

  if (permissionsResult.error) {
    await supabaseAdmin.from('profiles').delete().eq('id', adminId);
    await supabaseAdmin.auth.admin.deleteUser(adminId);
    redirect('/admin/admins/new?error=permissions_failed');
  }

  await supabaseAdmin.from('admin_time_settings').upsert(
    {
      active: true,
      hourly_rate_cents: 0,
      profile_id: adminId,
      updated_by: current.profile.id,
    },
    { onConflict: 'profile_id' }
  );

  await supabaseAdmin.from('admin_commission_settings').upsert(
    {
      active: true,
      commission_percent: 0,
      is_sales_rep: false,
      profile_id: adminId,
      updated_by: current.profile.id,
    },
    { onConflict: 'profile_id' }
  );

  await recordAdminAuditLog({
    action: 'admin_created',
    actorProfileId: current.profile.id,
    after: profile,
    sectionKey: 'manage_admins',
    supabase: supabaseAdmin,
    targetProfileId: adminId,
  });
  await recordAdminAuditLog({
    action: 'admin_permissions_updated',
    actorProfileId: current.profile.id,
    after: serializePermissionSnapshot(permissionsResult.access),
    sectionKey: 'manage_admins',
    supabase: supabaseAdmin,
    targetProfileId: adminId,
  });

  redirect(`/admin/users/${adminId}?success=admin_created`);
}

export default async function NewAdminPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireManageAdmins('/admin/users?error=admin_permission_denied');
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';
  const initialAccess = legacyReadOnlyAccessMap();

  return (
    <form action={createAdminAccount} className="space-y-6">
      {error ? <div className="card text-sm text-red-700">{errorMessage(error)}</div> : null}
      <section className="panel">
        <span className="eyebrow">Admin Accounts</span>
        <h1 className="page-title mt-4">Add admin</h1>
        <p className="page-subtitle mt-3">Create an admin login with a temporary password and set exactly which tabs they can view or edit.</p>
      </section>

      <section className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Name
            <input className="input" name="full_name" required />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Email
            <input className="input" name="email" required type="email" />
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Temporary password
            <input className="input" name="password" required minLength={8} type="password" autoComplete="new-password" />
          </label>
        </div>
      </section>

      <section className="card space-y-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Permissions</h2>
          <p className="mt-1 text-sm text-slate-500">Choose a preset, then adjust view and edit access for each screen.</p>
        </div>
        <AdminPermissionEditor allowManageAdmins initialAccess={initialAccess} showSuperadminToggle />
      </section>

      <button className="btn-primary w-full sm:w-auto" type="submit">
        Create Admin
      </button>
    </form>
  );
}

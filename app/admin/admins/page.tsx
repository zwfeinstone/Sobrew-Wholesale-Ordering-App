import Link from 'next/link';
import { requireManageAdmins } from '@/lib/admin-permissions';
import { createClient } from '@/lib/supabase/server';

type AdminUserRow = {
  email: string | null;
  full_name: string | null;
  id: string;
  is_active: boolean | null;
  is_superadmin: boolean | null;
};

function adminDisplayName(admin: AdminUserRow) {
  return admin.full_name?.trim() || admin.email?.trim() || 'Unnamed admin';
}

function adminErrorMessage(error: string) {
  if (error === 'admin_permission_denied') return 'Only superadmins can manage admin accounts and permissions.';
  return `Could not complete that action (${error}).`;
}

function AdminAccountLink({ admin }: { admin: AdminUserRow }) {
  return (
    <Link key={admin.id} href={`/admin/users/${admin.id}`} className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-lg font-semibold text-slate-950">{adminDisplayName(admin)}</p>
          <p className="mt-2 break-all text-sm text-slate-500">{admin.email || 'No email'}</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${admin.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
            {admin.is_active ? 'Active' : 'Archived'}
          </span>
          {admin.is_superadmin ? (
            <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-800">Superadmin</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  await requireManageAdmins('/admin/access-denied?section=manage_admins');
  const supabase = await createClient();
  const error = typeof searchParams?.error === 'string' ? searchParams.error : '';
  const { data: adminUsers } = await supabase
    .from('profiles')
    .select('id,email,full_name,is_active,is_superadmin')
    .eq('is_admin', true)
    .order('created_at', { ascending: false });
  const activeAdmins = ((adminUsers ?? []) as AdminUserRow[]).filter((admin) => admin.is_active !== false);
  const archivedAdmins = ((adminUsers ?? []) as AdminUserRow[]).filter((admin) => admin.is_active === false);

  return (
    <div className="space-y-8">
      {error ? <div className="card text-sm text-red-700">{adminErrorMessage(error)}</div> : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="eyebrow">Admin Accounts</span>
          <h1 className="page-title mt-4">Admins</h1>
          <p className="page-subtitle mt-3">Create admin logins, review access, and manage superadmin-only permissions.</p>
        </div>
        <Link href="/admin/admins/new" className="btn-primary w-full sm:w-auto">
          Add Admin
        </Link>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Active admins</h2>
            <p className="mt-1 text-sm text-slate-500">Admins who can currently sign in.</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">{activeAdmins.length}</span>
        </div>
        {!activeAdmins.length ? <div className="card text-sm text-slate-600">No active admin accounts found.</div> : null}
        {activeAdmins.map((admin) => <AdminAccountLink key={admin.id} admin={admin} />)}
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Deactivated / archived</h2>
            <p className="mt-1 text-sm text-slate-500">Admins kept for history, but blocked from signing in.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{archivedAdmins.length}</span>
        </div>
        {!archivedAdmins.length ? <div className="card text-sm text-slate-600">No deactivated or archived admin accounts found.</div> : null}
        {archivedAdmins.map((admin) => <AdminAccountLink key={admin.id} admin={admin} />)}
      </section>
    </div>
  );
}

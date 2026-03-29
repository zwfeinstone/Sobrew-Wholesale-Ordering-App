import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function UsersPage() {
  const supabase = await createClient();
  const [{ data: centers }, { data: centerMembers }, { data: adminUsers }] = await Promise.all([
    supabase.from('centers').select('id,name,is_active,created_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id,center_id,is_active').eq('is_admin', false).not('center_id', 'is', null),
    supabase.from('profiles').select('id,email,full_name,is_active,is_admin').eq('is_admin', true).order('created_at', { ascending: false }),
  ]);

  const memberCountsByCenterId = new Map<string, number>();
  const activeMemberCountsByCenterId = new Map<string, number>();
  for (const member of centerMembers ?? []) {
    if (!member.center_id) continue;
    memberCountsByCenterId.set(member.center_id, (memberCountsByCenterId.get(member.center_id) ?? 0) + 1);
    if (member.is_active) {
      activeMemberCountsByCenterId.set(member.center_id, (activeMemberCountsByCenterId.get(member.center_id) ?? 0) + 1);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <span className="eyebrow">Center Admin</span>
          <h1 className="page-title mt-4">Centers</h1>
          <p className="page-subtitle mt-3">Create centers, add or remove login access, and keep product pricing tied to the center instead of a single employee account.</p>
        </div>
        <Link href="/admin/users/new" className="btn-primary">Add Center</Link>
      </div>

      <section className="space-y-4">
        {!centers?.length ? <div className="card text-sm text-slate-600">No centers yet.</div> : null}
        {centers?.map((center: any) => (
          <Link key={center.id} href={`/admin/users/${center.id}`} className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95">
            <p className="text-lg font-semibold text-slate-950">{center.name}</p>
            <p className="mt-2 text-sm text-slate-500">
              {center.is_active ? 'Active center' : 'Inactive center'} • {activeMemberCountsByCenterId.get(center.id) ?? 0} active login(s) • {memberCountsByCenterId.get(center.id) ?? 0} total login(s)
            </p>
          </Link>
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <span className="eyebrow">Admin Accounts</span>
          <h2 className="page-title mt-4 text-3xl">Admin logins</h2>
        </div>
        {!adminUsers?.length ? <div className="card text-sm text-slate-600">No admin accounts found.</div> : null}
        {adminUsers?.map((user: any) => (
          <Link key={user.id} href={`/admin/users/${user.id}`} className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95">
            <p className="text-lg font-semibold text-slate-950">{user.full_name || user.email}</p>
            <p className="mt-2 text-sm text-slate-500">{user.email}</p>
            <p className="mt-2 text-sm text-slate-500">{!user.is_active ? 'Deactivated' : 'Active'}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}

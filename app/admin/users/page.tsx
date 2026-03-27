import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function UsersPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('id,email,full_name,is_active,is_admin').order('created_at', { ascending: false });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <span className="eyebrow">Customer Admin</span>
          <h1 className="page-title mt-4">Users</h1>
        </div>
        <Link href="/admin/users/new" className="btn-primary">Add New User</Link>
      </div>
      {data?.map((u) => (
        <Link key={u.id} href={`/admin/users/${u.id}`} className="card block transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/95">
          <p className="text-lg font-semibold text-slate-950">{u.email}</p>
          <p className="mt-2 text-sm text-slate-500">{u.is_admin ? 'Admin user' : 'Portal user'} {!u.is_active ? '• Deactivated' : '• Active'}</p>
        </Link>
      ))}
    </div>
  );
}

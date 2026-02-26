import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function UsersPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('profiles').select('id,email,full_name,is_active,is_admin').order('created_at', { ascending: false });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <Link href="/admin/users/new" className="btn-primary">New user wizard</Link>
      </div>
      {data?.map((u) => (
        <Link key={u.id} href={`/admin/users/${u.id}`} className="card block">
          {u.email} {u.is_admin ? '(admin)' : ''} {!u.is_active ? '(deactivated)' : ''}
        </Link>
      ))}
    </div>
  );
}

import { requireAdmin } from '@/lib/auth';
import { getAdminAccessForProfile } from '@/lib/admin-permissions';
import { isOwnerEmail } from '@/lib/admin-permission-definitions';
import { createClient } from '@/lib/supabase/server';
import { AdminShell } from '@/components/admin-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireAdmin();
  const supabase = await createClient();
  const [{ count }, access] = await Promise.all([
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'New').is('archived_at', null),
    getAdminAccessForProfile({ email: user.email || profile?.email, profileId: profile.id, supabase }),
  ]);

  return (
    <AdminShell access={access} isOwner={isOwnerEmail(user.email || profile?.email)} newOrders={count ?? 0}>
      {children}
    </AdminShell>
  );
}

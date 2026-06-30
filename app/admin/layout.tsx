import { requireAdmin } from '@/lib/auth';
import { getAdminAccessForProfile } from '@/lib/admin-permissions';
import { canViewAdminSection, hasSuperadminAccess } from '@/lib/admin-permission-definitions';
import { getPayrollStatus } from '@/lib/payroll-status';
import { createClient } from '@/lib/supabase/server';
import { AdminShell } from '@/components/admin-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireAdmin();
  const supabase = await createClient();
  const [{ count }, access] = await Promise.all([
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'New').is('archived_at', null),
    getAdminAccessForProfile({ email: user.email || profile?.email, isSuperadmin: profile?.is_superadmin, profileId: profile.id, supabase }),
  ]);
  const isSuperadmin = hasSuperadminAccess(user.email || profile?.email, profile?.is_superadmin);
  const payrollStatus = canViewAdminSection(access, 'payroll') ? await getPayrollStatus() : null;

  return (
    <AdminShell access={access} isOwner={isSuperadmin} newOrders={count ?? 0} payrollBadgeCount={payrollStatus?.badgeCount ?? 0}>
      {children}
    </AdminShell>
  );
}

import { getCurrentAdminAccess } from '@/lib/admin-permissions';
import { canViewAdminSection } from '@/lib/admin-permission-definitions';
import { getCachedNewOrderCount } from '@/lib/admin-order-status';
import { getCachedPayrollStatus } from '@/lib/payroll-status';
import { AdminShell } from '@/components/admin-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentAdminAccess();
  const canSeeOrderAlerts = canViewAdminSection(current.access, 'orders')
    || canViewAdminSection(current.access, 'planning')
    || canViewAdminSection(current.access, 'production');
  const [newOrders, payrollStatus] = await Promise.all([
    canSeeOrderAlerts ? getCachedNewOrderCount() : Promise.resolve(0),
    canViewAdminSection(current.access, 'payroll') ? getCachedPayrollStatus() : Promise.resolve(null),
  ]);

  return (
    <AdminShell
      access={current.access}
      isOwner={current.isOwner}
      newOrders={newOrders}
      payrollBadgeCount={payrollStatus?.badgeCount ?? 0}
    >
      {children}
    </AdminShell>
  );
}

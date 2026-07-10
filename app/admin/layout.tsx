import { getCurrentAdminAccess } from '@/lib/admin-permissions';
import { canViewAdminSection } from '@/lib/admin-permission-definitions';
import { getCachedNewOrderCount } from '@/lib/admin-order-status';
import { getCachedPayrollStatus } from '@/lib/payroll-status';
import { AdminShell } from '@/components/admin-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentAdminAccess();
  const [newOrders, payrollStatus] = await Promise.all([
    canViewAdminSection(current.access, 'orders') ? getCachedNewOrderCount() : Promise.resolve(0),
    canViewAdminSection(current.access, 'payroll') ? getCachedPayrollStatus() : Promise.resolve(null),
  ]);

  return (
    <AdminShell
      access={current.access}
      centerScope={current.centerScope}
      isOwner={current.isOwner}
      newOrders={newOrders}
      payrollBadgeCount={payrollStatus?.badgeCount ?? 0}
    >
      {children}
    </AdminShell>
  );
}

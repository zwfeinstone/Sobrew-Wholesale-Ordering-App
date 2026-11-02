import { getCurrentAdminAccess } from '@/lib/admin-permissions';
import { canViewAdminSection } from '@/lib/admin-permission-definitions';
import { getCachedNewOrderCount } from '@/lib/admin-order-status';
import { getCachedPayrollStatus } from '@/lib/payroll-status';
import { createPagePerformance, pagePerformanceEnabled } from '@/lib/page-performance';
import { NavigationPerformanceObserver } from '@/components/page-performance';
import { AdminShell } from '@/components/admin-shell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const timing = createPagePerformance('admin_layout');
  const current = await getCurrentAdminAccess();
  timing.checkpoint('authentication');
  const canSeeOrderAlerts = canViewAdminSection(current.access, 'orders')
    || canViewAdminSection(current.access, 'planning')
    || canViewAdminSection(current.access, 'production');
  const [newOrders, payrollStatus] = await Promise.all([
    canSeeOrderAlerts ? getCachedNewOrderCount() : Promise.resolve(0),
    canViewAdminSection(current.access, 'payroll') ? getCachedPayrollStatus() : Promise.resolve(null),
  ]);

  timing.checkpoint('badges');
  timing.finish();
  return (
    <AdminShell
      access={current.access}
      isOwner={current.isOwner}
      newOrders={newOrders}
      payrollBadgeCount={payrollStatus?.badgeCount ?? 0}
    >
      {pagePerformanceEnabled() ? <NavigationPerformanceObserver /> : null}
      {children}
    </AdminShell>
  );
}

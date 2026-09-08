import Image from 'next/image';
import Link from 'next/link';
import { ReactNode } from 'react';
import { ArrowUpRight, Archive, Boxes, Building2, CalendarClock, ChartColumn, ClipboardList, Clock, Factory, FileText, Inbox, Landmark, LayoutDashboard, Megaphone, Package, PackagePlus, Repeat2, Settings2, Shield, Target, Trash2, Users, Wallet } from 'lucide-react';
import { ActiveNavLink } from '@/components/active-nav-link';
import { AdminNavigationDrawer, AdminNavGroup } from '@/components/admin-navigation-drawer';
import { AdminReadOnlyGuard } from '@/components/admin-read-only-guard';
import { AdminRealtimeSync } from '@/components/admin-realtime-sync';
import { LogoutButton } from '@/components/logout-button';
import { ADMIN_NAV_LINKS, canViewAdminSection, type AdminAccessMap, type AdminPermissionKey } from '@/lib/admin-permission-definitions';

const ADMIN_NAV_GROUPS: Array<{ label: string; sections: AdminPermissionKey[]; initialOpen?: boolean }> = [
  { label: 'Commerce', sections: ['orders', 'recurring_orders', 'centers', 'products'], initialOpen: true },
  { label: 'Operations', sections: ['inventory', 'receiving', 'planning', 'production'], initialOpen: true },
  { label: 'Growth', sections: ['sales', 'sales_admin', 'prospecting', 'marketing', 'commission'] },
  { label: 'Finance', sections: ['accounting', 'invoicing', 'reports'] },
  { label: 'Team', sections: ['payroll', 'time_clock', 'week_hours'] },
  { label: 'Administration', sections: ['settings', 'manage_admins'] },
];
const icons: Partial<Record<AdminPermissionKey, typeof Inbox>> = {
  dashboard: LayoutDashboard, orders: Inbox, archived_orders: Archive, recurring_orders: Repeat2, canceled_recurring_orders: CalendarClock,
  order_form: ClipboardList, centers: Building2, products: Package, inventory: Boxes, receiving: PackagePlus, planning: ClipboardList,
  production: Factory, sales: ChartColumn, sales_admin: Users, prospecting: Target, marketing: Megaphone, commission: Wallet,
  accounting: Landmark, invoicing: FileText, reports: ChartColumn, payroll: Wallet, time_clock: Clock, week_hours: CalendarClock,
  settings: Settings2, manage_admins: Shield,
};

export function AdminShell({ access, children, isOwner, newOrders, payrollBadgeCount = 0 }: {
  access: AdminAccessMap; children: ReactNode; isOwner: boolean; newOrders: number; payrollBadgeCount?: number;
}) {
  const links = ADMIN_NAV_LINKS.filter((link) => canViewAdminSection(access, link.sectionKey));
  const editableSections = Object.fromEntries(Object.entries(access).map(([key, state]) => [key, state.canEdit])) as Record<string, boolean>;
  const orderBadgeSection = ['orders', 'production', 'planning'].find((section) => links.some((link) => link.sectionKey === section));
  const renderLink = ({ name, href, exact, sectionKey }: (typeof links)[number], child = false) => {
    const Icon = icons[sectionKey] ?? FileText;
    return <ActiveNavLink key={href} className={`sidebar-link${child ? ' sidebar-child' : ''}`} exact={exact} href={href} prefetch={false}>
      <Icon aria-hidden="true" /><span>{name === 'Centers' ? 'Customers' : name}</span>
      {sectionKey === orderBadgeSection && newOrders > 0 ? <span className="admin-nav-count">{newOrders}</span> : null}
      {sectionKey === 'payroll' && payrollBadgeCount > 0 ? <span className="admin-nav-count">{payrollBadgeCount}</span> : null}
    </ActiveNavLink>;
  };
  const orderChildren = links.filter((link) => ['archived_orders', 'order_form'].includes(link.sectionKey));
  const recurringChildren = links.filter((link) => link.sectionKey === 'canceled_recurring_orders');
  return (
    <div className="admin-shell" data-admin-can-write={isOwner ? 'true' : 'false'}>
      <AdminRealtimeSync enabled={Boolean(orderBadgeSection)} />
      <AdminReadOnlyGuard editableSections={editableSections} isOwner={isOwner} />
      <AdminNavigationDrawer>
        <Link href={links[0]?.href ?? '/admin/access-denied'} prefetch={false} className="admin-brand"><Image src="/sobrew-logo.png" alt="Sobrew logo" width={40} height={40} /><div><strong>Sobrew</strong><small>Wholesale operations</small></div></Link>
        <nav className="admin-nav" aria-label="Admin navigation">
          {links.filter((link) => link.sectionKey === 'dashboard').map((link) => renderLink(link))}
          {ADMIN_NAV_GROUPS.map((group) => {
            const groupLinks = links.filter((link) => group.sections.includes(link.sectionKey));
            if (!groupLinks.length && !(group.label === 'Commerce' && (orderChildren.length || recurringChildren.length))) return null;
            return <AdminNavGroup key={group.label} label={group.label} paths={groupLinks.map((link) => link.href)} initialOpen={group.initialOpen}>
              {groupLinks.map((link) => <div key={link.href}>
                {renderLink(link)}
                {link.sectionKey === 'orders' ? <AdminNavGroup label="Order history & tools" paths={[...orderChildren.map((child) => child.href), '/admin/orders/trash']}>
                  {orderChildren.map((child) => renderLink(child, true))}
                  {access.orders.canEdit ? <ActiveNavLink href="/admin/orders/trash" className="sidebar-link sidebar-child" prefetch={false}><Trash2 aria-hidden="true" /><span>Recently deleted</span></ActiveNavLink> : null}
                </AdminNavGroup> : null}
                {link.sectionKey === 'recurring_orders' && recurringChildren.length ? <AdminNavGroup label="Recurring history" paths={recurringChildren.map((child) => child.href)}>{recurringChildren.map((child) => renderLink(child, true))}</AdminNavGroup> : null}
              </div>)}
              {group.label === 'Commerce' && !links.some((link) => link.sectionKey === 'orders') ? orderChildren.map((link) => renderLink(link)) : null}
              {group.label === 'Commerce' && !links.some((link) => link.sectionKey === 'recurring_orders') ? recurringChildren.map((link) => renderLink(link)) : null}
            </AdminNavGroup>;
          })}
        </nav>
        <div className="admin-sidebar-footer"><span>{isOwner ? 'Owner workspace' : 'Team workspace'}</span><LogoutButton className="admin-logout" /></div>
      </AdminNavigationDrawer>
      <main className="admin-main" id="main-content">
        <div className="admin-topbar"><span>Workspace</span><Link href="/portal" prefetch={false}>Customer portal <ArrowUpRight aria-hidden="true" /></Link></div>
        <div className="admin-page-content">{children}</div>
      </main>
    </div>
  );
}

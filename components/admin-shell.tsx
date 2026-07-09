import Image from 'next/image';
import Link from 'next/link';
import { ReactNode } from 'react';
import { ActiveNavLink } from '@/components/active-nav-link';
import { AdminMobileSectionSelect } from '@/components/admin-mobile-section-select';
import { AdminReadOnlyGuard } from '@/components/admin-read-only-guard';
import { AdminRealtimeSync } from '@/components/admin-realtime-sync';
import { LogoutButton } from '@/components/logout-button';
import { ADMIN_NAV_LINKS, canViewAdminSection, type AdminAccessMap, type AdminPermissionKey } from '@/lib/admin-permission-definitions';

const ADMIN_NAV_GROUPS: Array<{ label: string; sections: AdminPermissionKey[] }> = [
  { label: 'Overview', sections: ['dashboard'] },
  { label: 'Commerce', sections: ['orders', 'recurring_orders', 'canceled_recurring_orders', 'archived_orders', 'order_form', 'centers', 'products'] },
  { label: 'Operations', sections: ['inventory', 'receiving', 'planning', 'production'] },
  { label: 'Growth', sections: ['sales', 'sales_admin', 'prospecting', 'marketing', 'commission'] },
  { label: 'Finance & team', sections: ['reports', 'payroll', 'time_clock', 'week_hours', 'settings'] },
];

export function AdminShell({
  access,
  children,
  isOwner,
  newOrders,
  payrollBadgeCount = 0,
}: {
  access: AdminAccessMap;
  children: ReactNode;
  isOwner: boolean;
  newOrders: number;
  payrollBadgeCount?: number;
}) {
  const links = ADMIN_NAV_LINKS.filter((link) => canViewAdminSection(access, link.sectionKey));
  const editableSections = Object.fromEntries(Object.entries(access).map(([key, state]) => [key, state.canEdit])) as Record<string, boolean>;

  return (
    <div className="admin-shell min-h-screen md:flex" data-admin-can-write={isOwner ? 'true' : 'false'}>
      <AdminRealtimeSync />
      <AdminReadOnlyGuard editableSections={editableSections} isOwner={isOwner} />
      <aside className="admin-sidebar border-b border-white/40 bg-white/70 p-3 backdrop-blur-xl sm:p-4 md:min-h-screen md:w-72 md:border-b-0 md:border-r md:px-5 md:py-6">
        <div className="admin-summary-card card space-y-6 p-4 sm:p-5">
          <div className="admin-brand flex items-start gap-3">
            <div className="admin-brand-mark brand-mark h-14 w-14">
              <Image src="/sobrew-logo.png" alt="Sobrew logo" fill sizes="(max-width: 767px) 44px, 56px" className="object-contain" />
            </div>
            <div className="admin-brand-copy min-w-0">
              <span className="eyebrow">Admin Console</span>
              <h2 className="admin-title mt-3 text-xl font-semibold tracking-tight text-slate-950">Sobrew Admin</h2>
              <p className="admin-description mt-1 text-sm text-slate-500">Manage orders, customers, products, and recurring schedules in one place.</p>
            </div>
          </div>
          <div className="admin-attention stat-card">
            <p className="admin-attention-label text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Needs Attention</p>
            <p className="admin-attention-value mt-2 text-3xl font-semibold text-slate-950">{newOrders}</p>
            <p className="admin-attention-copy mt-1 text-sm text-slate-500">New orders awaiting review.</p>
          </div>
          <LogoutButton className="admin-logout btn-secondary w-full" />
        </div>
        <AdminMobileSectionSelect links={links} />
        <nav className="admin-nav mt-5" aria-label="Admin navigation">
          {ADMIN_NAV_GROUPS.map((group) => {
            const groupLinks = links.filter((link) => group.sections.includes(link.sectionKey));
            if (!groupLinks.length) return null;

            return (
              <section key={group.label} className="admin-nav-group">
                <p className="admin-nav-group-label">{group.label}</p>
                {groupLinks.map(({ name, href, exact, child }) => (
                  <ActiveNavLink
                    key={href}
                    className={`sidebar-link ${child ? 'md:ml-3 md:min-h-[2.5rem] md:text-sm' : ''}`}
                    exact={exact}
                    href={href}
                  >
                    <span>{name}</span>
                    {name === 'Orders' && newOrders > 0 ? <span className="rounded-full bg-rose-400 px-2.5 py-1 text-xs font-semibold text-white">{newOrders}</span> : null}
                    {name === 'Payroll' && payrollBadgeCount > 0 ? <span className="rounded-full bg-rose-400 px-2.5 py-1 text-xs font-semibold text-white">{payrollBadgeCount}</span> : null}
                  </ActiveNavLink>
                ))}
              </section>
            );
          })}
        </nav>
      </aside>
      <main className="admin-main min-w-0 flex-1 px-3 py-5 sm:px-4 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">
          <div className="admin-topbar">
            <p>Live operations workspace</p>
            <Link href="/portal">Open customer portal</Link>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

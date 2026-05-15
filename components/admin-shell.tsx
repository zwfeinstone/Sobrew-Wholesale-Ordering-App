import Image from 'next/image';
import { ReactNode } from 'react';
import { ActiveNavLink } from '@/components/active-nav-link';
import { AdminRealtimeSync } from '@/components/admin-realtime-sync';
import { LogoutButton } from '@/components/logout-button';

export function AdminShell({ children, newOrders }: { children: ReactNode; newOrders: number }) {
  const links = [
    { name: 'Dashboard', href: '/admin', exact: true },
    { name: 'Sales', href: '/admin/sales', exact: true },
    { name: 'Prospecting', href: '/admin/sales/prospecting', child: true },
    { name: 'Orders', href: '/admin/orders' },
    { name: 'Archived Orders', href: '/admin/archived-orders' },
    { name: 'Recurring Orders', href: '/admin/recurring-orders' },
    { name: 'Canceled Recurring Orders', href: '/admin/canceled-recurring-orders' },
    { name: 'Order Form', href: '/admin/order-form' },
    { name: 'Centers', href: '/admin/users' },
    { name: 'Products', href: '/admin/products' },
    { name: 'Inventory', href: '/admin/inventory' },
    { name: 'Settings', href: '/admin/settings' }
  ];
  return (
    <div className="admin-shell min-h-screen md:flex">
      <AdminRealtimeSync />
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
        <nav className="admin-nav mt-4 grid gap-2 sm:grid-cols-2 md:block md:space-y-2">
          {links.map(({ name, href, exact, child }) => (
            <ActiveNavLink
              key={href}
              className={`sidebar-link ${child ? 'md:ml-4 md:min-h-[2.65rem] md:text-sm' : ''}`}
              exact={exact}
              href={href}
            >
              <span>{name}</span>
              {name === 'Orders' && newOrders > 0 ? <span className="rounded-full bg-rose-500 px-2.5 py-1 text-xs font-semibold text-white">{newOrders}</span> : null}
            </ActiveNavLink>
          ))}
        </nav>
      </aside>
      <main className="admin-main min-w-0 flex-1 px-3 py-5 sm:px-4 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

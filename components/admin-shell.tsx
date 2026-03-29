import Link from 'next/link';
import { ReactNode } from 'react';
import { AdminRealtimeSync } from '@/components/admin-realtime-sync';
import { LogoutButton } from '@/components/logout-button';

export function AdminShell({ children, newOrders }: { children: ReactNode; newOrders: number }) {
  const links = [
    ['Dashboard', '/admin'],
    ['Orders', '/admin/orders'],
    ['Archived Orders', '/admin/archived-orders'],
    ['Recurring Orders', '/admin/recurring-orders'],
    ['Canceled Recurring Orders', '/admin/canceled-recurring-orders'],
    ['Order Form', '/admin/order-form'],
    ['Users', '/admin/users'],
    ['Products', '/admin/products'],
    ['Settings', '/admin/settings']
  ];
  return (
    <div className="min-h-screen md:flex">
      <AdminRealtimeSync />
      <aside className="border-b border-white/40 bg-white/70 p-4 backdrop-blur-xl md:min-h-screen md:w-72 md:border-b-0 md:border-r md:px-5 md:py-6">
        <div className="card space-y-6 p-5">
          <div className="space-y-3">
            <span className="eyebrow">Admin Console</span>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-950">Sobrew Admin</h2>
              <p className="mt-1 text-sm text-slate-500">Manage orders, customers, products, and recurring schedules in one place.</p>
            </div>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Needs Attention</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{newOrders}</p>
            <p className="mt-1 text-sm text-slate-500">New orders awaiting review.</p>
          </div>
          <LogoutButton className="btn-secondary w-full" />
        </div>
        <nav className="mt-4 space-y-2">
          {links.map(([name, href]) => (
            <Link
              key={href}
              className="flex items-center justify-between rounded-2xl border border-transparent bg-white/45 px-4 py-3 text-sm font-medium text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/60 hover:bg-white/90 hover:text-slate-950"
              href={href}
            >
              <span>{name}</span>
              {name === 'Orders' && newOrders > 0 ? <span className="rounded-full bg-rose-500 px-2.5 py-1 text-xs font-semibold text-white">{newOrders}</span> : null}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

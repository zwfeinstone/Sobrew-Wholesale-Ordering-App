import Link from 'next/link';
import { ReactNode } from 'react';

export function AdminShell({ children, newOrders }: { children: ReactNode; newOrders: number }) {
  const links = [
    ['Dashboard', '/admin'],
    ['Orders', '/admin/orders'],
    ['Users', '/admin/users'],
    ['Products', '/admin/products'],
    ['Settings', '/admin/settings']
  ];
  return (
    <div className="min-h-screen md:flex">
      <aside className="w-full border-r bg-white p-4 md:w-64">
        <h2 className="mb-4 text-lg font-semibold">SoBrew Admin</h2>
        <nav className="space-y-1">
          {links.map(([name, href]) => (
            <Link key={href} className="block rounded px-3 py-2 hover:bg-slate-100" href={href}>
              {name}
              {name === 'Orders' && newOrders > 0 ? (
                <span className="ml-2 rounded bg-red-500 px-2 py-0.5 text-xs text-white">{newOrders}</span>
              ) : null}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-5">{children}</main>
    </div>
  );
}

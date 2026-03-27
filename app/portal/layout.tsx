import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { requireUser } from '@/lib/auth';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/40 bg-white/65 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <span className="eyebrow">Wholesale Portal</span>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Sobrew Ordering</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <nav className="flex flex-wrap gap-2 text-sm">
            <Link className="nav-pill" href="/portal">Catalog</Link>
            <Link className="nav-pill" href="/portal/cart">Cart</Link>
            <Link className="nav-pill" href="/portal/orders">Orders</Link>
            <Link className="nav-pill" href="/portal/recurring-orders">Recurring</Link>
            <Link className="nav-pill" href="/portal/settings">Settings</Link>
            {profile?.is_admin ? <Link className="nav-pill" href="/admin">Admin</Link> : null}
            </nav>
            <LogoutButton className="btn-secondary" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">{children}</main>
    </div>
  );
}

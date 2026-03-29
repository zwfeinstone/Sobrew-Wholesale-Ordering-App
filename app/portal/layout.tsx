import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { requireUser } from '@/lib/auth';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/40 bg-white/65 px-3 py-3 backdrop-blur-xl sm:px-4 sm:py-4">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <span className="eyebrow">Wholesale Portal</span>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Sobrew Ordering</h1>
          </div>
          <div className="flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <nav className="flex gap-2 overflow-x-auto pb-1 text-sm [scrollbar-width:none] [-ms-overflow-style:none] sm:flex-wrap sm:overflow-visible sm:pb-0">
            <Link className="nav-pill shrink-0 whitespace-nowrap" href="/portal">Catalog</Link>
            <Link className="nav-pill shrink-0 whitespace-nowrap" href="/portal/cart">Cart</Link>
            <Link className="nav-pill shrink-0 whitespace-nowrap" href="/portal/orders">Orders</Link>
            <Link className="nav-pill shrink-0 whitespace-nowrap" href="/portal/recurring-orders">Recurring</Link>
            <Link className="nav-pill shrink-0 whitespace-nowrap" href="/portal/settings">Settings</Link>
            {profile?.is_admin ? <Link className="nav-pill shrink-0 whitespace-nowrap" href="/admin">Admin</Link> : null}
            </nav>
            <LogoutButton className="btn-secondary w-full sm:w-auto" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 py-5 sm:px-4 md:px-6 md:py-8">{children}</main>
    </div>
  );
}

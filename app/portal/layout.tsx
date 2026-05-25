import Image from 'next/image';
import { ActiveNavLink } from '@/components/active-nav-link';
import { LogoutButton } from '@/components/logout-button';
import { PortalCartLink } from '@/components/portal-cart-link';
import { PortalMobileNav } from '@/components/portal-mobile-nav';
import { requireUser } from '@/lib/auth';
import { cartStorageKeyForUser } from '@/lib/cart';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireUser();
  const cartStorageKey = cartStorageKeyForUser(user.id);
  const centerName = !profile?.is_admin ? profile?.center?.name?.trim() : '';
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-white/40 bg-white/70 px-3 py-2 backdrop-blur-xl sm:px-4 sm:py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <div className="brand-mark h-10 w-10 sm:h-14 sm:w-14">
              <Image src="/sobrew-logo.png" alt="Sobrew logo" fill sizes="(max-width: 640px) 40px, 56px" className="object-contain" priority />
            </div>
            <div className="min-w-0">
              <span className="eyebrow portal-header-eyebrow">Wholesale Portal</span>
              <h1 className="truncate text-base font-semibold tracking-tight text-slate-950 sm:mt-2 sm:text-xl">Sobrew Ordering</h1>
              {centerName ? (
                <p className="mt-0.5 truncate text-xs font-medium text-slate-950 sm:mt-2 sm:text-sm">{centerName}</p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <nav className="hidden gap-2 overflow-x-auto pb-1 text-sm [scrollbar-width:none] [-ms-overflow-style:none] sm:flex-wrap sm:overflow-visible sm:pb-0 md:flex">
              <ActiveNavLink className="nav-pill shrink-0 whitespace-nowrap" exact href="/portal">Catalog</ActiveNavLink>
              <PortalCartLink storageKey={cartStorageKey} />
              <ActiveNavLink className="nav-pill shrink-0 whitespace-nowrap" href="/portal/orders">Orders</ActiveNavLink>
              <ActiveNavLink className="nav-pill shrink-0 whitespace-nowrap" href="/portal/recurring-orders">Recurring</ActiveNavLink>
              <ActiveNavLink className="nav-pill shrink-0 whitespace-nowrap" href="/portal/settings">Settings</ActiveNavLink>
              {profile?.is_admin ? <ActiveNavLink className="nav-pill shrink-0 whitespace-nowrap" href="/admin">Admin</ActiveNavLink> : null}
            </nav>
            <div className="flex items-center gap-1.5 md:hidden">
              <ActiveNavLink className="portal-header-action nav-pill justify-center" href="/portal/settings">Settings</ActiveNavLink>
              <LogoutButton className="portal-header-action btn-secondary" />
            </div>
            <LogoutButton className="btn-secondary portal-header-desktop-logout" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-3 pb-32 pt-5 sm:px-4 md:px-6 md:py-8">{children}</main>
      <PortalMobileNav storageKey={cartStorageKey} />
    </div>
  );
}

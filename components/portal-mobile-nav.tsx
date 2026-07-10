'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCart } from '@/components/cart-client';

const MOBILE_NAV_LINKS = [
  { href: '/portal', label: 'Restock', exact: true },
  { href: '/portal/cart', label: 'Cart', exact: false },
  { href: '/portal/orders', label: 'Orders', exact: false },
] as const;

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalMobileNav({ storageKey }: { storageKey: string }) {
  const pathname = usePathname();
  const { itemCount } = useCart(storageKey);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreIsActive = pathname.startsWith('/portal/recurring-orders') || pathname.startsWith('/portal/settings');

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moreOpen]);

  if (pathname.startsWith('/portal/checkout')) return null;

  return (
    <>
      {moreOpen ? (
        <nav id="portal-mobile-more" className="portal-mobile-more-panel md:hidden" aria-label="More portal destinations">
          <Link href="/portal/recurring-orders">Recurring orders</Link>
          <Link href="/portal/settings">Account settings</Link>
        </nav>
      ) : null}
      <nav className="portal-mobile-nav md:hidden" aria-label="Portal mobile navigation">
        {MOBILE_NAV_LINKS.map((link) => {
          const active = isActive(pathname, link.href, link.exact);
          return (
            <Link
              key={link.href}
              aria-current={active ? 'page' : undefined}
              className={`portal-mobile-nav-item ${active ? 'is-active' : ''}`}
              href={link.href}
            >
              <span>{link.label}</span>
              {link.href === '/portal/cart' ? (
                <span className="portal-mobile-nav-count">{itemCount}</span>
              ) : null}
            </Link>
          );
        })}
        <button
          ref={moreButtonRef}
          aria-controls="portal-mobile-more"
          aria-expanded={moreOpen}
          className={`portal-mobile-nav-item ${moreIsActive || moreOpen ? 'is-active' : ''}`}
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
        >
          More
        </button>
      </nav>
    </>
  );
}

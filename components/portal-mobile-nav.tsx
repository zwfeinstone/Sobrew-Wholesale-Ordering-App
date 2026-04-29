'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CART_UPDATED_EVENT, readCartItemCount } from '@/components/cart-client';

const MOBILE_NAV_LINKS = [
  { href: '/portal', label: 'Catalog', exact: true },
  { href: '/portal/cart', label: 'Cart', exact: false },
  { href: '/portal/orders', label: 'Orders', exact: false },
  { href: '/portal/recurring-orders', label: 'Recurring', exact: false },
] as const;

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalMobileNav({ storageKey }: { storageKey: string }) {
  const pathname = usePathname();
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    const syncCount = () => setCartCount(readCartItemCount(storageKey));
    syncCount();
    window.addEventListener(CART_UPDATED_EVENT, syncCount as EventListener);
    window.addEventListener('storage', syncCount);
    return () => {
      window.removeEventListener(CART_UPDATED_EVENT, syncCount as EventListener);
      window.removeEventListener('storage', syncCount);
    };
  }, [storageKey]);

  return (
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
              <span className="portal-mobile-nav-count">{cartCount}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

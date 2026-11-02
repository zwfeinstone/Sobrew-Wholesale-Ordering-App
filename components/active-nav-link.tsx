'use client';

import { AdminNavigationLink } from '@/components/admin-navigation';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

type ActiveNavLinkProps = {
  children: ReactNode;
  className?: string;
  exact?: boolean;
  href: string;
  label?: string;
  prefetch?: boolean;
};

function isActivePath(pathname: string, href: string, exact: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ActiveNavLink({ children, className = '', exact = false, href, label, prefetch }: ActiveNavLinkProps) {
  const pathname = usePathname();
  const active = isActivePath(pathname, href, exact);

  return (
    <AdminNavigationLink
      aria-current={active ? 'page' : undefined}
      className={`${className} ${active ? 'is-active' : ''}`.trim()}
      href={href}
      label={label ?? (href === '/admin' ? 'Dashboard' : href.split('/').filter(Boolean).at(-1)!.replaceAll('-', ' '))}
      prefetch={prefetch}
    >
      {children}
    </AdminNavigationLink>
  );
}

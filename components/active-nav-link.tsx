'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

type ActiveNavLinkProps = {
  children: ReactNode;
  className?: string;
  exact?: boolean;
  href: string;
};

function isActivePath(pathname: string, href: string, exact: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ActiveNavLink({ children, className = '', exact = false, href }: ActiveNavLinkProps) {
  const pathname = usePathname();
  const active = isActivePath(pathname, href, exact);

  return (
    <Link
      aria-current={active ? 'page' : undefined}
      className={`${className} ${active ? 'is-active' : ''}`.trim()}
      href={href}
    >
      {children}
    </Link>
  );
}

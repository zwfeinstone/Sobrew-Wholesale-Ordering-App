'use client';

import { useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';

type AdminMobileSectionLink = {
  name: string;
  href: string;
  exact?: boolean;
};

function isActivePath(pathname: string, link: AdminMobileSectionLink) {
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

export function AdminMobileSectionSelect({ links }: { links: AdminMobileSectionLink[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeHref = useMemo(() => links.find((link) => isActivePath(pathname, link))?.href ?? '/admin', [links, pathname]);

  return (
    <div className="admin-mobile-section-select">
      <label className="sr-only" htmlFor="admin-mobile-section">Admin section</label>
      <select
        id="admin-mobile-section"
        className="input h-11 rounded-xl px-3 py-2 text-sm font-semibold"
        value={activeHref}
        onChange={(event) => router.push(event.target.value)}
      >
        {links.map((link) => (
          <option key={link.href} value={link.href}>
            {link.name}
          </option>
        ))}
      </select>
    </div>
  );
}

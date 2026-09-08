'use client';

import { Menu, X } from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useRef, useState } from 'react';

export function AdminNavigationDrawer({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  useEffect(() => { dialog.current?.close(); }, [pathname]);
  return <>
    <aside className="admin-sidebar admin-sidebar-desktop">{children}</aside>
    <header className="admin-mobile-header"><span className="flex items-center gap-2.5"><Image src="/sobrew-logo.png" alt="" width={32} height={32} /><strong>Sobrew</strong></span><button ref={trigger} type="button" className="icon-button" aria-label="Open navigation" onClick={() => dialog.current?.showModal()}><Menu aria-hidden="true" /></button></header>
    <dialog ref={dialog} className="admin-drawer" aria-label="Admin navigation" onClose={() => trigger.current?.focus()} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}><div className="admin-sidebar admin-sidebar-mobile"><button className="icon-button drawer-close" type="button" aria-label="Close navigation" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button>{children}</div></dialog>
  </>;
}

export function AdminNavGroup({ label, paths, initialOpen = false, children }: { label: string; paths: string[]; initialOpen?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const active = paths.some((path) => pathname === path || (path !== '/admin' && pathname.startsWith(`${path}/`)));
  const [open, setOpen] = useState(initialOpen || active);
  useEffect(() => { if (active) setOpen(true); }, [active, pathname]);
  return <details className="admin-nav-group" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary className="admin-nav-group-label">{label}</summary>{children}</details>;
}

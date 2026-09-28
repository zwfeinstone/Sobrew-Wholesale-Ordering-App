'use client';

import { createContext, useContext, useEffect, useRef, useTransition, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

const PaneNavigation = createContext<((href: string) => void) | null>(null);
export const useProspectingPaneNavigation = () => useContext(PaneNavigation);

/** A stable shell: changing the lead query replaces the editor, not the queue. */
export default function ProspectingLeadWorkspace({ leadId, queue, children }: { leadId: string; queue: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pane = useRef<HTMLDivElement>(null);
  const previousLeadId = useRef(leadId);

  useEffect(() => {
    if (previousLeadId.current === leadId) return;
    previousLeadId.current = leadId;
    if (!pane.current) return;
    pane.current.scrollTop = 0;
    if (!window.matchMedia('(min-width: 1280px)').matches) pane.current.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [leadId]);

  function navigate(href: string) {
    const target = new URL(href, location.href);
    // Saved submission receipts may still contain the former record URL.
    const legacyLead = target.pathname.match(/^\/admin\/sales\/prospecting\/([0-9a-f-]{36})$/i)?.[1];
    if (legacyLead) {
      target.pathname = '/admin/sales/prospecting';
      target.searchParams.set('lead', legacyLead);
    }
    startTransition(() => {
      if (target.pathname === location.pathname && target.search === location.search && !target.hash) router.refresh();
      else router.push(`${target.pathname}${target.search}${target.hash}`, { scroll: Boolean(target.hash) });
    });
  }

  function selectLead(event: MouseEvent<HTMLDivElement>) {
    // The document-level draft guard runs first and stops unconfirmed navigation.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.target || link.hasAttribute('download')) return;
    const target = new URL(link.href);
    if (target.origin !== location.origin || target.pathname !== '/admin/sales/prospecting' || !target.searchParams.has('lead')) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(`${target.pathname}${target.search}${target.hash}`);
  }

  return <PaneNavigation.Provider value={navigate}>
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]" onClickCapture={selectLead}>
      <aside data-prospecting-rail className="hidden min-w-0 xl:sticky xl:top-4 xl:block xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">{queue}</aside>
      <div role="region" aria-label="Lead details" aria-busy={pending} className="relative min-w-0">
        <div ref={pane} inert={pending} className="min-w-0 xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">{children}</div>
        {pending ? <div className="absolute inset-0 bg-white/75"><p role="status" className="sticky top-0 rounded-xl border border-teal-100 bg-white p-5 text-sm font-medium text-teal-800 shadow-sm">Loading lead…</p></div> : null}
      </div>
    </div>
  </PaneNavigation.Provider>;
}

'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

type NavigationOptions = { refreshCurrent?: boolean };
type PaneRequest = { href: string; kind: 'navigate' | 'refresh' };
const PaneNavigation = createContext<{ navigate: (href: string, options?: NavigationOptions) => void; refresh: () => void } | null>(null);
export const useProspectingPaneNavigation = () => useContext(PaneNavigation)?.navigate;
export const useProspectingPaneRefresh = () => useContext(PaneNavigation)?.refresh;

const currentHref = () => `${location.pathname}${location.search}${location.hash}`;

/** A stable shell: changing the lead query replaces the editor, not the queue. */
export default function ProspectingLeadWorkspace({ leadId, queue, children }: { leadId: string; queue: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [request, setRequest] = useState<PaneRequest | null>(null);
  const [slow, setSlow] = useState(false);
  const activeRequest = useRef<PaneRequest | null>(null);
  const refreshAfterNavigation = useRef(false);
  const pane = useRef<HTMLDivElement>(null);
  const previousLeadId = useRef(leadId);

  useEffect(() => {
    if (previousLeadId.current === leadId) return;
    previousLeadId.current = leadId;
    if (!pane.current) return;
    pane.current.scrollTop = 0;
    if (!window.matchMedia('(min-width: 1280px)').matches) pane.current.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [leadId]);

  const beginRequest = useCallback((next: PaneRequest) => {
    // Track intent synchronously: a second click may precede the pending render.
    activeRequest.current = next;
    setRequest(next);
    setSlow(false);
    startTransition(() => {
      if (next.kind === 'refresh') router.refresh();
      else router.push(next.href, { scroll: Boolean(new URL(next.href, location.href).hash) });
    });
  }, [router]);

  const refresh = useCallback(() => {
    // Next can orphan a refresh queued behind a superseded navigation. Wait
    // until the transition settles, and coalesce duplicate refresh requests.
    if (activeRequest.current || pending) {
      refreshAfterNavigation.current = true;
      return;
    }
    beginRequest({ href: currentHref(), kind: 'refresh' });
  }, [beginRequest, pending]);

  useEffect(() => {
    if (pending || !request || activeRequest.current !== request) return;
    activeRequest.current = null;
    setRequest(null);
    setSlow(false);
    if (refreshAfterNavigation.current) {
      refreshAfterNavigation.current = false;
      beginRequest({ href: currentHref(), kind: 'refresh' });
    }
  }, [pending, request, beginRequest]);

  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [pending, request]);

  useEffect(() => {
    function onPopState() {
      if (!activeRequest.current) return;
      const next: PaneRequest = { href: currentHref(), kind: 'navigate' };
      activeRequest.current = next;
      setRequest(next);
      setSlow(false);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((href: string, options?: NavigationOptions) => {
    const target = new URL(href, location.href);
    // Saved submission receipts may still contain the former record URL.
    const legacyLead = target.pathname.match(/^\/admin\/sales\/prospecting\/([0-9a-f-]{36})$/i)?.[1];
    if (legacyLead) {
      target.pathname = '/admin/sales/prospecting';
      target.searchParams.set('lead', legacyLead);
    }
    const nextHref = `${target.pathname}${target.search}${target.hash}`;
    if (activeRequest.current?.href === nextHref) {
      if (options?.refreshCurrent) refreshAfterNavigation.current = true;
      return;
    }
    if (!activeRequest.current && !pending && nextHref === currentHref()) {
      if (options?.refreshCurrent) refresh();
      return;
    }
    // Returning to the displayed lead during another load must supersede that
    // load with a navigation, even though the browser URL has not changed yet.
    beginRequest({ href: nextHref, kind: 'navigate' });
  }, [beginRequest, pending, refresh]);

  const navigation = useMemo(() => ({ navigate, refresh }), [navigate, refresh]);

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

  return <PaneNavigation.Provider value={navigation}>
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]" onClickCapture={selectLead}>
      <aside data-prospecting-rail className="hidden min-w-0 xl:sticky xl:top-4 xl:block xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">{queue}</aside>
      <div role="region" aria-label="Lead details" aria-busy={pending} className="relative min-w-0">
        <div ref={pane} inert={pending} className="min-w-0 xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">{children}</div>
        {pending ? <div className="absolute inset-0 bg-white/75"><div className="sticky top-0 space-y-3 rounded-xl border border-teal-100 bg-white p-5 text-sm font-medium text-teal-800 shadow-sm"><p role="status">{slow ? 'This lead is taking longer than usual to load.' : 'Loading lead…'}</p>{slow ? <button type="button" className="btn-primary" onClick={() => window.location.assign(activeRequest.current?.href || currentHref())}>Reload lead</button> : null}</div></div> : null}
      </div>
    </div>
  </PaneNavigation.Provider>;
}

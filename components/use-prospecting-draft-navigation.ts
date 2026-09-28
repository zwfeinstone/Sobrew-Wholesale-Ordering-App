'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { installProspectingHistoryGuard } from '@/lib/prospecting-history';
import { useProspectingPaneNavigation } from '@/components/prospecting-lead-workspace';

type BrowserNavigateEvent = Event & { canIntercept: boolean; navigationType: string; destination: { url: string; sameDocument: boolean } };

/** Browser unload + all in-app links share a single guard. Native traverse interception is progressive. */
export function useProspectingDraftNavigation(dirty: boolean, pending: boolean) {
  const router = useRouter();
  const navigatePane = useProspectingPaneNavigation();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const bypass = useRef(false);
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => { bypass.current = false; setDestination(null); }, [pathname, search]);
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if ((!dirty && !pending) || bypass.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download') || !/^https?:/.test(link.href)) return;
      const target = new URL(link.href);
      if (target.pathname === location.pathname && target.search === location.search && target.hash) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!pending) setDestination(link.href);
    }
    function onSubmit(event: SubmitEvent) {
      if ((!dirty && !pending) || bypass.current || !(event.target instanceof HTMLFormElement) || event.target.dataset.prospectingRecord === 'true') return;
      const form = event.target;
      if (form.method.toLowerCase() !== 'get') return;
      event.preventDefault(); event.stopImmediatePropagation();
      const url = new URL(form.action || location.href);
      url.search = new URLSearchParams(Array.from(new FormData(form).entries()).filter((entry): entry is [string, string] => typeof entry[1] === 'string')).toString();
      if (!pending) setDestination(url.href);
    }
    function onUnload(event: BeforeUnloadEvent) { if ((dirty || pending) && !bypass.current) { event.preventDefault(); event.returnValue = ''; } }
    function onNavigate(raw: Event) {
      const event = raw as BrowserNavigateEvent;
      if ((dirty || pending) && !bypass.current && event.navigationType === 'traverse' && event.cancelable && event.canIntercept) { event.preventDefault(); if (!pending) setDestination(event.destination.url); }
    }
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    document.addEventListener('click', onClick, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('beforeunload', onUnload);
    navigation?.addEventListener('navigate', onNavigate);
    const removeHistoryGuard = navigation ? null : installProspectingHistoryGuard(window, {
      shouldBlock: () => (dirty || pending) && !bypass.current,
      onBlocked: (href) => { if (!pending) setDestination(href); },
    });
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('submit', onSubmit, true); window.removeEventListener('beforeunload', onUnload); navigation?.removeEventListener('navigate', onNavigate); removeHistoryGuard?.(); };
  }, [dirty, pending]);
  function navigate(href: string) {
    bypass.current = true; setDestination(null);
    const target = new URL(href, location.href);
    if (target.origin !== location.origin) window.location.assign(target.href);
    else {
      // A push to the identical query may not trigger a React route update.
      if (target.pathname === location.pathname && target.search === location.search) bypass.current = false;
      const path = `${target.pathname}${target.search}${target.hash}`;
      if (navigatePane) navigatePane(path);
      else router.push(path, { scroll: false });
    }
  }
  return { destination, stay: () => setDestination(null), navigate, bypass };
}

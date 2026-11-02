'use client';

import { useEffect, useRef } from 'react';
import type { PagePerformanceSample } from '@/lib/page-performance';

let pendingNavigation: { href: string; start: number; kind?: string; feedback_ms?: number; frames?: number; retained_frames?: number; pending_frames?: number } | null = null;
let committedDocument = false;

/** Mounted only when diagnostics are enabled; observes navigation without changing it. */
export function NavigationPerformanceObserver() {
  useEffect(() => {
    let frame = 0;
    function observeContent() {
      cancelAnimationFrame(frame);
      const navigation = pendingNavigation;
      const heading = document.querySelector('.admin-page-content h1');
      if (!navigation || !heading) return;
      const observe = () => {
        if (pendingNavigation !== navigation || performance.now() - navigation.start > 30_000) return;
        navigation.frames = (navigation.frames ?? 0) + 1;
        if (heading.isConnected && heading.getClientRects().length) navigation.retained_frames = (navigation.retained_frames ?? 0) + 1;
        if (document.querySelector('[role="status"][data-navigation-pending="true"]')) navigation.pending_frames = (navigation.pending_frames ?? 0) + 1;
        frame = requestAnimationFrame(observe);
      };
      frame = requestAnimationFrame(observe);
    }
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname && url.search === location.search) return;
      pendingNavigation = { href: url.pathname + url.search, start: performance.now() };
    }
    function onNavigation(event: Event) {
      const detail = (event as CustomEvent<{ href: string; startedAt: number; kind: string }>).detail;
      const url = new URL(detail.href, location.origin);
      pendingNavigation = { href: url.pathname + url.search, start: detail.startedAt, kind: detail.kind };
      observeContent();
    }
    function onFeedback(event: Event) {
      const detail = (event as CustomEvent<{ href: string; elapsed: number }>).detail;
      const url = new URL(detail.href, location.origin);
      if (pendingNavigation?.href === url.pathname + url.search) pendingNavigation.feedback_ms = detail.elapsed;
    }
    document.addEventListener('click', onClick, true);
    window.addEventListener('admin:navigation-start', onNavigation);
    window.addEventListener('admin:navigation-feedback', onFeedback);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('admin:navigation-start', onNavigation);
      window.removeEventListener('admin:navigation-feedback', onFeedback);
      cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}

/** Commit is a browser milestone, not a measurement of pure React render CPU time. */
export function PagePerformanceMarker({ sample }: { sample: PagePerformanceSample | null }) {
  const marker = useRef<HTMLSpanElement>(null);
  const recorded = useRef<string | null>(null);
  useEffect(() => {
    if (!sample || recorded.current === sample.id) return;
    recorded.current = sample.id;
    const now = performance.now();
    const href = location.pathname + location.search;
    const pending = pendingNavigation?.href === href ? pendingNavigation : null;
    const initial = !committedDocument && !pending;
    committedDocument = true;
    const start = pending?.start ?? 0;
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const requests = performance.getEntriesByType('resource').filter((entry) => {
      const url = new URL(entry.name);
      url.searchParams.delete('_rsc');
      return entry.startTime >= start && url.origin === location.origin && url.pathname + url.search === href;
    }) as PerformanceResourceTiming[];
    const responseEnd = initial ? navigation?.responseEnd : requests.at(-1)?.responseEnd;
    const browser = {
      kind: pending ? pending.kind ?? 'link' : initial ? 'document' : 'unattributed',
      pending_feedback_ms: pending?.feedback_ms ?? null,
      observed_frames: pending?.frames ?? null,
      previous_content_visible_frames: pending?.retained_frames ?? null,
      pending_visible_frames: pending?.pending_frames ?? null,
      navigation_to_commit_ms: pending || initial ? Math.round((now - start) * 10) / 10 : null,
      response_to_commit_ms: responseEnd && responseEnd <= now ? Math.round((now - responseEnd) * 10) / 10 : null,
      document_ttfb_ms: initial && navigation ? Math.round(navigation.responseStart * 10) / 10 : null,
      route_requests: initial ? 1 : requests.length,
      middleware_auth_ms: (initial ? navigation : requests.at(-1))?.serverTiming?.find((entry) => entry.name === 'middleware_auth')?.duration ?? null,
    };
    if (pending) pendingNavigation = null;
    const result = JSON.stringify({ ...sample, browser });
    marker.current?.setAttribute('data-page-performance', result);
    console.info('[page-performance-browser]', result);
  }, [sample]);
  return sample ? <span ref={marker} hidden data-page-performance-server={JSON.stringify(sample)} /> : null;
}

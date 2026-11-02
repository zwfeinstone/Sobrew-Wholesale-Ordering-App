'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, Suspense, type ComponentProps, type FormEvent, type ReactNode } from 'react';
import { getReportPreloadTarget } from '@/lib/report-navigation-policy';

type Request = { href: string; label: string; startedAt: number; kind: 'link' | 'filter' };
type Navigation = {
  pending: Request | null;
  navigate: (href: string, label: string, kind?: Request['kind']) => void;
  preload: (href: string) => void;
};
const NavigationContext = createContext<Navigation | null>(null);
const currentHref = () => `${location.pathname}${location.search}${location.hash}`;

/** Keep Next's router in charge of cancellation, history and out-of-order responses. */
export function AdminNavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [request, setRequest] = useState<Request | null>(null);
  const activeRequest = useRef<Request | null>(null);
  const preloadState = useRef({ active: false, recent: new Map<string, number>(), attempts: [] as number[] });

  const navigate = useCallback((href: string, label: string, kind: Request['kind'] = 'link') => {
    const target = new URL(href, location.href);
    const nextHref = `${target.pathname}${target.search}${target.hash}`;
    if (activeRequest.current?.href === nextHref) return;
    if (!activeRequest.current && !isPending && nextHref === currentHref()) return;
    const next = { href: nextHref, label, kind, startedAt: performance.now() };
    // Synchronous intent also handles A → B → A before B has committed.
    activeRequest.current = next;
    setRequest(next);
    window.dispatchEvent(new CustomEvent('admin:navigation-start', { detail: next }));
    startTransition(() => router.push(nextHref, { scroll: target.pathname !== location.pathname || Boolean(target.hash) }));
  }, [isPending, router]);

  useEffect(() => {
    if (isPending || !request || activeRequest.current !== request) return;
    activeRequest.current = null;
    setRequest(null);
  }, [isPending, request]);

  useEffect(() => {
    function restore() {
      if (!activeRequest.current) return;
      const next = { href: currentHref(), label: 'previous page', kind: 'link' as const, startedAt: performance.now() };
      activeRequest.current = next;
      setRequest(next);
    }
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const preload = useCallback((href: string) => {
    const target = getReportPreloadTarget(href);
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (!target || activeRequest.current || target === getReportPreloadTarget(currentHref()) || document.visibilityState === 'hidden' || connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType ?? '')) return;
    const state = preloadState.current;
    const now = Date.now();
    state.attempts = state.attempts.filter((at) => now - at < 10_000);
    for (const [key, at] of state.recent) if (now - at >= 20_000) state.recent.delete(key);
    if (state.active || state.recent.has(target) || state.attempts.length >= 2) return;
    state.active = true;
    state.recent.set(target, now);
    state.attempts.push(now);
    // Warm scoped raw data only. Never retain a prefetched permission-bearing
    // page response; the actual navigation still authenticates and authorizes.
    void fetch(`/api/admin/report-preload?href=${encodeURIComponent(target)}`, { credentials: 'same-origin', cache: 'no-store' })
      .catch(() => undefined).finally(() => { state.active = false; });
  }, []);

  const value = useMemo(() => ({ pending: isPending ? request : null, navigate, preload }), [isPending, request, navigate, preload]);
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function AdminNavigationStatus() {
  const pending = useContext(NavigationContext)?.pending;
  const [slow, setSlow] = useState(false);
  const [feedbackMs, setFeedbackMs] = useState<number | null>(null);
  useEffect(() => {
    setSlow(false);
    setFeedbackMs(null);
    if (!pending) return;
    const elapsed = Math.round((performance.now() - pending.startedAt) * 10) / 10;
    setFeedbackMs(elapsed);
    window.dispatchEvent(new CustomEvent('admin:navigation-feedback', { detail: { href: pending.href, elapsed } }));
    const timer = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [pending]);
  return <div className="pointer-events-none sticky top-3 z-40 h-0" aria-live="polite" role="status" data-navigation-pending={pending ? 'true' : 'false'} data-navigation-feedback-ms={feedbackMs ?? undefined}>
    {pending ? <div className="pointer-events-auto ml-auto w-fit max-w-full rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm text-teal-900 shadow-lg">
      <p className="flex items-center gap-2 font-semibold"><span aria-hidden="true" className="h-3 w-3 animate-pulse rounded-full bg-teal-600 motion-reduce:animate-none" />Loading {pending.label}…</p>
      <p className="mt-1 text-xs text-slate-600">{slow ? 'This is taking longer than usual. You can choose another page or retry.' : 'Current results remain visible until the next page is ready.'}</p>
      {slow ? <a className="mt-2 inline-block underline" href={pending.href}>Reload destination</a> : null}
    </div> : null}
  </div>;
}

export function AdminNavigationContent({ children }: { children: ReactNode }) {
  const pending = useContext(NavigationContext)?.pending;
  // This boundary stays above Next's child-route key. A route loading.tsx is
  // remounted on pathname changes and would replace useful previous content.
  return <div className="admin-page-content" aria-busy={Boolean(pending)}><Suspense fallback={<section role="status" aria-live="polite" className="space-y-4">
    <p className="text-sm font-medium text-slate-600">Loading workspace…</p>
    <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse"><div className="h-14 rounded-xl bg-slate-100" /><div className="h-64 rounded-xl bg-slate-100" /></div>
  </section>}>{children}</Suspense></div>;
}

type NavigationLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate' | 'prefetch'> & { href: string; label: string; prefetch?: boolean };

export function AdminNavigationLink({ href, label, children, className = '', prefetch: _prefetch, onMouseEnter, onMouseLeave, onFocus, onBlur, ...props }: NavigationLinkProps) {
  const navigation = useContext(NavigationContext);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, [href]);
  const prepare = () => { cancel(); if (navigation && getReportPreloadTarget(href)) timer.current = setTimeout(() => navigation.preload(href), 200); };
  const pending = navigation?.pending?.href === href;
  return <Link {...props} href={href} prefetch={false} className={`${className}${pending ? ' ring-2 ring-teal-500 ring-inset' : ''}`} aria-busy={pending || undefined} data-navigation-link data-navigation-pending={pending ? 'true' : undefined}
    onNavigate={navigation ? (event) => { cancel(); event.preventDefault(); navigation.navigate(href, label); } : undefined}
    onMouseEnter={(event) => { onMouseEnter?.(event); prepare(); }} onMouseLeave={(event) => { onMouseLeave?.(event); cancel(); }}
    onFocus={(event) => { onFocus?.(event); prepare(); }} onBlur={(event) => { onBlur?.(event); cancel(); }}>
    {children}
  </Link>;
}

/** A native GET fallback, enhanced to keep report results mounted while filtering. */
export function AdminNavigationForm({ children, label = 'updated reports', className = '' }: { children: ReactNode; label?: string; className?: string }) {
  const navigation = useContext(NavigationContext);
  function submit(event: FormEvent<HTMLFormElement>) {
    if (!navigation || event.defaultPrevented) return;
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(form, submitter);
    const params = new URLSearchParams();
    for (const [key, value] of data) if (typeof value === 'string') params.append(key, value);
    navigation.navigate(`${location.pathname}?${params}`, label, 'filter');
  }
  return <form method="get" className={className} onSubmit={submit} data-navigation-form>{children}</form>;
}

export function AdminNavigationSubmit({ className = 'btn-primary', label = 'Update reports' }: { className?: string; label?: string }) {
  const pending = useContext(NavigationContext)?.pending?.kind === 'filter';
  return <button type="submit" className={className} data-press-lock="off" aria-busy={pending || undefined}>{pending ? 'Updating…' : label}</button>;
}

export function AdminNavigationRetry({ reset }: { reset?: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button className="btn-primary mt-4" type="button" disabled={pending} onClick={() => startTransition(() => { router.refresh(); reset?.(); })}>{pending ? 'Retrying…' : 'Try again'}</button>;
}

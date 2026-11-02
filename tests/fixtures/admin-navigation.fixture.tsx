import { Component, startTransition, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AdminNavigationContent, AdminNavigationForm, AdminNavigationLink,
  AdminNavigationProvider, AdminNavigationStatus, AdminNavigationSubmit,
} from '@/components/admin-navigation';
import ReportsError from '@/app/admin/reports/error';
import { ButtonPressLock } from '@/components/button-press-lock';
import '@/app/globals.css';

type Mode = 'normal' | 'slow' | 'hold' | 'fail';
type Route = { href: string; revision: number; kind: 'push' | 'replace' | 'restore' | 'retry' };
type Load = { ready: boolean; failed: boolean; promise: Promise<void>; complete: () => void };
type FixtureState = {
  renderedHref: string;
  nextMode: Mode;
  requests: { href: string; revision: number; mode: Mode; delayMs: number }[];
  commits: { href: string; revision: number }[];
  preloads: string[];
  feedback: { href: string; elapsed: number }[];
  navigate: (href: string, kind?: Route['kind']) => void;
  retry: () => void;
  subscribe: (listener: () => void) => () => void;
};
declare global { interface Window { adminNavigationFixture: FixtureState; } }

const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const startHref = '/admin/reports?report=overview';
const loads = new Map<number, Load>();
const fixture: FixtureState = window.adminNavigationFixture = {
  renderedHref: startHref, nextMode: 'normal', requests: [], commits: [], preloads: [], feedback: [],
  navigate: () => {}, retry: () => {},
  subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
// No fixture interaction reaches a real application API or modifies business data.
window.fetch = async (input) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (url.pathname !== '/api/admin/report-preload') throw new Error('Unexpected fixture network request');
  fixture.preloads.push(url.pathname + url.search);
  emit();
  return new Response(null, { status: 204 });
};
history.replaceState({}, '', startHref);
window.addEventListener('admin:navigation-feedback', (event) => {
  fixture.feedback.push((event as CustomEvent<{ href: string; elapsed: number }>).detail);
  emit();
});

const reports = [
  { id: 'overview', label: 'Overview A', delay: 150 },
  { id: 'centers', label: 'Centers B', delay: 1_200 },
  { id: 'recent_order_gpm', label: 'Recent C', delay: 300 },
  { id: 'sales', label: 'Sales D', delay: 600 },
  { id: 'simulator', label: 'Simulator E', delay: 450 },
];
function reportFor(href: string) {
  const url = new URL(href, location.href);
  if (url.pathname === '/admin') return { id: 'dashboard', label: 'Dashboard', delay: 900 };
  if (url.pathname === '/admin/orders') return { id: 'orders', label: 'Orders', delay: 1_500 };
  return reports.find((report) => report.id === url.searchParams.get('report')) || reports[0];
}

function prepare(route: Route) {
  const mode = fixture.nextMode;
  fixture.nextMode = 'normal';
  const delayMs = mode === 'slow' ? 12_000 : reportFor(route.href).delay;
  let complete = () => {};
  const load: Load = { ready: false, failed: mode === 'fail', promise: new Promise<void>((resolve) => {
    complete = () => { load.ready = true; resolve(); };
  }), complete: () => complete() };
  loads.set(route.revision, load);
  fixture.requests.push({ href: route.href, revision: route.revision, mode, delayMs });
  if (mode !== 'hold') setTimeout(load.complete, delayMs);
  emit();
}

function Telemetry() {
  const [, update] = useState(0);
  useEffect(() => fixture.subscribe(() => update((value) => value + 1)), []);
  return <details className="rounded-lg border bg-white p-3" open>
    <summary>Fixture request and navigation log</summary>
    <pre data-navigation-fixture-json className="mt-2 max-h-60 overflow-auto text-xs">{JSON.stringify({
      renderedHref: fixture.renderedHref, nextMode: fixture.nextMode,
      requests: fixture.requests, commits: fixture.commits, preloads: fixture.preloads, feedback: fixture.feedback,
    }, null, 2)}</pre>
  </details>;
}

class RouteError extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error ? <ReportsError error={this.state.error} reset={() => this.setState({ error: null })} /> : this.props.children;
  }
}

function Results({ route }: { route: Route }) {
  const load = loads.get(route.revision);
  if (load && !load.ready) throw load.promise;
  if (load?.failed) throw new Error('Isolated fixture report request failed. No business data was changed.');
  return <ReadyResults route={route} />;
}

function ReadyResults({ route }: { route: Route }) {
  const report = reportFor(route.href);
  const params = new URL(route.href, location.href).searchParams;
  return <section className="card space-y-4" data-fixture-results data-fixture-revision={route.revision}>
    <h1 className="page-title">{report.label} results</h1>
    <p>Retained report content: {report.label}. Amount: $1,234.00.</p>
    <p>Committed customer filter: <strong>{params.get('center') || 'All customers'}</strong></p>
    <p>Committed product filter: <strong>{params.get('product') || 'All products'}</strong></p>
    {new URL(route.href, location.href).pathname === '/admin/reports' ? <AdminNavigationForm label="filtered fixture reports" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="report" value={report.id} />
      <label>Customer filter<input className="input" name="center" defaultValue={params.get('center') || ''} /></label>
      <label>Product filter<select className="input" name="product" defaultValue={params.get('product') || ''}><option value="">All products</option><option value="coffee">Coffee</option><option value="tea">Tea</option></select></label>
      <AdminNavigationSubmit label="Apply fixture filters" />
    </AdminNavigationForm> : null}
  </section>;
}

function CommittedRoute({ route }: { route: Route }) {
  useLayoutEffect(() => {
    if (route.kind === 'push' || route.kind === 'replace') history[route.kind === 'replace' ? 'replaceState' : 'pushState']({}, '', route.href);
    fixture.renderedHref = route.href;
    fixture.commits.push({ href: route.href, revision: route.revision });
    emit();
  }, [route]);
  return <RouteError key={route.revision}><Results route={route} /></RouteError>;
}

function FixtureControls() {
  const [, update] = useState(0);
  useEffect(() => fixture.subscribe(() => update((value) => value + 1)), []);
  function chooseMode(next: Mode) { fixture.nextMode = next; emit(); }
  return <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white p-3">
    <span>Next request behavior:</span>
    {(['normal', 'slow', 'hold', 'fail'] as const).map((value) => <button className="btn-secondary" key={value} type="button" data-press-lock="off" aria-pressed={fixture.nextMode === value} onClick={() => chooseMode(value)}>{value === 'slow' ? 'Slow next request (12 seconds)' : value === 'hold' ? 'Hold next request' : value === 'fail' ? 'Fail next request' : 'Normal next request'}</button>)}
    <button className="btn-secondary" type="button" data-press-lock="off" onClick={() => { for (const load of loads.values()) load.complete(); }}>Release pending requests</button>
    <button className="btn-secondary" type="button" data-press-lock="off" onClick={() => history.back()}>Go back</button>
    <button className="btn-secondary" type="button" data-press-lock="off" onClick={() => history.forward()}>Go forward</button>
  </div>;
}

function Fixture() {
  const [route, setRoute] = useState<Route>({ href: startHref, revision: 0, kind: 'restore' });
  useEffect(() => {
    let revision = 0;
    fixture.navigate = (href, kind = 'push') => {
      const next = { href, kind, revision: ++revision };
      prepare(next);
      setRoute(next);
    };
    fixture.retry = () => startTransition(() => fixture.navigate(route.href, 'retry'));
    const restore = () => startTransition(() => fixture.navigate(`${location.pathname}${location.search}`, 'restore'));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  // The router is intentionally stable while route updates suspend.
  }, []);
  useEffect(() => { fixture.retry = () => startTransition(() => fixture.navigate(route.href, 'retry')); }, [route]);

  return <AdminNavigationProvider>
    <ButtonPressLock />
    <main className="mx-auto max-w-6xl space-y-5 p-6">
      <AdminNavigationStatus />
      <header><p className="eyebrow">Isolated navigation verification</p><p className="text-sm">Real navigation components, simulated report responses. No production requests or writes.</p></header>
      <nav aria-label="Fixture main menu" className="flex flex-wrap gap-2">
        <AdminNavigationLink className="btn-secondary" href="/admin" label="Dashboard">Dashboard</AdminNavigationLink>
        <AdminNavigationLink className="btn-secondary" href="/admin/orders" label="Orders">Orders</AdminNavigationLink>
      </nav>
      <nav aria-label="Fixture report tabs" className="flex flex-wrap gap-2">
        {reports.map((report) => <AdminNavigationLink className="btn-secondary" key={report.id} href={`/admin/reports?report=${report.id}`} label={report.label}>{report.label}</AdminNavigationLink>)}
      </nav>
      <FixtureControls />
      <AdminNavigationContent><CommittedRoute key={new URL(route.href, location.href).pathname} route={route} /></AdminNavigationContent>
      <Telemetry />
    </main>
  </AdminNavigationProvider>;
}
createRoot(document.getElementById('fixture-root')!).render(<Fixture />);

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActiveNavLink } from '@/components/active-nav-link';
import ReportsError from '@/app/admin/reports/error';
import { AdminNavigationForm, AdminNavigationSubmit } from '@/components/admin-navigation';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/orders', useRouter: () => ({}) }));
vi.mock('next/link', () => ({ default: ({ prefetch, onNavigate: _onNavigate, ...props }: Record<string, unknown>) => createElement('a', { ...props, 'data-automatic-prefetch': String(prefetch) }) }));
const adminShell = readFileSync(
  fileURLToPath(new URL('../components/admin-shell.tsx', import.meta.url)),
  'utf8'
);
const invoicingViewTabs = readFileSync(
  fileURLToPath(new URL('../components/invoicing-view-tabs.tsx', import.meta.url)),
  'utf8'
);
const invoicingRefreshButton = readFileSync(
  fileURLToPath(new URL('../components/invoicing-refresh-button.tsx', import.meta.url)),
  'utf8'
);

describe('admin navigation prefetch contract', () => {
  it('disables automatic prefetch for the large protected admin sidebar', () => {
    const html = renderToStaticMarkup(createElement(ActiveNavLink, { href: '/admin/orders', prefetch: true, children: 'Orders' }));
    expect(html).toContain('data-automatic-prefetch="false"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-navigation-link="true"');
    expect(adminShell).toMatch(/<ActiveNavLink[\s\S]*?href=\{href\}[\s\S]*?prefetch=\{false\}/u);
  });

  it('disables prefetch and exposes pending state for invoicing views', () => {
    expect(invoicingViewTabs).toContain('prefetch={false}');
    expect(invoicingViewTabs).toContain('pendingView');
    expect(invoicingViewTabs).toContain('aria-busy');
    expect(invoicingViewTabs).toContain('Loading ${view.label}...');
    expect(invoicingViewTabs).toContain('useTransition');
    expect(invoicingViewTabs).toContain('router.push(view.href)');
  });

  it('forces customer retries through a router refresh', () => {
    expect(invoicingRefreshButton).toContain('useTransition');
    expect(invoicingRefreshButton).toContain('router.refresh()');
  });

  it('keeps report rendering errors accessible and offers the shared retry control', () => {
    const html = renderToStaticMarkup(createElement(ReportsError, { error: new Error('Report unavailable'), reset: vi.fn() }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Report unavailable');
    expect(html).toMatch(/<button\b[^>]*type="button"[^>]*>Try again<\/button>/);
    expect(html).not.toContain('disabled=""');
  });

  it('allows newer report filters to supersede a pending GET request', () => {
    const html = renderToStaticMarkup(createElement(AdminNavigationForm, {
      children: createElement(AdminNavigationSubmit),
    }));
    expect(html).toContain('method="get"');
    expect(html).toContain('data-navigation-form="true"');
    expect(html).toContain('data-press-lock="off"');
    expect(html).not.toContain('disabled=""');
  });
});

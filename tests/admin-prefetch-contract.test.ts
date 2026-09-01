import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const activeNavLink = readFileSync(
  fileURLToPath(new URL('../components/active-nav-link.tsx', import.meta.url)),
  'utf8'
);
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
    expect(activeNavLink).toContain('prefetch?: boolean');
    expect(activeNavLink).toContain('prefetch={prefetch}');
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
});

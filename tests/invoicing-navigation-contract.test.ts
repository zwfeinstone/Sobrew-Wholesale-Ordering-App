import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminNavigationContent } from '@/components/admin-navigation';
const invoicingPage = readFileSync(
  fileURLToPath(new URL('../app/admin/invoicing/page.tsx', import.meta.url)),
  'utf8'
);

describe('invoicing navigation contract', () => {
  it('uses one accessible workspace loading boundary for main-menu transitions', () => {
    function PendingResult(): never { throw new Promise<void>(() => {}); }
    const html = renderToStaticMarkup(createElement(AdminNavigationContent, { children: createElement(PendingResult) }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Loading workspace…');
    expect(existsSync(fileURLToPath(new URL('../app/admin/loading.tsx', import.meta.url)))).toBe(false);
    for (const section of ['invoicing', 'orders', 'reports', 'sales/prospecting']) {
      expect(existsSync(fileURLToPath(new URL(`../app/admin/${section}/loading.tsx`, import.meta.url)))).toBe(false);
    }
  });

  it('renders available workspace content without replacing it with a loading fallback', () => {
    const html = renderToStaticMarkup(createElement(AdminNavigationContent, { children: createElement('p', null, 'Current report results') }));
    expect(html).toContain('Current report results');
    expect(html).not.toContain('Loading workspace…');
    expect(html).toContain('aria-busy="false"');
  });

  it('does not issue a redundant QuickBooks customer summary request', () => {
    expect(invoicingPage).not.toContain('getQuickBooksCustomerSummary');
    expect(invoicingPage).toContain('quickBooksCustomersResult.customers');
    expect(invoicingPage).toContain('quickBooksCustomers.length');
  });
});

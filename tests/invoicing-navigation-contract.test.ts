import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const invoicingLoading = readFileSync(
  fileURLToPath(new URL('../app/admin/invoicing/loading.tsx', import.meta.url)),
  'utf8'
);
const invoicingPage = readFileSync(
  fileURLToPath(new URL('../app/admin/invoicing/page.tsx', import.meta.url)),
  'utf8'
);

describe('invoicing navigation contract', () => {
  it('provides an accessible route-level loading fallback', () => {
    expect(invoicingLoading).toContain('export default function InvoicingLoading');
    expect(invoicingLoading).toContain('role="status"');
    expect(invoicingLoading).toContain('aria-live="polite"');
    expect(invoicingLoading).toContain('Loading invoicing...');
  });

  it('does not issue a redundant QuickBooks customer summary request', () => {
    expect(invoicingPage).not.toContain('getQuickBooksCustomerSummary');
    expect(invoicingPage).toContain('quickBooksCustomersResult.customers');
    expect(invoicingPage).toContain('quickBooksCustomers.length');
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const invoicingPage = readFileSync(
  fileURLToPath(new URL('../app/admin/invoicing/page.tsx', import.meta.url)),
  'utf8'
);
const invoiceDownloadRoute = readFileSync(
  fileURLToPath(new URL('../app/api/admin/quickbooks/invoices/download/route.ts', import.meta.url)),
  'utf8'
);

describe('invoicing sample order exclusion contract', () => {
  it('keeps prospecting sample orders out of the ready-to-invoice queue', () => {
    expect(invoicingPage).toContain("const PROSPECTING_SAMPLE_ORDER_KIND = 'prospecting_sample';");
    expect(invoicingPage).toContain('order.order_kind !== PROSPECTING_SAMPLE_ORDER_KIND');
    expect(invoicingPage).toMatch(
      /\.select\(INVOICE_ORDER_SELECT\)[\s\S]*?\.eq\('status', 'Shipped'\)[\s\S]*?\.neq\('order_kind', PROSPECTING_SAMPLE_ORDER_KIND\)[\s\S]*?\.is\('archived_at', null\)[\s\S]*?\.or\('quickbooks_invoice_id\.is\.null,invoice_status\.eq\.invoice_error'\)/
    );
  });

  it('blocks invoice creation actions from claiming prospecting sample orders', () => {
    expect(invoicingPage).toMatch(
      /\.select\('id,order_kind,status[\s\S]*?order\.order_kind === PROSPECTING_SAMPLE_ORDER_KIND/
    );
    expect((invoicingPage.match(/\.neq\('order_kind', PROSPECTING_SAMPLE_ORDER_KIND\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(invoiceDownloadRoute).toMatch(
      /\.select\('id,order_kind,status[\s\S]*?order_kind === PROSPECTING_SAMPLE_ORDER_KIND/
    );
    expect(invoiceDownloadRoute).toContain(".neq('order_kind', PROSPECTING_SAMPLE_ORDER_KIND)");
  });
});

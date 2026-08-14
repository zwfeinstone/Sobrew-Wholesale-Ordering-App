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
const quickBooksLib = readFileSync(
  fileURLToPath(new URL('../lib/quickbooks.ts', import.meta.url)),
  'utf8'
);

describe('invoicing sample order exclusion contract', () => {
  it('keeps prospecting sample orders out of the ready-to-invoice queue', () => {
    expect(invoicingPage).toContain("const PROSPECTING_SAMPLE_ORDER_KIND = 'prospecting_sample';");
    expect(invoicingPage).toContain('order.order_kind !== PROSPECTING_SAMPLE_ORDER_KIND');
    expect(invoicingPage).toMatch(
      /\.select\(INVOICE_ORDER_SELECT\)[\s\S]*?\.eq\('status', 'Shipped'\)[\s\S]*?\.neq\('order_kind', PROSPECTING_SAMPLE_ORDER_KIND\)[\s\S]*?\.in\('invoice_status', \['not_invoiced', 'invoicing', 'invoice_error'\]\)/
    );
  });

  it('lets admins mark manually sent QuickBooks invoices out of the ready queue', () => {
    expect(invoicingPage).toContain('async function markInvoiceSentManually');
    expect(invoicingPage).toContain("invoice_status: 'invoiced'");
    expect(invoicingPage).toContain('quickbooks_invoice_id: invoiceId || null');
    expect(invoicingPage).toContain('Mark sent manually in QuickBooks');
    expect(invoicingPage).toContain('Latest invoices recorded from the portal or marked sent manually.');
  });

  it('reconciles archived shipped orders against paid QuickBooks invoices before rendering the queue', () => {
    expect(invoicingPage).toContain('Archived order');
    expect(invoicingPage).toContain('reconcileQuickBooksPaidInvoicesForOrders');
    expect(invoicingPage).toContain('const queueOrders = orders.filter((order) => !reconciledOrderIds.has(order.id));');
    expect(invoicingPage).toContain('{queueOrders.map((order) => {');
    expect(quickBooksLib).toContain('export async function reconcileQuickBooksPaidInvoicesForOrders');
    expect(quickBooksLib).toContain('order.archived_at');
    expect(quickBooksLib).toContain("invoice_status: 'invoiced'");
    expect(invoiceDownloadRoute).not.toContain(".is('archived_at', null)");
    expect(invoiceDownloadRoute).not.toContain('(order as any).archived_at ||');
    expect(quickBooksLib).not.toContain('Archived orders cannot be invoiced.');
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

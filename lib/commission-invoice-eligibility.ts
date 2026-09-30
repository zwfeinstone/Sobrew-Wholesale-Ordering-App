import 'server-only';

import { getQuickBooksInvoiceReceivables } from '@/lib/quickbooks';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchAllByIds } from '@/lib/supabase/pagination';

type SupabaseLike = { from: (table: string) => any };
type InvoiceLinkedOrder = { id: string; quickbooks_invoice_id: string | null };

export type CommissionInvoiceEligibility = {
  error: string | null;
  missingInvoiceOrderIds: Set<string>;
  paidOrderIds: Set<string>;
  unpaidOrderIds: Set<string>;
};

function emptyEligibility(error: string | null = null): CommissionInvoiceEligibility {
  return {
    error,
    missingInvoiceOrderIds: new Set(),
    paidOrderIds: new Set(),
    unpaidOrderIds: new Set(),
  };
}

/**
 * Verify commission eligibility against the same live invoice balances used by
 * the invoicing tab. Local sync/payment IDs are not proof of full payment.
 * Call again immediately before recording a payout; never cache this result.
 */
export async function getCommissionInvoiceEligibility(
  orderIds: string[],
  supabase: SupabaseLike = supabaseAdmin,
): Promise<CommissionInvoiceEligibility> {
  const uniqueOrderIds = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];
  if (!uniqueOrderIds.length) return emptyEligibility();

  try {
    const ordersResult = await fetchAllByIds<InvoiceLinkedOrder>(uniqueOrderIds, (ids, from, to) => supabase
      .from('orders')
      .select('id,quickbooks_invoice_id')
      .in('id', ids)
      .order('id', { ascending: true })
      .range(from, to));
    if (ordersResult.error) {
      return emptyEligibility(`Unable to verify commission invoice links: ${ordersResult.error.message}`);
    }

    const orderInvoiceIds = new Map(ordersResult.data.map((order) => [order.id, order.quickbooks_invoice_id?.trim() ?? '']));
    const invoiceIds = [...new Set([...orderInvoiceIds.values()].filter(Boolean))];
    const receivables = invoiceIds.length
      ? await getQuickBooksInvoiceReceivables(invoiceIds)
      : { error: null, invoices: [], missingIds: [] };
    if (receivables.error) {
      return emptyEligibility(`Unable to verify paid QuickBooks invoices: ${receivables.error}`);
    }

    const invoicesById = new Map(receivables.invoices.map((invoice) => [invoice.id, invoice]));
    const missingInvoiceIds = new Set(receivables.missingIds);
    const eligibility = emptyEligibility();
    for (const orderId of uniqueOrderIds) {
      const invoiceId = orderInvoiceIds.get(orderId);
      const invoice = invoiceId ? invoicesById.get(invoiceId) : undefined;
      if (!invoiceId || !invoice || missingInvoiceIds.has(invoiceId)) {
        eligibility.missingInvoiceOrderIds.add(orderId);
      } else if (invoice.status === 'paid' && invoice.balanceCents === 0 && invoice.amountCents > 0) {
        // A voided/zero-value invoice cannot release a first-order spiff.
        eligibility.paidOrderIds.add(orderId);
      } else {
        eligibility.unpaidOrderIds.add(orderId);
      }
    }
    return eligibility;
  } catch (error) {
    return emptyEligibility(error instanceof Error ? error.message : 'Unable to verify paid QuickBooks invoices.');
  }
}

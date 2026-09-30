import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  order: {} as Record<string, any>,
  canEdit: true,
  authorize: vi.fn(),
  billing: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ access: {} }), adminCanEdit: () => state.canEdit,
}));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.authorize }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/lib/supabase/admin', () => ({ getSupabaseAdmin: () => database }));
vi.mock('@/lib/quickbooks', () => ({
  fulfillShippedOrderBilling: state.billing,
  getQuickBooksConnectionStatus: async () => ({ connected: true, grantedScopes: ['com.intuit.quickbooks.payment'], missingConfig: [] }),
  getQuickBooksSalesTaxSettings: async () => ({ states: [] }),
  getQuickBooksSavedPaymentMethodLookups: async () => [],
  reconcileQuickBooksPaidInvoicesForOrders: async () => ({ error: null, reconciled: [] }),
  buildQuickBooksReceivablesSummary: () => ({ unpaidCents: 0, overdueCents: 0, paidCents: 0 }),
  buildQuickBooksCustomerMatches: () => [],
  normalizeQuickBooksSavedPaymentMethodType: (type: string) => type || null,
  quickBooksSavedPaymentMethodLabel: () => 'Saved card',
  shouldCollectQuickBooksSalesTax: () => false,
}));

class Query {
  private filters: Array<(order: Record<string, any>) => boolean> = [];
  private singleRow = false;
  constructor(private table: string) {}
  select() { return this; }
  eq(key: string, value: unknown) { this.filters.push((order) => order[key] === value); return this; }
  neq(key: string, value: unknown) { this.filters.push((order) => order[key] !== value); return this; }
  in(key: string, values: unknown[]) { this.filters.push((order) => values.includes(order[key])); return this; }
  gte() { return this; }
  order() { return this; }
  limit() { return this; }
  single() { this.singleRow = true; return this; }
  then(resolve: (result: { data: unknown; error: null }) => unknown) {
    const rows = this.table === 'orders' && this.filters.every((filter) => filter(state.order)) ? [{ ...state.order }] : [];
    return Promise.resolve({ data: this.singleRow ? rows[0] ?? null : rows, error: null }).then(resolve);
  }
}
const database = { from: (table: string) => new Query(table) };

import InvoicingPage from '@/app/admin/invoicing/page';
import PendingSubmitButton from '@/components/pending-submit-button';

type Action = (data: FormData) => Promise<void>;
type NodeProps = { children?: ReactNode; action?: Action; label?: string; disabled?: boolean };
function findRetryButton(node: ReactNode, label: string): NodeProps | undefined {
  if (Array.isArray(node)) return node.map((child) => findRetryButton(child, label)).find(Boolean);
  if (!isValidElement<NodeProps>(node)) return;
  if (node.type === PendingSubmitButton && node.props.label === label) return node.props;
  return findRetryButton(node.props.children, label);
}
async function findRetryForm(node: ReactNode, label = 'Retry automatic billing'): Promise<{ action: Action; disabled: boolean } | undefined> {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = await findRetryForm(child, label);
      if (found) return found;
    }
    return;
  }
  if (!isValidElement<NodeProps>(node)) return;
  if (node.type === 'form' && node.props.action) {
    const button = findRetryButton(node.props.children, label);
    if (button) return { action: node.props.action, disabled: Boolean(button.disabled) };
  }
  if (typeof node.type === 'function' && node.type.constructor.name === 'AsyncFunction') {
    return findRetryForm(await (node.type as (props: NodeProps) => Promise<ReactNode>)(node.props), label);
  }
  return findRetryForm(node.props.children, label);
}
async function retryForm() {
  const retry = await findRetryForm(await InvoicingPage({ searchParams: Promise.resolve({}) }));
  expect(retry).toBeDefined();
  return retry!;
}
function form() {
  const data = new FormData();
  data.set('order_id', 'order-1');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.canEdit = true;
  state.order = {
    id: 'order-1', status: 'Shipped', order_kind: 'wholesale', archived_at: null,
    created_at: '2026-09-30T10:00:00Z', shipped_at: '2026-09-30T12:00:00Z', subtotal_cents: 2400,
    invoice_status: 'invoice_error', invoice_error: 'Invoice email unavailable',
    quickbooks_invoice_id: 'invoice-1', quickbooks_payment_id: 'payment-1',
    centers: { id: 'center-1', name: 'Customer', quickbooks_customer_id: 'customer-1' },
    order_items: [{ qty: 1, line_total_cents: 2400, product_name_snapshot: 'Coffee', products: { name: 'Coffee', quickbooks_item_id: 'item-1' } }],
  };
  state.authorize.mockResolvedValue(undefined);
  state.billing.mockResolvedValue({ status: 'paid' });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('automatic invoice retry action', () => {
  it('offers a retry for a recorded payment whose invoice email failed, and delegates resumption to billing', async () => {
    const retry = await retryForm();
    expect(retry.disabled).toBe(false);
    await expect(retry.action(form())).rejects.toThrow('toast=automatic_billing_complete');
    expect(state.authorize).toHaveBeenCalledExactlyOnceWith('/admin/invoicing?toast=admin_write_denied', 'invoicing');
    expect(state.billing).toHaveBeenCalledExactlyOnceWith('order-1');
    expect(state.authorize.mock.invocationCallOrder[0]).toBeLessThan(state.billing.mock.invocationCallOrder[0]);
    expect(state.revalidate).toHaveBeenCalledWith('/admin/invoicing');
    expect(state.revalidate).toHaveBeenCalledWith('/admin/orders/order-1');
  });

  it('disables the retry without invoicing edit access and rejects a direct unauthorized action call', async () => {
    state.canEdit = false;
    const retry = await retryForm();
    expect(retry.disabled).toBe(true);
    state.authorize.mockRejectedValue(new Error('Write denied'));
    await expect(retry.action(form())).rejects.toThrow('Write denied');
    expect(state.billing).not.toHaveBeenCalled();
  });

  it.each([
    ['sample order', { order_kind: 'prospecting_sample' }, 'invoice_not_ready'],
    ['unshipped order', { status: 'Processing' }, 'invoice_not_ready'],
    ['archived order', { archived_at: '2026-09-30T13:00:00Z' }, 'invoice_not_ready'],
    ['older order', { created_at: '2026-07-01T00:00:00Z' }, 'invoice_not_ready'],
    ['completed billing', { invoice_status: 'invoiced' }, 'automatic_billing_not_ready'],
    ['missing customer mapping', { centers: { quickbooks_customer_id: null } }, 'invoice_mapping_required'],
    ['missing product mapping', { order_items: [{ line_total_cents: 2400, products: { quickbooks_item_id: null } }] }, 'invoice_mapping_required'],
    ['no invoiceable lines', { order_items: [] }, 'invoice_no_line_items'],
  ])('rechecks eligibility before retrying a %s', async (_label, changes, toast) => {
    const retry = await retryForm();
    Object.assign(state.order, changes);
    await expect(retry.action(form())).rejects.toThrow(`toast=${toast}`);
    expect(state.billing).not.toHaveBeenCalled();
  });

  it.each([
    ['error', 'automatic_billing_failed'],
    ['skipped', 'automatic_billing_not_ready'],
  ])('does not report success when the retry returns %s', async (status, toast) => {
    const retry = await retryForm();
    state.billing.mockResolvedValue({ status, error: status === 'error' ? 'Still unavailable' : null });
    await expect(retry.action(form())).rejects.toThrow(`toast=${toast}`);
  });

  it.each([
    ['captured charge', 'quickbooks', { quickbooks_payment_charge_id: 'charge-1', quickbooks_payment_status: 'CAPTURED' }],
    ['uncertain charge', 'quickbooks', { quickbooks_payment_charge_id: null, quickbooks_payment_status: 'CHARGE_PENDING' }],
    ['captured charge', 'pdf', { quickbooks_payment_charge_id: 'charge-1', quickbooks_payment_status: 'CAPTURED' }],
    ['uncertain charge', 'pdf', { quickbooks_payment_charge_id: null, quickbooks_payment_status: 'CHARGE_PENDING' }],
  ])('blocks manual unpaid email after a %s via %s delivery', async (_kind, delivery, paymentState) => {
    Object.assign(state.order, paymentState, { quickbooks_payment_id: null });
    const invoice = await findRetryForm(await InvoicingPage({ searchParams: Promise.resolve({}) }),
      delivery === 'pdf' ? 'Create & send PDF' : 'Create & send invoice');
    expect(invoice).toBeDefined();
    expect(invoice!.disabled).toBe(true);
    const data = form();
    data.set('delivery', delivery);
    await expect(invoice!.action(data)).rejects.toThrow('toast=payment_review_required');
    expect(state.billing).not.toHaveBeenCalled();
  });
});

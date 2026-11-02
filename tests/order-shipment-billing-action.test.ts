import { isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  updateError: null as { message: string } | null,
  loseShipmentClaim: false,
  updates: [] as Record<string, unknown>[],
  authorize: vi.fn(),
  billing: vi.fn(),
  shopifyValidate: vi.fn(),
  shopifySync: vi.fn(),
  shippingEmail: vi.fn(),
  items: vi.fn(),
  cogs: vi.fn(),
  orderItems: [] as Array<Record<string, any>>,
  stockProducts: [] as Array<Record<string, any>>,
  stockBalances: [] as Array<Record<string, any>>,
  batchCostItems: [] as Array<Record<string, any>>,
  shippingBoxes: [] as Array<Record<string, any>>,
  boxWrites: [] as string[],
  itemUpdates: [] as Record<string, unknown>[],
  boxReadError: null as { message: string } | null,
  itemReadError: null as { message: string } | null,
  isOwner: true,
  canEdit: true,
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ isOwner: state.isOwner, access: { orders: { canEdit: state.canEdit } } }),
  requireAdminSectionEdit: vi.fn(),
}));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.authorize }));
vi.mock('@/lib/shopify', () => ({ syncShopifyFulfillment: state.shopifySync, validateShopifyOrderForShipment: state.shopifyValidate }));
vi.mock('@/lib/quickbooks', () => ({ fulfillShippedOrderBilling: state.billing }));
vi.mock('@/lib/email', () => ({ sendShippedEmail: state.shippingEmail }));
vi.mock('@/lib/center-logins', () => ({ getCenterLoginEmails: async () => ['shipping@example.com'] }));
vi.mock('@/lib/order-items', () => ({ getOrderItemSummaries: state.items }));
vi.mock('@/lib/order-cogs', () => ({ snapshotOrderCogsForShipment: state.cogs }));
vi.mock('@/lib/customer-stock', () => ({ loadCustomerStockBalances: async () => state.stockBalances }));
vi.mock('@/lib/commissions', () => ({ snapshotOrderCommissionForShipment: async () => ({ error: null }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/components/order-trash-dialog', () => ({ OrderTrashDialog: () => null }));
vi.mock('@/components/order-fulfillment-form', () => ({ default: () => null }));

class Query {
  private selectedColumns = '';
  private inPredicates: Array<(row: Record<string, unknown>) => boolean> = [];
  private mutation: Record<string, unknown> | null = null;
  private singleRow = false;
  private boxOperation = '';
  private inserts: Array<Record<string, unknown>> = [];
  private predicates: Array<(row: Record<string, unknown>) => boolean> = [];
  constructor(private table: string) {}
  select(columns = '') { this.selectedColumns = columns; return this; }
  eq(key: string, value: unknown) { this.predicates.push(row => row[key] === value); return this; }
  neq() { return this; }
  is(key: string, value: unknown) { this.predicates.push(row => (row[key] ?? null) === value); return this; }
  in(key: string, values: unknown[]) { this.inPredicates.push(row => values.includes(row[key])); return this; }
  delete() { this.boxOperation = 'delete'; return this; }
  insert(rows: Array<Record<string, unknown>>) { this.boxOperation = 'insert'; this.inserts = rows; return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  update(payload: Record<string, unknown>) { this.mutation = payload; return this; }
  single() { this.singleRow = true; return this; }
  then(resolve: (result: { data: unknown; error: { message: string } | null; count?: number }) => unknown) {
    if (this.table === 'customer_stock_product_allocations') {
      return Promise.resolve({ data: state.stockProducts.filter(row => this.inPredicates.every(predicate => predicate(row))), error: null }).then(resolve);
    }
    if (this.table === 'order_items' && this.selectedColumns.includes('orders(status,archived_at)')) {
      return Promise.resolve({ data: state.batchCostItems.filter(row => this.inPredicates.every(predicate => predicate(row))), error: null }).then(resolve);
    }
    if (this.table === 'order_item_shipping_boxes') {
      if (this.boxOperation) {
        state.boxWrites.push(this.boxOperation);
        if (this.boxOperation === 'delete') state.shippingBoxes = state.shippingBoxes.filter(row => !this.predicates.every(predicate => predicate(row)));
        else state.shippingBoxes.push(...this.inserts.map((row, index) => ({ id: `usage-${index}`, consumed_at: null, ...row })));
      }
      return Promise.resolve({ data: structuredClone(state.shippingBoxes), error: this.boxOperation ? null : state.boxReadError }).then(resolve);
    }
    if (this.table === 'order_items') {
      if (this.mutation) {
        state.itemUpdates.push(this.mutation);
        state.orderItems.filter(row => this.predicates.every(predicate => predicate(row))).forEach(row => Object.assign(row, this.mutation));
      }
      return Promise.resolve({ data: structuredClone(state.orderItems), error: this.mutation ? null : state.itemReadError }).then(resolve);
    }
    if (this.table === 'inventory_items') {
      return Promise.resolve({ data: [{ id: 'small-box', name: 'Small box', sku: 'BOX-SMALL' }, { id: 'large-box', name: 'Large box', sku: 'BOX-LARGE' }], error: null }).then(resolve);
    }
    if (this.table === 'orders' && this.mutation) {
      state.updates.push(this.mutation);
      if (state.updateError) return Promise.resolve({ data: null, error: state.updateError }).then(resolve);
      if (state.loseShipmentClaim) return Promise.resolve({ data: [], error: null }).then(resolve);
      Object.assign(state.order, this.mutation);
      return Promise.resolve({ data: [{ id: state.order.id }], error: null }).then(resolve);
    }
    return Promise.resolve({
      data: this.table === 'orders' ? this.singleRow ? { ...state.order } : [{ ...state.order }] : [],
      error: null,
      count: 0,
    }).then(resolve);
  }
}
const database = { from: (table: string) => new Query(table) };

import AdminOrderDetail from '@/app/admin/orders/[id]/page';
import OrderFulfillmentForm from '@/components/order-fulfillment-form';
import StatusToast from '@/components/status-toast';
import { ProductBoxUsageFields } from '@/components/product-box-usage-fields';
import PendingSubmitButton from '@/components/pending-submit-button';
import { CustomerStockSummary } from '@/components/customer-stock-summary';

type ShipmentAction = (data: FormData) => Promise<void>;
function findAction(node: ReactNode): ShipmentAction | undefined {
  if (Array.isArray(node)) return node.map(findAction).find(Boolean);
  if (!isValidElement<{ action?: ShipmentAction; children?: ReactNode }>(node)) return;
  if (node.type === OrderFulfillmentForm) return node.props.action;
  return findAction(node.props.children);
}
function hasSubmitLabel(node: ReactNode, label: string): boolean {
  if (Array.isArray(node)) return node.some(child => hasSubmitLabel(child, label));
  if (!isValidElement<{ label?: string; children?: ReactNode }>(node)) return false;
  return (node.type === PendingSubmitButton && node.props.label === label) || hasSubmitLabel(node.props.children, label);
}
function findFormAction(node: ReactNode, label: string): ShipmentAction | undefined {
  if (Array.isArray(node)) return node.map(child => findFormAction(child, label)).find(Boolean);
  if (!isValidElement<{ action?: ShipmentAction; children?: ReactNode }>(node)) return;
  if (node.type === 'form' && hasSubmitLabel(node.props.children, label)) return node.props.action;
  return findFormAction(node.props.children, label);
}
function toastMessages(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(toastMessages);
  if (!isValidElement<{ message?: string; children?: ReactNode }>(node)) return [];
  if (node.type === StatusToast) return [node.props.message ?? ''];
  return toastMessages(node.props.children);
}
function findBoxFields(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(findBoxFields).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return null;
  if (node.type === ProductBoxUsageFields) return node;
  return findBoxFields(node.props.children);
}
function treeText(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(treeText).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<{ children?: ReactNode }>(node) ? treeText(node.props.children) : '';
}
async function page(toast = '') {
  return AdminOrderDetail({ params: Promise.resolve({ id: 'order-1' }), searchParams: Promise.resolve({ toast }) });
}
async function action() {
  const ship = findAction(await page());
  expect(ship).toBeTypeOf('function');
  return ship!;
}
function form() {
  const data = new FormData();
  data.set('id', 'order-1');
  data.set('shipping_cost', '5.00');
  data.set('fulfillment_method', 'carrier');
  data.set('tracking_numbers', 'TRACK-123');
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.order = {
    id: 'order-1', center_id: 'center-1', status: 'Processing', subtotal_cents: 10000,
    archived_at: null, created_at: '2026-09-30T00:00:00Z', order_kind: 'standard',
    profiles: { email: 'creator@example.com', full_name: 'Order Creator' }, centers: { name: 'Customer' },
  };
  state.updateError = null;
  state.loseShipmentClaim = false;
  state.updates = [];
  state.orderItems = [];
  state.stockProducts = [];
  state.stockBalances = [];
  state.batchCostItems = [];
  state.shippingBoxes = [];
  state.boxWrites = [];
  state.itemUpdates = [];
  state.boxReadError = null;
  state.itemReadError = null;
  state.isOwner = true;
  state.canEdit = true;
  state.cogs.mockReset().mockResolvedValue({ error: null });
  state.authorize.mockResolvedValue(undefined);
  state.shopifyValidate.mockResolvedValue({ ok: true });
  state.shopifySync.mockResolvedValue({ status: 'synced' });
  state.billing.mockResolvedValue({ status: 'paid' });
  state.shippingEmail.mockResolvedValue({ ok: true });
  state.items.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

it('shows one shared pool and includes costs from both variants and the archived original sale', async () => {
  state.order = { ...state.order, status: 'Shipped', subtotal_cents: 0 };
  state.stockProducts = ['ground', 'whole'].map(product_id => ({
    allocation_id: 'shared-pool', product_id, inventory_product_id: 'ground', center_id: 'center-1', initial_order_id: 'original', initial_quantity: 1000,
  }));
  state.stockBalances = ['ground', 'whole'].map(product_id => ({
    allocation_id: 'shared-pool', product_id, initial_quantity: 1000, available_quantity: 850, reserved_quantity: 0, on_hand_quantity: 850, shared_product_count: 2,
  }));
  state.orderItems = ['ground', 'whole'].map(product_id => ({
    id: `${product_id}-line`, product_id, qty: 75, unit_price_cents: 0, line_total_cents: 0, product_name_snapshot: product_id,
  }));
  state.batchCostItems = [
    { product_id: 'ground', cogs_total_cents: 354631, orders: { status: 'Shipped', archived_at: '2026-10-20T23:31:16Z' } },
    { product_id: 'ground', cogs_total_cents: 20, orders: { status: 'Shipped', archived_at: null } },
    { product_id: 'whole', cogs_total_cents: 30, orders: { status: 'Shipped', archived_at: null } },
    { product_id: 'whole', cogs_total_cents: 999999, orders: { status: 'Processing', archived_at: null } },
    { product_id: 'unrelated', cogs_total_cents: 999999, orders: { status: 'Shipped', archived_at: null } },
  ];
  const tree = await page();
  function countSummaries(node: ReactNode): number {
    if (Array.isArray(node)) return node.reduce((sum, child) => sum + countSummaries(child), 0);
    if (!isValidElement<{ children?: ReactNode }>(node)) return 0;
    return Number(node.type === CustomerStockSummary) + countSummaries(node.props.children);
  }
  expect(countSummaries(tree)).toBe(1);
  expect(treeText(tree)).toContain('$3,546.81');
  expect(treeText(tree)).not.toContain('Verify that complimentary pricing');
});

describe('billing after shipment', () => {
  it.each([
    ['paid', 'order_shipped_paid'],
    ['invoiced', 'order_shipped_invoiced'],
    ['skipped', 'order_shipped'],
  ])('reports %s billing only after shipment is saved', async (status, toast) => {
    const ship = await action();
    state.billing.mockImplementation(async () => {
      expect(state.order.status).toBe('Shipped');
      expect(state.updates).toHaveLength(1);
      return { status };
    });
    await expect(ship(form())).rejects.toThrow(`REDIRECT /admin/orders/order-1?toast=${toast}`);
    expect(state.authorize).toHaveBeenCalledWith('/admin/orders/order-1?toast=admin_write_denied', 'orders');
    expect(state.billing).toHaveBeenCalledExactlyOnceWith('order-1');
    expect(state.shippingEmail).toHaveBeenCalledExactlyOnceWith(
      ['shipping@example.com'], [], [{ carrier: 'UPS', trackingCode: 'TRACK-123' }],
      expect.objectContaining({ orderId: 'order-1', customerName: 'Customer' }),
    );
  });

  it('does not bill or notify if saving the shipped status fails', async () => {
    const ship = await action();
    state.updateError = { message: 'Database unavailable' };
    await expect(ship(form())).rejects.toThrow('toast=ship_error');
    expect(state.order.status).toBe('Processing');
    expect(state.billing).not.toHaveBeenCalled();
    expect(state.shippingEmail).not.toHaveBeenCalled();
  });

  it('does not bill or notify when another shipment request claimed the order', async () => {
    const ship = await action();
    state.loseShipmentClaim = true;
    await expect(ship(form())).rejects.toThrow('toast=order_already_shipped');
    expect(state.billing).not.toHaveBeenCalled();
    expect(state.shippingEmail).not.toHaveBeenCalled();
  });

  it('does not repeat billing or notification on a second shipping submission', async () => {
    const ship = await action();
    await expect(ship(form())).rejects.toThrow('toast=order_shipped_paid');
    await expect(ship(form())).rejects.toThrow('toast=order_already_shipped');
    expect(state.updates).toHaveLength(1);
    expect(state.billing).toHaveBeenCalledOnce();
    expect(state.shippingEmail).toHaveBeenCalledOnce();
  });

  it.each(['reported', 'thrown'])('keeps the shipment and sends its email after a %s billing failure', async (failure) => {
    const ship = await action();
    if (failure === 'reported') state.billing.mockResolvedValue({ status: 'error', error: 'QuickBooks unavailable' });
    else state.billing.mockRejectedValue(new Error('QuickBooks unavailable'));
    await expect(ship(form())).rejects.toThrow('toast=order_shipped_billing_failed');
    expect(state.order.status).toBe('Shipped');
    expect(state.updates).toHaveLength(1);
    expect(state.shippingEmail).toHaveBeenCalledOnce();
  });

  it('reports both failures while preserving the shipment', async () => {
    const ship = await action();
    state.billing.mockResolvedValue({ status: 'error', error: 'QuickBooks unavailable' });
    state.shippingEmail.mockResolvedValue({ ok: false });
    await expect(ship(form())).rejects.toThrow('toast=order_shipped_billing_and_email_failed');
    expect(state.order.status).toBe('Shipped');
    expect(state.billing).toHaveBeenCalledOnce();
    expect(state.shippingEmail).toHaveBeenCalledOnce();
  });

  it('reports a thrown shipping-email failure after successful billing', async () => {
    const ship = await action();
    state.shippingEmail.mockRejectedValue(new Error('Email unavailable'));
    await expect(ship(form())).rejects.toThrow('toast=order_shipped_email_failed');
    expect(state.order.status).toBe('Shipped');
    expect(state.billing).toHaveBeenCalledOnce();
  });

  it('still bills if preparing the shipping email fails', async () => {
    const ship = await action();
    state.items.mockRejectedValue(new Error('Items unavailable'));
    await expect(ship(form())).rejects.toThrow('toast=order_shipped_email_failed');
    expect(state.order.status).toBe('Shipped');
    expect(state.billing).toHaveBeenCalledOnce();
    expect(state.shippingEmail).not.toHaveBeenCalled();
  });

  it('starts the shipping email while QuickBooks billing is still pending', async () => {
    const ship = await action();
    let finishBilling!: (result: { status: string }) => void;
    state.billing.mockImplementation(() => new Promise((resolve) => { finishBilling = resolve; }));
    const completion = ship(form()).catch((error: Error) => error);
    await vi.waitFor(() => expect(state.shippingEmail).toHaveBeenCalledOnce());
    finishBilling({ status: 'paid' });
    expect(await completion).toMatchObject({ message: 'REDIRECT /admin/orders/order-1?toast=order_shipped_paid' });
  });

  it('rejects unauthorized shipment requests before billing or changing the order', async () => {
    const ship = await action();
    state.authorize.mockRejectedValue(new Error('Write access denied'));
    await expect(ship(form())).rejects.toThrow('Write access denied');
    expect(state.updates).toHaveLength(0);
    expect(state.billing).not.toHaveBeenCalled();
    expect(state.shippingEmail).not.toHaveBeenCalled();
  });

  it('shows both outstanding issues without claiming billing or email success', async () => {
    const messages = toastMessages(await page('order_shipped_billing_and_email_failed'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('QuickBooks billing needs attention');
    expect(messages[0]).toContain('shipping email failed');
    expect(messages[0]).toContain('Do not ship it again');
    expect(messages[0]).not.toContain('email sent');
    expect(messages[0]).not.toContain('payment collected');
  });
});


describe('Shopify prepaid shipment', () => {
  beforeEach(() => { state.order.order_source = 'shopify'; });

  it('previews and saves one dollar per bag while retaining the standard processing fee', async () => {
    state.order.subtotal_cents = 8000;
    state.orderItems = [
      { id: 'line-a', order_id: 'order-1', qty: 2, unit_price_cents: 2500, line_total_cents: 5000 },
      { id: 'line-b', order_id: 'order-1', qty: 3, unit_price_cents: 1000, line_total_cents: 3000 },
    ];
    const text = treeText(await page());
    expect(text).toContain('Donation ($1 per bag) $5.00');
    expect(text).toContain('Processing fee $2.69');
    await expect((await action())(form())).rejects.toThrow('toast=shopify_shipped');
    expect(state.order).toMatchObject({ donation_cogs_cents: 500, processing_fee_cents: 269 });
    expect(state.cogs).toHaveBeenCalledWith(expect.objectContaining({ orderSource: 'shopify', donationCogsCents: 500, processingFeeCents: 269 }));
  });

  it('saves the expense and tracking before fulfilling Shopify without billing twice', async () => {
    const ship = await action();
    state.shopifySync.mockImplementation(async () => {
      expect(state.order).toMatchObject({ status: 'Shipped', shipping_cost_cents: 500, shipping_tracking_numbers: ['TRACK-123'] });
      return { status: 'synced' };
    });
    await expect(ship(form())).rejects.toThrow('toast=shopify_shipped');
    expect(state.shopifyValidate).toHaveBeenCalledExactlyOnceWith('order-1');
    expect(state.shopifySync).toHaveBeenCalledExactlyOnceWith('order-1');
    expect(state.billing).not.toHaveBeenCalled();
    expect(state.shippingEmail).not.toHaveBeenCalled();
  });

  it('keeps the saved shipment and exposes sync failure for retry', async () => {
    state.shopifySync.mockResolvedValue({ status: 'error', error: 'Shopify unavailable' });
    await expect((await action())(form())).rejects.toThrow('toast=shopify_sync_failed');
    expect(state.order.status).toBe('Shipped');
    expect(state.order.shipping_tracking_numbers).toEqual(['TRACK-123']);
    expect(state.billing).not.toHaveBeenCalled();
  });

  it('blocks shipping a canceled, refunded, edited, or unverifiable Shopify order', async () => {
    state.shopifyValidate.mockResolvedValue({ ok: false, error: 'Order canceled' });
    await expect((await action())(form())).rejects.toThrow('toast=shopify_validation_failed');
    expect(state.updates).toHaveLength(0);
    expect(state.shopifySync).not.toHaveBeenCalled();
    expect(state.billing).not.toHaveBeenCalled();
  });

  it('requires tracking and a positive shipping cost for carrier shipping', async () => {
    const ship = await action();
    const missing = form(); missing.delete('tracking_numbers');
    await expect(ship(missing)).rejects.toThrow('toast=tracking_required');
    const noCost = form(); noCost.set('shipping_cost', '0');
    await expect(ship(noCost)).rejects.toThrow('toast=shipping_required');
    expect(state.updates).toHaveLength(0);
    expect(state.shopifyValidate).not.toHaveBeenCalled();
  });

  function localDeliveryForm() {
    const data = form();
    data.set('fulfillment_method', 'local_delivery');
    data.set('shipping_cost', '0');
    data.set('local_delivery_zero_confirm', 'on');
    data.set('zero_boxes_confirmed', 'on');
    data.set('box_quantity', '0');
    return data;
  }

  function requireCoffeeBoxes() {
    state.orderItems = [{ id: 'coffee-line', order_id: 'order-1', product_id: 'coffee', qty: 2,
      products: { name: 'Fourth Dimension', shipping_box_count_required: true } }];
  }

  it('fulfills confirmed local delivery with zero shipping and no boxes, ignoring stale carrier tracking', async () => {
    requireCoffeeBoxes();
    state.shopifySync.mockImplementation(async () => {
      expect(state.order).toMatchObject({ status: 'Shipped', fulfillment_method: 'local_delivery', shipping_cost_cents: 0, shipping_tracking_numbers: [] });
      return { status: 'synced' };
    });
    await expect((await action())(localDeliveryForm())).rejects.toThrow('toast=shopify_shipped');
    expect(state.shopifyValidate).toHaveBeenCalledExactlyOnceWith('order-1');
    expect(state.cogs).toHaveBeenCalledWith(expect.objectContaining({ orderSource: 'shopify', shippingCostCents: 0, donationCogsCents: 200 }));
    expect(state.orderItems[0].shipping_boxes_used).toBe(0);
    expect(state.shippingBoxes).toEqual([]);
    expect(state.boxWrites).toEqual(['delete']);
    expect(state.shopifySync).toHaveBeenCalledExactlyOnceWith('order-1');
    expect(state.billing).not.toHaveBeenCalled();
    expect(state.shippingEmail).not.toHaveBeenCalled();
    expect(toastMessages(await page('shopify_shipped'))).toEqual(['Local delivery / pickup marked fulfilled in Shopify. No invoice is needed.']);
    state.order.shopify_sync_status = 'synced';
    const text = treeText(await page());
    expect(text).toContain('Local delivery / pickup fulfilled in Shopify.');
    expect(text).not.toContain('tracking synced');
  });

  it.each([
    ['local_delivery_zero_confirm', 'local_delivery_confirm_required'],
    ['zero_boxes_confirmed', 'zero_boxes_confirm_required'],
  ])('blocks local delivery without %s', async (confirmation, toast) => {
    requireCoffeeBoxes();
    const data = localDeliveryForm();
    data.delete(confirmation);
    await expect((await action())(data)).rejects.toThrow(`toast=${toast}`);
    expect(state.updates).toHaveLength(0);
    expect(state.itemUpdates).toHaveLength(0);
    expect(state.boxWrites).toHaveLength(0);
    expect(state.cogs).not.toHaveBeenCalled();
    expect(state.shopifySync).not.toHaveBeenCalled();
    expect(state.billing).not.toHaveBeenCalled();
    expect(state.shippingEmail).not.toHaveBeenCalled();
  });

  it('still verifies Shopify payment, items, and readiness before local delivery', async () => {
    state.shopifyValidate.mockResolvedValue({ ok: false, error: 'Order canceled' });
    await expect((await action())(localDeliveryForm())).rejects.toThrow('toast=shopify_validation_failed');
    expect(state.updates).toHaveLength(0);
    expect(state.cogs).not.toHaveBeenCalled();
    expect(state.shopifySync).not.toHaveBeenCalled();
    expect(state.billing).not.toHaveBeenCalled();
  });

  it('does not sync when saving the shipment fails or on a duplicate submission', async () => {
    const ship = await action();
    state.updateError = { message: 'Database unavailable' };
    await expect(ship(form())).rejects.toThrow('toast=ship_error');
    expect(state.shopifySync).not.toHaveBeenCalled();
    state.updateError = null;
    await expect(ship(form())).rejects.toThrow('toast=shopify_shipped');
    await expect(ship(form())).rejects.toThrow('toast=order_already_shipped');
    expect(state.shopifySync).toHaveBeenCalledOnce();
    expect(state.billing).not.toHaveBeenCalled();
  });
});


describe('Shopify readiness recheck', () => {
  beforeEach(() => { state.order.order_source = 'shopify'; });

  async function recheckAction() {
    const recheck = findFormAction(await page(), 'Recheck Shopify');
    expect(recheck).toBeTypeOf('function');
    return recheck!;
  }

  function recheckForm() {
    const data = new FormData();
    data.set('id', 'order-1');
    return data;
  }

  function expectNoShipmentSideEffects() {
    expect(state.updates).toHaveLength(0);
    expect(state.itemUpdates).toHaveLength(0);
    expect(state.boxWrites).toHaveLength(0);
    expect(state.cogs).not.toHaveBeenCalled();
    expect(state.shopifySync).not.toHaveBeenCalled();
    expect(state.billing).not.toHaveBeenCalled();
    expect(state.shippingEmail).not.toHaveBeenCalled();
  }

  it('checks Shopify without shipping, consuming inventory, billing, or notifying', async () => {
    const before = structuredClone(state.order);
    await expect((await recheckAction())(recheckForm())).rejects.toThrow('toast=shopify_verified');
    expect(state.authorize).toHaveBeenCalledWith('/admin/orders/order-1?toast=admin_write_denied', 'orders');
    expect(state.shopifyValidate).toHaveBeenCalledExactlyOnceWith('order-1');
    expect(state.order).toEqual(before);
    expectNoShipmentSideEffects();
    expect(toastMessages(await page('shopify_verified'))).toEqual(['Shopify verified. This order is ready to ship.']);
  });

  it('reports a failed check without starting shipment', async () => {
    state.shopifyValidate.mockResolvedValue({ ok: false, error: 'Shopify unavailable' });
    await expect((await recheckAction())(recheckForm())).rejects.toThrow('toast=shopify_validation_failed');
    expect(state.shopifyValidate).toHaveBeenCalledExactlyOnceWith('order-1');
    expectNoShipmentSideEffects();
  });

  it('requires write authorization before contacting Shopify', async () => {
    const recheck = await recheckAction();
    state.authorize.mockRejectedValueOnce(new Error('WRITE_DENIED'));
    await expect(recheck(recheckForm())).rejects.toThrow('WRITE_DENIED');
    expect(state.shopifyValidate).not.toHaveBeenCalled();
    expectNoShipmentSideEffects();
  });

  it.each([
    { order_source: 'portal' },
    { status: 'Shipped' },
    { archived_at: '2026-10-09T15:00:00Z' },
  ])('rejects an order that became ineligible before submission: %j', async (change) => {
    const recheck = await recheckAction();
    Object.assign(state.order, change);
    await expect(recheck(recheckForm())).rejects.toThrow('toast=shopify_validation_failed');
    expect(state.shopifyValidate).not.toHaveBeenCalled();
    expectNoShipmentSideEffects();
    expect(findFormAction(await page(), 'Recheck Shopify')).toBeUndefined();
  });

  it('hides the recheck from viewers without edit access', async () => {
    state.isOwner = false;
    state.canEdit = false;
    expect(findFormAction(await page(), 'Recheck Shopify')).toBeUndefined();
  });
});

describe('shipping box plan retry guard', () => {
  beforeEach(() => {
    state.order.order_source = 'shopify';
    state.orderItems = [
      { id: 'line-1', order_id: 'order-1', product_id: 'product-1', qty: 2, products: { name: 'Coffee A', shipping_box_count_required: true } },
      { id: 'line-2', order_id: 'order-1', product_id: 'product-2', qty: 3, products: { name: 'Coffee B', shipping_box_count_required: true } },
    ];
  });

  function packing(entries: Array<[string, number]>) {
    const data = form();
    for (const [id, quantity] of entries) {
      data.append('box_inventory_item_id', id);
      data.append('box_quantity', String(quantity));
    }
    return data;
  }

  function savedBox(id: string, box: string, quantity: number, consumed: boolean) {
    return { id, order_id: 'order-1', order_item_id: 'line-1', inventory_item_id: box, quantity,
      consumed_at: consumed ? '2026-10-09T12:00:00Z' : null, total_cost_cents: consumed ? quantity * 50 : null,
      inventory_items: { name: box === 'small-box' ? 'Small box' : 'Large box', sku: box === 'small-box' ? 'BOX-SMALL' : 'BOX-LARGE' } };
  }

  it('reuses the entire saved plan, including unconsumed rows and duplicate box types, without rewriting its allocation', async () => {
    state.shippingBoxes = [savedBox('a', 'small-box', 1, true), savedBox('b', 'small-box', 1, false), savedBox('c', 'large-box', 2, false)];
    const saved = structuredClone(state.shippingBoxes);
    await expect((await action())(packing([['small-box', 1], ['large-box', 2], ['small-box', 1]]))).rejects.toThrow('toast=shopify_shipped');
    expect(state.shippingBoxes).toEqual(saved);
    expect(state.boxWrites).toHaveLength(0);
    expect(state.itemUpdates).toHaveLength(0);
    expect(state.cogs).toHaveBeenCalledOnce();
    expect(state.shopifySync).toHaveBeenCalledOnce();
  });

  it('resumes a failed shipping attempt without inserting or consuming a second copy of its boxes', async () => {
    const ship = await action();
    state.cogs.mockImplementationOnce(async () => {
      state.shippingBoxes[0].consumed_at = '2026-10-09T12:00:00Z';
      state.shippingBoxes[0].total_cost_cents = 100;
      return { error: 'lot_update_error' };
    });
    await expect(ship(packing([['small-box', 2], ['large-box', 1]]))).rejects.toThrow('toast=ship_error');
    const saved = structuredClone(state.shippingBoxes);
    expect(state.boxWrites).toEqual(['delete', 'insert']);
    expect(state.order.status).toBe('Processing');
    expect(state.shopifySync).not.toHaveBeenCalled();

    await expect(ship(packing([['large-box', 1], ['small-box', 2]]))).rejects.toThrow('toast=shopify_shipped');
    expect(state.shippingBoxes).toEqual(saved);
    expect(state.boxWrites).toEqual(['delete', 'insert']);
    expect(state.cogs).toHaveBeenCalledTimes(2);
    expect(state.shopifySync).toHaveBeenCalledOnce();
  });

  it.each([
    [['small-box', 1]],
    [['small-box', 3]],
    [['large-box', 2]],
    [['small-box', 2], ['large-box', 1]],
  ] as Array<Array<[string, number]>>)('rejects changed box totals or types before inventory, shipping, or fulfillment writes: %j', async (...entries) => {
    state.shippingBoxes = [savedBox('a', 'small-box', 1, true), savedBox('b', 'small-box', 1, false)];
    const saved = structuredClone(state.shippingBoxes);
    await expect((await action())(packing(entries))).rejects.toThrow('toast=box_usage_changed');
    expect(state.shippingBoxes).toEqual(saved);
    expect(state.boxWrites).toHaveLength(0);
    expect(state.itemUpdates).toHaveLength(0);
    expect(state.updates).toHaveLength(0);
    expect(state.cogs).not.toHaveBeenCalled();
    expect(state.shopifySync).not.toHaveBeenCalled();
  });

  it('still replaces a wholly unconsumed plan before the first successful shipment', async () => {
    state.shippingBoxes = [savedBox('draft', 'small-box', 1, false)];
    await expect((await action())(packing([['large-box', 2]]))).rejects.toThrow('toast=shopify_shipped');
    expect(state.boxWrites).toEqual(['delete', 'insert']);
    expect(state.shippingBoxes).toHaveLength(1);
    expect(state.shippingBoxes[0]).toMatchObject({ inventory_item_id: 'large-box', quantity: 2, consumed_at: null });
  });

  it('stops when saved box usage cannot be read', async () => {
    const ship = await action();
    state.boxReadError = { message: 'Database unavailable' };
    await expect(ship(packing([['small-box', 2]]))).rejects.toThrow('toast=box_usage_unavailable');
    expect(state.boxWrites).toHaveLength(0);
    expect(state.cogs).not.toHaveBeenCalled();
    expect(state.shopifySync).not.toHaveBeenCalled();
  });

  it('does not bypass the box requirement when the order-item query fails', async () => {
    const ship = await action();
    state.itemReadError = { message: 'Database unavailable' };
    await expect(ship(packing([['small-box', 2]]))).rejects.toThrow('toast=ship_error');
    expect(state.boxWrites).toHaveLength(0);
    expect(state.cogs).not.toHaveBeenCalled();
    expect(state.shopifySync).not.toHaveBeenCalled();
  });

  it('shows saved totals and prefills every box type while a partially consumed order is still editable', async () => {
    state.shippingBoxes = [savedBox('a', 'small-box', 1, true), savedBox('b', 'small-box', 1, false), savedBox('c', 'large-box', 1, false)];
    const tree = await page();
    expect(treeText(tree)).toContain('Saved product boxes');
    expect(treeText(tree)).toContain('2 x Small box');
    const fields = findBoxFields(tree);
    expect(fields).toBeTruthy();
    const html = renderToStaticMarkup(fields);
    expect(html).toContain('value="small-box" selected=""');
    expect(html).toContain('value="large-box" selected=""');
    expect(html).toMatch(/name="box_quantity"[^>]*value="2"/);
    expect(html).toMatch(/name="box_quantity"[^>]*value="1"/);
  });

  it('explains how to recover from a packaging mismatch', async () => {
    const messages = toastMessages(await page('box_usage_changed'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('already consumed');
    expect(messages[0]).toContain('same box types and quantities');
  });
});

import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  order: {} as Record<string, unknown>,
  updateError: null as { message: string } | null,
  loseShipmentClaim: false,
  updates: [] as Record<string, unknown>[],
  authorize: vi.fn(),
  billing: vi.fn(),
  shippingEmail: vi.fn(),
  items: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  notFound: () => { throw new Error('NOT_FOUND'); },
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ isOwner: true, access: { orders: { canEdit: true } } }),
  requireAdminSectionEdit: vi.fn(),
}));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.authorize }));
vi.mock('@/lib/quickbooks', () => ({ fulfillShippedOrderBilling: state.billing }));
vi.mock('@/lib/email', () => ({ sendShippedEmail: state.shippingEmail }));
vi.mock('@/lib/center-logins', () => ({ getCenterLoginEmails: async () => ['shipping@example.com'] }));
vi.mock('@/lib/order-items', () => ({ getOrderItemSummaries: state.items }));
vi.mock('@/lib/order-cogs', () => ({ snapshotOrderCogsForShipment: async () => ({ error: null }) }));
vi.mock('@/lib/commissions', () => ({ snapshotOrderCommissionForShipment: async () => ({ error: null }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/components/order-trash-dialog', () => ({ OrderTrashDialog: () => null }));
vi.mock('@/components/order-fulfillment-form', () => ({ default: () => null }));

class Query {
  private mutation: Record<string, unknown> | null = null;
  private singleRow = false;
  constructor(private table: string) {}
  select() { return this; }
  eq() { return this; }
  neq() { return this; }
  is() { return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  update(payload: Record<string, unknown>) { this.mutation = payload; return this; }
  single() { this.singleRow = true; return this; }
  then(resolve: (result: { data: unknown; error: { message: string } | null; count?: number }) => unknown) {
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

type ShipmentAction = (data: FormData) => Promise<void>;
function findAction(node: ReactNode): ShipmentAction | undefined {
  if (Array.isArray(node)) return node.map(findAction).find(Boolean);
  if (!isValidElement<{ action?: ShipmentAction; children?: ReactNode }>(node)) return;
  if (node.type === OrderFulfillmentForm) return node.props.action;
  return findAction(node.props.children);
}
function toastMessages(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(toastMessages);
  if (!isValidElement<{ message?: string; children?: ReactNode }>(node)) return [];
  if (node.type === StatusToast) return [node.props.message ?? ''];
  return toastMessages(node.props.children);
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
  state.authorize.mockResolvedValue(undefined);
  state.billing.mockResolvedValue({ status: 'paid' });
  state.shippingEmail.mockResolvedValue({ ok: true });
  state.items.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

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

import { isValidElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  sendOrderEmails: vi.fn(),
  orderInsert: vi.fn(),
  sourceAvailable: true,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}));

vi.mock('@/lib/auth', () => ({ requireUser: async () => ({
  user: { id: 'buyer', email: 'buyer@example.test' },
  profile: { center_id: 'center-a', email: 'buyer@example.test', center: { name: 'Recovery Center' } },
}) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => database.from(table) } }));
vi.mock('@/lib/center-logins', () => ({ getCenterLoginEmails: async () => ['buyer@example.test'] }));
vi.mock('@/lib/email', () => ({ sendOrderEmails: state.sendOrderEmails }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => {
  throw Object.assign(new Error(`REDIRECT:${url}`), { digest: 'NEXT_REDIRECT;replace' });
} }));

import RecurringOrdersPage from '@/app/portal/recurring-orders/page';

const schedule = {
  id: 'schedule-1', center_id: 'center-a', user_id: 'buyer', source_order_id: 'source-order',
  frequency: '2_weeks', amount_cents: 4000, status: 'paused', active: false,
  created_at: '2026-09-01T12:00:00Z', last_generated_at: '2026-09-15T12:00:00Z',
  next_run_at: '2026-10-01T12:00:00Z',
};
const item = {
  id: 'item-1', recurring_order_id: schedule.id, product_id: 'coffee-1',
  product_name_snapshot: 'Coffee', qty: 2, unit_price_cents: 2000, line_total_cents: 4000,
};
const historicalShipping = {
  center_location_id: 'location-1', shipping_name: 'Original name',
  shipping_address1: '100 Old Street', shipping_address2: null,
  shipping_city: 'Memphis', shipping_state: 'TN', shipping_zip: '38103',
};
const insertedOrder = {
  ...historicalShipping, id: 'new-order', shipping_name: 'Updated location name',
  shipping_address1: '200 New Street',
};

class Query {
  private operation = 'read';
  private payload: unknown;
  private filters: Array<[string, unknown]> = [];
  constructor(private table: string) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  neq() { return this; }
  in() { return this; }
  order() { return this; }
  limit() { return this; }
  update(payload: unknown) { this.operation = 'update'; this.payload = payload; return this; }
  insert(payload: unknown) { this.operation = 'insert'; this.payload = payload; return this; }
  result(single: boolean) {
    if (this.operation === 'read') {
      state.reads.push({ table: this.table, filters: this.filters });
      if (this.table === 'recurring_orders') return { data: single ? { ...schedule } : [{ ...schedule }], error: null };
      if (this.table === 'recurring_order_items') return { data: [{ ...item }], error: null };
      if (this.table === 'orders') {
        const sourceRead = this.filters.some(([column]) => column === 'id');
        return { data: sourceRead && !state.sourceAvailable ? null : { id: 'source-order', ...historicalShipping }, error: null };
      }
    }
    if (this.operation === 'insert' && this.table === 'orders') {
      state.orderInsert(this.payload);
      // The migration regression tests separately verify the insert trigger.
      // Its returned snapshot is what customer notifications must use.
      return { data: { ...insertedOrder }, error: null };
    }
    if (this.operation === 'update' && this.table === 'recurring_orders') return { data: { id: schedule.id }, error: null };
    if (this.operation === 'insert' && this.table === 'order_items') return { data: null, error: null };
    throw new Error(`Unexpected query ${this.table}:${this.operation}`);
  }
  single() { return Promise.resolve(this.result(true)); }
  maybeSingle() { return this.single(); }
  then(resolve: (value: unknown) => unknown) { return Promise.resolve(this.result(false)).then(resolve); }
}
const database = { from: (table: string) => new Query(table) };

type NodeProps = { children?: ReactNode; name?: string; value?: string; action?: (data: FormData) => Promise<void> };
function hasResumeInput(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasResumeInput);
  if (!isValidElement<NodeProps>(node)) return false;
  return node.type === 'input' && node.props.name === 'status' && node.props.value === 'active'
    || hasResumeInput(node.props.children);
}
function resumeAction(node: ReactNode): ((data: FormData) => Promise<void>) | undefined {
  if (Array.isArray(node)) return node.map(resumeAction).find(Boolean);
  if (!isValidElement<NodeProps>(node)) return;
  if (node.type === 'form' && hasResumeInput(node.props.children)) return node.props.action;
  return resumeAction(node.props.children);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.sourceAvailable = true;
  state.reads = [];
  state.sendOrderEmails.mockResolvedValue(undefined);
});

describe('resuming a customer recurring schedule', () => {
  it.each([true, false])('tags the immediate new order for saved-address refresh (source available: %s)', async (sourceAvailable) => {
    state.sourceAvailable = sourceAvailable;
    const action = resumeAction(await RecurringOrdersPage({}));
    expect(action).toBeTypeOf('function');
    const form = new FormData();
    form.set('recurring_order_id', schedule.id); form.set('status', 'active');
    await expect(action!(form)).rejects.toThrow('REDIRECT:/portal/recurring-orders?success=reactivated');

    expect(state.orderInsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      recurring_order_id: schedule.id, center_id: 'center-a', center_location_id: 'location-1',
      user_id: 'buyer', subtotal_cents: 4000,
    }));
    expect(state.reads).toContainEqual({
      table: 'recurring_orders', filters: [['id', schedule.id], ['center_id', 'center-a']],
    });
    expect(state.sendOrderEmails).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      orderId: 'new-order', centerId: 'center-a', shipping: insertedOrder,
      items: [{ name: 'Coffee', qty: 2, price: 2000, line: 4000 }], subtotalCents: 4000,
    }));
  });
});

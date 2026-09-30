import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem } from '@/lib/cart';

const fixture = vi.hoisted(() => ({
  userId: 'customer-user',
  centerId: 'customer-center' as string | null,
  orders: [] as Record<string, unknown>[],
  queries: [] as Array<{ table: string; filters: Record<string, unknown> }>,
  clearCart: vi.fn(),
  reorder: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('not-found'); },
}));
vi.mock('next/link', () => ({
  default: ({ prefetch: _prefetch, ...props }: Record<string, unknown>) => createElement('a', props),
}));
vi.mock('@/lib/auth', () => ({
  requireUser: async () => ({ user: { id: fixture.userId }, profile: { center_id: fixture.centerId } }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => database }));
vi.mock('@/components/cart-client', () => ({
  ClearCart: ({ storageKey }: { storageKey: string }) => {
    fixture.clearCart(storageKey);
    return null;
  },
  ReorderButton: (props: { items: CartItem[]; storageKey: string; label: string }) => {
    fixture.reorder(props);
    return createElement('button', null, props.label);
  },
}));

const orderId = '4a13baf3-1111-4111-8111-111111111111';
const productId = 'available-coffee';
const items = [
  { id: 'line-1', order_id: orderId, product_id: productId, product_name_snapshot: 'Meeting Coffee Medium Roast Ground - 5 lb', qty: 4, unit_price_cents: 4000, line_total_cents: 16000 },
  { id: 'line-2', order_id: orderId, product_id: 'unavailable-coffee', product_name_snapshot: 'Limited roast', qty: 1, unit_price_cents: 2000, line_total_cents: 2000 },
];
const catalogProducts = [{ product_id: productId, name: 'Meeting Coffee Medium Roast Ground - 5 lb', current_price_cents: 4500 }];

class Query {
  filters: Record<string, unknown> = {};

  constructor(private table: string) {
    fixture.queries.push({ table, filters: this.filters });
  }

  select() { return this; }
  eq(key: string, value: unknown) { this.filters[key] = value; return this; }
  in(key: string, value: unknown[]) { this.filters[key] = value; return this; }

  result(single = false) {
    const tables: Record<string, Record<string, unknown>[]> = {
      orders: fixture.orders,
      order_items: items,
      portal_catalog: catalogProducts,
    };
    const rows = (tables[this.table] ?? []).filter((row) => Object.entries(this.filters).every(([key, value]) => (
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value
    )));
    return { data: single ? rows[0] ?? null : rows, error: null };
  }

  single() { return Promise.resolve(this.result(true)); }
  then(resolve: (result: ReturnType<Query['result']>) => unknown) { return Promise.resolve(this.result()).then(resolve); }
}

const database = { from: (table: string) => new Query(table) };

beforeEach(() => {
  fixture.centerId = 'customer-center';
  fixture.orders = [{
    id: orderId,
    center_id: fixture.centerId,
    status: 'New',
    created_at: '2026-09-30T15:59:00Z',
    subtotal_cents: 18000,
    notes: 'Deliver to reception.',
    fulfillment_method: 'carrier',
    shipping_name: 'Receiving team',
    shipping_company: 'Augustine Recovery',
    shipping_address1: '123 Recovery Way',
    shipping_address2: 'Suite 2',
    shipping_city: 'St. Augustine',
    shipping_state: 'FL',
    shipping_zip: '32084',
  }];
  fixture.queries = [];
  fixture.clearCart.mockReset();
  fixture.reorder.mockReset();
});

async function renderOrder(toast?: string | string[]) {
  const Page = (await import('@/app/portal/orders/[id]/page')).default;
  return renderToStaticMarkup(await Page({
    params: Promise.resolve({ id: orderId }),
    searchParams: Promise.resolve(toast === undefined ? {} : { toast }),
  }));
}

describe('customer order confirmation', () => {
  it.each([
    'order_placed',
    'order_placed_recurring_created',
    'order_placed_recurring_error',
  ])('makes the saved order unmistakable for %s without offering immediate reorder', async (toast) => {
    const html = await renderOrder(toast);

    expect(html).toMatch(/<h1\b[^>]*>Your order is placed\.<\/h1>/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('$180.00');
    expect(html).toContain('Order subtotal · 5 items');
    expect(html).toContain('4a13baf3');
    expect(html).toContain('123 Recovery Way');
    expect(html).toContain('Deliver to reception.');
    expect(html).toContain('Your order is saved. There’s no need to submit it again.');
    expect(html).toContain('href="/portal/orders"');
    expect(html).not.toContain('Reorder &amp; review');
    expect(fixture.reorder).not.toHaveBeenCalled();
    expect(fixture.clearCart).toHaveBeenCalledExactlyOnceWith('sobrew-cart:customer-user');

    if (toast === 'order_placed_recurring_error') {
      expect(html).toContain('role="alert"');
      expect(html).toContain('Only the recurring schedule could not be saved. Please do not place this order again.');
      expect(html).toContain('href="/portal/recurring-orders"');
    } else if (toast === 'order_placed_recurring_created') {
      expect(html).toContain('Your recurring schedule is set.');
      expect(html).toContain('href="/portal/recurring-orders"');
      expect(html).not.toContain('role="alert"');
    } else {
      expect(html).not.toContain('recurring schedule');
      expect(html).not.toContain('role="alert"');
    }
  });

  it('keeps confirmation visible when the customer reloads their saved order confirmation', async () => {
    await renderOrder('order_placed');
    const reloaded = await renderOrder('order_placed');

    expect(reloaded).toMatch(/<h1\b[^>]*>Your order is placed\.<\/h1>/);
    expect(fixture.reorder).not.toHaveBeenCalled();
  });

  it.each([undefined, 'unrelated_notice', ['order_placed']])('preserves deliberate reorder from order history for toast %j', async (toast) => {
    const html = await renderOrder(toast);

    expect(html).not.toContain('Your order is placed.');
    expect(html).toContain('Reorder &amp; review');
    expect(fixture.clearCart).not.toHaveBeenCalled();
    expect(fixture.reorder).toHaveBeenCalledOnce();
    expect(fixture.reorder.mock.calls[0][0]).toMatchObject({
      storageKey: 'sobrew-cart:customer-user',
      items: [{ product_id: productId, name: catalogProducts[0].name, price_cents: 4500, qty: 4 }],
    });
  });

  it('does not show a confirmation or clear the cart for another center’s order', async () => {
    fixture.orders[0].center_id = 'another-center';

    await expect(renderOrder('order_placed')).rejects.toThrow('not-found');
    expect(fixture.queries).toEqual([{ table: 'orders', filters: { id: orderId, center_id: 'customer-center' } }]);
    expect(fixture.clearCart).not.toHaveBeenCalled();
    expect(fixture.reorder).not.toHaveBeenCalled();
  });

  it('uses the authenticated user’s legacy center scope when the profile has no center', async () => {
    fixture.centerId = null;
    fixture.orders[0].center_id = fixture.userId;

    expect(await renderOrder('order_placed')).toContain('Your order is placed.');
    expect(fixture.queries[0]).toEqual({ table: 'orders', filters: { id: orderId, center_id: fixture.userId } });
  });
});

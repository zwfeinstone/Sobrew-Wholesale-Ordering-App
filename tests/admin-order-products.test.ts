import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdminOrderWorkspace, type AdminOrderRow } from '@/components/admin-order-workspace';

vi.mock('@/app/admin/orders/actions', () => ({ archiveSelectedOrders: vi.fn(), moveOrderToTrash: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({}) }));
vi.mock('next/link', () => ({ default: ({ prefetch: _prefetch, ...props }: Record<string, unknown>) => createElement('a', props) }));

describe('order product disclosure', () => {
  it.each([0, 1, 2, 3, 5])('renders %i products with a disclosure only when needed', (count) => {
    const items = [
      'Meeting Coffee Dark Roast Fraction Pack - 100 x 1.5 oz x 2',
      'Meeting Coffee Medium Roast Fraction Pack - 100 x 1.5 oz x 2',
      'Decaf Ground Coffee - 5 lb x 1',
      'Sweet Tea - Case x 3',
      'Coffee Filters - Case x 1',
    ].slice(0, count);
    const order: AdminOrderRow = {
      id: '16537fa6-preview', customerName: 'Example Customer', email: 'orders@example.com',
      status: 'New', kind: 'standard', createdAt: '2026-09-08T19:18:00Z',
      placedLabel: 'Sep 8, 2026, 2:18 PM', subtotal: 55000, notes: '', items, hasRecurring: false,
    };
    const html = renderToStaticMarkup(createElement(AdminOrderWorkspace, {
      orders: [order, { ...order, id: 'second-preview', customerName: 'Second Customer' }],
      counts: { New: 2 }, canArchive: true, canEdit: false,
    }));

    for (const item of items) expect(html).toContain(item);
    if (count > 2) {
      expect(html.match(/<details class="order-products-disclosure">/g)).toHaveLength(2);
      expect(html).toContain(`+${count - 2} more`);
      expect(html).toContain('Show less');
      expect(html).toContain('products for Example Customer order 16537fa6');
      expect(html).toContain(`class="order-products-remaining"><p>${items[2]}</p>`);
    } else {
      expect(html).not.toContain('<details');
      expect(html).not.toContain('Show less');
    }

    if (count === 5 && process.env.GENERATE_UI_PREVIEWS === '1') {
      const output = 'output/order-products';
      mkdirSync(output, { recursive: true });
      writeFileSync(`${output}/orders.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order products preview</title></head><body class="admin-shell"><main class="admin-page-content"><h1 class="page-title">Orders</h1>${html}</main></body></html>`);
    }
  });
});

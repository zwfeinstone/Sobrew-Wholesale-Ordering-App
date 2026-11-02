import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ method: 'carrier' }));
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: () => [state.method, vi.fn()],
}));
vi.mock('@/components/ship-order-submit-button', () => ({
  default: () => createElement('button', { type: 'submit' }, 'Mark shipped'),
}));

import OrderFulfillmentForm from '@/components/order-fulfillment-form';

function renderForm(prepaidShopify = true) {
  return renderToStaticMarkup(createElement(OrderFulfillmentForm, {
    action: async () => undefined,
    orderId: 'order-1',
    hasRequiredBoxLines: true,
    prepaidShopify,
    children: null,
  }));
}

beforeEach(() => { state.method = 'carrier'; });

describe('order fulfillment methods', () => {
  it.each([true, false])('offers local delivery or pickup for prepaidShopify=%s', (prepaidShopify) => {
    const html = renderForm(prepaidShopify);
    expect(html).toContain('value="carrier"');
    expect(html).toContain('value="local_delivery"');
    expect(html).toContain('Local delivery / pickup');
  });

  it('requires tracking and positive cost for a carrier shipment', () => {
    const html = renderForm();
    const costInput = html.match(/<input[^>]*name="shipping_cost"[^>]*>/)?.[0];
    expect(costInput).toContain('min="0.01"');
    expect(costInput).toContain('required=""');
    expect(html).toMatch(/name="tracking_numbers"[^>]*required/);
    expect(html).toContain('updates Shopify fulfillment and tracking');
    expect(html).not.toContain('name="local_delivery_zero_confirm"');
  });

  it('allows zero cost with confirmation and omits tracking for local delivery', () => {
    state.method = 'local_delivery';
    const html = renderForm();
    const costInput = html.match(/<input[^>]*name="shipping_cost"[^>]*>/)?.[0];
    expect(costInput).toContain('min="0"');
    expect(costInput).toContain('required=""');
    expect(html).toContain('name="local_delivery_zero_confirm"');
    expect(html).toContain('name="zero_boxes_confirmed"');
    expect(html).not.toContain('name="tracking_numbers"');
    expect(html).toContain('updates Shopify fulfillment. No invoice is created.');
    expect(html).not.toContain('and tracking');
  });
});

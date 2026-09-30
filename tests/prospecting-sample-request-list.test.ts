import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], filters: [] as unknown[][], error: null as { message: string } | null }));
vi.mock('next/link', () => ({ default: (props: Record<string, unknown>) => createElement('a', props) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: () => {
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => { state.filters.push(['eq', ...args]); return query; },
    in: (...args: unknown[]) => { state.filters.push(['in', ...args]); return query; },
    is: (...args: unknown[]) => { state.filters.push(['is', ...args]); return query; },
    order: () => query,
    range: () => Promise.resolve({ data: state.rows, count: state.rows.length, error: state.error }),
  };
  return query;
} } }));

import ProspectingSampleRequestList from '@/components/prospecting-sample-request-list';

const request = { id: 'request-1', lead_id: 'lead-1', status: 'pending', order_id: null, created_at: '2026-09-24T12:00:00Z', details: { notes: 'Ground coffee preferred' }, prospecting_leads: { company_name: 'Sample Prospect', stage: 'sample_requested', archived_at: null }, prospecting_contacts: { full_name: 'Taylor', email: 'taylor@example.test' } };
const render = async (history = false, canEdit = true) => renderToStaticMarkup(await ProspectingSampleRequestList({ page: 1, pageSize: 25, history, canEdit }));

describe('manager sample request handling', () => {
  beforeEach(() => { state.rows = [{ ...request }]; state.filters = []; state.error = null; });
  it('limits the pending queue to active requests and links the exact request identity', async () => {
    const html = await render();
    expect(state.filters).toContainEqual(['in', 'status', ['pending', 'legacy_review']]);
    expect(state.filters).toContainEqual(['is', 'closed_at', null]);
    expect(state.filters).toContainEqual(['eq', 'prospecting_leads.stage', 'sample_requested']);
    expect(state.filters).toContainEqual(['is', 'prospecting_leads.archived_at', null]);
    expect(html).toContain('sample-order?lead=lead-1&amp;request=request-1');
    expect(html).toContain('origin=samples&amp;return_to=');
    expect(html).toContain('Ground coffee preferred');
  });
  it('labels legacy requests for review and never offers another order for a linked order', async () => {
    state.rows = [{ ...request, status: 'legacy_review' }];
    expect(await render()).toContain('Review &amp; create order');
    state.rows = [{ ...request, status: 'order_created', order_id: 'order-1' }];
    const html = await render(true);
    expect(state.filters).toContainEqual(['eq', 'status', 'order_created']);
    expect(html).toContain('/admin/orders/order-1');
    expect(html).toContain('/admin/sales/prospecting/sample-order/order-1/quote?back=');
    expect(html).toContain('Continue to tracking &amp; pricing');
    expect(html).not.toContain('sample-order?');
  });
  it('retains read access without exposing fulfillment to a manager lacking edit permission', async () => {
    const html = await render(false, false);
    expect(html).toContain('Open prospect');
    expect(html).toContain('No edit access');
    expect(html).not.toContain('sample-order?');
  });
  it('distinguishes unavailable storage from an empty queue', async () => {
    state.error = { message: 'relation unavailable' }; state.rows = [];
    const html = await render();
    expect(html).toContain('temporarily unavailable');
    expect(html).not.toContain('No sample requests are waiting');
  });
});

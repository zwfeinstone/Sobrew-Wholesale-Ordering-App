import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  authorize: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.authorize }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
import { GET } from '@/app/admin/accounting/shopify/export/route';

const request = () => new NextRequest('https://example.com/admin/accounting/shopify/export?start=2026-11-01&end=2026-11-30');
const order = { id: 'one', center_id: 'retail', order_source: 'shopify', shopify_order_name: '#1001', created_at: '2026-11-17T12:00:00Z', status: 'New', subtotal_cents: 8000, shopify_shipping_collected_cents: 700, shopify_tax_collected_cents: 700, shopify_total_paid_cents: 9400 };

beforeEach(() => { state.authorize.mockReset().mockResolvedValue({ centerScope: ['retail'] }); });

describe('Shopify accounting export', () => {
  it('requires accounting access before reading order data', async () => {
    const stub = supabaseReadStub({ tables: { orders: [order] } });
    state.client = stub.client;
    state.authorize.mockRejectedValue(new Error('Access denied'));
    await expect(GET(request())).rejects.toThrow('Access denied');
    expect(state.authorize).toHaveBeenCalledWith('accounting');
    expect(stub.reads).toHaveLength(0);
  });

  it('exports every page within the admin scope and Central date boundaries without ledger writes', async () => {
    const stub = supabaseReadStub({ maxRows: 1, tables: { orders: [order, { ...order, id: 'two', shopify_order_name: '#1002' }], order_items: [] } });
    state.client = stub.client;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const csv = await response.text();
    expect(csv).toContain('#1001');
    expect(csv).toContain('#1002');
    expect(csv).toContain('80.00,7.00,87.00,7.00,94.00');
    const read = stub.reads.find((row) => row.table === 'orders')!;
    expect(read.filters).toEqual(expect.arrayContaining([
      { operator: 'eq', column: 'order_source', value: 'shopify' },
      { operator: 'in', column: 'center_id', value: ['retail'] },
      { operator: 'gte', column: 'created_at', value: '2026-11-01T05:00:00.000Z' },
      { operator: 'lt', column: 'created_at', value: '2026-12-01T06:00:00.000Z' },
    ]));
    expect(stub.reads.every((row) => ['orders', 'order_items'].includes(row.table))).toBe(true);
    expect(stub.reads.filter((row) => row.table === 'orders')).toHaveLength(3);
    const itemRead = stub.reads.find((row) => row.table === 'order_items')!;
    expect(itemRead.columns.split(',')).toEqual(expect.arrayContaining(['cogs_source', 'cogs_estimated']));
  });

  it('returns an error without a CSV attachment when line costs cannot be loaded', async () => {
    const stub = supabaseReadStub({ tables: { orders: [order] }, fail: (read) => read.table === 'order_items' ? 'Costs unavailable' : undefined });
    state.client = stub.client;
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get('content-disposition')).toBeNull();
  });

  it('rejects invalid calendar dates before querying', async () => {
    const stub = supabaseReadStub();
    state.client = stub.client;
    const response = await GET(new NextRequest('https://example.com/admin/accounting/shopify/export?start=2026-02-30&end=2026-03-01'));
    expect(response.status).toBe(400);
    expect(stub.reads).toHaveLength(0);
  });
});

import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof supabaseReadStub>['client'] }));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: vi.fn(async () => ({})),
  requireAdminSectionEdit: vi.fn(async () => ({})),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => state.client }));
vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => state.client,
  supabaseAdmin: { from: (table: string) => state.client.from(table) },
}));

import { GET as exportOrders } from '@/app/api/export/orders/route';
import { GET as exportTimeEntries } from '@/app/api/export/time-entries/route';
import { GET as exportStatement } from '@/app/admin/accounting/pnl-statement/route';

describe('complete financial exports', () => {
  it('exports every order past the database row cap with deterministic ordering', async () => {
    const stub = supabaseReadStub({ tables: { orders: Array.from({ length: 1001 }, (_, index) => ({
      id: `order-${index}`, status: 'Shipped', fulfillment_method: 'carrier', subtotal_cents: 100,
      created_at: '2026-07-01T12:00:00Z', center_id: 'center', user_id: 'user',
    })) } });
    state.client = stub.client;
    const response = await exportOrders();
    expect(response.status).toBe(200);
    const lines = (await response.text()).split('\n');
    expect(lines).toHaveLength(1002);
    expect(lines.at(-1)).toContain('order-1000');
    expect(stub.reads.every((read) => read.orders.at(-1)?.column === 'id')).toBe(true);
  });

  it('preserves the older-schema fulfillment fallback while paging its complete result', async () => {
    const stub = supabaseReadStub({
      maxRows: 1,
      tables: { orders: [{ id: 'first' }, { id: 'second' }] },
      fail: (read) => read.columns.includes('fulfillment_method') ? 'column fulfillment_method does not exist' : undefined,
    });
    state.client = stub.client;
    const response = await exportOrders();
    expect(response.status).toBe(200);
    expect((await response.text()).split('\n')).toHaveLength(3);
  });

  it('exports all time-entry, salary-payment, and paid-spiff pages', async () => {
    const stub = supabaseReadStub({
      maxRows: 1,
      tables: {
        admin_time_entries: [1, 2].map((id) => ({ id: `entry-${id}`, profile_id: 'employee', clock_in_at: '2026-07-01T12:00:00Z', clock_out_at: '2026-07-01T13:00:00Z', work_type: 'production', hourly_rate_cents_snapshot: 100, status: 'approved' })),
        admin_salary_payroll_payments: [1, 2].map((id) => ({ id: `salary-${id}`, profile_id: 'employee', salary_pay_cents: 100, salary_labor_work_type: 'production', payroll_month: '2026-07-01', paid_at: '2026-07-31T12:00:00Z' })),
        admin_weekly_sales_spiffs: [1, 2].map((id) => ({ id: `spiff-${id}`, profile_id: 'employee', amount_cents: 100, week_start_date: '2026-07-06', week_end_date: '2026-07-12', paid_at: '2026-07-31T12:00:00Z' })),
      },
    });
    state.client = stub.client;
    const response = await exportTimeEntries(new NextRequest('https://example.com/api/export/time-entries?from=2026-07-01&to=2026-07-31'));
    expect(response.status).toBe(200);
    const csv = await response.text();
    expect(csv.match(/"time_entry"/g)).toHaveLength(2);
    expect(csv.match(/"salary_paid"/g)).toHaveLength(2);
    expect(csv.match(/"sales_spiff_paid"/g)).toHaveLength(2);
    expect(stub.reads.every((read) => ['id', 'profile_id'].includes(read.orders.at(-1)?.column ?? ''))).toBe(true);
    expect(stub.reads.find((read) => read.table === 'admin_time_entries')?.filters).toEqual([
      { operator: 'gte', column: 'clock_in_at', value: '2026-07-01T05:00:00.000Z' },
      { operator: 'lt', column: 'clock_in_at', value: '2026-08-01T05:00:00.000Z' },
    ]);
  });

  it.each(['orders', 'admin_salary_payroll_payments', 'admin_weekly_sales_spiffs'])('returns an explicit failure when %s cannot finish loading', async (table) => {
    const stub = supabaseReadStub({
      maxRows: 1,
      tables: { [table]: [{ id: 'first' }, { id: 'second' }] },
      fail: (read) => read.table === table && read.from > 0 ? 'Later page failed' : undefined,
    });
    state.client = stub.client;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = table === 'orders'
        ? await exportOrders()
        : await exportTimeEntries(new NextRequest('https://example.com/api/export/time-entries?from=2026-07-01&to=2026-07-31'));
      expect(response.status).toBe(500);
      expect(response.headers.get('content-disposition')).toBeNull();
      expect(await response.text()).toContain('Unable to load all');
    } finally {
      log.mockRestore();
    }
  });

  it('does not generate a PDF if payroll allocations fail', async () => {
    const stub = supabaseReadStub({ fail: (read) => read.table === 'admin_time_entry_allocations' ? 'Allocations unavailable' : undefined });
    state.client = stub.client;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await exportStatement(new NextRequest('https://example.com/admin/accounting/pnl-statement?start=2026-07-01&end=2026-07-31'));
      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).not.toContain('application/pdf');
    } finally {
      log.mockRestore();
    }
  });
});

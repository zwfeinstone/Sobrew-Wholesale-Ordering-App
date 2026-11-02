import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  isOwner: true,
  eligibility: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: vi.fn(async () => ({ isOwner: state.isOwner, access: {}, profile: { id: 'rep' } })),
  requireAdminSectionEdit: vi.fn(),
  adminCanEdit: () => state.isOwner,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('@/lib/commission-invoice-eligibility', () => ({ getCommissionInvoiceEligibility: state.eligibility }));
vi.mock('@/components/status-toast', () => ({ default: ({ message }: { message: string }) => message }));
vi.mock('next/link', () => ({ default: 'a' }));

import CommissionPage from '@/app/admin/commission/page';
import SalesAdminPage from '@/app/admin/sales-admin/page';

function fixtures() {
  const snapshot = (id: string, commissionCents: number) => ({
    id, order_id: id, center_id: 'center', sales_profile_id: 'rep',
    commission_month: '2026-09-01', shipped_at: '2026-09-15T12:00:00Z',
    revenue_cents: commissionCents * 20, gross_profit_cents: commissionCents * 10,
    commission_percent: 10, commission_cents: commissionCents, cogs_estimated: false,
  });
  return {
    profiles: [{ id: 'rep', full_name: 'Sales Rep', email: 'sales@example.test', is_active: true }],
    centers: [{ id: 'center', name: 'Wholesale Center', is_active: true }],
    center_sales_assignments: [{ center_id: 'center', sales_profile_id: 'rep' }],
    admin_commission_settings: [{ profile_id: 'rep', is_sales_rep: true }],
    admin_labor_tag_assignments: [{ profile_id: 'rep', work_type: 'sales' }],
    order_commission_snapshots: [snapshot('paid-in-october', 10000), snapshot('still-unpaid', 90000), snapshot('recorded-in-september', 7000)],
    monthly_commission_payouts: [{
      id: 'recorded-payment', sales_profile_id: 'rep', commission_month: '2026-09-01',
      status: 'paid', commission_cents: 7000, revenue_cents: 140000, gross_profit_cents: 70000,
      order_count: 1, paid_at: '2026-10-01T12:00:00Z', paid_order_ids: ['recorded-in-september'],
    }],
  };
}

function hourlyOffsetFixtures() {
  const tables = fixtures();
  return {
    ...tables,
    admin_commission_settings: [{ profile_id: 'rep', is_sales_rep: true, commission_percent: 10, hourly_offset_enabled: true, hourly_offset_start_month: '2026-09-01' }],
    admin_time_entries: ['09', '10'].map((month) => ({ id: `${month}-shift`, profile_id: 'rep', clock_in_at: `2026-${month}-20T14:00:00Z`, clock_out_at: `2026-${month}-20T16:00:00Z`, hourly_rate_cents_snapshot: 1500, status: month === '09' ? 'locked' : 'approved', work_type: 'sales' })),
    monthly_commission_payouts: tables.monthly_commission_payouts.map((payout) => ({ ...payout, gross_commission_cents: 10000, hourly_base_offset_cents: 3000 })),
  };
}

function text(markup: string) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  state.isOwner = true;
  state.client = supabaseReadStub({ tables: fixtures() }).client;
  state.eligibility.mockReset().mockResolvedValue({
    error: null,
    paidOrderIds: new Set(['paid-in-october']),
    paidOrderMonths: new Map([['paid-in-october', '2026-10-01']]),
    unpaidOrderIds: new Set(['still-unpaid']),
    missingInvoiceOrderIds: new Set(),
  });
});
afterEach(() => vi.useRealTimers());

describe('paid-invoice commission reports', () => {
  it('shows monthly GP commission, hourly wage threshold, and only the excess as payable', async () => {
    state.isOwner = false;
    state.client = supabaseReadStub({ tables: hourlyOffsetFixtures() }).client;
    const markup = renderToStaticMarkup(await CommissionPage({ searchParams: Promise.resolve({ month: '2026-10' }) }));
    const content = text(markup);
    expect(content).toContain('$70.00 payable');
    expect(content).toContain('Your commission rate is 10% of gross profit');
    expect(content).toContain('Gross commission $100.00 Monthly hourly wages $30.00 Extra commission $70.00');
    expect(content).toContain('First-order SPIFFs remain separate');
    const septemberHistory = [...markup.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
      .map(([row]) => text(row)).find((row) => row.includes('September 2026'));
    expect(septemberHistory).toContain('$100.00 $30.00 $70.00 Paid');
  });

  it('shows the net payment and wage deduction in Sales Admin totals', async () => {
    state.client = supabaseReadStub({ tables: hourlyOffsetFixtures() }).client;
    const markup = renderToStaticMarkup(await SalesAdminPage({ searchParams: Promise.resolve({ month: '2026-10' }) }));
    const content = text(markup);
    expect(content).toContain('Team commission $70.00 $100.00 gross commission before hourly wage deductions.');
    expect(content).toContain('Gross commission: $100.00 Monthly hourly wages: $30.00 Extra commission: $70.00');
    expect(content).toContain('$70.00 payable');
    expect(markup).toContain('name="payment_amount_cents" value="7000"');
  });

  it('shows only October earnings in the salesperson statement and keeps recorded September history', async () => {
    const markup = renderToStaticMarkup(await CommissionPage({ searchParams: Promise.resolve({ month: '2026-10' }) }));
    const content = text(markup);
    expect(content).toContain('Commission is earned in the month the invoice is fully paid.');
    expect(content).toContain('$100.00 payable');
    expect(content).not.toMatch(/on hold|awaiting invoice payment|earlier earnings|original shipment month/i);
    const orderDetail = markup.slice(markup.indexOf('Order detail'));
    expect(orderDetail).toContain('/admin/orders/paid-in-october');
    expect(orderDetail).not.toContain('/admin/orders/still-unpaid');
    expect(orderDetail).not.toContain('/admin/orders/recorded-in-september');
    const septemberHistory = [...markup.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
      .map(([row]) => text(row)).find((row) => row.includes('September 2026'));
    expect(septemberHistory).toContain('$70.00 Paid');
  });

  it.each([
    ['2026-09', '$70.00', '$0.00 payable', 'Paid'],
    ['2026-10', '$100.00', '$100.00 payable', 'Due'],
  ])('shows the same payment-month totals on Sales Admin for %s', async (month, amount, payable, status) => {
    const markup = renderToStaticMarkup(await SalesAdminPage({ searchParams: Promise.resolve({ month }) }));
    const reportRow = [...markup.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
      .map(([row]) => text(row)).find((row) => row.includes('Sales Rep')) ?? '';
    expect(reportRow).toContain(amount);
    expect(reportRow).toContain(payable);
    expect(reportRow).toContain(status);
    expect(reportRow).not.toContain('$900.00');
    expect(text(markup)).not.toMatch(/on hold|awaiting invoice payment|live shipment snapshots/i);
  });

  it('keeps the salesperson statement scoped to the signed-in salesperson', async () => {
    state.isOwner = false;
    const stub = supabaseReadStub({ tables: fixtures() });
    state.client = stub.client;
    await CommissionPage({ searchParams: Promise.resolve({ month: '2026-10', sales_profile_id: 'another-rep' }) });
    const snapshotReads = stub.reads.filter((read) => read.table === 'order_commission_snapshots');
    expect(snapshotReads.length).toBeGreaterThan(0);
    expect(snapshotReads.every((read) => read.filters.some((filter) => filter.column === 'sales_profile_id' && filter.value === 'rep'))).toBe(true);
  });
});

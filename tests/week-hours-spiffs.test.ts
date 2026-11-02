import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  eligibility: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: vi.fn(async () => ({ profile: { id: 'haskins' } })) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('@/lib/commission-invoice-eligibility', () => ({ getCommissionInvoiceEligibility: state.eligibility }));
vi.mock('next/link', () => ({ default: 'a' }));

import WeekHoursPage from '@/app/admin/week-hours/page';

function spiff(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, profile_id: 'haskins', first_order_id: id, amount_cents: 10000,
    week_start_date: '2026-10-05', week_end_date: '2026-10-11',
    paid_at: null, notes: `SPIFF ${id}`, ...overrides,
  };
}

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const section = (html: string, title: string) => [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)]
  .map(([match]) => match).find((match) => match.includes(title)) ?? '';
const rowFor = (html: string, notes: string) => [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
  .map(([match]) => plain(match)).find((match) => match.includes(notes)) ?? '';
const group = (html: string, title: string) => [...html.matchAll(/<h3\b[^>]*>[\s\S]*?(?=<h3\b|$)/g)]
  .map(([match]) => match).find((match) => new RegExp(`<h3\\b[^>]*>${title}<\\/h3>`).test(match)) ?? '';
const currentStatus = (html: string) => section(html, '>SPIFF payment status<');

function expectGroup(html: string, title: string, total: string, count: number) {
  const content = plain(group(html, title));
  expect(content).toContain(total);
  expect(content).toMatch(new RegExp(`\\b${count} SPIFF${count === 1 ? '' : 's'}\\b`));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T14:00:00Z'));
  state.eligibility.mockReset().mockResolvedValue({
    error: null,
    paidOrderIds: new Set(['customer-paid', 'earlier-payable']),
    unpaidOrderIds: new Set(['customer-unpaid', 'earlier-unpaid']),
    missingInvoiceOrderIds: new Set(['no-invoice']),
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Week Hours SPIFF payment status', () => {
  it('separates paid customer invoices, unpaid invoices, missing verification, and SPIFFs already paid to the employee', async () => {
    state.client = supabaseReadStub({ tables: {
      admin_weekly_sales_spiffs: [
        spiff('customer-paid'), spiff('customer-unpaid'), spiff('no-invoice'),
        spiff('payroll-paid', { paid_at: '2026-10-08T14:00:00Z' }),
        spiff('manual', { first_order_id: null, amount_cents: 2500 }),
      ],
      orders: [{ id: 'customer-paid', quickbooks_invoice_doc_number: 'SO-1463', centers: { name: 'Every Arkansan' }, shipping_company: null, shipping_name: null }],
    } }).client;

    const html = renderToStaticMarkup(await WeekHoursPage({}));
    const current = currentStatus(html);
    expect(plain(html)).toContain('SPIFFs Payable Now $125.00 2 SPIFFs ready for payroll, including eligible carryovers.');
    expectGroup(current, 'Payable now', '$125.00', 2);
    expectGroup(current, 'Pending', '$200.00', 2);
    expectGroup(current, 'Already paid', '$100.00', 1);
    expect(rowFor(group(current, 'Payable now'), 'SPIFF customer-paid')).not.toBe('');
    expect(rowFor(group(current, 'Payable now'), 'SPIFF manual')).not.toBe('');
    expect(group(current, 'Payable now')).not.toContain('SPIFF customer-unpaid');
    expect(group(current, 'Payable now')).not.toContain('SPIFF no-invoice');
    expect(group(current, 'Payable now')).not.toContain('SPIFF payroll-paid');
    expect(rowFor(group(current, 'Pending'), 'SPIFF customer-unpaid')).not.toBe('');
    expect(rowFor(group(current, 'Pending'), 'SPIFF no-invoice')).not.toBe('');
    expect(rowFor(group(current, 'Already paid'), 'SPIFF payroll-paid')).not.toBe('');
    expect(rowFor(current, 'SPIFF customer-paid')).toContain('Every Arkansan');
    expect(rowFor(current, 'SPIFF customer-paid')).toContain('Invoice SO-1463');
    expect(rowFor(current, 'SPIFF customer-paid')).toContain('Payable now Customer invoice paid in full.');
    expect(rowFor(current, 'SPIFF customer-unpaid')).toContain('Not payable yet Awaiting full customer invoice payment.');
    expect(rowFor(current, 'SPIFF no-invoice')).toContain('Verification unavailable Customer invoice is not linked or is unavailable.');
    expect(rowFor(current, 'SPIFF payroll-paid')).toContain('Paid to you');
    expect(rowFor(current, 'SPIFF payroll-paid')).not.toContain('Customer invoice paid in full');
    expect(rowFor(current, 'SPIFF manual')).toContain('Payable now Invoice payment is not required for this SPIFF.');
    expect(state.eligibility).toHaveBeenCalledWith(['customer-paid', 'customer-unpaid', 'no-invoice']);
    expect(html).not.toContain('Mark paid');
  });

  it('shows a short order reference when an invoice number is unavailable', async () => {
    const orderId = '9889680b-1111-2222-3333-444444444444';
    const stub = supabaseReadStub({ tables: {
      admin_weekly_sales_spiffs: [spiff('missing-number', { first_order_id: orderId })],
      orders: [{ id: orderId, quickbooks_invoice_doc_number: null, centers: { name: 'Every Arkansan' } }],
    } });
    state.client = stub.client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    const row = rowFor(html, 'SPIFF missing-number');
    expect(row).toContain('Every Arkansan Order 9889680b');
    expect(row).not.toContain(orderId);
    expect(stub.reads.find((read) => read.table === 'orders')?.columns).toContain('quickbooks_invoice_doc_number');
  });

  it('includes eligible earlier first-order SPIFFs in payable totals while keeping history date-scoped', async () => {
    const earlier = { week_start_date: '2026-09-28', week_end_date: '2026-10-04' };
    const stub = supabaseReadStub({ tables: { admin_weekly_sales_spiffs: [
      spiff('customer-paid'), spiff('earlier-payable', earlier), spiff('earlier-unpaid', earlier),
      spiff('earlier-paid', { ...earlier, paid_at: '2026-10-01T14:00:00Z' }),
      spiff('earlier-manual', { ...earlier, first_order_id: null }),
      spiff('future-order', { week_start_date: '2026-10-12', week_end_date: '2026-10-18' }),
    ] } });
    state.client = stub.client;
    const html = renderToStaticMarkup(await WeekHoursPage({ searchParams: Promise.resolve({ spiff_from: '2026-10-05', spiff_to: '2026-10-09' }) }));
    const current = currentStatus(html);
    expect(plain(current)).toContain('Includes 2 unpaid first-order SPIFFs from earlier weeks.');
    expectGroup(current, 'Payable now', '$200.00', 2);
    expectGroup(current, 'Pending', '$100.00', 1);
    expectGroup(current, 'Already paid', '$0.00', 0);
    expect(rowFor(current, 'SPIFF earlier-payable')).toContain('Payable now');
    expect(rowFor(current, 'SPIFF earlier-unpaid')).toContain('Not payable yet');
    expect(current).not.toContain('SPIFF earlier-paid');
    expect(current).not.toContain('SPIFF earlier-manual');
    expect(current).not.toContain('SPIFF future-order');
    expect(plain(html)).toContain('SPIFFs Payable Now $200.00 2 SPIFFs ready for payroll, including eligible carryovers.');
    expect(section(html, '>SPIFF history<')).not.toContain('SPIFF earlier-payable');
    const query = stub.reads.find((read) => read.table === 'admin_weekly_sales_spiffs')?.filters.find((filter) => filter.operator === 'or')?.value;
    expect(query).toContain('and(week_start_date.lte.2026-10-09,week_end_date.gte.2026-10-01)');
    expect(query).toContain('and(first_order_id.not.is.null,paid_at.is.null,week_start_date.lte.2026-10-09)');
    expect(query).toContain('and(first_order_id.is.null,notes.ilike.*mileage*,paid_at.is.null,week_start_date.lte.2026-10-09)');
  });

  it.each([
    { phase: 'before payroll', paidAt: null, payableCount: 5, payableTotal: '$500.00', paidCount: 0, paidTotal: '$0.00' },
    { phase: 'after Sunday payroll', paidAt: '2026-10-18T20:17:00Z', payableCount: 0, payableTotal: '$0.00', paidCount: 5, paidTotal: '$500.00' },
  ])('reconciles Haskins’s six recorded SPIFFs and one carryover $phase', async ({ paidAt, payableCount, payableTotal, paidCount, paidTotal }) => {
    vi.setSystemTime(new Date('2026-10-18T21:00:00Z'));
    const thisWeek = { week_start_date: '2026-10-12', week_end_date: '2026-10-18' };
    const eligibleIds = ['buffalo-valley-one', 'buffalo-valley-two', 'buffalo-valley-three', 'mccoy-house', 'monte-nido'];
    state.eligibility.mockResolvedValue({
      error: null,
      paidOrderIds: new Set(eligibleIds),
      unpaidOrderIds: new Set(['hebron-colony', 'memphis-detox']),
      missingInvoiceOrderIds: new Set(),
    });
    const stub = supabaseReadStub({ tables: { admin_weekly_sales_spiffs: [
      ...eligibleIds.slice(0, 4).map((id) => spiff(id, { ...thisWeek, paid_at: paidAt })),
      spiff('hebron-colony', thisWeek), spiff('memphis-detox', thisWeek),
      spiff('monte-nido', { paid_at: paidAt }),
      spiff('already-paid-last-week', { paid_at: '2026-10-09T20:17:00Z' }),
      spiff('future-payroll', { week_start_date: '2026-10-19', week_end_date: '2026-10-25', paid_at: '2026-10-18T20:17:00Z' }),
    ] } });
    state.client = stub.client;
    const html = renderToStaticMarkup(await WeekHoursPage({ searchParams: Promise.resolve({
      spiff_from: '2026-10-12', spiff_to: '2026-10-16', mileage_from: '2026-10-12', mileage_to: '2026-10-16',
    }) }));
    const current = currentStatus(html);
    expect(plain(html)).toContain(`SPIFFs Payable Now ${payableTotal} ${payableCount} SPIFFs ready for payroll, including eligible carryovers.`);
    expect(plain(html)).toContain('Oct 12 to Oct 16. Completed shifts');
    expectGroup(current, 'Payable now', payableTotal, payableCount);
    expectGroup(current, 'Pending', '$200.00', 2);
    expectGroup(current, 'Already paid', paidTotal, paidCount);
    const destination = group(current, paidAt ? 'Already paid' : 'Payable now');
    for (const id of eligibleIds) expect(rowFor(destination, `SPIFF ${id}`)).not.toBe('');
    expect(rowFor(group(current, 'Pending'), 'SPIFF hebron-colony')).toContain('Awaiting full customer invoice payment.');
    expect(rowFor(group(current, 'Pending'), 'SPIFF memphis-detox')).toContain('Awaiting full customer invoice payment.');
    expect(current).not.toContain('SPIFF already-paid-last-week');
    expect(current).not.toContain('SPIFF future-payroll');
    expect(current.match(/SPIFF monte-nido/g)).toHaveLength(1);
    const history = section(html, '>SPIFF history<');
    expect(plain(history)).toContain('$600.00');
    expect(plain(history)).toContain('recorded from Oct 12 to Oct 16.');
    expect(history).not.toContain('SPIFF monte-nido');
    expect(history).not.toContain('SPIFF already-paid-last-week');
    const query = stub.reads.find((read) => read.table === 'admin_weekly_sales_spiffs')?.filters.find((filter) => filter.operator === 'or')?.value;
    expect(query).toContain('and(first_order_id.not.is.null,paid_at.gte.2026-10-12T05:00:00.000Z,paid_at.lte.2026-10-19T04:59:59.000Z,week_start_date.lte.2026-10-16)');
  });

  it('fails closed when invoice verification is unavailable and preserves recorded employee payments', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.eligibility.mockResolvedValue({ error: 'QuickBooks unavailable', paidOrderIds: new Set(['customer-paid']), unpaidOrderIds: new Set(), missingInvoiceOrderIds: new Set() });
    state.client = supabaseReadStub({ tables: { admin_weekly_sales_spiffs: [
      spiff('customer-paid'), spiff('payroll-paid', { paid_at: '2026-10-08T14:00:00Z' }),
      spiff('manual', { first_order_id: null, amount_cents: 2500 }),
    ] } }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    const current = currentStatus(html);
    expect(plain(html)).toContain('SPIFFs Payable Now $25.00 1 SPIFF ready for payroll, including eligible carryovers.');
    expectGroup(current, 'Payable now', '$25.00', 1);
    expectGroup(current, 'Pending', '$100.00', 1);
    expectGroup(current, 'Already paid', '$100.00', 1);
    expect(group(current, 'Payable now')).not.toContain('SPIFF customer-paid');
    expect(rowFor(group(current, 'Pending'), 'SPIFF customer-paid')).toContain('Verification unavailable');
    expect(rowFor(current, 'SPIFF customer-paid')).toContain('Verification unavailable');
    expect(rowFor(current, 'SPIFF payroll-paid')).toContain('Paid to you');
    expect(plain(html)).toContain('Customer invoice payments could not be verified.');
  });

  it('loads all SPIFF pages and scopes every read to the signed-in employee', async () => {
    const stub = supabaseReadStub({ maxRows: 2, tables: { admin_weekly_sales_spiffs: [
      spiff('customer-paid'), spiff('customer-unpaid'), spiff('no-invoice'),
      spiff('other-employee', { profile_id: 'another-employee', amount_cents: 50000 }),
    ] } });
    state.client = stub.client;
    const html = renderToStaticMarkup(await WeekHoursPage({ searchParams: Promise.resolve({ profile_id: 'another-employee' }) }));
    expect(plain(html)).toContain('SPIFFs Payable Now $100.00');
    expectGroup(currentStatus(html), 'Pending', '$200.00', 2);
    expect(html).not.toContain('SPIFF other-employee');
    expect(state.eligibility).toHaveBeenCalledWith(['customer-paid', 'customer-unpaid', 'no-invoice']);
    const reads = stub.reads.filter((read) => read.table === 'admin_weekly_sales_spiffs');
    expect(reads.map((read) => read.from)).toEqual([0, 2, 4]);
    expect(reads.every((read) => read.filters.some((filter) => filter.operator === 'eq' && filter.column === 'profile_id' && filter.value === 'haskins'))).toBe(true);
  });

  it('does not present a failed SPIFF query as zero payable or no SPIFFs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.client = supabaseReadStub({ fail: (read) => read.table === 'admin_weekly_sales_spiffs' ? 'Unavailable' : undefined }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    expect(plain(html)).toContain('SPIFFs Payable Now Unavailable');
    expect(plain(html)).toContain('SPIFF totals are unavailable.');
    expect(plain(html)).not.toContain('No SPIFFs');
  });
});

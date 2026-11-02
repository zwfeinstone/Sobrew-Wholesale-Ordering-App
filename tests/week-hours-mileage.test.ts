import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  eligibility: vi.fn(),
  requireView: vi.fn(async () => ({ profile: { id: 'haskins' } })),
}));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionView: state.requireView }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('@/lib/commission-invoice-eligibility', () => ({ getCommissionInvoiceEligibility: state.eligibility }));
vi.mock('next/link', () => ({ default: 'a' }));

import WeekHoursPage from '@/app/admin/week-hours/page';

function mileage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, profile_id: 'haskins', first_order_id: null, amount_cents: 2146,
    week_start_date: '2026-10-05', week_end_date: '2026-10-09', paid_at: null,
    notes: `Mileage reimbursement: 29 miles at $0.74 per mile. ${id}`,
    ...overrides,
  };
}

const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const section = (html: string, title: string) => [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)]
  .map(([match]) => match).find((match) => match.includes(title)) ?? '';
const rowFor = (html: string, notes: string) => [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)]
  .map(([match]) => plain(match)).find((match) => match.includes(notes)) ?? '';
const formFor = (html: string, name: string) => [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
  .map(([match]) => match).find((match) => new RegExp(`<input\\b[^>]*type="date"[^>]*name="${name}"|<input\\b[^>]*name="${name}"[^>]*type="date"`).test(match)) ?? '';
const inputValue = (html: string, name: string) => [...html.matchAll(/<input\b[^>]*>/g)]
  .map(([match]) => match).find((match) => match.includes(`name="${name}"`))?.match(/value="([^"]*)"/)?.[1];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-09T14:00:00Z'));
  vi.clearAllMocks();
  state.eligibility.mockResolvedValue({
    error: null,
    paidOrderIds: new Set(['first-order', 'linked-mileage']),
    unpaidOrderIds: new Set(),
    missingInvoiceOrderIds: new Set(),
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Week Hours mileage payment and tracker', () => {
  it('shows recorded miles, rate, reimbursement, and employee payment status without double-counting mileage as SPIFFs', async () => {
    state.client = supabaseReadStub({ tables: { admin_weekly_sales_spiffs: [
      mileage('current-unpaid'),
      mileage('current-paid', { amount_cents: 740, paid_at: '2026-10-08T14:00:00Z', notes: 'Mileage reimbursement: 10 miles at $0.74 per mile. current-paid' }),
      mileage('first-order', { first_order_id: 'first-order', amount_cents: 10000, notes: 'Customer first-order SPIFF' }),
      mileage('incidental-mileage', { amount_cents: 5000, notes: 'Sales bonus with mileage mentioned in the notes' }),
      mileage('linked-mileage', { first_order_id: 'linked-mileage', amount_cents: 3000, notes: 'Mileage mentioned on a customer-linked SPIFF' }),
    ] } }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    const current = section(html, 'Mileage payment and tracker');
    const content = plain(current);
    expect(content).toMatch(/Miles this week 39(?:\.0+)?\b/);
    expect(content).toContain('Reimbursement this week $28.86');
    expect(content).toContain('Payable now $21.46');
    expect(content).toContain('Paid for this week $7.40');
    expect(rowFor(current, 'current-unpaid')).toMatch(/29(?:\.0+)?\s+\$0\.74\s+\$21\.46\s+Payable/);
    expect(rowFor(current, 'current-unpaid')).toContain('Awaiting payroll');
    expect(rowFor(current, 'current-paid')).toContain('Paid to you');
    expect(current).not.toContain('Customer first-order SPIFF');
    expect(current).not.toContain('Sales bonus with mileage');
    expect(current).not.toContain('Mileage mentioned on a customer-linked SPIFF');
    expect(plain(html)).toContain('SPIFFs Payable Now $180.00 3 SPIFFs ready for payroll, including eligible carryovers.');
    expect(section(html, '>SPIFF payment status<')).not.toContain('current-unpaid');
    expect(section(html, '>SPIFF payment status<')).not.toContain('current-paid');
    expect(section(html, '>SPIFF history<')).not.toContain('current-paid');
    expect(state.eligibility).toHaveBeenCalledWith(['first-order', 'linked-mileage']);
    expect(html).not.toContain('Mark paid');
  });

  it('loads every page while keeping another employee’s reimbursement and notes private', async () => {
    const stub = supabaseReadStub({ maxRows: 1, tables: { admin_weekly_sales_spiffs: [
      mileage('own-trip'),
      mileage('private-trip', { profile_id: 'another-employee', amount_cents: 500000, notes: 'Mileage reimbursement: private employee trip' }),
      mileage('another-own-trip'),
    ] } });
    state.client = stub.client;
    const html = renderToStaticMarkup(await WeekHoursPage({ searchParams: Promise.resolve({ profile_id: 'another-employee' }) }));
    const current = plain(section(html, 'Mileage payment and tracker'));
    expect(current).toContain('Reimbursement this week $42.92');
    expect(current).toContain('Payable now $42.92');
    expect(html).not.toContain('private employee trip');
    expect(html).not.toContain('$5,000.00');
    expect(state.requireView).toHaveBeenCalledWith('week_hours');
    const reads = stub.reads.filter((read) => read.table === 'admin_weekly_sales_spiffs');
    expect(reads.map((read) => read.from)).toEqual([0, 1, 2, 3]);
    expect(reads.every((read) => read.filters.some((filter) => filter.operator === 'eq' && filter.column === 'profile_id' && filter.value === 'haskins'))).toBe(true);
    expect(state.eligibility).toHaveBeenCalledWith([]);
  });

  it('carries earlier unpaid mileage into payable totals while excluding earlier paid and future records from the current tracker', async () => {
    const earlier = { week_start_date: '2026-09-21', week_end_date: '2026-09-25' };
    state.client = supabaseReadStub({ tables: { admin_weekly_sales_spiffs: [
      mileage('this-week'), mileage('earlier-unpaid', earlier),
      mileage('earlier-paid', { ...earlier, paid_at: '2026-10-08T14:00:00Z' }),
      mileage('future-trip', { week_start_date: '2026-10-12', week_end_date: '2026-10-16' }),
    ] } }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    const current = section(html, 'Mileage payment and tracker');
    expect(plain(current)).toMatch(/Miles this week 29(?:\.0+)?\b/);
    expect(plain(current)).toContain('Reimbursement this week $21.46');
    expect(plain(current)).toContain('Payable now $42.92');
    expect(plain(current)).toContain('Paid for this week $0.00');
    expect(rowFor(current, 'earlier-unpaid')).toContain('Payable');
    expect(current).not.toContain('earlier-paid');
    expect(current).not.toContain('future-trip');
    expect(section(html, 'Mileage history')).not.toContain('earlier-unpaid');
    expect(section(html, 'Mileage history')).not.toContain('future-trip');
  });

  it('filters mileage history independently and preserves both date ranges in each filter form', async () => {
    const stub = supabaseReadStub({ tables: { admin_weekly_sales_spiffs: [
      mileage('september-trip', { week_start_date: '2026-09-14', week_end_date: '2026-09-18', paid_at: '2026-09-18T14:00:00Z' }),
      mileage('october-trip'),
      mileage('october-spiff', { first_order_id: 'first-order', amount_cents: 10000, notes: 'October customer SPIFF' }),
    ] } });
    state.client = stub.client;
    const html = renderToStaticMarkup(await WeekHoursPage({ searchParams: Promise.resolve({
      spiff_from: '2026-10-05', spiff_to: '2026-10-31',
      mileage_from: '2026-09-01', mileage_to: '2026-09-30',
    }) }));
    const history = section(html, 'Mileage history');
    expect(history).toContain('september-trip');
    expect(history).not.toContain('october-trip');
    expect(history).not.toContain('October customer SPIFF');
    expect(section(html, '>SPIFF history<')).toContain('October customer SPIFF');
    expect(section(html, 'Mileage payment and tracker')).toContain('october-trip');
    for (const form of [formFor(html, 'spiff_from'), formFor(html, 'mileage_from')]) {
      expect(inputValue(form, 'spiff_from')).toBe('2026-10-05');
      expect(inputValue(form, 'spiff_to')).toBe('2026-10-31');
      expect(inputValue(form, 'mileage_from')).toBe('2026-09-01');
      expect(inputValue(form, 'mileage_to')).toBe('2026-09-30');
    }
    const query = stub.reads.find((read) => read.table === 'admin_weekly_sales_spiffs')?.filters.find((filter) => filter.operator === 'or')?.value;
    expect(query).toContain('and(week_start_date.lte.2026-10-31,week_end_date.gte.2026-09-01)');
    expect(query).toContain('and(first_order_id.not.is.null,paid_at.is.null,week_start_date.lte.2026-10-09)');
    expect(query).toContain('and(first_order_id.is.null,notes.ilike.*mileage*,paid_at.is.null,week_start_date.lte.2026-10-09)');
    expect(query).toContain('and(first_order_id.not.is.null,paid_at.gte.2026-10-05T05:00:00.000Z,paid_at.lte.2026-10-10T04:59:59.000Z,week_start_date.lte.2026-10-09)');
  });

  it('retains legacy and inconsistent payment amounts without inventing miles or a rate', async () => {
    state.client = supabaseReadStub({ tables: { admin_weekly_sales_spiffs: [
      mileage('legacy-payment', { amount_cents: 3000, paid_at: '2026-10-08T14:00:00Z', notes: 'Mileage reimbursement for customer visits — legacy payment' }),
      mileage('mismatch-payment', { amount_cents: 2200 }),
    ] } }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    const current = section(html, 'Mileage payment and tracker');
    const legacy = rowFor(current, 'legacy payment');
    const mismatch = rowFor(current, 'mismatch-payment');
    expect(legacy).toContain('Not recorded');
    expect(legacy.match(/Not recorded/g)).toHaveLength(2);
    expect(legacy).toContain('$30.00');
    expect(legacy).toContain('Paid to you');
    expect(mismatch).toContain('Needs review');
    expect(mismatch.match(/Not recorded/g)).toHaveLength(2);
    expect(mismatch).toContain('$22.00');
    expect(mismatch).toContain('Payable');
    expect(plain(current)).toContain('Reimbursement this week $52.00');
    expect(plain(current)).toContain('Payable now $22.00');
    expect(plain(current)).toContain('Paid for this week $30.00');
    const trackerOnly = plain(current.split('<table')[0]);
    expect(trackerOnly).not.toMatch(/Miles this week 29(?:\.0+)?\b/);
    expect(plain(html)).toContain('SPIFFs Payable Now $0.00');
  });

  it('shows a mileage load failure instead of zero reimbursement or an empty history', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.client = supabaseReadStub({ fail: (read) => read.table === 'admin_weekly_sales_spiffs' ? 'Unavailable' : undefined }).client;
    const html = renderToStaticMarkup(await WeekHoursPage({}));
    const current = plain(section(html, 'Mileage payment and tracker'));
    const history = plain(section(html, 'Mileage history'));
    expect(current).toMatch(/unavailable|could not be loaded/i);
    expect(current).not.toContain('$0.00');
    expect(current).not.toMatch(/no mileage|no reimbursements/i);
    expect(history).toMatch(/unavailable|could not be loaded/i);
    expect(history).not.toContain('$0.00');
    expect(history).not.toMatch(/no mileage|no reimbursements/i);
  });
});

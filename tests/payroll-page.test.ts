import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  canEdit: true,
  paidOrderMonths: new Map<string, string>(),
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  requireView: vi.fn(async () => ({ access: {}, profile: { id: 'reviewer' } })),
  invoiceEligibility: vi.fn(async (orderIds: string[]) => ({
    error: null,
    paidOrderIds: new Set(orderIds),
    paidOrderMonths: state.paidOrderMonths,
    unpaidOrderIds: new Set<string>(),
    missingInvoiceOrderIds: new Set<string>(),
  })),
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: state.requireView,
  requireAdminSectionEdit: vi.fn(),
  adminCanEdit: () => state.canEdit,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('@/lib/commission-invoice-eligibility', () => ({ getCommissionInvoiceEligibility: state.invoiceEligibility }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/status-toast', () => ({ default: () => null }));

import PayrollPage from '@/app/admin/payroll/page';

const NOW = new Date('2026-09-25T16:00:00.000Z');

function fixture() {
  const alex = { id: 'alex', full_name: 'Alex Baker', email: 'alex@example.test', is_active: true };
  const casey = { id: 'casey', full_name: 'Casey Diaz', email: 'casey@example.test', is_active: true };
  const morgan = { id: 'morgan', full_name: 'Morgan Lee', email: 'morgan@example.test', is_active: true };
  const devon = { id: 'devon', full_name: 'Devon Park', email: 'devon@example.test', is_active: false };
  const entry = (id: string, profile: typeof alex | null, status = 'approved') => ({
    id, profile_id: profile?.id ?? null, admin_profile: profile, status,
    clock_in_at: '2026-09-21T14:00:00.000Z', clock_out_at: '2026-09-21T16:00:00.000Z',
    hourly_rate_cents_snapshot: 1500, work_type: 'production', notes: null,
    correction_request_note: null, correction_reason: null, manual_reason: null,
    locked_at: null, void_reason: null, voided_at: null, admin_time_breaks: [],
  });
  return {
    profiles: [alex, casey, morgan, devon],
    admin_time_settings: [
      { profile_id: alex.id, active: true, compensation_type: 'hourly', hourly_rate_cents: 2000 },
      { profile_id: casey.id, active: true, compensation_type: 'hourly', hourly_rate_cents: 2500 },
      { profile_id: morgan.id, active: true, compensation_type: 'salary', hourly_rate_cents: 0, salary_amount_cents: 300000, salary_frequency: 'monthly', salary_labor_work_type: 'admin' },
    ],
    admin_commission_settings: [{ profile_id: casey.id, commission_percent: 5, is_sales_rep: true }],
    admin_labor_tag_assignments: [
      { profile_id: alex.id, work_type: 'production' },
      { profile_id: casey.id, work_type: 'sales' },
    ],
    admin_time_entries: [
      {
        ...entry('alex-submitted', alex, 'submitted'),
        clock_out_at: '2026-09-21T16:30:00.000Z', hourly_rate_cents_snapshot: 2000,
        correction_request_note: 'Please check the lunch punch.',
        admin_time_breaks: [{ id: 'alex-break', break_start_at: '2026-09-21T15:00:00.000Z', break_end_at: '2026-09-21T15:30:00.000Z', status: 'completed' }],
      },
      entry('casey-approved', casey),
      entry('former-approved', null),
    ],
    admin_time_entry_allocations: [{ id: 'casey-allocation', time_entry_id: 'casey-approved', work_type: 'sales', minutes: 120, wage_cents: 3000, production_run_id: null, notes: null }],
    admin_payroll_locks: [],
    admin_salary_payroll_payments: [],
    admin_weekly_sales_spiffs: [
      { id: 'casey-spiff', profile_id: casey.id, amount_cents: 10000, week_start_date: '2026-09-21', week_end_date: '2026-09-25', paid_at: null, notes: 'Weekly sales incentive' },
      { id: 'former-spiff', profile_id: null, amount_cents: 2500, week_start_date: '2026-09-21', week_end_date: '2026-09-25', paid_at: null, notes: null },
      { id: 'paid-spiff', profile_id: casey.id, amount_cents: 1000, week_start_date: '2026-09-21', week_end_date: '2026-09-25', paid_at: '2026-09-24T16:00:00.000Z', notes: 'Already paid incentive' },
    ].map((row) => ({ ...row, first_order_id: null as string | null })),
    production_runs: [],
  };
}

function overtimeFixture({ earlierPaid = false, earlierSales = false } = {}) {
  const base = fixture();
  const alex = base.profiles[0];
  return {
    ...base,
    profiles: [alex],
    admin_time_settings: [base.admin_time_settings[0]],
    admin_commission_settings: [],
    admin_time_entries: ['21', '22', '23', '24', '25'].map((day, index) => ({
      ...base.admin_time_entries[0],
      id: `alex-${day}`,
      admin_profile: alex,
      clock_in_at: `2026-09-${day}T14:00:00.000Z`,
      clock_out_at: `2026-09-${day}T23:00:00.000Z`,
      hourly_rate_cents_snapshot: 1500,
      status: earlierPaid && index < 4 ? 'locked' : 'approved',
      locked_at: earlierPaid && index < 4 ? '2026-09-25T01:00:00.000Z' : null,
      work_type: earlierSales && index < 4 ? 'sales' : 'production',
      correction_request_note: null,
      admin_time_breaks: [],
    })),
    admin_time_entry_allocations: [],
    admin_weekly_sales_spiffs: [],
  };
}

function commissionFixture(commissionMonth = '2026-08-01') {
  const snapshot = (id: string, salesProfileId: string, commissionCents: number) => ({
    id, order_id: `order-${id}`, sales_profile_id: salesProfileId, commission_month: commissionMonth,
    shipped_at: `${commissionMonth.slice(0, 8)}15T16:00:00.000Z`,
    commission_cents: commissionCents, commission_percent: 5, gross_profit_cents: commissionCents * 20,
    revenue_cents: commissionCents * 25, product_cogs_cents: commissionCents * 5,
    shipping_cogs_cents: 0, processing_fee_cogs_cents: 0, donation_cogs_cents: 0,
    total_cogs_cents: commissionCents * 5, cogs_estimated: false,
  });
  for (const id of ['casey-first', 'casey-second', 'morgan-current', 'alex-current']) state.paidOrderMonths.set(`order-${id}`, commissionMonth);
  const payout = (id: string, salesProfileId: string, cents: number, status: string) => ({
    id, sales_profile_id: salesProfileId, commission_month: commissionMonth, commission_cents: cents,
    revenue_cents: cents * 25, gross_profit_cents: cents * 20, product_cogs_cents: cents * 5,
    shipping_cogs_cents: 0, processing_fee_cogs_cents: 0, donation_cogs_cents: 0,
    total_cogs_cents: cents * 5, order_count: 1, status,
    locked_at: '2026-09-01T12:00:00.000Z', locked_by: 'reviewer',
    paid_at: status === 'paid' ? '2026-09-01T12:00:00.000Z' : null,
    paid_order_ids: null as string[] | null,
    paid_by: status === 'paid' ? 'reviewer' : null, updated_at: '2026-09-01T12:00:00.000Z', notes: null,
  });
  return {
    ...fixture(),
    order_commission_snapshots: [
      snapshot('casey-first', 'casey', 5000), snapshot('casey-second', 'casey', 7500),
      snapshot('morgan-current', 'morgan', 99000), snapshot('alex-current', 'alex', 10000),
    ],
    monthly_commission_payouts: [payout('morgan-locked', 'morgan', 9000, 'locked'), payout('alex-paid', 'alex', 7500, 'paid')],
  };
}

function monthlyCommissionSection(markup: string) {
  return /<section\b[^>]*id="monthly-commissions"[^>]*>[\s\S]*?<\/section>/.exec(markup)?.[0] ?? '';
}

function plainText(markup: string) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function elementWithId(markup: string, id: string) {
  const opening = new RegExp(`<([a-z]+)\\b[^>]*id="${id}"[^>]*>`).exec(markup);
  if (!opening) return '';
  const tag = opening[1];
  const rest = markup.slice(opening.index);
  let depth = 0;
  for (const match of rest.matchAll(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'g'))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return rest.slice(0, match.index + match[0].length);
  }
  return '';
}

function payrollPerson(markup: string, name: string) {
  return [...markup.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/g)]
    .map(([html]) => html).find((html) => html.includes(`aria-label="${name} payroll"`)) ?? '';
}

function inputValue(markup: string, name: string) {
  const input = [...markup.matchAll(/<input\b[^>]*>/g)].map(([html]) => html)
    .find((html) => html.includes(`name="${name}"`)) ?? '';
  return /\bvalue="([^"]*)"/.exec(input)?.[1];
}

function paymentSnapshots(markup: string): Array<Record<string, unknown>> {
  return JSON.parse((hiddenValue(markup, 'payment_rows') ?? '[]').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

function hiddenValue(markup: string, name: string) {
  const input = [...markup.matchAll(/<input\b[^>]*>/g)].map(([html]) => html)
    .find((html) => html.includes(`name="${name}"`) && html.includes('type="hidden"')) ?? '';
  return /\bvalue="([^"]*)"/.exec(input)?.[1];
}

async function page(params: Record<string, string> = {}) {
  return renderToStaticMarkup(await PayrollPage({ searchParams: Promise.resolve(params) }));
}

it('lets the user correct a reversed pay period without calculating wages', async () => {
  const markup = await page({ from: '2026-09-25', to: '2026-09-21', tab: 'payments', admin: 'alex', work_type: 'production' });
  expect(plainText(markup)).toContain('Choose an end date on or after the start date.');
  expect(markup).toContain('name="from"');
  expect(markup).toContain('name="to"');
  expect(hiddenValue(markup, 'admin')).toBe('alex');
  expect(hiddenValue(markup, 'work_type')).toBe('production');
  expect(hiddenValue(markup, 'tab')).toBe('payments');
  expect(plainText(markup)).not.toContain('Amount owed');
});

/** Disabled fieldsets disable nested controls without duplicating disabled on each button. */
function enabledMutationButtons(markup: string) {
  const fieldsets: boolean[] = [];
  let mutationForm = false;
  const enabled: string[] = [];
  for (const [token] of markup.matchAll(/<\/?(?:fieldset|form)\b[^>]*>|<button\b[^>]*>[\s\S]*?<\/button>/g)) {
    if (token.startsWith('<fieldset')) fieldsets.push(/\bdisabled(?:\s|=|>)/.test(token));
    else if (token.startsWith('</fieldset')) fieldsets.pop();
    else if (token.startsWith('<form')) mutationForm = /\baction=/.test(token) && !/\bmethod="get"/i.test(token);
    else if (token.startsWith('</form')) mutationForm = false;
    else if (mutationForm && !fieldsets.some(Boolean) && !/\bdisabled(?:\s|=|>)/.test(token.split('>')[0] + '>')) enabled.push(plainText(token));
  }
  return enabled;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.canEdit = true;
  state.paidOrderMonths.clear();
  state.requireView.mockClear();
  state.invoiceEligibility.mockReset().mockImplementation(async (orderIds: string[]) => ({
    error: null,
    paidOrderIds: new Set(orderIds),
    paidOrderMonths: state.paidOrderMonths,
    unpaidOrderIds: new Set<string>(),
    missingInvoiceOrderIds: new Set<string>(),
  }));
  state.client = supabaseReadStub({ tables: fixture() }).client;
});
afterEach(() => { vi.useRealTimers(); });

it.skipIf(!process.env.GENERATE_PAYROLL_PREVIEW)('renders a sample payroll workspace for visual review without live data', async () => {
  state.client = supabaseReadStub({ tables: commissionFixture() }).client;
  const markup = await page();
  const destination = process.env.GENERATE_PAYROLL_PREVIEW === '1' ? '/tmp/sobrew-payroll-preview.html' : process.env.GENERATE_PAYROLL_PREVIEW!;
  writeFileSync(destination, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payroll preview · synthetic data</title><link rel="stylesheet" href="payroll-preview.css"></head><body><main class="mx-auto max-w-7xl p-4 sm:p-8"><p class="mb-4 text-xs text-slate-500">Synthetic payroll preview — no actual employee or payment data. Payment actions disabled.</p>${markup}</main><script>document.addEventListener('submit', event => event.preventDefault());</script></body></html>`);
  expect(markup).toContain('id="pay-run"');
});

describe('payroll navigation and access', () => {
  it('keeps date, employee, and labor filters between Payroll and separate Reports', async () => {
    const markup = await page({ from: '2026-09-07', to: '2026-09-11', admin: 'alex', work_type: 'production' });
    const nav = /<nav\b[^>]*aria-label="Payroll sections"[^>]*>[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? '';
    const links = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(2);
    expect(links.map(([, , label]) => plainText(label.replace(/<span\b[^>]*class="payroll-count"[^>]*>[\s\S]*?<\/span>/g, '')))).toEqual([
      'Payroll', 'Reports',
    ]);
    for (const [, href] of links) {
      const url = new URL(href.replace(/&amp;/g, '&'), 'https://example.test');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ from: '2026-09-07', to: '2026-09-11', admin: 'alex', work_type: 'production' });
    }
    expect(links.map(([, href]) => new URL(href.replace(/&amp;/g, '&'), 'https://example.test').searchParams.get('tab')))
      .toEqual(['review', 'reports']);
  });

  it.each([
    ['time', 'time-corrections'],
    ['settings', 'employee-settings'],
    ['payments', 'payment-adjustments'],
    ['export', 'payroll-export'],
  ])('opens the requested legacy %s tool within the same payment workspace', async (tab, id) => {
    const markup = await page({ tab });
    expect(elementWithId(markup, 'pay-run')).toContain('Review &amp; pay your team');
    expect(elementWithId(markup, id).split('>')[0]).toMatch(/\bopen=""/);
    expect(markup).toContain('aria-current="page" href="/admin/payroll?');
  });

  it('keeps advanced tools collapsed by default and keeps reports separate', async () => {
    const markup = await page();
    for (const id of ['commission-details', 'time-corrections', 'payment-adjustments', 'employee-settings', 'payroll-export']) {
      const disclosure = elementWithId(markup, id);
      expect(disclosure).not.toBe('');
      expect(disclosure.split('>')[0]).not.toMatch(/\bopen=/);
    }
    const reports = await page({ tab: 'reports' });
    expect(reports).not.toContain('id="pay-run"');
    expect(reports).not.toContain('id="employee-settings"');
    expect(reports).toContain('Labor by employee');
    expect(reports).toContain('Production Run Labor COGS');
  });

  it.each(['review', 'time', 'settings', 'payments'])('keeps %s read-only when payroll editing is unavailable', async (tab) => {
    state.canEdit = false;
    const markup = await page({ tab });
    expect(state.requireView).toHaveBeenCalledWith('payroll');
    expect(enabledMutationButtons(markup)).toEqual([]);
    expect(markup).toContain('Alex Baker');
  });

  it.each(['review', 'time', 'settings', 'payments'])('retains working mutation controls for editors in %s', async (tab) => {
    expect(enabledMutationButtons(await page({ tab })).length).toBeGreaterThan(0);
  });

  it.each([true, false])('offers a filtered CSV download only when payroll edit access is %s', async (canEdit) => {
    state.canEdit = canEdit;
    const filters = { from: '2026-09-07', to: '2026-09-11', admin: 'alex', work_type: 'production' };
    const markup = await page({ tab: 'export', ...filters });
    const downloads = [...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)]
      .map(([, href]) => new URL(href.replace(/&amp;/g, '&'), 'https://example.test'))
      .filter((url) => url.pathname === '/api/export/time-entries');
    expect(downloads).toHaveLength(canEdit ? 1 : 0);
    if (canEdit) expect(Object.fromEntries(downloads[0].searchParams)).toEqual(filters);
    else expect(plainText(markup)).toContain('Payroll edit access is required to download exports.');
    const deferredDownloads = [...markup.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/g)]
      .map(([, href]) => new URL(href.replace(/&amp;/g, '&'), 'https://example.test'))
      .filter((url) => url.pathname === '/api/export/deferred-pay');
    expect(deferredDownloads).toHaveLength(canEdit ? 1 : 0);
    if (canEdit) expect(Object.fromEntries(deferredDownloads[0].searchParams)).toEqual({ from: filters.from, to: filters.to, admin: filters.admin });
  });
});

describe('unified payroll payment queue', () => {
  it('combines each employee’s unpaid pay into one action and batches only ready employees', async () => {
    state.client = supabaseReadStub({ tables: commissionFixture() }).client;
    const markup = await page();
    const run = elementWithId(markup, 'pay-run');
    const casey = payrollPerson(markup, 'Casey Diaz');
    const morgan = payrollPerson(markup, 'Morgan Lee');
    expect(plainText(casey)).toContain('Hourly $30.00 Incentives $100.00 Salary $0.00 Commission $125.00');
    expect(plainText(casey)).toContain('$255.00');
    expect(enabledMutationButtons(casey)).toEqual(['Record paid']);
    expect(paymentSnapshots(casey)).toEqual([{
      profileId: 'casey', entryIds: ['casey-approved'], spiffIds: ['casey-spiff'],
      wagesCents: 3000, spiffCents: 10000, salaryCents: 0, commissionCents: 12500,
      payrollMonth: '2026-08-01', commissionMonth: '2026-08-01',
    }]);
    expect(paymentSnapshots(morgan)[0]).toMatchObject({ salaryCents: 300000, commissionCents: 99000, payrollMonth: '2026-08-01' });
    expect(paymentSnapshots(run).map((row) => row.profileId)).toEqual(['casey', 'morgan']);
    expect(plainText(run)).toContain('Record 2 payments · $4,245.00');
    expect(enabledMutationButtons(payrollPerson(markup, 'Alex Baker'))).toEqual(['Approve shifts', 'Approve']);
    expect(plainText(payrollPerson(markup, 'Alex Baker'))).toContain('Correction request: Please check the lunch punch.');
  });

  it('includes every labor tag in the displayed payment and snapshot while filtering time details', async () => {
    const base = fixture();
    const alex = base.profiles[0];
    state.client = supabaseReadStub({ tables: {
      ...base,
      admin_time_entries: [
        { ...base.admin_time_entries[0], status: 'approved' },
        { ...base.admin_time_entries[1], id: 'alex-sales', profile_id: 'alex', admin_profile: alex, work_type: 'sales', hourly_rate_cents_snapshot: 1000 },
      ],
      admin_time_entry_allocations: [],
      admin_weekly_sales_spiffs: [{ ...base.admin_weekly_sales_spiffs[0], id: 'alex-mileage', profile_id: 'alex', amount_cents: 1000, notes: 'Mileage reimbursement' }],
    } }).client;
    const markup = await page({ admin: 'alex', work_type: 'production' });
    const person = payrollPerson(markup, 'Alex Baker');
    expect(plainText(person)).toContain('Hourly $60.00 Incentives $10.00');
    expect(paymentSnapshots(person)[0]).toMatchObject({ entryIds: ['alex-submitted', 'alex-sales'], spiffIds: ['alex-mileage'], wagesCents: 6000, spiffCents: 1000 });
    const details = elementWithId(markup, 'time-corrections');
    expect(details).toContain('value="alex-submitted"');
    expect(details).not.toContain('value="alex-sales"');
    expect(plainText(markup)).toContain('The payment list includes all tags so its totals match the payments recorded.');
  });

  it('carries overdue unpaid mileage into the current payment without repeating paid or unrelated records', async () => {
    const base = fixture();
    const mileage = { ...base.admin_weekly_sales_spiffs[0], amount_cents: 2146, week_start_date: '2026-09-14', week_end_date: '2026-09-18', notes: 'Mileage reimbursement: 29 miles at $0.74 per mile' };
    const stub = supabaseReadStub({ maxRows: 1, tables: {
      ...base,
      profiles: [base.profiles[1]],
      admin_time_settings: [base.admin_time_settings[1]],
      admin_time_entries: [],
      admin_weekly_sales_spiffs: [
        { ...mileage, id: 'overdue-mileage' },
        { ...mileage, id: 'paid-mileage', paid_at: '2026-09-18T14:00:00Z' },
        { ...mileage, id: 'old-bonus', notes: 'Sales bonus with mileage mentioned in notes' },
        { ...mileage, id: 'current-mileage', amount_cents: 740, week_start_date: '2026-09-21', week_end_date: '2026-09-25', notes: 'Mileage reimbursement: 10 miles at $0.74 per mile' },
        { ...mileage, id: 'future-mileage', week_start_date: '2026-09-28', week_end_date: '2026-10-02' },
      ],
    } });
    state.client = stub.client;
    const markup = await page({ admin: 'casey', from: '2026-09-21', to: '2026-09-25' });
    const person = payrollPerson(markup, 'Casey Diaz');
    expect(plainText(person)).toContain('Incentives $28.86');
    expect(paymentSnapshots(person)[0]).toMatchObject({ spiffIds: ['overdue-mileage', 'current-mileage'], spiffCents: 2886 });
    const adjustments = elementWithId(markup, 'payment-adjustments');
    expect(adjustments).toContain('value="overdue-mileage"');
    for (const id of ['paid-mileage', 'old-bonus', 'future-mileage']) expect(adjustments).not.toContain(`value="${id}"`);
    const reads = stub.reads.filter((read) => read.table === 'admin_weekly_sales_spiffs');
    expect(reads).toHaveLength(6);
    expect(reads[0].filters).toContainEqual({ operator: 'or', column: '', value: 'and(week_start_date.lte.2026-09-25,week_end_date.gte.2026-09-21),and(paid_at.is.null,week_start_date.lte.2026-09-25)' });
  });

  it('keeps bulk shift approval scoped to the chosen employee rather than the visible row count', async () => {
    const base = fixture();
    state.client = supabaseReadStub({ tables: { ...base, profiles: [base.profiles[0]], admin_time_entries: [base.admin_time_entries[0]], admin_time_settings: [base.admin_time_settings[0]], admin_weekly_sales_spiffs: [] } }).client;
    const everyone = elementWithId(await page(), 'pay-run');
    const alex = elementWithId(await page({ admin: 'alex' }), 'pay-run');
    expect(hiddenValue(everyone, 'profile_id')).toBe('');
    expect(hiddenValue(alex, 'profile_id')).toBe('alex');
  });

  it('collapses settled employees while leaving a specifically selected employee visible', async () => {
    const base = fixture();
    state.client = supabaseReadStub({ tables: {
      ...base,
      profiles: [base.profiles[1]],
      admin_time_settings: [base.admin_time_settings[1]],
      admin_time_entries: [{ ...base.admin_time_entries[1], status: 'locked' }],
      admin_weekly_sales_spiffs: [],
    } }).client;
    const run = elementWithId(await page(), 'pay-run');
    const settled = [...run.matchAll(/<details\b[^>]*>[\s\S]*?<\/details>/g)].map(([html]) => html)
      .find((html) => html.includes('Paid &amp; no pay due')) ?? '';
    expect(settled).toContain('Casey Diaz');
    expect(settled.split('>')[0]).not.toMatch(/\bopen=/);
    const selected = elementWithId(await page({ admin: 'casey' }), 'pay-run');
    expect(selected).not.toContain('Paid &amp; no pay due');
    expect(plainText(payrollPerson(selected, 'Casey Diaz'))).toContain('Paid');
  });

  it('holds an unresolved prior-month commission without blocking current wages, SPIFFs, or coworkers', async () => {
    const base = commissionFixture('2026-08-01');
    state.client = supabaseReadStub({ tables: {
      ...base,
      admin_commission_settings: [{ profile_id: 'casey', commission_percent: 5, is_sales_rep: true,
        hourly_offset_enabled: true, hourly_offset_start_month: '2026-08-01' }],
      admin_time_entries: [...base.admin_time_entries, { ...base.admin_time_entries[1],
        id: 'casey-august-review', status: 'submitted', clock_in_at: '2026-08-20T14:00:00Z', clock_out_at: '2026-08-20T16:00:00Z' }],
    } }).client;
    const run = elementWithId(await page({ commission_month: '2026-08' }), 'pay-run');
    const casey = paymentSnapshots(run).find((row) => row.profileId === 'casey');
    expect(casey).toMatchObject({ wagesCents: 3000, spiffCents: 10000, commissionCents: 0 });
    expect(casey).not.toHaveProperty('commissionMonth');
    expect(paymentSnapshots(run).some((row) => row.profileId === 'morgan')).toBe(true);
    expect(plainText(payrollPerson(run, 'Casey Diaz'))).toContain('Commission held: Approve or lock');
    expect(enabledMutationButtons(payrollPerson(run, 'Casey Diaz'))).toContain('Record paid');
  });

  it('excludes open shifts and closed shifts with open breaks from the bulk payment', async () => {
    const base = fixture();
    state.client = supabaseReadStub({ tables: {
      ...base,
      admin_time_entries: [
        { ...base.admin_time_entries[0], status: 'open', clock_out_at: null },
        { ...base.admin_time_entries[1], admin_time_breaks: [{ id: 'casey-open-break', status: 'open', break_start_at: '2026-09-21T15:00:00Z', break_end_at: null }] },
      ],
    } }).client;
    const markup = await page();
    expect(plainText(payrollPerson(markup, 'Alex Baker'))).toContain('1 open shift');
    expect(plainText(payrollPerson(markup, 'Casey Diaz'))).toContain('Open break to close');
    expect(enabledMutationButtons(payrollPerson(markup, 'Casey Diaz'))).not.toContain('Record paid');
    expect(paymentSnapshots(elementWithId(markup, 'pay-run')).map((row) => row.profileId)).toEqual(['morgan']);
  });

  it.each(['profiles', 'admin_time_settings', 'admin_salary_payroll_payments', 'admin_weekly_sales_spiffs', 'order_commission_snapshots'])('withholds totals and payment actions if %s cannot load completely', async (table) => {
    state.client = supabaseReadStub({ tables: commissionFixture(), fail: (read) => read.table === table ? 'Unavailable payroll source' : undefined }).client;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const run = elementWithId(await page(), 'pay-run');
      expect(plainText(run)).toContain('Pay run total Unavailable');
      expect(plainText(run)).toContain('Some payment data could not be loaded.');
      expect(paymentSnapshots(run)).toEqual([]);
      expect(enabledMutationButtons(run).filter((label) => /record/i.test(label))).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });

  it('does not require a second week-completion action after employee payments are recorded', async () => {
    const base = fixture();
    state.client = supabaseReadStub({ tables: {
      ...base,
      admin_time_entries: [{ ...base.admin_time_entries[1], status: 'locked' }],
      admin_weekly_sales_spiffs: base.admin_weekly_sales_spiffs.filter((row) => row.profile_id === 'casey').map((row) => ({ ...row, paid_at: NOW.toISOString() })),
      admin_payroll_locks: [],
    } }).client;
    const person = payrollPerson(await page({ admin: 'casey' }), 'Casey Diaz');
    expect(plainText(person)).toContain('Paid');
    expect(plainText(person)).toContain('Hourly $0.00 Incentives $0.00');
    expect(enabledMutationButtons(person)).toEqual([]);
    expect(paymentSnapshots(person)).toEqual([]);
  });
});

describe('payroll employee settings filters', () => {
  it.each([
    [{}, ['alex', 'casey', 'morgan']],
    [{ admin: 'casey' }, ['casey']],
    [{ settings_view: 'deactivated' }, ['devon']],
    [{ settings_view: 'deactivated', admin: 'devon' }, ['devon']],
    [{ settings_view: 'deactivated', admin: 'alex' }, []],
  ] satisfies Array<[Record<string, string>, string[]]>)('shows only matching employee forms for %j', async (filters: Record<string, string>, expectedProfiles) => {
    const markup = await page({ tab: 'settings', ...filters });
    const settings = elementWithId(markup, 'employee-settings');
    const forms = [...settings.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([html]) => html)
      .filter((html) => hiddenValue(html, 'profile_id'));
    expect(forms.map((html) => hiddenValue(html, 'profile_id'))).toEqual(expectedProfiles);
    if (filters.settings_view === 'deactivated') {
      expect(hiddenValue(markup, 'settings_view')).toBe('deactivated');
      for (const form of forms) expect(hiddenValue(form, 'return_to')).toContain('settings_view=deactivated');
    }
    if (filters.admin) {
      for (const form of forms) expect(hiddenValue(form, 'return_to')).toContain(`admin=${filters.admin}`);
    }
    if (!expectedProfiles.length) expect(plainText(markup)).toContain('No employees match this filter in the selected account view.');
  });
});

describe('payroll period and historical amounts', () => {
  it('keeps monthly salary pay tied to the prior calendar month independently of the selected weekly range', async () => {
    const markup = await page({ tab: 'review', from: '2026-09-21', to: '2026-09-25' });
    const salary = /<details\b[^>]*id="monthly-salary"[^>]*>[\s\S]*?<\/details>/.exec(markup)?.[0] ?? '';
    expect(salary).toContain('Morgan Lee');
    expect(salary).toContain('$3,000.00');
    expect(hiddenValue(salary, 'payroll_month')).toBe('2026-08-01');
    expect(hiddenValue(salary, 'period_start_date')).toBe('2026-08-01');
    expect(hiddenValue(salary, 'period_end_date')).toBe('2026-08-31');
    expect(plainText(salary)).toContain('Aug 1');
    expect(plainText(salary)).toContain('Aug 31');
    expect(hiddenValue(markup, 'lock_start')).toBe('2026-09-21');
    expect(hiddenValue(markup, 'lock_end')).toBe('2026-09-25');
    expect(markup.indexOf('id="pay-run"')).toBeLessThan(markup.indexOf('id="monthly-salary"'));
    expect(paymentSnapshots(payrollPerson(markup, 'Morgan Lee'))[0]).toMatchObject({ salaryCents: 300000, payrollMonth: '2026-08-01' });
  });

  it('preserves former employee wages and unpaid SPIFFs in the pay summary', async () => {
    const markup = await page({ tab: 'payroll-day' });
    const formerRow = payrollPerson(markup, 'Former employee');
    expect(plainText(formerRow)).toContain('Former employee');
    expect(formerRow).toContain('$55.00');
    expect(formerRow).toContain('$30.00');
    expect(formerRow).toContain('$25.00');
    expect(plainText(elementWithId(markup, 'pay-run'))).toContain('Pay run total $3,225.00');
    expect(enabledMutationButtons(formerRow)).toEqual([]);
  });

  it('keeps an unpaid first-order SPIFF visible on hold while excluding it from the amount owed', async () => {
    vi.setSystemTime(new Date('2026-10-09T16:00:00.000Z'));
    const tables = fixture();
    tables.admin_time_entries = tables.admin_time_entries.filter((entry) => entry.profile_id === 'casey').map((entry) => ({
      ...entry, clock_in_at: '2026-10-05T14:00:00.000Z', clock_out_at: '2026-10-05T16:00:00.000Z',
    }));
    tables.admin_weekly_sales_spiffs = [{
      ...tables.admin_weekly_sales_spiffs[0],
      profile_id: 'casey',
      first_order_id: 'unpaid-first-order',
      week_start_date: '2026-09-28', week_end_date: '2026-10-04',
      notes: 'Automatic first-order SPIFF: unpaid customer',
    }];
    state.client = supabaseReadStub({ tables }).client;
    state.invoiceEligibility.mockImplementation(async (orderIds: string[]) => ({
      error: null,
      paidOrderIds: new Set<string>(),
      paidOrderMonths: state.paidOrderMonths,
      unpaidOrderIds: new Set(orderIds),
      missingInvoiceOrderIds: new Set<string>(),
    }));
    const filters = { from: '2026-10-05', to: '2026-10-09', admin: 'casey' };
    const summary = await page({ ...filters, tab: 'payroll-day' });
    const caseyRow = payrollPerson(summary, 'Casey Diaz');
    expect(plainText(caseyRow)).toContain('$30.00');
    expect(plainText(caseyRow)).not.toContain('$130.00');
    expect(plainText(caseyRow)).not.toContain('$100.00');

    const payments = await page({ ...filters, tab: 'payments' });
    const spiffRow = [...payments.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([html]) => html)
      .find((html) => html.includes('Automatic first-order SPIFF: unpaid customer')) ?? '';
    expect(plainText(spiffRow)).toContain('$100.00');
    expect(plainText(spiffRow)).toContain('Awaiting invoice payment');
    expect(plainText(spiffRow)).toContain('Check invoice');
    expect(spiffRow).toContain('/admin/invoicing?view=accounts-receivable');
    expect(enabledMutationButtons(spiffRow)).toEqual([]);
    expect(plainText(payments)).toContain('$0.00 due and $0.00 paid.');
    expect(state.invoiceEligibility).toHaveBeenCalledWith(['unpaid-first-order']);
  });

  it('loads every SPIFF page and releases a prior-week first order only after its invoice is paid', async () => {
    vi.setSystemTime(new Date('2026-10-09T16:00:00.000Z'));
    const tables = fixture();
    tables.profiles = [tables.profiles[1]];
    tables.admin_time_entries = [];
    tables.admin_weekly_sales_spiffs = [
      { ...tables.admin_weekly_sales_spiffs[0], profile_id: 'casey', id: 'old-paid-invoice-spiff', first_order_id: 'settled-first-order',
        week_start_date: '2026-09-28', week_end_date: '2026-10-04', notes: 'Prior-week first order' },
      { ...tables.admin_weekly_sales_spiffs[0], profile_id: 'casey', id: 'waiting-spiff', first_order_id: 'waiting-first-order',
        week_start_date: '2026-10-05', week_end_date: '2026-10-11', amount_cents: 20000, notes: 'Current unpaid invoice' },
    ];
    state.invoiceEligibility.mockImplementation(async (orderIds: string[]) => ({
      error: null,
      paidOrderIds: new Set(orderIds.filter((id) => id === 'settled-first-order')),
      paidOrderMonths: state.paidOrderMonths,
      unpaidOrderIds: new Set(orderIds.filter((id) => id !== 'settled-first-order')),
      missingInvoiceOrderIds: new Set<string>(),
    }));
    const stub = supabaseReadStub({ maxRows: 1, tables });
    state.client = stub.client;
    const markup = await page({ tab: 'payments', admin: 'casey', from: '2026-10-05', to: '2026-10-09' });
    expect(plainText(markup)).toContain('$100.00 due and $0.00 paid.');
    const rows = [...markup.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([html]) => html);
    const released = rows.find((html) => html.includes('Prior-week first order')) ?? '';
    const held = rows.find((html) => html.includes('Current unpaid invoice')) ?? '';
    expect(enabledMutationButtons(released)).toEqual(['Mark Paid']);
    expect(hiddenValue(released, 'spiff_id')).toBe('old-paid-invoice-spiff');
    expect(plainText(held)).toContain('Awaiting invoice payment');
    expect(enabledMutationButtons(held)).toEqual([]);
    const reads = stub.reads.filter((read) => read.table === 'admin_weekly_sales_spiffs');
    expect(reads).toHaveLength(3);
    expect(reads.every((read) => read.orders.at(-1)?.column === 'id')).toBe(true);
    expect(state.invoiceEligibility).toHaveBeenCalledWith(['settled-first-order', 'waiting-first-order']);
  });

  it('keeps an existing unpaid first-order SPIFF payable without retroactive invoice verification', async () => {
    vi.setSystemTime(new Date('2026-10-02T16:00:00.000Z'));
    const tables = fixture();
    tables.admin_weekly_sales_spiffs = [{
      ...tables.admin_weekly_sales_spiffs[0], profile_id: 'casey', first_order_id: null,
      notes: 'Automatic first-order SPIFF: historical unpaid customer. Order legacy-order.',
    }];
    state.client = supabaseReadStub({ tables }).client;
    state.invoiceEligibility.mockImplementation(async (orderIds: string[]) => ({
      error: null, paidOrderIds: new Set<string>(), paidOrderMonths: state.paidOrderMonths, unpaidOrderIds: new Set(orderIds), missingInvoiceOrderIds: new Set<string>(),
    }));

    const markup = await page({ tab: 'payments', admin: 'casey', from: '2026-09-21', to: '2026-09-27' });
    const legacyRow = [...markup.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([html]) => html)
      .find((html) => html.includes('historical unpaid customer')) ?? '';

    expect(plainText(markup)).toContain('$100.00 due and $0.00 paid.');
    expect(enabledMutationButtons(legacyRow)).toEqual(['Mark Paid']);
    expect(plainText(legacyRow)).not.toContain('Awaiting invoice payment');
    expect(state.invoiceEligibility.mock.calls.flatMap(([ids]) => ids)).toEqual([]);
  });

  it('shows both years for a reporting period that crosses New Year', async () => {
    const markup = await page({ tab: 'reports', from: '2025-12-29', to: '2026-01-02' });
    expect(plainText(markup)).toContain('Report period · Central time Dec 29, 2025 – Jan 2, 2026');
  });
});

describe('weekly overtime across payroll views', () => {
  it.each(['payroll-day', 'payments'])('includes time and a half in the employee amount owed on %s', async (tab) => {
    state.client = supabaseReadStub({ tables: overtimeFixture() }).client;
    const markup = await page({ tab, from: '2026-09-21', to: '2026-09-25' });
    const alexRow = payrollPerson(markup, 'Alex Baker');
    const text = plainText(alexRow);
    expect(text).toContain('$712.50');
    expect(text).toContain('45.00 hours · 5 shifts · 5.00 OT');
    expect(text).toContain('Includes $37.50 OT premium');
    expect(text).toContain('Ready');
  });

  it('carries the same overtime amount into reports and individual shifts', async () => {
    state.client = supabaseReadStub({ tables: overtimeFixture() }).client;
    const reports = plainText(await page({ tab: 'reports', from: '2026-09-21', to: '2026-09-25' }));
    expect(reports).toContain('Estimated Wages $712.50 Includes $37.50 overtime premium.');
    expect(reports).toContain('Paid Hours 45.00 5.00 overtime hours included.');
    const time = await page({ tab: 'time', from: '2026-09-21', to: '2026-09-25' });
    const fridayRow = [...time.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([html]) => html)
      .find((html) => html.includes('$172.50')) ?? '';
    expect(plainText(fridayRow)).toContain('5.00 overtime');
    expect(plainText(fridayRow)).toContain('Includes $37.50 OT premium');
  });

  it.each(['payroll-day', 'payments'])('counts paid hours toward the threshold without owing them again in %s', async (tab) => {
    state.client = supabaseReadStub({ tables: overtimeFixture({ earlierPaid: true }) }).client;
    const markup = await page({ tab, from: '2026-09-21', to: '2026-09-25' });
    const alexRow = payrollPerson(markup, 'Alex Baker');
    expect(plainText(alexRow)).toContain('$172.50');
    expect(plainText(alexRow)).toContain('Includes $37.50 OT premium');
    expect(plainText(alexRow)).not.toContain('$712.50');
  });

  it('loads every page of weekly context before applying a Friday-only labor filter', async () => {
    const stub = supabaseReadStub({ maxRows: 1, tables: overtimeFixture({ earlierPaid: true, earlierSales: true }) });
    state.client = stub.client;
    const markup = await page({ tab: 'payroll-day', from: '2026-09-25', to: '2026-09-25', admin: 'alex', work_type: 'production' });
    const text = plainText(markup);
    expect(text).toContain('$172.50');
    expect(text).toContain('4.00 regular · 5.00 OT');
    expect(text).toContain('1 shift');
    expect(text).toContain('Includes $37.50 OT premium');
    const reads = stub.reads.filter((read) => read.table === 'admin_time_entries');
    expect(reads).toHaveLength(6);
    expect(reads[0].filters).toEqual([
      { operator: 'or', column: '', value: 'clock_in_at.gte.2026-09-21T05:00:00.000Z,clock_out_at.gt.2026-09-21T05:00:00.000Z' },
      { operator: 'lt', column: 'clock_in_at', value: '2026-09-28T05:00:00.000Z' },
      { operator: 'eq', column: 'profile_id', value: 'alex' },
    ]);
    expect(reads.every((read) => read.orders.at(-1)?.column === 'id')).toBe(true);
  });

  it.each(['admin_time_entries', 'admin_time_entry_allocations'])('shows a loading error instead of incomplete pay when a later %s page fails', async (table) => {
    const tables = {
      ...overtimeFixture(),
      admin_time_entry_allocations: [
        { id: 'allocation-a', time_entry_id: 'alex-21', minutes: 540, wage_cents: 13500, work_type: 'production' },
        { id: 'allocation-b', time_entry_id: 'alex-22', minutes: 540, wage_cents: 13500, work_type: 'production' },
      ],
    };
    state.client = supabaseReadStub({
      maxRows: 1,
      tables,
      fail: (read) => read.table === table && read.from > 0 ? 'Later payroll page failed' : undefined,
    }).client;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const markup = await page({ tab: 'payroll-day', from: '2026-09-21', to: '2026-09-25' });
      expect(plainText(markup)).toContain('The payroll data could not be loaded.');
      expect(markup).not.toContain('$135.00');
      expect(markup).not.toContain('$712.50');
      expect(markup).not.toContain('Amount owed');
      expect(enabledMutationButtons(markup)).toEqual([]);
    } finally {
      log.mockRestore();
    }
  });
});

describe('monthly commissions in payroll', () => {
  it.each(['review', 'payroll-day', 'payments'])('shows the prior month due on the first in %s independently of weekly dates', async (tab) => {
    const stub = supabaseReadStub({ tables: commissionFixture() });
    state.client = stub.client;
    const markup = await page({ tab, from: '2026-07-06', to: '2026-07-10' });
    const section = monthlyCommissionSection(markup);
    const text = plainText(section);
    expect(text).toContain('August 2026 earnings · Pay on Sep 1, 2026');
    expect(text).toContain('Commissions owed $1,115.00');
    expect(text).toContain('$75.00 already paid');
    expect(text).toContain('Casey Diaz');
    expect(text).toContain('$125.00');
    expect(text).toContain('Morgan Lee');
    expect(text).toContain('$990.00');
    expect(text).not.toContain('$90.00');
    expect(text).toContain('Payment recorded');
    expect(enabledMutationButtons(section)).toEqual(['Mark commission paid', 'Mark commission paid']);
    expect(hiddenValue(section, 'commission_month')).toBe('2026-08-01');
    for (const read of stub.reads.filter((read) => ['order_commission_snapshots', 'monthly_commission_payouts'].includes(read.table))) {
      expect(read.filters.some((filter) => filter.column === 'commission_month')).toBe(false);
    }
  });

  it('preserves the chosen commission month in navigation and weekly filters while applying the employee filter', async () => {
    state.client = supabaseReadStub({ tables: commissionFixture('2026-07-01') }).client;
    const markup = await page({ tab: 'payments', commission_month: '2026-07', admin: 'casey', work_type: 'production', from: '2026-09-21', to: '2026-09-25' });
    const section = monthlyCommissionSection(markup);
    expect(plainText(section)).toContain('July 2026 earnings · Pay on Aug 1, 2026');
    expect(plainText(section)).toContain('Commissions owed $125.00');
    expect(plainText(section)).toContain('Casey Diaz');
    expect(section).not.toContain('Morgan Lee');
    expect(section).not.toContain('Alex Baker');
    const nav = /<nav\b[^>]*aria-label="Payroll sections"[^>]*>[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? '';
    for (const [, href] of nav.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      expect(new URL(href.replace(/&amp;/g, '&'), 'https://example.test').searchParams.get('commission_month')).toBe('2026-07');
    }
    const filters = /<section\b[^>]*aria-label="Pay period and filters"[^>]*>[\s\S]*?<\/section>/.exec(markup)?.[0] ?? '';
    expect(inputValue(filters, 'commission_month')).toBe('2026-07');
    expect(hiddenValue(section, 'return_to')).toContain('commission_month=2026-07');
  });

  it.each([
    ['2026-09', 'September 2026', 'Oct 1, 2026'],
    ['2026-10', 'October 2026', 'Nov 1, 2026'],
  ])('shows %s accrual without allowing payment before the following month', async (month, label, dueDate) => {
    const tables = commissionFixture(`${month}-01`);
    tables.order_commission_snapshots = tables.order_commission_snapshots.filter((row) => row.sales_profile_id === 'casey');
    tables.monthly_commission_payouts = [];
    state.client = supabaseReadStub({ tables }).client;
    const section = monthlyCommissionSection(await page({ tab: 'payments', commission_month: month }));
    expect(plainText(section)).toContain(`${label} earnings · Pay on ${dueDate}`);
    expect(plainText(section)).toContain('Accrued commissions $125.00');
    expect(plainText(section)).toContain('Accruing');
    expect(section).not.toContain('Mark commission paid');
    expect(enabledMutationButtons(section)).toEqual([]);
  });

  it('keeps monthly commissions read-only for viewers', async () => {
    state.canEdit = false;
    state.client = supabaseReadStub({ tables: commissionFixture() }).client;
    const section = monthlyCommissionSection(await page({ tab: 'payments' }));
    expect(plainText(section)).toContain('Commissions owed $1,115.00');
    expect(plainText(section)).toContain('View only');
    expect(enabledMutationButtons(section)).toEqual([]);
  });

  it('loads all earned commission and saved payout pages', async () => {
    const stub = supabaseReadStub({ maxRows: 1, tables: commissionFixture() });
    state.client = stub.client;
    const section = monthlyCommissionSection(await page({ tab: 'payroll-day' }));
    expect(plainText(section)).toContain('Commissions owed $1,115.00');
    expect(plainText(section)).toContain('$75.00 already paid');
    expect(stub.reads.filter((read) => read.table === 'order_commission_snapshots')).toHaveLength(5);
    expect(stub.reads.filter((read) => read.table === 'monthly_commission_payouts')).toHaveLength(3);
  });

  it('keeps recorded payments while excluding every unpaid invoice from earnings', async () => {
    vi.setSystemTime(new Date('2026-10-02T16:00:00.000Z'));
    state.client = supabaseReadStub({ tables: commissionFixture() }).client;
    state.invoiceEligibility.mockImplementation(async (orderIds: string[]) => ({
      error: null, paidOrderIds: new Set<string>(), paidOrderMonths: new Map<string, string>(),
      unpaidOrderIds: new Set(orderIds), missingInvoiceOrderIds: new Set<string>(),
    }));

    const section = monthlyCommissionSection(await page({ tab: 'payments', commission_month: '2026-08' }));

    expect(plainText(section)).toContain('Commissions owed $0.00');
    expect(plainText(section)).toContain('$75.00 already paid');
    expect(plainText(section)).not.toContain('could not be loaded');
    expect(plainText(section)).not.toMatch(/on hold|awaiting invoice payment/i);
    expect(enabledMutationButtons(section)).toEqual([]);
    expect(state.invoiceEligibility.mock.calls.flatMap(([ids]) => ids)).toEqual(expect.arrayContaining(['order-casey-first', 'order-casey-second', 'order-morgan-current']));
    expect(state.invoiceEligibility.mock.calls.flatMap(([ids]) => ids)).not.toContain('order-alex-current');
  });

  it('earns September shipments in October when their invoices are fully paid in October', async () => {
    vi.setSystemTime(new Date('2026-11-02T16:00:00.000Z'));
    const tables = commissionFixture('2026-09-01');
    tables.order_commission_snapshots = tables.order_commission_snapshots.filter((row) => row.sales_profile_id === 'casey');
    tables.monthly_commission_payouts = [];
    state.client = supabaseReadStub({ tables }).client;
    state.invoiceEligibility.mockImplementation(async () => ({
      error: null, paidOrderIds: new Set(['order-casey-first']),
      paidOrderMonths: new Map([['order-casey-first', '2026-10-01']]),
      unpaidOrderIds: new Set(['order-casey-second']), missingInvoiceOrderIds: new Set<string>(),
    }));

    const september = monthlyCommissionSection(await page({ tab: 'payments', admin: 'casey', commission_month: '2026-09' }));
    const october = monthlyCommissionSection(await page({ tab: 'payments', admin: 'casey', commission_month: '2026-10' }));
    expect(plainText(september)).toContain('Commissions owed $0.00');
    expect(enabledMutationButtons(september)).toEqual([]);
    expect(plainText(october)).toContain('Commissions owed $50.00');
    expect(plainText(october)).toContain('Commission is earned in the month the invoice is fully paid.');
    expect(plainText(september + october)).not.toMatch(/on hold|awaiting invoice payment/i);
    expect(hiddenValue(october, 'payment_amount_cents')).toBe('5000');
    expect(enabledMutationButtons(october)).toEqual(['Mark commission paid']);
  });

  it('offers payment for a later-settled invoice while preserving the amount already paid for the month', async () => {
    vi.setSystemTime(new Date('2026-11-25T16:00:00.000Z'));
    const tables = commissionFixture('2026-10-01');
    tables.order_commission_snapshots = tables.order_commission_snapshots.filter((row) => row.sales_profile_id === 'casey');
    tables.monthly_commission_payouts = [{
      ...tables.monthly_commission_payouts[1],
      id: 'casey-partially-paid', sales_profile_id: 'casey', commission_cents: 5000,
      revenue_cents: 125000, gross_profit_cents: 100000,
      product_cogs_cents: 25000, total_cogs_cents: 25000,
      paid_order_ids: ['order-casey-first'],
    }];
    state.client = supabaseReadStub({ tables }).client;
    const section = monthlyCommissionSection(await page({ tab: 'payments', admin: 'casey' }));
    const text = plainText(section);
    expect(text).toContain('Commissions owed $75.00');
    expect(text).toContain('$50.00 already paid');
    expect(text).toContain('$125.00');
    expect(text).toContain('Due');
    expect(text).not.toContain('Additional commission due');
    expect(text).toContain('$75.00 payable');
    expect(enabledMutationButtons(section)).toEqual(['Mark commission paid']);
    expect(hiddenValue(section, 'payment_amount_cents')).toBe('7500');
    expect(hiddenValue(section, 'commission_month')).toBe('2026-10-01');
    expect(state.invoiceEligibility.mock.calls.some(([ids]) => ids.length === 1 && ids[0] === 'order-casey-second')).toBe(true);
    expect(state.invoiceEligibility.mock.calls.flatMap(([ids]) => ids)).not.toContain('order-casey-first');
  });

  it.each(['order_commission_snapshots', 'monthly_commission_payouts'])('shows an unavailable state instead of a partial balance when %s pagination fails', async (table) => {
    state.client = supabaseReadStub({
      maxRows: 1, tables: commissionFixture(),
      fail: (read) => read.table === table && read.from > 0 ? 'Later commission page failed' : undefined,
    }).client;
    const section = monthlyCommissionSection(await page({ tab: 'payroll-day' }));
    expect(plainText(section)).toContain('Monthly commissions could not be loaded.');
    expect(section).not.toContain('Commissions owed');
    expect(section).not.toContain('$0.00');
    expect(enabledMutationButtons(section)).toEqual([]);
  });
});

describe('deferred pay in payroll', () => {
  const deferredPlan = {
    id: 'haskins-plan', profile_id: 'alex', label: 'January 4 deferred pay',
    start_date: '2026-10-07', end_date: '2027-01-03', payout_date: '2027-01-04',
    weekly_rate_cents: 1500, accrual_rate_cents: 500, paid_at: null, paid_amount_cents: null,
  };
  function deferredFixture() {
    const base = fixture();
    return {
      ...base,
      admin_deferred_pay_plans: [deferredPlan],
      admin_time_entries: [{
        ...base.admin_time_entries[0], id: 'eligible', profile_id: 'alex', status: 'locked',
        clock_in_at: '2026-10-07T13:00:00Z', clock_out_at: '2026-10-07T21:00:00Z',
        hourly_rate_cents_snapshot: 1500, work_type: 'sales', admin_time_breaks: [],
      }],
      admin_time_breaks: [],
      admin_time_entry_allocations: [],
    };
  }
  const section = (html: string) => /<section\b[^>]*id="deferred-pay"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';

  it.each(['review', 'payroll-day', 'payments'])('shows the current full-period liability in %s independent of weekly dates and labor tag', async (tab) => {
    vi.setSystemTime(new Date('2027-01-04T18:00:00Z'));
    state.client = supabaseReadStub({ tables: deferredFixture() }).client;
    const html = section(await page({ tab, from: '2027-01-04', to: '2027-01-08', admin: 'alex', work_type: 'production' }));
    expect(plainText(html)).toContain('Current deferred liability $40.00');
    expect(plainText(html)).toContain('Deferred payable now $40.00');
    expect(hiddenValue(html, 'expected_amount_cents')).toBe('4000');
    expect(hiddenValue(html, 'plan_id')).toBe('haskins-plan');
    expect(html).not.toContain('name="lock_start"');
  });

  it('shows carryover in January reports without recognizing the October expense again', async () => {
    vi.setSystemTime(new Date('2027-01-04T18:00:00Z'));
    state.client = supabaseReadStub({ tables: deferredFixture() }).client;
    const html = section(await page({ tab: 'reports', from: '2027-01-01', to: '2027-01-31', admin: 'alex' }));
    expect(plainText(html)).toContain('Opening liability $40.00');
    expect(plainText(html)).toContain('Accrued in period $0.00');
    expect(plainText(html)).toContain('Closing liability $40.00');
    expect(html).not.toContain('<form');
  });

  it('honors the employee filter and does not query bank data for read-only payroll viewers', async () => {
    vi.setSystemTime(new Date('2027-01-04T18:00:00Z'));
    state.canEdit = false;
    const stub = supabaseReadStub({ tables: deferredFixture() }); state.client = stub.client;
    const own = section(await page({ tab: 'payments', admin: 'alex' }));
    expect(plainText(own)).toContain('Current deferred liability $40.00');
    expect(own).not.toContain('<form');
    const other = section(await page({ tab: 'payments', admin: 'casey' }));
    expect(plainText(other)).toContain('No deferred hourly pay plans');
    expect(stub.reads.some((read) => read.table === 'accounting_transactions')).toBe(false);
  });

  it('excludes bank transactions already matched to another employee even under a profile filter', async () => {
    vi.setSystemTime(new Date('2027-01-04T18:00:00Z'));
    const tables = deferredFixture();
    const stub = supabaseReadStub({ tables: {
      ...tables,
      admin_deferred_pay_plans: [deferredPlan, { ...deferredPlan, id: 'other-plan', profile_id: 'casey', accounting_transaction_id: 'used-bank' }],
      accounting_transactions: ['used-bank', 'free-bank'].map((id) => ({ id, account_type: 'bank', account_name: 'Checking', merchant_name: 'Payroll', original_description: id, amount_cents: 4000, status: 'needs_review', transaction_date: '2027-01-04' })),
    } }); state.client = stub.client;
    const html = section(await page({ tab: 'payments', admin: 'alex' }));
    expect(html).toContain('<option value="free-bank">');
    expect(html).not.toContain('<option value="used-bank">');
    const linkRead = stub.reads.find((read) => read.table === 'admin_deferred_pay_plans' && read.columns === 'accounting_transaction_id');
    expect(linkRead?.filters.some((filter) => filter.column === 'profile_id')).toBe(false);
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  canEdit: true,
  client: null as unknown as ReturnType<typeof supabaseReadStub>['client'],
  requireView: vi.fn(async () => ({ access: {}, profile: { id: 'reviewer' } })),
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: state.requireView,
  requireAdminSectionEdit: vi.fn(),
  adminCanEdit: () => state.canEdit,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
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
    ],
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
    commission_cents: commissionCents, commission_percent: 5, gross_profit_cents: commissionCents * 20,
    revenue_cents: commissionCents * 25, product_cogs_cents: commissionCents * 5,
    shipping_cogs_cents: 0, processing_fee_cogs_cents: 0, donation_cogs_cents: 0,
    total_cogs_cents: commissionCents * 5, cogs_estimated: false,
  });
  const payout = (id: string, salesProfileId: string, cents: number, status: string) => ({
    id, sales_profile_id: salesProfileId, commission_month: commissionMonth, commission_cents: cents,
    revenue_cents: cents * 25, gross_profit_cents: cents * 20, product_cogs_cents: cents * 5,
    shipping_cogs_cents: 0, processing_fee_cogs_cents: 0, donation_cogs_cents: 0,
    total_cogs_cents: cents * 5, order_count: 1, status,
    locked_at: '2026-09-01T12:00:00.000Z', locked_by: 'reviewer',
    paid_at: status === 'paid' ? '2026-09-01T12:00:00.000Z' : null,
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
  state.requireView.mockClear();
  state.client = supabaseReadStub({ tables: fixture() }).client;
});
afterEach(() => { vi.useRealTimers(); });

describe('payroll navigation and access', () => {
  it('keeps date, employee, and labor filters while navigating all seven payroll sections', async () => {
    const markup = await page({ from: '2026-09-07', to: '2026-09-11', admin: 'alex', work_type: 'production' });
    const nav = /<nav\b[^>]*aria-label="Payroll sections"[^>]*>[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? '';
    const links = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(7);
    expect(links.map(([, , label]) => plainText(label.replace(/<span\b[^>]*class="payroll-count"[^>]*>[\s\S]*?<\/span>/g, '')))).toEqual([
      'Review payroll', 'Pay summary', 'Payments', 'Time & corrections', 'Reports', 'Employee settings', 'Export CSV',
    ]);
    for (const [, href] of links) {
      const url = new URL(href.replace(/&amp;/g, '&'), 'https://example.test');
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ from: '2026-09-07', to: '2026-09-11', admin: 'alex', work_type: 'production' });
    }
    expect(links.map(([, href]) => new URL(href.replace(/&amp;/g, '&'), 'https://example.test').searchParams.get('tab')))
      .toEqual(['review', 'payroll-day', 'payments', 'time', 'reports', 'settings', 'export']);
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
    const forms = [...markup.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([html]) => html)
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
    expect(markup.indexOf('Weekly payroll review')).toBeLessThan(markup.indexOf('id="monthly-salary"'));
  });

  it('preserves former employee wages and unpaid SPIFFs in the pay summary', async () => {
    const markup = await page({ tab: 'payroll-day' });
    const formerRow = [...markup.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([html]) => html)
      .find((html) => html.includes('Former employee')) ?? '';
    expect(plainText(formerRow)).toContain('Former employee');
    expect(formerRow).toContain('$55.00');
    expect(formerRow).toContain('$30.00');
    expect(formerRow).toContain('$25.00');
    expect(markup).toContain('$225.00');
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
    const alexRow = [...markup.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([html]) => html)
      .find((html) => html.includes('Alex Baker')) ?? '';
    const text = plainText(alexRow);
    expect(text).toContain('$712.50');
    expect(text).toContain('40.00 regular · 5.00 OT');
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
    const alexRow = [...markup.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map(([html]) => html)
      .find((html) => html.includes('Alex Baker')) ?? '';
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
    expect(text).toContain('August 2026 sales · Pay on Sep 1, 2026');
    expect(text).toContain('Commissions owed $215.00');
    expect(text).toContain('$75.00 already paid');
    expect(text).toContain('Casey Diaz');
    expect(text).toContain('$125.00');
    expect(text).toContain('Morgan Lee');
    expect(text).toContain('$90.00');
    expect(text).not.toContain('$990.00');
    expect(text).toContain('Amount locked');
    expect(text).toContain('Payment recorded');
    expect(enabledMutationButtons(section)).toEqual(['Mark commission paid', 'Mark commission paid']);
    expect(hiddenValue(section, 'commission_month')).toBe('2026-08-01');
    for (const read of stub.reads.filter((read) => ['order_commission_snapshots', 'monthly_commission_payouts'].includes(read.table))) {
      expect(read.filters).toEqual([{ operator: 'eq', column: 'commission_month', value: '2026-08-01' }]);
    }
  });

  it('preserves the chosen commission month in navigation and weekly filters while applying the employee filter', async () => {
    state.client = supabaseReadStub({ tables: commissionFixture('2026-07-01') }).client;
    const markup = await page({ tab: 'payments', commission_month: '2026-07', admin: 'casey', work_type: 'production', from: '2026-09-21', to: '2026-09-25' });
    const section = monthlyCommissionSection(markup);
    expect(plainText(section)).toContain('July 2026 sales · Pay on Aug 1, 2026');
    expect(plainText(section)).toContain('Commissions owed $125.00');
    expect(plainText(section)).toContain('Casey Diaz');
    expect(section).not.toContain('Morgan Lee');
    expect(section).not.toContain('Alex Baker');
    const nav = /<nav\b[^>]*aria-label="Payroll sections"[^>]*>[\s\S]*?<\/nav>/.exec(markup)?.[0] ?? '';
    for (const [, href] of nav.matchAll(/<a\b[^>]*href="([^"]+)"/g)) {
      expect(new URL(href.replace(/&amp;/g, '&'), 'https://example.test').searchParams.get('commission_month')).toBe('2026-07');
    }
    const filters = /<section\b[^>]*aria-label="Pay period and filters"[^>]*>[\s\S]*?<\/section>/.exec(markup)?.[0] ?? '';
    expect(hiddenValue(filters, 'commission_month')).toBe('2026-07');
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
    expect(plainText(section)).toContain(`${label} sales · Pay on ${dueDate}`);
    expect(plainText(section)).toContain('Accrued commissions $125.00');
    expect(plainText(section)).toContain('Accruing');
    expect(section).not.toContain('Mark commission paid');
    expect(enabledMutationButtons(section)).toEqual([]);
  });

  it('keeps monthly commissions read-only for viewers', async () => {
    state.canEdit = false;
    state.client = supabaseReadStub({ tables: commissionFixture() }).client;
    const section = monthlyCommissionSection(await page({ tab: 'payments' }));
    expect(plainText(section)).toContain('Commissions owed $215.00');
    expect(plainText(section)).toContain('View only');
    expect(enabledMutationButtons(section)).toEqual([]);
  });

  it('loads all earned commission and saved payout pages', async () => {
    const stub = supabaseReadStub({ maxRows: 1, tables: commissionFixture() });
    state.client = stub.client;
    const section = monthlyCommissionSection(await page({ tab: 'payroll-day' }));
    expect(plainText(section)).toContain('Commissions owed $215.00');
    expect(plainText(section)).toContain('$75.00 already paid');
    expect(stub.reads.filter((read) => read.table === 'order_commission_snapshots')).toHaveLength(5);
    expect(stub.reads.filter((read) => read.table === 'monthly_commission_payouts')).toHaveLength(3);
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

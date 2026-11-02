import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ eligibility: vi.fn(), commissions: vi.fn(), recordCommission: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/commission-invoice-eligibility', () => ({ getCommissionInvoiceEligibility: mocks.eligibility }));
vi.mock('@/lib/payroll-commissions', () => ({
  isPayrollCommissionMonth: (value: unknown) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value),
  loadPayrollCommissions: mocks.commissions, recordPayrollCommissionPaid: mocks.recordCommission,
}));
vi.mock('@/lib/admin-audit', () => ({ recordAdminAuditLog: mocks.audit }));

import { parsePayrollPaymentSnapshots, recordReviewedPayrollPayments, type PayrollPaymentSnapshot } from './payroll-payment';

type Row = Record<string, any>;
type Operation = { table: string; payload: Row; kind: string };
function database(tables: Record<string, Row[]>, failWrite?: (operation: Operation) => boolean) {
  const writes: Operation[] = [];
  const reads: string[] = [];
  const client = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let kind = 'read';
      let payload: Row = {};
      let start = 0;
      let end = Infinity;
      let single = false;
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
        is: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
        in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
        lt: (key: string, value: string) => { filters.push((row) => row[key] < value); return query; },
        lte: (key: string, value: string) => { filters.push((row) => row[key] <= value); return query; },
        or: () => query,
        order: () => query,
        range: (from: number, to: number) => { start = from; end = to; return query; },
        maybeSingle: () => { single = true; return query; },
        single: () => { single = true; return query; },
        update: (value: Row) => { kind = 'update'; payload = value; return query; },
        insert: (value: Row) => { kind = 'insert'; payload = value; return query; },
        then(resolve: (result: { data: Row[] | Row | null; error: { message: string } | null }) => unknown) {
          if (kind === 'read') reads.push(table);
          if (kind !== 'read') {
            const operation = { table, payload, kind };
            writes.push(operation);
            if (failWrite?.(operation)) return Promise.resolve({ data: null, error: { message: 'Write failed' } }).then(resolve);
          }
          let rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          if (kind === 'insert') {
            rows = [{ id: `insert-${writes.length}`, ...payload }];
            (tables[table] ??= []).push(...rows);
          }
          if (kind === 'update') rows.forEach((row) => Object.assign(row, payload));
          rows = rows.slice(start, end + 1).map((row) => structuredClone(row));
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { client, writes, reads };
}

const NOW = new Date('2026-10-18T18:00:00Z');
const entry = (overrides: Row = {}) => ({ id: 'entry-a', profile_id: 'employee-a', status: 'approved',
  clock_in_at: '2026-10-12T14:00:00.000Z', clock_out_at: '2026-10-12T15:00:00.000Z', hourly_rate_cents_snapshot: 2000,
  updated_at: '2026-10-12T15:00:00.000Z', admin_time_breaks: [], ...overrides });
const spiff = (overrides: Row = {}) => ({ id: 'spiff-a', profile_id: 'employee-a', paid_at: null, amount_cents: 500,
  first_order_id: 'order-a', week_start_date: '2026-10-12', week_end_date: '2026-10-16', updated_at: '2026-10-12T15:00:00.000Z', ...overrides });
const snapshot = (overrides: Partial<PayrollPaymentSnapshot> = {}): PayrollPaymentSnapshot => ({ profileId: 'employee-a',
  entryIds: ['entry-a'], spiffIds: [], wagesCents: 2000, spiffCents: 0, salaryCents: 0, commissionCents: 0, ...overrides });
const run = (db: ReturnType<typeof database>, snapshots = [snapshot()]) => recordReviewedPayrollPayments({
  snapshots, startInput: '2026-10-12', endInput: '2026-10-16', actorProfileId: 'actor', supabase: db.client, now: NOW,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit.mockResolvedValue(undefined);
  mocks.eligibility.mockResolvedValue({ paidOrderIds: new Set(['order-a']), error: null });
  mocks.commissions.mockResolvedValue({ rows: [{ salesProfileId: 'employee-a', amountOwedCents: 700 }], error: null });
  mocks.recordCommission.mockResolvedValue({ payout: { id: 'commission-a' }, before: null, paymentAmountCents: 700 });
});

describe('payroll review snapshots', () => {
  it('rejects malformed, duplicate, empty, negative, and unbounded requests', () => {
    for (const rows of [[], [snapshot(), snapshot()], [snapshot({ wagesCents: -1 })], [snapshot({ entryIds: ['entry-a', 'entry-a'] })],
      [snapshot({ commissionCents: 700 })], [snapshot({ wagesCents: 1.5 })], [snapshot({ entryIds: [], wagesCents: 0 })]]) {
      expect(parsePayrollPaymentSnapshots(JSON.stringify(rows))).toBeNull();
    }
    expect(parsePayrollPaymentSnapshots('not JSON')).toBeNull();
    expect(parsePayrollPaymentSnapshots(JSON.stringify([snapshot()]))).toEqual([snapshot()]);
  });
});

describe('recording consolidated payroll', () => {
  it('records wages, salary, SPIFF, and commission once with the authenticated actor', async () => {
    const db = database({ admin_time_entries: [entry()], admin_weekly_sales_spiffs: [spiff()],
      profiles: [{ id: 'employee-a', is_admin: true, is_active: true }], admin_time_settings: [{ profile_id: 'employee-a', active: true,
        compensation_type: 'salary', salary_frequency: 'monthly', salary_amount_cents: 300000, salary_labor_work_type: 'owner' }] });
    const result = await run(db, [snapshot({ spiffIds: ['spiff-a'], spiffCents: 500, salaryCents: 300000, payrollMonth: '2026-09-01',
      commissionCents: 700, commissionMonth: '2026-09-01' })]);
    expect(result).toEqual({ recordedCount: 4, completedEmployees: 1 });
    expect(db.writes.map((write) => write.table)).toEqual(['admin_salary_payroll_payments', 'admin_weekly_sales_spiffs', 'admin_time_entries']);
    expect(db.writes[0].payload).toMatchObject({ paid_by: 'actor', salary_labor_work_type: 'owner', period_start_date: '2026-09-01', period_end_date: '2026-09-30' });
    expect(mocks.recordCommission).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: 'actor', expectedPaymentCents: 700 }));
    expect(mocks.audit).toHaveBeenCalledTimes(4);
    expect(mocks.audit.mock.calls.every(([args]) => args.actorProfileId === 'actor')).toBe(true);
  });

  it.each([
    [entry({ status: 'submitted' }), 'unapproved_entries'],
    [entry({ clock_out_at: null }), 'open_entries'],
    [entry({ admin_time_breaks: [{ break_start_at: '2026-10-12T14:30:00.000Z', break_end_at: null, status: 'open' }] }), 'open_breaks'],
    [entry({ hourly_rate_cents_snapshot: 2100 }), 'payroll_payment_changed'],
    [entry({ status: 'locked' }), 'payroll_payment_changed'],
  ])('rejects unreviewed or changed shifts without recording any payment', async (shift, error) => {
    const db = database({ admin_time_entries: [shift] });
    expect(await run(db)).toMatchObject({ error, recordedCount: 0 });
    expect(db.writes).toEqual([]);
  });

  it('preflights every employee before changing the first employee', async () => {
    const db = database({ admin_time_entries: [entry(), entry({ id: 'entry-b', profile_id: 'employee-b', status: 'submitted' })] });
    expect(await run(db, [snapshot(), snapshot({ profileId: 'employee-b', entryIds: ['entry-b'] })])).toMatchObject({ error: 'unapproved_entries', recordedCount: 0 });
    expect(db.writes).toEqual([]);
  });

  it('refuses to pay a partial hidden selection or an added shift', async () => {
    const db = database({ admin_time_entries: [entry(), entry({ id: 'entry-new' })] });
    expect(await run(db)).toMatchObject({ error: 'payroll_payment_changed' });
    expect(db.writes).toEqual([]);
  });

  it('matches stored allocation wages and uses all workweek hours for overtime', async () => {
    const db = database({ admin_time_entries: [entry({ id: 'paid-earlier', status: 'locked', clock_in_at: '2026-10-12T00:00:00.000Z',
      clock_out_at: '2026-10-13T16:00:00.000Z' }), entry({ clock_in_at: '2026-10-14T14:00:00.000Z', clock_out_at: '2026-10-14T15:00:00.000Z' })],
    admin_time_entry_allocations: [{ id: 'allocation-a', time_entry_id: 'entry-a', minutes: 60, wage_cents: 2500 }] });
    // The preceding shift crosses the Sunday/Monday boundary: 35 hours in this workweek.
    expect(await run(db, [snapshot({ wagesCents: 2500 })])).toEqual({ recordedCount: 1, completedEmployees: 1 });
  });

  it('includes locked time when calculating overtime for the remaining unpaid shift', async () => {
    const db = database({ admin_time_entries: [entry({ id: 'paid-earlier', status: 'locked', clock_in_at: '2026-10-12T05:00:00.000Z',
      clock_out_at: '2026-10-13T21:00:00.000Z' }), entry({ clock_in_at: '2026-10-14T14:00:00.000Z', clock_out_at: '2026-10-14T15:00:00.000Z' })] });
    expect(await run(db, [snapshot({ wagesCents: 3000 })])).toEqual({ recordedCount: 1, completedEmployees: 1 });
  });

  it('allows reviewed zero-dollar salary shifts without inventing hourly wages', async () => {
    const db = database({ admin_time_entries: [entry({ hourly_rate_cents_snapshot: 0 })] });
    expect(await run(db, [snapshot({ wagesCents: 0 })])).toEqual({ recordedCount: 1, completedEmployees: 1 });
  });

  it('keeps first-order SPIFFs on hold when invoices are not fully paid', async () => {
    mocks.eligibility.mockResolvedValue({ paidOrderIds: new Set(), error: null });
    const db = database({ admin_time_entries: [entry()], admin_weekly_sales_spiffs: [spiff()] });
    expect(await run(db, [snapshot({ spiffIds: ['spiff-a'], spiffCents: 500 })])).toMatchObject({ error: 'spiff_invoice_unpaid' });
    expect(db.writes).toEqual([]);
  });

  it('rejects a SPIFF belonging to another employee', async () => {
    const db = database({ admin_time_entries: [entry()], admin_weekly_sales_spiffs: [spiff({ profile_id: 'employee-b' })] });
    expect(await run(db, [snapshot({ spiffIds: ['spiff-a'], spiffCents: 500 })])).toMatchObject({ error: 'payroll_payment_changed' });
    expect(db.writes).toEqual([]);
  });

  it('records mileage and manual SPIFFs without requiring an invoice', async () => {
    const db = database({ admin_time_entries: [], admin_weekly_sales_spiffs: [spiff({ first_order_id: null })] });
    expect(await run(db, [snapshot({ entryIds: [], wagesCents: 0, spiffIds: ['spiff-a'], spiffCents: 500 })])).toEqual({ recordedCount: 1, completedEmployees: 1 });
    expect(mocks.eligibility).not.toHaveBeenCalled();
  });

  it('includes overdue unpaid mileage in the employee payment', async () => {
    const db = database({ admin_weekly_sales_spiffs: [spiff({ first_order_id: null, notes: 'Mileage reimbursement: 10 miles at $0.50 per mile',
      week_start_date: '2026-09-01', week_end_date: '2026-09-05' })] });
    expect(await run(db, [snapshot({ entryIds: [], wagesCents: 0, spiffIds: ['spiff-a'], spiffCents: 500 })])).toEqual({ recordedCount: 1, completedEmployees: 1 });
    expect(mocks.eligibility).not.toHaveBeenCalled();
  });

  it('reports partial completion and leaves recorded components paid for a safe refreshed retry', async () => {
    const tables = { admin_time_entries: [entry()], admin_weekly_sales_spiffs: [spiff()] };
    const db = database(tables, (write) => write.table === 'admin_time_entries');
    expect(await run(db, [snapshot({ spiffIds: ['spiff-a'], spiffCents: 500 })])).toMatchObject({ error: 'payroll_payment_partial', recordedCount: 1 });
    expect(tables.admin_weekly_sales_spiffs[0].paid_at).toBe(NOW.toISOString());
    expect(tables.admin_time_entries[0].status).toBe('approved');
    const retry = database(tables);
    expect(await run(retry)).toEqual({ recordedCount: 1, completedEmployees: 1 });
    expect(retry.writes.map((write) => write.table)).toEqual(['admin_time_entries']);
  });

  it('rejects a stale replay instead of recording the same wages twice', async () => {
    const db = database({ admin_time_entries: [entry()] });
    expect(await run(db)).toMatchObject({ completedEmployees: 1 });
    expect(await run(db)).toMatchObject({ error: 'payroll_payment_changed', recordedCount: 0 });
    expect(db.writes).toHaveLength(1);
  });

  it('does not overwrite a shift changed by another admin after preflight', async () => {
    const tables = { admin_time_entries: [entry()] };
    const db = database(tables, (write) => {
      if (write.table === 'admin_time_entries') {
        tables.admin_time_entries[0].status = 'submitted';
        tables.admin_time_entries[0].updated_at = '2026-10-18T18:00:01.000Z';
      }
      return false;
    });
    expect(await run(db)).toMatchObject({ error: 'payroll_payment_partial', recordedCount: 0 });
    expect(tables.admin_time_entries[0].status).toBe('submitted');
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('records an existing unpaid salary row with a conditional update', async () => {
    const db = database({ profiles: [{ id: 'employee-a', is_admin: true, is_active: true }],
      admin_time_settings: [{ profile_id: 'employee-a', active: true, compensation_type: 'salary', salary_frequency: 'monthly', salary_amount_cents: 300000 }],
      admin_salary_payroll_payments: [{ id: 'salary-a', profile_id: 'employee-a', payroll_month: '2026-09-01', paid_at: null, updated_at: '2026-09-30T18:00:00Z' }] });
    expect(await run(db, [snapshot({ entryIds: [], wagesCents: 0, salaryCents: 300000, payrollMonth: '2026-09-01' })]))
      .toEqual({ recordedCount: 1, completedEmployees: 1 });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ table: 'admin_salary_payroll_payments', kind: 'update', payload: { paid_at: NOW.toISOString() } });
  });

  it('will not overwrite salary that has already been paid', async () => {
    const db = database({ profiles: [{ id: 'employee-a', is_admin: true, is_active: true }],
      admin_time_settings: [{ profile_id: 'employee-a', active: true, compensation_type: 'salary', salary_frequency: 'monthly', salary_amount_cents: 300000 }],
      admin_salary_payroll_payments: [{ id: 'salary-a', profile_id: 'employee-a', payroll_month: '2026-09-01', paid_at: NOW.toISOString(), updated_at: NOW.toISOString() }] });
    expect(await run(db, [snapshot({ entryIds: [], wagesCents: 0, salaryCents: 300000, payrollMonth: '2026-09-01' })]))
      .toMatchObject({ error: 'payroll_payment_changed', recordedCount: 0 });
    expect(db.writes).toEqual([]);
  });

  it('does not include commissions until their earned month is complete', async () => {
    const db = database({ admin_time_entries: [entry()] });
    expect(await run(db, [snapshot({ commissionCents: 700, commissionMonth: '2026-10-01' })]))
      .toMatchObject({ error: 'payroll_payment_changed', recordedCount: 0 });
    expect(db.writes).toEqual([]);
    expect(mocks.recordCommission).not.toHaveBeenCalled();
  });

  it.each([
    spiff({ first_order_id: null }),
    spiff({ week_start_date: '2026-09-01', week_end_date: '2026-09-05' }),
    spiff({ first_order_id: null, notes: 'Mileage', week_start_date: '2026-09-01', week_end_date: '2026-09-05' }),
  ])('rejects a newly payable incentive absent from the reviewed total', async (incentive) => {
    const db = database({ admin_time_entries: [entry()], admin_weekly_sales_spiffs: [incentive] });
    expect(await run(db)).toMatchObject({ error: 'payroll_payment_changed', recordedCount: 0 });
    expect(db.writes).toEqual([]);
  });

  it('excludes unpaid-invoice incentives and old manual SPIFFs from the current total', async () => {
    mocks.eligibility.mockResolvedValue({ paidOrderIds: new Set(), error: null });
    const db = database({ admin_time_entries: [entry()], admin_weekly_sales_spiffs: [spiff(),
      spiff({ id: 'old-manual', first_order_id: null, week_start_date: '2026-09-01', week_end_date: '2026-09-05' })] });
    expect(await run(db)).toEqual({ recordedCount: 1, completedEmployees: 1 });
    expect(db.writes.map((write) => write.table)).toEqual(['admin_time_entries']);
  });

  it('rechecks a zero salary snapshot when an employee has become eligible since review', async () => {
    const db = database({ admin_time_entries: [entry()], profiles: [{ id: 'employee-a', is_admin: true, is_active: true }],
      admin_time_settings: [{ profile_id: 'employee-a', active: true, compensation_type: 'salary', salary_frequency: 'monthly', salary_amount_cents: 300000 }] });
    expect(await run(db, [snapshot({ payrollMonth: '2026-09-01' })])).toMatchObject({ error: 'payroll_payment_changed', recordedCount: 0 });
    expect(db.writes).toEqual([]);
  });

  it('does not manufacture salary eligibility for an inactive employee with hourly wages owed', async () => {
    const db = database({ admin_time_entries: [entry()], profiles: [{ id: 'employee-a', is_admin: true, is_active: false }],
      admin_time_settings: [{ profile_id: 'employee-a', active: true, compensation_type: 'salary', salary_frequency: 'monthly', salary_amount_cents: 300000 }] });
    expect(await run(db, [snapshot({ payrollMonth: '2026-09-01' })])).toEqual({ recordedCount: 1, completedEmployees: 1 });
  });

  it('rechecks a zero commission snapshot when another invoice has been paid', async () => {
    const db = database({ admin_time_entries: [entry()] });
    expect(await run(db, [snapshot({ commissionMonth: '2026-09-01' })])).toMatchObject({ error: 'payroll_payment_changed', recordedCount: 0 });
    expect(db.writes).toEqual([]);
  });

  it('validates unresolved monthly offset wages across the full batch before any payment', async () => {
    const db = database({ admin_time_entries: [entry(), entry({ id: 'entry-b', profile_id: 'employee-b' })] });
    mocks.commissions.mockResolvedValue({ rows: [{ salesProfileId: 'employee-b', amountOwedCents: 700,
      settlementBlockedReason: 'Approve or lock all time entries for this month before paying commission.' }], error: null });
    const result = await run(db, [snapshot(), snapshot({ profileId: 'employee-b', entryIds: ['entry-b'], commissionCents: 700, commissionMonth: '2026-09-01' })]);
    expect(result).toEqual({ error: 'payroll_payment_changed', recordedCount: 0, completedEmployees: 0 });
    expect(db.writes).toEqual([]);
    expect(mocks.recordCommission).not.toHaveBeenCalled();
  });

  it.each(['2026-10-01', '2026-11-01'])('permits wages while commission month %s is still accruing', async (commissionMonth) => {
    const db = database({ admin_time_entries: [entry()] });
    expect(await run(db, [snapshot({ commissionMonth })])).toEqual({ recordedCount: 1, completedEmployees: 1 });
    expect(mocks.recordCommission).not.toHaveBeenCalled();
  });

  it('fails closed on invalid calendar dates', async () => {
    const db = database({});
    expect(await recordReviewedPayrollPayments({ snapshots: [snapshot()], startInput: '2026-02-30', endInput: '2026-03-05', actorProfileId: 'actor', supabase: db.client, now: NOW }))
      .toMatchObject({ error: 'payroll_payment_invalid' });
    expect(db.reads).toEqual([]);
  });
});

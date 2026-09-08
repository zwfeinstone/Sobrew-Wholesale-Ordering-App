import { describe, expect, it } from 'vitest';
import { loadAccountingPnlInputs } from '@/lib/accounting-data';
import { buildAccountingPnlStatement } from '@/lib/accounting-pnl-statement';
import { supabaseReadStub } from './support/supabase-read-stub';

type AccountingClient = Parameters<typeof loadAccountingPnlInputs>[0]['supabase'];
const range = { start: '2026-07-01', end: '2026-07-31', endExclusive: '2026-08-01' };
const category = { id: 'sales', name: 'Sales', category_type: 'revenue', pnl_section: 'revenue' };

describe('complete accounting inputs', () => {
  it('loads every statement source past the server cap and preserves the complete totals', async () => {
    const count = 1001;
    const stub = supabaseReadStub({
      tables: {
        accounting_categories: [category],
        accounting_transactions: Array.from({ length: count }, (_, index) => ({
          id: `transaction-${index}`, transaction_date: '2026-07-01', category_id: 'sales',
          accounting_categories: category, amount_cents: -100, status: 'categorized',
        })),
        production_runs: Array.from({ length: count }, () => ({ actual_labor_cost_cents: 20, quantity_produced: 1, quantity_voided: 0, status: 'completed' })),
        admin_time_entries: Array.from({ length: count }, (_, index) => ({
          id: `entry-${index}`, profile_id: 'employee', clock_in_at: '2026-07-01T12:00:00Z',
          clock_out_at: '2026-07-01T13:00:00Z', status: 'approved', work_type: 'production', hourly_rate_cents_snapshot: 100,
        })),
        admin_time_entry_allocations: Array.from({ length: count }, (_, index) => ({
          time_entry_id: `entry-${index}`, work_type: 'production', minutes: 60, wage_cents: 30,
        })),
        admin_salary_payroll_payments: Array.from({ length: count }, (_, index) => ({
          id: `salary-${index}`, paid_at: '2026-07-31T12:00:00Z', salary_labor_work_type: 'production', salary_pay_cents: 10,
          period_start_date: '2026-07-01', period_end_date: '2026-07-31',
        })),
      },
    });
    const client = stub.client as unknown as AccountingClient;
    const result = await loadAccountingPnlInputs({ ...range, supabase: client, payrollSupabase: client });

    expect(result.error).toBeNull();
    expect(result.data?.transactions).toHaveLength(count);
    expect(result.data?.productionRuns).toHaveLength(count);
    expect(result.data?.payrollAllocations).toHaveLength(count);
    const statement = buildAccountingPnlStatement(result.data!);
    expect(statement.basePnl.revenueCents).toBe(count * 100);
    expect(statement.payrollLaborSummary.productionLaborCogsCents).toBe(count * 40);
    expect(statement.productionRunLaborCogsCents).toBe(count * 20);
    expect(stub.reads.every((read) => read.orders.at(-1)?.column === 'id')).toBe(true);
    expect(stub.reads.find((read) => read.table === 'accounting_transactions')?.filters).toEqual([
      { operator: 'gte', column: 'transaction_date', value: '2026-07-01' },
      { operator: 'lt', column: 'transaction_date', value: '2026-08-01' },
    ]);
    expect(stub.reads.find((read) => read.table === 'admin_time_entry_allocations')?.filters).toEqual([
      { operator: 'gte', column: 'admin_time_entries.clock_in_at', value: '2026-07-01T00:00:00.000Z' },
      { operator: 'lt', column: 'admin_time_entries.clock_in_at', value: '2026-08-01T00:00:00.000Z' },
    ]);
    expect(stub.reads.find((read) => read.table === 'admin_salary_payroll_payments')?.filters).toEqual([
      { operator: 'not.is', column: 'paid_at', value: null },
      { operator: 'lte', column: 'period_start_date', value: '2026-07-31' },
      { operator: 'gte', column: 'period_end_date', value: '2026-07-01' },
    ]);
  });

  it.each(['accounting_transactions', 'production_runs', 'admin_time_entries', 'admin_time_entry_allocations', 'admin_salary_payroll_payments'])('rejects the entire statement when %s fails on a later page', async (table) => {
    const stub = supabaseReadStub({
      tables: { [table]: [{ id: 'first' }, { id: 'second' }] },
      maxRows: 1,
      fail: (read) => read.table === table && read.from > 0 ? 'Page failed' : undefined,
    });
    const client = stub.client as unknown as AccountingClient;
    const result = await loadAccountingPnlInputs({ ...range, supabase: client, payrollSupabase: client });
    expect(result).toEqual({ data: null, error: { message: 'Page failed' } });
  });

  it('loads revenue/category inputs without requesting payroll for the category view', async () => {
    const stub = supabaseReadStub();
    const result = await loadAccountingPnlInputs({ ...range, supabase: stub.client as unknown as AccountingClient });
    expect(result.error).toBeNull();
    expect(stub.reads.map((read) => read.table)).toEqual(['accounting_categories', 'accounting_transactions']);
  });
});

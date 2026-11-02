import { describe, expect, it } from 'vitest';
import { loadDeferredPayAccounting } from './deferred-pay-accounting-data';
import { loadAccountingPnlInputs } from './accounting-data';
import { supabaseReadStub } from '../tests/support/supabase-read-stub';

type Client = Parameters<typeof loadDeferredPayAccounting>[0]['supabase'];
const plan = { id: 'plan', profile_id: 'haskins', label: 'Deferred pay', start_date: '2026-10-07', end_date: '2027-01-03', payout_date: '2027-01-04', accrual_rate_cents: 500, weekly_rate_cents: 1500, paid_at: '2027-01-04T06:00:00Z', paid_amount_cents: 8000, accounting_transaction_id: 'bank' };
const entry = { id: 'shift', profile_id: 'haskins', clock_in_at: '2026-10-07T13:00:00Z', clock_out_at: '2026-10-07T21:00:00Z', hourly_rate_cents_snapshot: 1500, status: 'locked', work_type: 'sales' };
const now = new Date('2027-02-01T18:00:00Z');
const tables = {
  admin_deferred_pay_plans: [plan],
  profiles: [{ id: 'haskins', full_name: 'Haskins', email: 'haskins@example.com' }],
  admin_time_entries: [entry, { ...entry, id: 'shift2' }],
  admin_time_breaks: [{ id: 'break', time_entry_id: 'shift', break_start_at: '2026-10-07T15:00:00Z', break_end_at: '2026-10-07T16:00:00Z', status: 'closed' }],
  admin_time_entry_allocations: [{ id: 'allocation', time_entry_id: 'shift2', minutes: 240, work_type: 'production' }],
};

describe('deferred financial source completeness', () => {
  it('loads full plan history and bank links for a post-accrual payment period, across row caps', async () => {
    const stub = supabaseReadStub({ maxRows: 1, tables });
    const result = await loadDeferredPayAccounting({ supabase: stub.client as unknown as Client, start: '2027-01-04', end: '2027-01-31', now });
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ openingLiabilityCents: 7500, accruedCents: 0, paidCents: 8000, closingLiabilityCents: -500, settlementTransactionIds: ['bank'] });
    expect(result.data?.plans[0]).toMatchObject({ employeeName: 'Haskins', summary: { eligibleHours: 15, accruedCents: 7500 } });
    expect(stub.reads.filter((row) => row.table === 'admin_time_entries').map((row) => row.from)).toEqual([0, 1, 2]);
    const read = stub.reads.find((row) => row.table === 'admin_time_entries')!;
    expect(read.filters).toContainEqual({ operator: 'gt', column: 'clock_out_at', value: '2026-10-07T05:00:00.000Z' });
    expect(read.filters).toContainEqual({ operator: 'lt', column: 'clock_in_at', value: '2027-01-04T06:00:00.000Z' });
    expect(stub.reads.every((row) => row.orders.at(-1)?.column === 'id')).toBe(true);
  });

  it('honors the selected employee throughout plan/shift/break/allocation reads', async () => {
    const stub = supabaseReadStub({ tables: {
      ...tables,
      admin_deferred_pay_plans: [plan, { ...plan, id: 'other', profile_id: 'other' }],
      admin_time_entries: [entry, { ...entry, id: 'other-shift', profile_id: 'other' }],
    } });
    const result = await loadDeferredPayAccounting({ supabase: stub.client as unknown as Client, start: '2026-10-01', end: '2026-10-31', now, profileId: 'haskins' });
    expect(result.data?.plans).toHaveLength(1);
    expect(result.data?.eligibleHours).toBe(7);
    expect(stub.reads.find((row) => row.table === 'admin_deferred_pay_plans')?.filters).toContainEqual({ operator: 'eq', column: 'profile_id', value: 'haskins' });
    expect(stub.reads.find((row) => row.table === 'admin_time_entries')?.filters).toContainEqual({ operator: 'in', column: 'profile_id', value: ['haskins'] });
    for (const table of ['admin_time_breaks', 'admin_time_entry_allocations']) {
      expect(stub.reads.find((row) => row.table === table)?.filters).toContainEqual({ operator: 'in', column: 'time_entry_id', value: ['shift'] });
    }
  });

  it.each(Object.keys(tables))('fails closed if a later %s page cannot load', async (table) => {
    const stub = supabaseReadStub({ tables, maxRows: 1, fail: (read) => read.table === table && read.from > 0 ? 'Unavailable page' : undefined });
    expect(await loadDeferredPayAccounting({ supabase: stub.client as unknown as Client, start: '2026-10-01', end: '2026-10-31', now })).toEqual({ data: null, error: { message: 'Unavailable page' } });
  });

  it('does not produce a financial statement when the deferred source fails', async () => {
    const stub = supabaseReadStub({ fail: (read) => read.table === 'admin_deferred_pay_plans' ? 'Deferred ledger unavailable' : undefined });
    const client = stub.client as unknown as Client;
    expect(await loadAccountingPnlInputs({ supabase: client, payrollSupabase: client, start: '2026-10-01', end: '2026-10-31', endExclusive: '2026-11-01' })).toEqual({ data: null, error: { message: 'Deferred ledger unavailable' } });
  });

  it('rejects invalid periods before querying financial data', async () => {
    const stub = supabaseReadStub();
    const result = await loadDeferredPayAccounting({ supabase: stub.client as unknown as Client, start: '2026-02-30', end: '2026-10-31', now });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('dates');
    expect(stub.reads).toEqual([]);
  });
});

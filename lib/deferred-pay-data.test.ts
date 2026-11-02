import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadDeferredPayForProfile } from './deferred-pay-data';
import type { Database } from './supabase/schema';
import { supabaseReadStub } from '../tests/support/supabase-read-stub';

const plan = {
  id: 'plan', profile_id: 'employee', label: 'January 4 deferred pay',
  start_date: '2026-10-07', end_date: '2027-01-03', payout_date: '2027-01-04',
  accrual_rate_cents: 500, weekly_rate_cents: 1500, paid_at: null, paid_amount_cents: null,
};
const now = new Date('2027-01-04T18:00:00Z');
const entry = {
  id: 'shift', profile_id: 'employee', clock_in_at: '2026-10-07T13:00:00Z',
  clock_out_at: '2026-10-07T21:00:00Z', hourly_rate_cents_snapshot: 1500, status: 'locked', work_type: 'sales',
};
const asClient = (client: ReturnType<typeof supabaseReadStub>['client']) => client as unknown as SupabaseClient<Database>;

describe('deferred pay data', () => {
  it('loads the full October–January plan in January and scopes all shift reads to the authenticated employee', async () => {
    const { client, reads } = supabaseReadStub({ maxRows: 1, tables: {
      admin_deferred_pay_plans: [plan, { ...plan, id: 'other-plan', profile_id: 'another-employee' }],
      admin_time_entries: [entry, { ...entry, id: 'jan-shift', clock_in_at: '2027-01-03T14:00:00Z', clock_out_at: '2027-01-03T22:00:00Z' }, { ...entry, id: 'someone-else', profile_id: 'another-employee' }],
      admin_time_breaks: [
        { id: 'break1', time_entry_id: 'shift', break_start_at: '2026-10-07T17:00:00Z', break_end_at: '2026-10-07T17:30:00Z', status: 'closed' },
        { id: 'break2', time_entry_id: 'jan-shift', break_start_at: '2027-01-03T18:00:00Z', break_end_at: '2027-01-03T18:15:00Z', status: 'closed' },
      ],
    } });
    const result = await loadDeferredPayForProfile(asClient(client), 'employee', now);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].summary).toMatchObject({ eligibleHours: 15.25, accruedCents: 7625, status: 'awaiting_payment' });
    const parentReads = reads.filter((read) => read.table !== 'admin_time_breaks');
    expect(parentReads.length).toBeGreaterThan(3);
    for (const read of parentReads) expect(read.filters).toContainEqual({ operator: 'eq', column: 'profile_id', value: 'employee' });
    const timeRead = reads.find((read) => read.table === 'admin_time_entries')!;
    expect(timeRead.filters).toContainEqual({ operator: 'gt', column: 'clock_out_at', value: '2026-10-07T05:00:00.000Z' });
    expect(timeRead.filters).toContainEqual({ operator: 'lt', column: 'clock_in_at', value: '2027-01-04T06:00:00.000Z' });
    for (const read of reads.filter((row) => row.table === 'admin_time_breaks')) {
      expect(read.filters).toContainEqual({ operator: 'in', column: 'time_entry_id', value: ['shift', 'jan-shift'] });
    }
    expect(reads.filter((read) => read.table === 'admin_time_breaks').map((read) => read.from)).toEqual([0, 1, 2]);
  });

  it('does not load shifts for employees without a plan', async () => {
    const { client, reads } = supabaseReadStub();
    expect(await loadDeferredPayForProfile(asClient(client), 'other', now)).toEqual({ data: [], error: null });
    expect(reads.map((read) => read.table)).toEqual(['admin_deferred_pay_plans']);
  });

  it('shows a future plan with zero accrual without querying shifts', async () => {
    const { client, reads } = supabaseReadStub({ tables: { admin_deferred_pay_plans: [plan] } });
    const result = await loadDeferredPayForProfile(asClient(client), 'employee', new Date('2026-10-06T19:00:00Z'));
    expect(result.data?.[0].summary).toMatchObject({ status: 'scheduled', accruedCents: 0 });
    expect(reads.every((read) => read.table === 'admin_deferred_pay_plans')).toBe(true);
  });

  it.each(['admin_deferred_pay_plans', 'admin_time_entries', 'admin_time_breaks'])(
    'returns unavailable rather than a partial or zero balance when %s fails', async (failedTable) => {
      const { client } = supabaseReadStub({ tables: { admin_deferred_pay_plans: [plan], admin_time_entries: [entry] },
        fail: (read) => read.table === failedTable ? 'Data unavailable' : undefined,
      });
      expect(await loadDeferredPayForProfile(asClient(client), 'employee', now)).toEqual({ data: null, error: { message: 'Data unavailable' } });
    },
  );

  it('discards all results when a later shift page fails', async () => {
    const { client } = supabaseReadStub({ maxRows: 1, tables: { admin_deferred_pay_plans: [plan], admin_time_entries: [entry, { ...entry, id: 'second' }] },
      fail: (read) => read.table === 'admin_time_entries' && read.from > 0 ? 'Next page unavailable' : undefined,
    });
    expect(await loadDeferredPayForProfile(asClient(client), 'employee', now)).toEqual({ data: null, error: { message: 'Next page unavailable' } });
  });
});

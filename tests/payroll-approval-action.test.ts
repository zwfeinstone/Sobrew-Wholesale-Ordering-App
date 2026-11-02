import { isValidElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({
  client: null as unknown as { from: (table: string) => any },
  authorize: vi.fn(), audit: vi.fn(), revalidate: vi.fn(),
}));
vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ access: {}, profile: { id: 'reviewer' } }),
  requireAdminSectionEdit: state.authorize,
  adminCanEdit: () => true,
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from: (table: string) => state.client.from(table) } }));
vi.mock('@/lib/admin-audit', () => ({ recordAdminAuditLog: state.audit }));
vi.mock('@/lib/payroll-commissions', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  loadPayrollCommissions: async () => ({ rows: [], error: null }),
}));
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/components/status-toast', () => ({ default: () => null }));

import PayrollPage from '@/app/admin/payroll/page';
import PayrollRun from '@/components/payroll-run';

type Action = (formData: FormData) => Promise<void>;
type Entry = {
  id: string; profile_id: string; status: string | null;
  clock_in_at: string; clock_out_at: string | null; updated_at: string;
  work_type: string; approved_by?: string; locked_at?: string;
};
const NOW = new Date('2026-10-18T16:00:00.000Z');
const employee = { id: 'employee-a', full_name: 'Alex Baker', email: 'alex@example.test', is_active: true };
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'shift-a', profile_id: employee.id, status: 'submitted', work_type: 'production',
  clock_in_at: '2026-10-12T14:00:00.000Z', clock_out_at: '2026-10-12T16:00:00.000Z',
  updated_at: '2026-10-12T16:00:00.000Z', ...overrides,
});

function findNode(node: ReactNode, predicate: (value: any) => boolean): any {
  if (Array.isArray(node)) return node.map((child) => findNode(child, predicate)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return;
  if (predicate(node)) return node;
  return findNode(node.props.children, predicate);
}

async function actions() {
  state.client = supabaseReadStub({ tables: {
    profiles: [employee],
    admin_time_entries: [{ ...entry(), admin_profile: employee, hourly_rate_cents_snapshot: 2000, admin_time_breaks: [] }],
  } }).client;
  const page = await PayrollPage({ searchParams: Promise.resolve({ from: '2026-10-12', to: '2026-10-16' }) });
  const run = findNode(page, (node) => node.type === PayrollRun);
  expect(run).toBeDefined();
  const approvalForm = findNode(run.props.rows[0].shifts, (node) => node.type === 'form');
  expect(approvalForm?.props.action).toBeTypeOf('function');
  return { single: approvalForm.props.action as Action, bulk: run.props.approveAction as Action };
}

/** Apply predicates at write time so a read/write race cannot pass unnoticed. */
function database(entries: Entry[], beforeWrite?: (rows: Entry[]) => void) {
  const reads: string[] = [];
  const writes: Array<{ payload: Record<string, unknown>; affectedIds: string[] }> = [];
  const client = {
    from(table: string) {
      if (table !== 'admin_time_entries') throw new Error(`Unexpected table: ${table}`);
      const filters: Array<(row: Entry) => boolean> = [];
      let payload: Record<string, unknown> | undefined;
      let single = false;
      const query = {
        select: () => query,
        eq: (key: keyof Entry, value: unknown) => { filters.push((row) => row[key] === value); return query; },
        in: (key: keyof Entry, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
        gte: (key: keyof Entry, value: string) => { filters.push((row) => String(row[key]) >= value); return query; },
        lte: (key: keyof Entry, value: string) => { filters.push((row) => String(row[key]) <= value); return query; },
        not: (key: keyof Entry, operator: string, value: unknown) => {
          if (operator !== 'is') throw new Error(`Unexpected not operator: ${operator}`);
          filters.push((row) => row[key] !== value); return query;
        },
        or: (condition: string) => {
          // Model the SQL null semantics of the approval action's status predicate.
          if (condition !== 'status.is.null,status.not.in.(approved,locked,void)') throw new Error(`Unexpected OR: ${condition}`);
          filters.push((row) => row.status === null || !['approved', 'locked', 'void'].includes(row.status));
          return query;
        },
        limit: () => query,
        maybeSingle: () => { single = true; return query; },
        update: (value: Record<string, unknown>) => { payload = value; return query; },
        then(resolve: (result: { data: Entry[] | Entry | null; error: null }) => unknown) {
          if (payload) beforeWrite?.(entries);
          const matched = entries.filter((row) => filters.every((filter) => filter(row)));
          if (payload) {
            writes.push({ payload, affectedIds: matched.map((row) => row.id) });
            matched.forEach((row) => Object.assign(row, payload));
          } else reads.push(table);
          const result = structuredClone(matched);
          return Promise.resolve({ data: single ? result[0] ?? null : result, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  state.client = client;
  return { entries, reads, writes };
}

function form(profileId = employee.id) {
  const data = new FormData();
  data.set('entry_id', 'shift-a');
  data.set('profile_id', profileId);
  data.set('lock_start', '2026-10-12');
  data.set('lock_end', '2026-10-16');
  data.set('return_to', '/admin/payroll?tab=review&admin=employee-a');
  data.set('actor_profile_id', 'forged-actor');
  return data;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  state.authorize.mockResolvedValue({ profile: { id: 'reviewer' } });
  state.audit.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); });

describe('single payroll shift approval', () => {
  it('approves only the requested completed shift and audits the authenticated actor', async () => {
    const { single } = await actions();
    const db = database([entry(), entry({ id: 'other-shift', profile_id: 'employee-b' })]);
    await expect(single(form())).rejects.toThrow('success=entry_approved');
    expect(db.entries.map((row) => row.status)).toEqual(['approved', 'submitted']);
    expect(db.writes).toEqual([{ affectedIds: ['shift-a'], payload: expect.objectContaining({ status: 'approved', approved_by: 'reviewer', updated_by: 'reviewer' }) }]);
    expect(state.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      actorProfileId: 'reviewer', targetProfileId: employee.id, action: 'time_clock_entry_approved',
      before: expect.objectContaining({ status: 'submitted' }), after: { status: 'approved' },
    }));
    expect(state.revalidate).toHaveBeenCalledWith('/admin', 'layout');
  });

  it.each([
    entry({ status: 'locked', locked_at: '2026-10-17T18:00:00.000Z' }),
    entry({ status: 'void' }),
    entry({ status: 'open', clock_out_at: null }),
  ])('does not approve a paid, voided, or incomplete shift: $status', async (row) => {
    const { single } = await actions();
    const db = database([row]);
    const before = structuredClone(row);
    await expect(single(form())).rejects.toThrow('error=invalid_time');
    expect(db.entries[0]).toEqual(before);
    expect(db.writes).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('preserves a payment recorded after the approval form read', async () => {
    const { single } = await actions();
    const db = database([entry()], (rows) => {
      rows[0].status = 'locked';
      rows[0].locked_at = NOW.toISOString();
      // The live status must protect the payment even if timestamps coincide.
    });
    await expect(single(form())).rejects.toThrow('error=payroll_payment_changed');
    expect(db.entries[0]).toMatchObject({ status: 'locked', locked_at: NOW.toISOString() });
    expect(db.writes[0].affectedIds).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it('preserves a concurrent time correction even when its status remains submitted', async () => {
    const { single } = await actions();
    const db = database([entry()], (rows) => {
      rows[0].clock_out_at = '2026-10-12T17:00:00.000Z';
      rows[0].updated_at = NOW.toISOString();
    });
    await expect(single(form())).rejects.toThrow('error=payroll_payment_changed');
    expect(db.entries[0]).toMatchObject({ status: 'submitted', clock_out_at: '2026-10-12T17:00:00.000Z' });
    expect(db.writes[0].affectedIds).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.revalidate).toHaveBeenCalledWith('/admin', 'layout');
  });
});

describe('bulk payroll shift approval', () => {
  it('honors employee/date scope, includes all labor tags, and preserves paid, approved, void, and open shifts', async () => {
    const { bulk } = await actions();
    const db = database([
      entry(), entry({ id: 'sales', work_type: 'sales', status: null }),
      entry({ id: 'paid', status: 'locked' }), entry({ id: 'approved', status: 'approved' }),
      entry({ id: 'void', status: 'void' }), entry({ id: 'open', clock_out_at: null, status: 'open' }),
      entry({ id: 'other-employee', profile_id: 'employee-b' }),
      entry({ id: 'before-period', clock_in_at: '2026-10-12T04:59:59.000Z' }),
      entry({ id: 'after-period', clock_in_at: '2026-10-17T05:00:00.000Z' }),
    ]);
    const request = form();
    request.set('work_type', 'production');
    await expect(bulk(request)).rejects.toThrow('success=entries_approved');
    expect(db.writes[0].affectedIds).toEqual(['shift-a', 'sales']);
    expect(db.entries.map((row) => row.status)).toEqual(['approved', 'approved', 'locked', 'approved', 'void', 'open', 'submitted', 'submitted', 'submitted']);
    expect(state.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: 'time_clock_entries_bulk_approved', actorProfileId: 'reviewer', targetProfileId: employee.id,
      after: expect.objectContaining({ count: 2, profile_id: employee.id, lock_start_at: '2026-10-12T05:00:00.000Z', lock_end_at: '2026-10-17T04:59:59.000Z' }),
    }));
  });

  it('approves all employees when no employee filter is supplied', async () => {
    const { bulk } = await actions();
    const db = database([entry(), entry({ id: 'shift-b', profile_id: 'employee-b' })]);
    await expect(bulk(form(''))).rejects.toThrow('success=entries_approved');
    expect(db.writes[0].affectedIds).toEqual(['shift-a', 'shift-b']);
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ targetProfileId: null, after: expect.objectContaining({ count: 2, profile_id: null }) }));
  });

  it('does not undo concurrent payments or voids and audits only shifts actually approved', async () => {
    const { bulk } = await actions();
    const db = database([entry(), entry({ id: 'void-race' }), entry({ id: 'reopened' }), entry({ id: 'safe-shift' })], (rows) => {
      rows[0].status = 'locked';
      rows[0].locked_at = NOW.toISOString();
      rows[1].status = 'void';
      rows[2].clock_out_at = null;
    });
    await expect(bulk(form())).rejects.toThrow('success=entries_approved');
    expect(db.entries.map((row) => row.status)).toEqual(['locked', 'void', 'submitted', 'approved']);
    expect(db.writes[0].affectedIds).toEqual(['safe-shift']);
    expect(state.audit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ after: expect.objectContaining({ count: 1 }) }));
  });

  it('does not invent an approval audit when every selected shift is already paid or void', async () => {
    const { bulk } = await actions();
    const db = database([entry({ status: 'locked' }), entry({ id: 'void', status: 'void' })]);
    await expect(bulk(form())).rejects.toThrow('success=entries_approved');
    expect(db.writes).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
  });
});

describe('payroll approval permissions', () => {
  it.each(['single', 'bulk'] as const)('authorizes %s approval before any read or mutation', async (kind) => {
    const action = (await actions())[kind];
    const db = database([entry()]);
    state.authorize.mockRejectedValueOnce(new Error('Payroll edit denied'));
    await expect(action(form())).rejects.toThrow('Payroll edit denied');
    expect(state.authorize).toHaveBeenCalledWith('payroll', expect.stringContaining('error=write_denied'));
    expect(db.reads).toEqual([]);
    expect(db.writes).toEqual([]);
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.revalidate).not.toHaveBeenCalled();
  });
});

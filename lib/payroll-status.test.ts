import { describe, expect, it, vi } from 'vitest';
import { getWeeklyPayrollStatus } from './payroll-status';

const NOW = new Date('2026-10-19T18:00:00Z');
type Entry = { id: string; status: string; clock_out_at: string | null };
const paid = (id = 'paid'): Entry => ({ id, status: 'locked', clock_out_at: '2026-10-12T18:00:00Z' });

function client({ entries = [], locked = false, failEntries = false, pageSize = 1000 }: {
  entries?: Entry[]; locked?: boolean; failEntries?: boolean; pageSize?: number;
} = {}) {
  return {
    from(table: string) {
      let offset = 0;
      const query = {
        select: () => query, gte: () => query, lte: () => query, order: () => query, limit: () => query,
        range: (start: number) => { offset = start; return query; },
        then(resolve: (result: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
          if (table === 'admin_time_entries') return Promise.resolve({
            data: failEntries ? null : entries.slice(offset, offset + pageSize), error: failEntries ? { message: 'Read failed' } : null,
          }).then(resolve);
          return Promise.resolve({ data: locked ? [{ id: 'range-lock' }] : [], error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

describe('weekly payroll completion badges', () => {
  it('finishes when all employee payments are recorded without a separate range lock', async () => {
    const status = await getWeeklyPayrollStatus({ now: NOW, supabase: client({ entries: [paid(), { ...paid('voided'), status: 'void' }] }) });
    expect(status).toMatchObject({ isComplete: true, hasCoveringLock: false, badgeCount: 0, needsApproval: false, isDue: false });
  });

  it('keeps payroll due while an approved employee remains unpaid', async () => {
    const status = await getWeeklyPayrollStatus({ now: NOW, supabase: client({ entries: [paid(), { ...paid('unpaid'), status: 'approved' }] }) });
    expect(status).toMatchObject({ isComplete: false, needsApproval: true, badgeCount: 1 });
  });

  it('retains completion for paid and explicitly completed empty weeks', async () => {
    for (const entries of [[], [paid()]]) {
      const status = await getWeeklyPayrollStatus({ now: NOW, supabase: client({ entries, locked: true }) });
      expect(status).toMatchObject({ isComplete: true, hasCoveringLock: true, badgeCount: 0 });
    }
  });

  it('does not let a covering lock hide newly added approved but unpaid shifts', async () => {
    const status = await getWeeklyPayrollStatus({ now: NOW, supabase: client({ locked: true,
      entries: [paid(), { ...paid('new-shift'), status: 'approved' }],
    }) });
    expect(status).toMatchObject({ hasCoveringLock: true, isComplete: false, needsApproval: true, badgeCount: 1 });
  });

  it('does not assume an empty or void-only week has been completed', async () => {
    for (const entries of [[], [{ ...paid(), status: 'void' }]]) {
      const status = await getWeeklyPayrollStatus({ now: NOW, supabase: client({ entries }) });
      expect(status.isComplete).toBe(false);
    }
  });

  it('checks entries beyond a server page cap before declaring payroll complete', async () => {
    const status = await getWeeklyPayrollStatus({ now: NOW, supabase: client({
      entries: [paid('first'), paid('second'), { ...paid('third'), status: 'submitted' }], pageSize: 1,
    }) });
    expect(status).toMatchObject({ isComplete: false, unapprovedEntryCount: 1, needsApproval: true });
  });

  it('does not hide a failed entry read behind an existing range lock', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const status = await getWeeklyPayrollStatus({ now: NOW, supabase: client({ locked: true, failEntries: true }) });
      expect(status.isComplete).toBe(false);
    } finally { log.mockRestore(); }
  });
});

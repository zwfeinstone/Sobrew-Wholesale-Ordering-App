import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { supabaseReadStub } from './support/supabase-read-stub';

const state = vi.hoisted(() => ({ client: null as unknown as ReturnType<typeof supabaseReadStub>['client'] }));
vi.mock('@/lib/admin-permissions', () => ({ requireAdminSectionEdit: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => state.client.from(table) },
}));

import { GET } from '@/app/api/export/time-entries/route';

function entry(id: string, date: string, hours: number, overrides: Record<string, unknown> = {}) {
  const clockIn = new Date(`${date}T12:00:00Z`);
  return {
    id,
    profile_id: 'employee-a',
    admin_profile: { full_name: 'Employee A', email: null },
    clock_in_at: clockIn.toISOString(),
    clock_out_at: new Date(clockIn.getTime() + hours * 3600000).toISOString(),
    hourly_rate_cents_snapshot: 2000,
    status: 'approved',
    work_type: 'production',
    admin_time_breaks: [],
    ...overrides,
  };
}

// These fixtures have no embedded newlines; parse quoted cells including escaped quotes.
function csvRows(csv: string) {
  const rows = csv.split('\n').map((line) => Array.from(line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g), (match) => match[1].replaceAll('""', '"')));
  const headers = rows.shift()!;
  return { headers, rows: rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]]))) };
}

describe('payroll export overtime', () => {
  it('uses all paginated weekly work before narrowing dates and work types', async () => {
    const stub = supabaseReadStub({
      maxRows: 1,
      tables: {
        admin_time_entries: [
          ...['06', '07', '08', '09'].map((day) => entry(`earlier-${day}`, `2026-07-${day}`, 10)),
          entry('friday-sales', '2026-07-10', 8, {
            work_type: 'sales',
            admin_time_breaks: [{ break_start_at: '2026-07-10T16:00:00Z', break_end_at: '2026-07-10T17:00:00Z', status: 'completed' }],
          }),
        ],
      },
    });
    state.client = stub.client;

    const response = await GET(new NextRequest('https://example.com/api/export/time-entries?from=2026-07-09&to=2026-07-10&work_type=sales&admin=employee-a'));
    expect(response.status).toBe(200);
    const { headers, rows } = csvRows(await response.text());
    expect(headers.slice(-3)).toEqual(['regular_hours', 'overtime_hours', 'overtime_premium']);
    expect(headers[9]).toBe('estimated_wages');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      row_type: 'time_entry',
      paid_hours: '7.00',
      regular_hours: '0.00',
      overtime_hours: '7.00',
      overtime_premium: '$70.00',
      estimated_wages: '$210.00',
    });
    const entryReads = stub.reads.filter((read) => read.table === 'admin_time_entries');
    expect(entryReads).toHaveLength(6);
    expect(entryReads[0].filters).toEqual([
      { operator: 'or', column: '', value: 'clock_out_at.gt.2026-07-06T05:00:00.000Z,clock_in_at.gte.2026-07-06T05:00:00.000Z' },
      { operator: 'lt', column: 'clock_in_at', value: '2026-07-13T05:00:00.000Z' },
      { operator: 'eq', column: 'profile_id', value: 'employee-a' },
    ]);
  });

  it('keeps employee totals separate and ignores void and open shifts', async () => {
    state.client = supabaseReadStub({ tables: {
      admin_time_entries: [
        ...['06', '07', '08', '09'].map((day) => entry(`a-${day}`, `2026-07-${day}`, 10)),
        entry('a-overtime', '2026-07-10', 5),
        entry('b-void', '2026-07-06', 24, { profile_id: 'employee-b', status: 'void' }),
        entry('b-open', '2026-07-07', 24, { profile_id: 'employee-b', status: 'open' }),
        entry('b-friday', '2026-07-10', 5, {
          profile_id: 'employee-b',
          admin_profile: { full_name: 'Employee B', email: null },
        }),
      ],
    } }).client;
    const response = await GET(new NextRequest('https://example.com/api/export/time-entries?from=2026-07-06&to=2026-07-10'));
    const { rows } = csvRows(await response.text());
    const employeeB = rows.find((row) => row.admin === 'Employee B');
    expect(employeeB).toMatchObject({ regular_hours: '5.00', overtime_hours: '0.00', estimated_wages: '$100.00' });
    const excludedRows = rows.filter((row) => ['void', 'open'].includes(row.status));
    expect(excludedRows).toHaveLength(2);
    for (const row of excludedRows) {
      expect(row).toMatchObject({ paid_hours: '0.00', overtime_hours: '0.00', estimated_wages: '$0.00' });
    }
    expect(rows.find((row) => row.overtime_hours === '5.00')).toMatchObject({ admin: 'Employee A', estimated_wages: '$150.00', overtime_premium: '$50.00' });
  });

  it('preserves salary and SPIFF amounts and original column positions', async () => {
    state.client = supabaseReadStub({ tables: {
      profiles: [{ id: 'employee-a', full_name: 'Employee A', email: null }],
      admin_time_settings: [{ profile_id: 'employee-a', active: true, compensation_type: 'salary', salary_amount_cents: 400000, salary_frequency: 'monthly', salary_labor_work_type: 'production' }],
      admin_salary_payroll_payments: [{ profile_id: 'employee-a', salary_pay_cents: 400000, salary_amount_cents: 400000, salary_frequency: 'monthly', salary_labor_work_type: 'production', payroll_month: '2026-07-01', paid_at: '2026-07-31T12:00:00Z' }],
      admin_weekly_sales_spiffs: [{ profile_id: 'employee-a', amount_cents: 7500, week_start_date: '2026-07-06', week_end_date: '2026-07-12', paid_at: '2026-07-31T12:00:00Z' }],
    } }).client;
    const response = await GET(new NextRequest('https://example.com/api/export/time-entries?from=2026-07-01&to=2026-07-31'));
    const { headers, rows } = csvRows(await response.text());
    expect(headers).toHaveLength(24);
    expect(headers[20]).toBe('paid_at');
    expect(rows.map((row) => [row.row_type, row.estimated_wages])).toEqual([
      ['salary_estimate', '$4,076.71'],
      ['salary_paid', '$4,000.00'],
      ['sales_spiff_paid', '$75.00'],
    ]);
    for (const row of rows) {
      expect(row).toMatchObject({ regular_hours: '', overtime_hours: '', overtime_premium: '' });
    }
  });
});

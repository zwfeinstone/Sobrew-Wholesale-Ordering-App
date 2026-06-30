import Link from 'next/link';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { getCurrentPayrollWeekWindow } from '@/lib/payroll-status';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  completedBreakMinutes,
  formatCentralDateInput,
  formatCentralDateTime,
  hoursLabel,
  paidMinutes,
  parseCentralDateInput,
  workTypeLabel,
} from '@/lib/time-clock';

type TimeBreak = {
  break_end_at: string | null;
  break_start_at: string;
  status: string | null;
};

type TimeEntry = {
  admin_time_breaks?: TimeBreak[];
  clock_in_at: string;
  clock_out_at: string | null;
  hourly_rate_cents_snapshot: number | string | null;
  id: string;
  status: string | null;
  work_type: string | null;
};

function entryBreaks(entry: TimeEntry) {
  return (entry.admin_time_breaks ?? []) as TimeBreak[];
}

function formatDateInputLabel(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
  });
}

function isWithin(entry: TimeEntry, start: Date, end: Date) {
  const clockIn = new Date(entry.clock_in_at);
  return clockIn >= start && clockIn <= end;
}

function completedPaidMinutes(entries: TimeEntry[], start: Date, end: Date) {
  return entries
    .filter((entry) => entry.status !== 'void' && entry.clock_out_at && isWithin(entry, start, end))
    .reduce((sum, entry) => sum + paidMinutes(entry, entryBreaks(entry)), 0);
}

function StatCard({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="stat-card">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{detail}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center">
      <p className="font-semibold text-slate-950">No completed hours this week.</p>
      <p className="mt-2 text-sm text-slate-500">Completed shifts will show here after you clock out.</p>
    </div>
  );
}

export default async function WeekHoursPage() {
  const current = await requireAdminSectionView('time_clock');
  const now = new Date();
  const todayInput = formatCentralDateInput(now);
  const week = getCurrentPayrollWeekWindow(now);
  const monthStartInput = `${todayInput.slice(0, 8)}01`;
  const yearStartInput = `${todayInput.slice(0, 4)}-01-01`;
  const monthStart = parseCentralDateInput(monthStartInput)!;
  const yearStart = parseCentralDateInput(yearStartInput)!;
  const todayEnd = parseCentralDateInput(todayInput, true)!;
  const queryStart = new Date(Math.min(yearStart.getTime(), week.weekStart.getTime()));
  const queryEnd = new Date(Math.max(todayEnd.getTime(), week.weekEnd.getTime()));

  const { data, error } = await supabaseAdmin
    .from('admin_time_entries')
    .select('id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,work_type,admin_time_breaks(break_start_at,break_end_at,status)')
    .eq('profile_id', current.profile.id)
    .gte('clock_in_at', queryStart.toISOString())
    .lte('clock_in_at', queryEnd.toISOString())
    .order('clock_in_at', { ascending: false })
    .limit(50000);

  if (error) {
    console.error('[admin-week-hours] page load failed', { error, profileId: current.profile.id });
    return (
      <div className="space-y-6">
        <section className="panel">
          <span className="eyebrow">Week Hours</span>
          <h1 className="page-title mt-4">Week Hours</h1>
          <p className="page-subtitle mt-3">Your hours could not be loaded.</p>
        </section>
        <section className="card text-sm text-red-700">Refresh the page after confirming the latest time clock data is available.</section>
      </div>
    );
  }

  const entries = ((data ?? []) as TimeEntry[]).filter((entry) => entry.status !== 'void');
  const weekEntries = entries.filter((entry) => isWithin(entry, week.weekStart, week.weekEnd));
  const completedWeekEntries = weekEntries.filter((entry) => entry.clock_out_at);
  const openWeekEntries = weekEntries.filter((entry) => !entry.clock_out_at);
  const weekMinutes = completedPaidMinutes(entries, week.weekStart, week.weekEnd);
  const monthMinutes = completedPaidMinutes(entries, monthStart, todayEnd);
  const yearMinutes = completedPaidMinutes(entries, yearStart, todayEnd);

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Week Hours</span>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="page-title">Your hours</h1>
            <p className="page-subtitle mt-3">
              {formatDateInputLabel(week.weekStartInput)} to {formatDateInputLabel(week.weekEndInput)}. Completed shifts count toward totals after you clock out.
            </p>
          </div>
          <Link className="btn-secondary w-full sm:w-auto" href="/admin/time-clock">Time Clock</Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="This Week" value={`${hoursLabel(weekMinutes)} hrs`} detail="Current Monday-Friday payroll week." />
        <StatCard label="This Month" value={`${hoursLabel(monthMinutes)} hrs`} detail={`Since ${formatDateInputLabel(monthStartInput)}.`} />
        <StatCard label="YTD" value={`${hoursLabel(yearMinutes)} hrs`} detail={`Since ${formatDateInputLabel(yearStartInput)}.`} />
      </section>

      {openWeekEntries.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
          {openWeekEntries.length} open shift{openWeekEntries.length === 1 ? '' : 's'} will count after clock out.
        </section>
      ) : null}

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">This week</h2>
          <p className="mt-1 text-sm text-slate-500">Read-only shift detail for the current payroll week.</p>
        </div>
        {!completedWeekEntries.length ? <EmptyState /> : null}
        {weekEntries.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[58rem] border-separate border-spacing-y-2 text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Labor tag</th>
                  <th className="px-4 py-2">Clock in</th>
                  <th className="px-4 py-2">Clock out</th>
                  <th className="px-4 py-2 text-right">Lunch / break</th>
                  <th className="px-4 py-2 text-right">Paid hours</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {weekEntries.map((entry) => {
                  const breaks = entryBreaks(entry);
                  const breakMinutes = completedBreakMinutes(breaks);
                  const entryPaidMinutes = paidMinutes(entry, breaks);
                  return (
                    <tr key={entry.id} className="bg-white/70">
                      <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{formatDateInputLabel(formatCentralDateInput(entry.clock_in_at))}</td>
                      <td className="px-4 py-3 text-slate-700">{workTypeLabel(entry.work_type)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(entry.clock_in_at)}</td>
                      <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(entry.clock_out_at)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{hoursLabel(breakMinutes)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-950">{hoursLabel(entryPaidMinutes)}</td>
                      <td className="rounded-r-xl px-4 py-3">
                        <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">{entry.status ?? 'submitted'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

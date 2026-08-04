import Link from 'next/link';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { getCurrentPayrollWeekWindow } from '@/lib/payroll-status';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  completedBreakMinutes,
  formatCentralDateInput,
  formatCentralDateTime,
  hoursLabel,
  normalizeMoneyCents,
  paidMinutes,
  parseCentralDateInput,
  workTypeLabel,
} from '@/lib/time-clock';
import { usd } from '@/lib/utils';

type SearchParams = Record<string, string | string[] | undefined>;

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

type WeeklySalesSpiff = {
  amount_cents: number | string | null;
  id: string;
  notes: string | null;
  paid_at: string | null;
  week_end_date: string;
  week_start_date: string;
};

function entryBreaks(entry: TimeEntry) {
  return (entry.admin_time_breaks ?? []) as TimeBreak[];
}

function stringParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

function dateInputParam(value: string | string[] | undefined, fallback: string) {
  const raw = stringParam(value);
  return parseCentralDateInput(raw) ? raw : fallback;
}

function normalizeDateRange(fromInput: string, toInput: string) {
  return fromInput <= toInput
    ? { fromInput, toInput }
    : { fromInput: toInput, toInput: fromInput };
}

function dateRangesOverlap(startInput: string, endInput: string, rangeStartInput: string, rangeEndInput: string) {
  return startInput <= rangeEndInput && endInput >= rangeStartInput;
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

function spiffTotalCents(spiffs: WeeklySalesSpiff[]) {
  return spiffs.reduce((sum, spiff) => sum + normalizeMoneyCents(spiff.amount_cents), 0);
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

function EmptyState({
  detail = 'Completed shifts will show here after you clock out.',
  title = 'No completed hours this week.',
}: {
  detail?: string;
  title?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white/50 px-4 py-8 text-center">
      <p className="font-semibold text-slate-950">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function SpiffTable({ spiffs }: { spiffs: WeeklySalesSpiff[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-separate border-spacing-y-2 text-left text-sm">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th className="px-4 py-2">Week</th>
            <th className="px-4 py-2 text-right">Amount</th>
            <th className="px-4 py-2">Paid</th>
            <th className="px-4 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {spiffs.map((spiff) => (
            <tr key={spiff.id} className="bg-white/70">
              <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">
                {formatDateInputLabel(spiff.week_start_date)} to {formatDateInputLabel(spiff.week_end_date)}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-slate-950">{usd(normalizeMoneyCents(spiff.amount_cents))}</td>
              <td className="px-4 py-3 text-slate-700">{formatCentralDateTime(spiff.paid_at, 'Not paid')}</td>
              <td className="rounded-r-xl px-4 py-3 text-slate-600">{spiff.notes || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function WeekHoursPage({ searchParams }: { searchParams?: SearchParams }) {
  const current = await requireAdminSectionView('week_hours');
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
  const defaultSpiffFromInput = monthStartInput;
  const defaultSpiffToInput = todayInput;
  const { fromInput: spiffFromInput, toInput: spiffToInput } = normalizeDateRange(
    dateInputParam(searchParams?.spiff_from, defaultSpiffFromInput),
    dateInputParam(searchParams?.spiff_to, defaultSpiffToInput)
  );
  const spiffQueryStartInput = week.weekStartInput <= spiffFromInput ? week.weekStartInput : spiffFromInput;
  const spiffQueryEndInput = week.weekEndInput >= spiffToInput ? week.weekEndInput : spiffToInput;

  const [timeEntriesResult, weeklySalesSpiffsResult] = await Promise.all([
    supabaseAdmin
      .from('admin_time_entries')
      .select('id,clock_in_at,clock_out_at,hourly_rate_cents_snapshot,status,work_type,admin_time_breaks(break_start_at,break_end_at,status)')
      .eq('profile_id', current.profile.id)
      .gte('clock_in_at', queryStart.toISOString())
      .lte('clock_in_at', queryEnd.toISOString())
      .order('clock_in_at', { ascending: false })
      .limit(50000),
    supabaseAdmin
      .from('admin_weekly_sales_spiffs')
      .select('id,week_start_date,week_end_date,amount_cents,paid_at,notes')
      .eq('profile_id', current.profile.id)
      .lte('week_start_date', spiffQueryEndInput)
      .gte('week_end_date', spiffQueryStartInput)
      .order('week_start_date', { ascending: false })
      .order('paid_at', { ascending: false })
      .limit(500),
  ]);

  if (timeEntriesResult.error) {
    console.error('[admin-week-hours] page load failed', { error: timeEntriesResult.error, profileId: current.profile.id });
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
  if (weeklySalesSpiffsResult.error) {
    console.error('[admin-week-hours] weekly sales SPIFF records failed', { error: weeklySalesSpiffsResult.error, profileId: current.profile.id });
  }

  const entries = ((timeEntriesResult.data ?? []) as TimeEntry[]).filter((entry) => entry.status !== 'void');
  const weeklySalesSpiffs = weeklySalesSpiffsResult.error ? [] : (weeklySalesSpiffsResult.data ?? []) as WeeklySalesSpiff[];
  const currentWeekSpiffs = weeklySalesSpiffs.filter((spiff) => dateRangesOverlap(spiff.week_start_date, spiff.week_end_date, week.weekStartInput, week.weekEndInput));
  const historicalSpiffs = weeklySalesSpiffs.filter((spiff) => dateRangesOverlap(spiff.week_start_date, spiff.week_end_date, spiffFromInput, spiffToInput));
  const weekEntries = entries.filter((entry) => isWithin(entry, week.weekStart, week.weekEnd));
  const completedWeekEntries = weekEntries.filter((entry) => entry.clock_out_at);
  const openWeekEntries = weekEntries.filter((entry) => !entry.clock_out_at);
  const weekMinutes = completedPaidMinutes(entries, week.weekStart, week.weekEnd);
  const monthMinutes = completedPaidMinutes(entries, monthStart, todayEnd);
  const yearMinutes = completedPaidMinutes(entries, yearStart, todayEnd);
  const currentWeekSpiffCents = spiffTotalCents(currentWeekSpiffs);
  const historicalSpiffCents = spiffTotalCents(historicalSpiffs);

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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="This Week" value={`${hoursLabel(weekMinutes)} hrs`} detail="Current Monday-Friday payroll week." />
        <StatCard label="This Month" value={`${hoursLabel(monthMinutes)} hrs`} detail={`Since ${formatDateInputLabel(monthStartInput)}.`} />
        <StatCard label="YTD" value={`${hoursLabel(yearMinutes)} hrs`} detail={`Since ${formatDateInputLabel(yearStartInput)}.`} />
        <StatCard
          label="This Week SPIFFs"
          value={usd(currentWeekSpiffCents)}
          detail={`${currentWeekSpiffs.length} SPIFF record${currentWeekSpiffs.length === 1 ? '' : 's'} this week.`}
        />
      </section>

      {weeklySalesSpiffsResult.error ? (
        <section className="card text-sm text-red-700">Weekly sales SPIFF records could not be loaded. Refresh after confirming the weekly sales SPIFF migration is current.</section>
      ) : null}

      {openWeekEntries.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-900">
          {openWeekEntries.length} open shift{openWeekEntries.length === 1 ? '' : 's'} will count after clock out.
        </section>
      ) : null}

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">This week SPIFFs</h2>
          <p className="mt-1 text-sm text-slate-500">{usd(currentWeekSpiffCents)} recorded for {formatDateInputLabel(week.weekStartInput)} to {formatDateInputLabel(week.weekEndInput)}.</p>
        </div>
        {!currentWeekSpiffs.length ? (
          <EmptyState title="No SPIFFs recorded this week." detail="Weekly SPIFF records will show here after payroll records them." />
        ) : (
          <SpiffTable spiffs={currentWeekSpiffs} />
        )}
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">This week shifts</h2>
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

      <section className="card space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">SPIFF history</h2>
            <p className="mt-1 text-sm text-slate-500">{usd(historicalSpiffCents)} recorded from {formatDateInputLabel(spiffFromInput)} to {formatDateInputLabel(spiffToInput)}.</p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              From
              <input className="input" name="spiff_from" type="date" defaultValue={spiffFromInput} />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              To
              <input className="input" name="spiff_to" type="date" defaultValue={spiffToInput} />
            </label>
            <div className="flex items-end">
              <button className="btn-primary w-full" type="submit">Update</button>
            </div>
          </form>
        </div>
        {!historicalSpiffs.length ? (
          <EmptyState title="No SPIFFs in this range." detail="Try a different date range." />
        ) : (
          <SpiffTable spiffs={historicalSpiffs} />
        )}
      </section>
    </div>
  );
}

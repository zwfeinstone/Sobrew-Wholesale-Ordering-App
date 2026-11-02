import type { DeferredPayPlan, DeferredPaySummary } from '@/lib/deferred-pay';
import { formatCentralDateInput, formatCentralDateTime, workTypeLabel } from '@/lib/time-clock';
import { formatAppDate, usd } from '@/lib/utils';

const statusLabels: Record<DeferredPaySummary['status'], string> = {
  scheduled: 'Scheduled · Not paid',
  accruing: 'Accruing · Not paid',
  awaiting_payment: 'Awaiting payment',
  paid: 'Payment recorded',
};

export default function DeferredPaySummaryCard({
  plan,
  summary,
}: {
  plan: DeferredPayPlan;
  summary: DeferredPaySummary;
}) {
  const headingId = `deferred-pay-${plan.id}`;
  const today = formatCentralDateInput(new Date(summary.asOf));
  const currentWeek = summary.weeks.find((week) => week.weekStartDate <= today && week.weekEndDate >= today);
  const hasRecordedPayment = summary.paidCents > 0;
  const statusLabel = hasRecordedPayment && summary.status !== 'paid' ? 'Partially paid' : statusLabels[summary.status];
  let runningCents = 0;
  const weeks = summary.weeks.map((week) => {
    runningCents += week.accruedCents;
    return { ...week, runningCents };
  });

  return (
    <section className="card min-w-0 space-y-5" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="eyebrow">Deferred pay</span>
          <h2 id={headingId} className="mt-3 text-xl font-semibold text-slate-950">Your deferred pay</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            <strong className="text-slate-950">{usd(plan.weekly_rate_cents + plan.accrual_rate_cents)}/hr</strong> total base compensation during the accrual period.
          </p>
          <p className="text-sm leading-6 text-slate-600">
            <strong className="text-slate-950">{usd(plan.weekly_rate_cents)}/hr</strong> paid weekly + <strong className="text-slate-950">{usd(plan.accrual_rate_cents)}/hr</strong> deferred to the lump-sum payment.
          </p>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${summary.status === 'awaiting_payment' ? 'bg-amber-50 text-amber-800' : 'bg-teal-50 text-teal-800'}`}>
          {statusLabel}
        </span>
      </div>

      <dl className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-teal-100 bg-teal-50/60 p-4">
          <dt className="text-sm text-teal-900">{hasRecordedPayment ? 'Remaining balance' : 'Accrued balance'}</dt>
          <dd className="mt-2 break-words text-3xl font-semibold tracking-tight text-teal-950 tabular-nums">{usd(summary.remainingCents)}</dd>
          <dd className="mt-2 text-xs leading-5 text-teal-800">{usd(plan.accrual_rate_cents)} for each eligible paid hour</dd>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white/60 p-4">
          <dt className="text-sm text-slate-600">Eligible hours accrued</dt>
          <dd className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 tabular-nums">{summary.eligibleHours.toFixed(2)} <span className="text-base font-normal text-slate-500">hrs</span></dd>
          <dd className="mt-2 text-xs leading-5 text-slate-500">Completed hours, after unpaid breaks</dd>
        </div>
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white/60 p-4">
          <dt className="text-sm text-slate-600">Deferred this week</dt>
          <dd className="mt-2 break-words text-3xl font-semibold tracking-tight text-slate-950 tabular-nums">{usd(currentWeek?.accruedCents ?? 0)}</dd>
          <dd className="mt-2 text-xs leading-5 text-slate-500">{(currentWeek?.eligibleHours ?? 0).toFixed(2)} eligible hrs · Monday–Sunday</dd>
        </div>
      </dl>

      <div className="flex flex-wrap justify-between gap-3 rounded-xl bg-teal-50/60 px-4 py-3 text-sm leading-6 text-teal-900">
        <p>Accrual period · <strong>{formatAppDate(plan.start_date)}–{formatAppDate(plan.end_date)}</strong></p>
        <p>Planned lump-sum payment · <strong>{formatAppDate(plan.payout_date)}</strong></p>
      </div>
      {hasRecordedPayment ? (
        <p className="text-sm leading-6 text-slate-600">
          {usd(summary.paidCents)} payment recorded{plan.paid_at ? ` on ${formatAppDate(plan.paid_at)}` : ''}. Total accrued: {usd(summary.accruedCents)}.
        </p>
      ) : null}

      <div className="space-y-3 border-t border-slate-200 pt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-950">Accrual history</h3>
          <p className="text-xs text-slate-500">{summary.entryCount} completed shift{summary.entryCount === 1 ? '' : 's'} · {weeks.length} week{weeks.length === 1 ? '' : 's'}</p>
        </div>

        {weeks.length ? (
          <div className="space-y-2">
            {weeks.map((week) => (
              <details key={week.weekStartDate} className="group min-w-0 rounded-xl border border-slate-200 bg-white/60">
                <summary className="cursor-pointer list-none rounded-xl p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
                  <span className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
                    <span className="col-span-2 min-w-0 lg:col-span-1">
                      <span className="block text-xs text-slate-500">Week</span>
                      <span className="mt-1 block text-sm font-semibold leading-5 text-slate-950">{formatAppDate(week.weekStartDate)}–{formatAppDate(week.weekEndDate)}</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-xs text-teal-800"><span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">›</span> Shift details</span>
                    </span>
                    <span className="min-w-0"><span className="block text-xs text-slate-500">Eligible hours</span><span className="mt-1 block text-sm font-semibold text-slate-950 tabular-nums">{week.eligibleHours.toFixed(2)} hrs</span></span>
                    <span className="min-w-0"><span className="block text-xs text-slate-500">Accrued</span><span className="mt-1 block break-words text-sm font-semibold text-slate-950 tabular-nums">{usd(week.accruedCents)}</span></span>
                    <span className="min-w-0"><span className="block text-xs text-slate-500">Running total</span><span className="mt-1 block break-words text-sm font-semibold text-teal-900 tabular-nums">{usd(week.runningCents)}</span></span>
                  </span>
                </summary>
                <div className="border-t border-slate-200 px-4 pb-4">
                  <ul className="divide-y divide-slate-200" aria-label={`Shifts for week of ${formatAppDate(week.weekStartDate)}`}>
                    {week.entries.map((entry) => (
                      <li key={entry.entryId} className="grid min-w-0 gap-3 py-3 sm:grid-cols-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-950">{workTypeLabel(entry.workType)}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-600">{formatCentralDateTime(entry.clockInAt)} to {formatCentralDateTime(entry.clockOutAt)}</p>
                        </div>
                        <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm sm:text-right">
                          <div className="min-w-0"><dt className="text-xs text-slate-500">Eligible hours</dt><dd className="mt-1 font-semibold text-slate-950 tabular-nums">{entry.eligibleHours.toFixed(2)} hrs</dd></div>
                          <div className="min-w-0"><dt className="text-xs text-slate-500">Accrued</dt><dd className="mt-1 break-words font-semibold text-slate-950 tabular-nums">{usd(entry.accruedCents)}</dd></div>
                        </dl>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs leading-5 text-slate-500">Only eligible hours within this week and the accrual period are included above.</p>
                </div>
              </details>
            ))}
            <dl className="flex flex-wrap justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-950">
              <div><dt className="inline">Total eligible hours: </dt><dd className="inline tabular-nums">{summary.eligibleHours.toFixed(2)} hrs</dd></div>
              <div><dt className="inline">Total accrued: </dt><dd className="inline tabular-nums">{usd(summary.accruedCents)}</dd></div>
            </dl>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm leading-6 text-slate-600">
            {summary.status === 'scheduled'
              ? `Accrual starts ${formatAppDate(plan.start_date)}.`
              : 'No eligible completed hours have been recorded yet.'} Completed shifts in the accrual period appear here after clock-out.
          </div>
        )}

        <p className="text-xs leading-5 text-slate-500">
          All eligible shifts, including weekends, count. Times use America/Chicago. Hours display to two decimals; accrual uses unrounded eligible time. Gross amounts before deductions; regular-rate accrual is tracked separately from payroll overtime.
        </p>
      </div>
    </section>
  );
}

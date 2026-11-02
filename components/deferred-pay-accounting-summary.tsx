import type { DeferredPayAccountingSummary } from '@/lib/deferred-pay-accounting';
import { usd } from '@/lib/utils';

export function DeferredPayAccountingSummaryCard({ summary }: { summary: DeferredPayAccountingSummary }) {
  if (!summary.plans.length) return null;
  return (
    <section className="card space-y-4" aria-label="Deferred payroll accounting">
      <div>
        <span className="eyebrow">Deferred payroll</span>
        <h2 className="mt-2 text-xl font-semibold text-slate-950">Earned pay and balance owed</h2>
        <p className="mt-2 text-sm text-slate-600">{summary.periodStartDate} – {summary.periodEndDate} · Central time · Company totals</p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Opening balance owed', summary.openingLiabilityCents],
          ['Earned this period', summary.accruedCents],
          ['Payments recorded', summary.paidCents],
          ['Closing balance owed', summary.closingLiabilityCents],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <dt className="text-sm text-slate-600">{label}</dt>
            <dd className="mt-2 text-xl font-semibold tabular-nums text-slate-950">{usd(Number(value))}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-slate-600">
        {summary.eligibleHours.toFixed(2)} eligible hours in this period. Earned expense: {usd(summary.productionAccruedCents)} production labor and {usd(summary.operatingAccruedCents)} operating payroll.
        {' '}Opening balance + earned pay − payments = closing balance. Recorded payments reduce the balance owed; they do not add another payroll expense.
      </p>
      <p className="text-xs text-slate-500">Based on completed shifts and recorded payments as of {new Date(summary.asOf).toLocaleDateString('en-US', { timeZone: 'America/Chicago' })}. Match the dedicated bank payment in Payroll when it is imported. Product and order margins keep their stored inventory costs; these accruals are included separately in Accounting P&amp;L.</p>
    </section>
  );
}

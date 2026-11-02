import { getMileageDetails, type MileageSource } from '@/lib/payroll-mileage';
import { formatCentralDateTime, normalizeMoneyCents } from '@/lib/time-clock';
import { usd } from '@/lib/utils';

type MileagePayment = MileageSource & {
  id: string;
  paid_at: string | null;
  week_start_date: string;
  week_end_date: string;
};

type Props = {
  payments: MileagePayment[];
  error: boolean;
  weekStart: string;
  weekEnd: string;
  from: string;
  to: string;
  spiffFrom: string;
  spiffTo: string;
};

function overlaps(payment: MileagePayment, from: string, to: string) {
  return payment.week_start_date <= to && payment.week_end_date >= from;
}

function total(payments: MileagePayment[]) {
  return payments.reduce((sum, payment) => sum + normalizeMoneyCents(payment.amount_cents), 0);
}

function dateLabel(input: string) {
  return new Date(`${input}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function MileageTable({ payments }: { payments: MileagePayment[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-separate border-spacing-y-2 text-left text-sm">
        <caption className="sr-only">Recorded mileage reimbursements and payroll payment status</caption>
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            <th scope="col" className="px-4 py-2">Payroll week</th>
            <th scope="col" className="px-4 py-2 text-right">Miles</th>
            <th scope="col" className="px-4 py-2 text-right">Rate per mile</th>
            <th scope="col" className="px-4 py-2 text-right">Amount</th>
            <th scope="col" className="px-4 py-2">Payment status</th>
            <th scope="col" className="px-4 py-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => {
            const details = getMileageDetails(payment);
            return (
              <tr key={payment.id} className="bg-white/70">
                <td className="rounded-l-xl px-4 py-3 font-semibold text-slate-950">{dateLabel(payment.week_start_date)} to {dateLabel(payment.week_end_date)}</td>
                <td className="px-4 py-3 text-right text-slate-700">{details.miles === null ? 'Not recorded' : details.miles.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                <td className="px-4 py-3 text-right text-slate-700">{details.rateCents === null ? 'Not recorded' : usd(details.rateCents)}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-950">{usd(normalizeMoneyCents(payment.amount_cents))}</td>
                <td className="px-4 py-3 text-slate-700">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${payment.paid_at ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-800'}`}>{payment.paid_at ? 'Paid to you' : 'Payable'}</span>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{payment.paid_at ? formatCentralDateTime(payment.paid_at) : 'Awaiting payroll'}</p>
                </td>
                <td className="rounded-r-xl px-4 py-3 text-slate-600">
                  {payment.notes}
                  {details.status === 'needs_review' ? <p className="mt-2 text-xs text-amber-900">Needs review: miles and rate could not be verified against the recorded payment. Contact payroll.</p> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function WeekHoursMileage({ payments, error, weekStart, weekEnd, from, to, spiffFrom, spiffTo }: Props) {
  const current = payments.filter((payment) => overlaps(payment, weekStart, weekEnd));
  const earlierUnpaid = payments.filter((payment) => payment.week_end_date < weekStart && !payment.paid_at);
  const visible = [...current, ...earlierUnpaid];
  const history = payments.filter((payment) => overlaps(payment, from, to));
  const details = current.map(getMileageDetails);
  const missingMiles = details.filter((detail) => detail.miles === null).length;
  const recordedMiles = details.reduce((sum, detail) => sum + (detail.miles ?? 0), 0);
  const milesValue = missingMiles === current.length && current.length > 0
    ? 'Not recorded'
    : `${recordedMiles.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${missingMiles ? 'recorded miles' : 'miles'}`;

  return (
    <>
      <section className="card space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Mileage payment and tracker</h2>
          <p className="mt-1 text-sm text-slate-500">Track mileage reimbursements recorded by payroll. Payable means awaiting payment; Paid to you means payroll has recorded the payment.</p>
          {earlierUnpaid.length > 0 && !error ? <p className="mt-1 text-sm text-slate-500">Includes {earlierUnpaid.length} unpaid mileage reimbursement{earlierUnpaid.length === 1 ? '' : 's'} from earlier weeks.</p> : null}
        </div>
        {error ? <p className="text-sm text-red-700" role="alert">Mileage records could not be loaded. Totals and payment status are unavailable; refresh or contact payroll.</p> : (
          <>
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Miles this week', value: milesValue, detail: missingMiles ? `${missingMiles} reimbursement${missingMiles === 1 ? ' is' : 's are'} missing verified miles.` : 'Miles recorded for the current payroll week.' },
                { label: 'Reimbursement this week', value: usd(total(current)), detail: 'Total recorded for the current payroll week.' },
                { label: 'Payable now', value: usd(total(visible.filter((payment) => !payment.paid_at))), detail: 'Includes unpaid mileage from earlier weeks.' },
                { label: 'Paid for this week', value: usd(total(current.filter((payment) => payment.paid_at))), detail: 'Current-week reimbursements already paid to you.' },
              ].map((stat) => (
                <div key={stat.label} className="rounded-xl bg-slate-50 px-4 py-3">
                  <dt className="text-sm text-slate-600">{stat.label}</dt>
                  <dd className="mt-1 text-xl font-semibold text-slate-950">{stat.value}</dd>
                  <dd className="mt-1 text-xs leading-5 text-slate-500">{stat.detail}</dd>
                </div>
              ))}
            </dl>
            {visible.length ? <MileageTable payments={visible} /> : <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">No mileage reimbursements recorded this week or awaiting payment.</p>}
          </>
        )}
      </section>
      <section className="card space-y-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Mileage history</h2>
            <p className="mt-1 text-sm text-slate-500">{error ? 'Mileage history is unavailable.' : `${usd(total(history))} recorded for payroll weeks overlapping ${dateLabel(from)} to ${dateLabel(to)}. Payment statuses are current.`}</p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input type="hidden" name="spiff_from" value={spiffFrom} />
            <input type="hidden" name="spiff_to" value={spiffTo} />
            <label className="space-y-2 text-sm font-medium text-slate-700">From<input className="input" name="mileage_from" type="date" defaultValue={from} /></label>
            <label className="space-y-2 text-sm font-medium text-slate-700">To<input className="input" name="mileage_to" type="date" defaultValue={to} /></label>
            <div className="flex items-end"><button className="btn-primary w-full" type="submit">Update mileage</button></div>
          </form>
        </div>
        {error ? null : history.length ? <MileageTable payments={history} /> : <p className="text-sm text-slate-500">No mileage reimbursements in this range. Try a different date range.</p>}
      </section>
    </>
  );
}

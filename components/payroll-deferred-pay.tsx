import Link from 'next/link';
import PendingSubmitButton from '@/components/pending-submit-button';
import type { DeferredPayAccountingSummary } from '@/lib/deferred-pay-accounting';
import { linkDeferredPayPayment, recordDeferredPayPayment } from '@/lib/deferred-pay-settlement';
import { formatCentralDateInput } from '@/lib/time-clock';
import { formatAppDate, usd } from '@/lib/utils';

export type DeferredPayBankTransaction = {
  id: string;
  transaction_date: string;
  account_name: string | null;
  account_type: string;
  merchant_name: string | null;
  original_description: string;
  amount_cents: number | string;
  status: string;
};

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white/60 p-3"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-2 break-words text-xl font-semibold text-slate-950 tabular-nums">{value}</dd></div>;
}

function BankTransactionField({ transactions, required = false }: { transactions: DeferredPayBankTransaction[]; required?: boolean }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
      {required ? 'Bank transaction' : 'Bank transaction (optional)'}
      <select className="input w-full min-w-0" name="accounting_transaction_id" defaultValue="" required={required}>
        <option value="">{required ? 'Select the matching payment' : 'Match after importing the bank transaction'}</option>
        {transactions.map((transaction) => <option key={transaction.id} value={transaction.id}>
          {formatAppDate(transaction.transaction_date)} · {usd(Number(transaction.amount_cents))} · {transaction.merchant_name || transaction.original_description} {transaction.account_name ? `(${transaction.account_name})` : ''}
        </option>)}
      </select>
      <span className="text-xs font-normal leading-5 text-slate-500">Choose a dedicated bank outflow for the full gross amount, dated on the payment date. Combined or net payments stay unmatched.</span>
    </label>
  );
}

export default function PayrollDeferredPay({
  summary,
  error,
  canEditPayroll,
  canEditAccounting,
  returnTo,
  mode = 'payments',
  bankTransactions = [],
  bankTransactionsError = false,
}: {
  summary: DeferredPayAccountingSummary | null;
  error: boolean;
  canEditPayroll: boolean;
  canEditAccounting: boolean;
  returnTo: string;
  mode?: 'payments' | 'report';
  bankTransactions?: DeferredPayBankTransaction[];
  bankTransactionsError?: boolean;
}) {
  if (error || !summary) return (
    <section id="deferred-pay" className="card space-y-2" aria-labelledby="deferred-pay-heading">
      <h2 id="deferred-pay-heading" className="text-xl font-semibold text-slate-950">Deferred hourly pay</h2>
      <p role="alert" className="text-sm text-rose-700">Deferred pay could not be loaded. The liability and payment actions are unavailable until the records can be loaded.</p>
    </section>
  );
  const today = formatCentralDateInput(summary.asOf);
  const currentLiabilityCents = summary.plans.reduce((total, row) => total + row.summary.accruedCents - row.summary.paidCents, 0);
  const dueNowCents = summary.plans.reduce((total, row) => total + (row.plan.payout_date <= today ? row.summary.remainingCents : 0), 0);
  const currentHours = summary.plans.reduce((total, row) => total + row.summary.eligibleHours, 0);
  const isReport = mode === 'report';
  const linkedTransactionIds = new Set(summary.settlementTransactionIds);

  return (
    <section id="deferred-pay" className="card min-w-0 scroll-mt-5 space-y-5" aria-labelledby="deferred-pay-heading">
      <div>
        <h2 id="deferred-pay-heading" className="text-xl font-semibold text-slate-950">Deferred hourly pay</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{isReport
          ? `${formatAppDate(summary.periodStartDate)}–${formatAppDate(summary.periodEndDate)}. Earned compensation, recorded payments, and the remaining liability are tracked separately.`
          : `Current balances as of ${formatAppDate(summary.asOf)}. Weekly paycheck rates and hourly payment records stay separate.`}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{isReport
          ? 'The selected employee and dates apply. Includes all labor tags.'
          : 'The selected employee applies. Current balances include each full accrual period, regardless of the weekly date or labor-tag filters.'}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isReport ? <>
          <Metric label="Opening liability" value={usd(summary.openingLiabilityCents)} />
          <Metric label="Accrued in period" value={usd(summary.accruedCents)} />
          <Metric label="Paid in period" value={usd(summary.paidCents)} />
          <Metric label="Closing liability" value={usd(summary.closingLiabilityCents)} />
        </> : <>
          <Metric label="Current deferred liability" value={usd(currentLiabilityCents)} />
          <Metric label="Deferred payable now" value={usd(dueNowCents)} />
          <Metric label="Not due yet" value={usd(Math.max(0, currentLiabilityCents - dueNowCents))} />
          <Metric label="Eligible hours accrued" value={`${currentHours.toFixed(2)} hrs`} />
        </>}
      </dl>

      {!summary.plans.length ? <p className="text-sm text-slate-500">No deferred hourly pay plans for the selected employee filter.</p> : null}
      <div className="space-y-4">
        {summary.plans.map((row) => {
          const { plan, summary: accrual } = row;
          const balanceCents = accrual.accruedCents - accrual.paidCents;
          const hasPayment = Boolean(plan.paid_at) && accrual.paidCents > 0;
          const canRecord = canEditPayroll && !plan.paid_at && plan.payout_date <= today && accrual.remainingCents > 0;
          const status = hasPayment ? balanceCents !== 0 ? 'Payment recorded · Balance needs review' : 'Payment recorded' : plan.payout_date <= today ? 'Awaiting payment' : accrual.status === 'scheduled' ? 'Scheduled' : 'Accruing';
          const paymentCents = hasPayment ? accrual.paidCents : accrual.remainingCents;
          const paymentDate = plan.paid_at ? formatCentralDateInput(plan.paid_at) : null;
          const candidates = bankTransactions.filter((transaction) => (
            !linkedTransactionIds.has(transaction.id)
            && ['bank', 'debit_card'].includes(transaction.account_type)
            && ['needs_review', 'categorized'].includes(transaction.status)
            && Number(transaction.amount_cents) === paymentCents
            && transaction.transaction_date >= plan.payout_date
            && transaction.transaction_date <= today
            && (!paymentDate || transaction.transaction_date === paymentDate)
          ));
          return (
            <article key={plan.id} className="min-w-0 rounded-xl border border-slate-200 bg-white/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-950">{row.employeeName}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{usd(plan.weekly_rate_cents)}/hr paid weekly + {usd(plan.accrual_rate_cents)}/hr deferred · {usd(plan.weekly_rate_cents + plan.accrual_rate_cents)}/hr total base during the accrual period.</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{formatAppDate(plan.start_date)}–{formatAppDate(plan.end_date)} · Lump sum due {formatAppDate(plan.payout_date)}</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${!hasPayment && plan.payout_date <= today ? 'bg-amber-50 text-amber-800' : 'bg-teal-50 text-teal-800'}`}>{status}</span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {isReport ? <>
                  <Metric label="Eligible hours in period" value={`${row.eligibleHours.toFixed(2)} hrs`} />
                  <Metric label="Accrued in period" value={usd(row.accruedCents)} />
                  <Metric label="Paid in period" value={usd(row.paidCents)} />
                  <Metric label="Closing liability" value={usd(row.closingLiabilityCents)} />
                </> : <>
                  <Metric label="Eligible hours" value={`${accrual.eligibleHours.toFixed(2)} hrs`} />
                  <Metric label="Total accrued" value={usd(accrual.accruedCents)} />
                  <Metric label="Recorded payment" value={usd(accrual.paidCents)} />
                  <Metric label="Remaining balance" value={usd(balanceCents)} />
                </>}
              </dl>
              {hasPayment ? <p className="mt-3 text-sm text-slate-600">Payment recorded {formatAppDate(plan.paid_at)}. {plan.accounting_transaction_id ? 'Bank transaction matched.' : 'Bank transaction not yet matched.'}</p> : null}

              {!isReport && canRecord ? (
                <details className="mt-4 rounded-lg border border-teal-100 bg-teal-50/40 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-teal-900">Record lump-sum payment · {usd(accrual.remainingCents)}</summary>
                  <form action={recordDeferredPayPayment} className="mt-4 grid min-w-0 gap-3">
                    <input type="hidden" name="return_to" value={returnTo} />
                    <input type="hidden" name="plan_id" value={plan.id} />
                    <input type="hidden" name="expected_amount_cents" value={accrual.remainingCents} />
                    <p className="text-sm text-slate-600">Record this only after paying {row.employeeName} the full {usd(accrual.remainingCents)} gross amount. This saves the payment record; no funds are transferred.</p>
                    <label className="grid gap-1.5 text-sm font-medium text-slate-700">Actual payment date<input className="input w-full sm:max-w-xs" type="date" name="paid_date" defaultValue={today} min={plan.payout_date} max={today} required /></label>
                    <label className="grid gap-1.5 text-sm font-medium text-slate-700">Payment notes (optional)<input className="input w-full" type="text" name="payment_notes" maxLength={1000} placeholder="Check number or payment reference" /></label>
                    {canEditAccounting && !bankTransactionsError ? <BankTransactionField transactions={candidates} /> : null}
                    <PendingSubmitButton className="btn-primary w-full sm:w-auto sm:justify-self-start" label="Record payment" pendingLabel="Saving payment..." />
                  </form>
                </details>
              ) : null}
              {!isReport && !plan.paid_at && plan.payout_date > today ? <p className="mt-3 text-xs text-slate-500">Payment can be recorded on or after {formatAppDate(plan.payout_date)}.</p> : null}
              {!isReport && !canEditPayroll ? <p className="mt-3 text-xs text-slate-500">View only. A payroll editor can record payment after it is made.</p> : null}
              {!isReport && hasPayment && !plan.accounting_transaction_id && canEditPayroll && canEditAccounting && !bankTransactionsError && candidates.length ? (
                <details className="mt-4 rounded-lg border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-teal-900">Match recorded payment to a bank transaction</summary>
                  <form action={linkDeferredPayPayment} className="mt-4 grid min-w-0 gap-3">
                    <input type="hidden" name="return_to" value={returnTo} />
                    <input type="hidden" name="plan_id" value={plan.id} />
                    <input type="hidden" name="expected_amount_cents" value={accrual.paidCents} />
                    <BankTransactionField transactions={candidates} required />
                    <PendingSubmitButton className="btn-secondary w-full sm:w-auto sm:justify-self-start" label="Match bank transaction" pendingLabel="Matching..." />
                  </form>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>

      {!isReport && canEditPayroll && canEditAccounting ? <p className="text-xs leading-5 text-slate-500">
        {bankTransactionsError ? 'Bank transactions could not be loaded; you can record payment and match it later. ' : 'Matching categorizes the dedicated bank outflow as Deferred Payroll / Compensation Payable. '}
        <Link href="/admin/accounting?view=review" className="font-medium text-teal-800 underline">Review or import bank transactions in Accounting</Link>, then return here to match the payment.
      </p> : null}
      <p className="text-xs leading-5 text-slate-500">Gross compensation before deductions. Deferred earnings are recognized as they accrue; recording the payout reduces the liability and does not add another wage expense. All eligible shifts, including weekends, count after unpaid breaks.</p>
    </section>
  );
}

import Link from 'next/link';
import PendingSubmitButton from '@/components/pending-submit-button';
import { addCommissionMonths, commissionMonthLabel, emptyCommissionSummary } from '@/lib/commissions';
import type { PayrollCommissionRow } from '@/lib/payroll-commissions';
import { formatCentralDateTime } from '@/lib/time-clock';
import { usd } from '@/lib/utils';

type Profile = { id: string; full_name: string | null; email: string | null; is_active: boolean | null };

export default function PayrollMonthlyCommissions({
  action, canEdit, commissionMonth, currentMonth, error, profiles, rows, salesProfileIds, selectedAdmin, currentParams, activeTab, returnTo,
}: {
  action: (formData: FormData) => Promise<void>;
  canEdit: boolean;
  commissionMonth: string;
  currentMonth: string;
  error: boolean;
  profiles: Map<string, Profile>;
  rows: PayrollCommissionRow[];
  salesProfileIds: string[];
  selectedAdmin: string;
  currentParams: Record<string, string>;
  activeTab: string;
  returnTo: string;
}) {
  const dueDate = addCommissionMonths(commissionMonth, 1);
  const dueDateLabel = new Date(`${dueDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const isDue = commissionMonth < currentMonth;
  const rowsByProfile = new Map(rows.map((row) => [row.salesProfileId, row]));
  for (const profileId of salesProfileIds) {
    if (!rowsByProfile.has(profileId)) rowsByProfile.set(profileId, { salesProfileId: profileId, summary: emptyCommissionSummary(), payout: null, amountOwedCents: 0, cogsEstimated: false });
  }
  const label = (profileId: string | null) => {
    const profile = profiles.get(profileId ?? '');
    return profile?.full_name || profile?.email || 'Former employee';
  };
  const visibleRows = [...rowsByProfile.values()]
    .filter((row) => !selectedAdmin || row.salesProfileId === selectedAdmin)
    .sort((a, b) => label(a.salesProfileId).localeCompare(label(b.salesProfileId)));
  const unpaidCents = visibleRows.reduce((sum, row) => sum + row.amountOwedCents, 0);
  const paidCents = visibleRows.reduce((sum, row) => sum + (row.payout?.status === 'paid' || row.payout?.paid_at ? Math.round(row.summary.commissionCents) : 0), 0);
  const monthHref = (month: string) => `/admin/payroll?${new URLSearchParams({ ...currentParams, tab: activeTab, commission_month: month.slice(0, 7) })}#monthly-commissions`;

  return (
    <section id="monthly-commissions" aria-labelledby="monthly-commissions-heading" className="card scroll-mt-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <h2 id="monthly-commissions-heading" className="text-xl font-semibold text-slate-950">Monthly commissions</h2>
          <p className="mt-1 text-sm text-slate-600">{commissionMonthLabel(commissionMonth)} sales · Pay on {dueDateLabel}</p>
          <p className="mt-1 text-sm text-slate-500">Commissions are due on the first of the following month, separate from weekly hourly pay and SPIFFs.</p>
        </div>
        {!error ? <div className="sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{isDue ? 'Commissions owed' : 'Accrued commissions'}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-teal-900">{usd(unpaidCents)}</p>
          {paidCents > 0 ? <p className="mt-1 text-xs text-slate-500">{usd(paidCents)} already paid</p> : null}
        </div> : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form action="/admin/payroll#monthly-commissions" method="get" className="flex flex-wrap items-end gap-2">
          {Object.entries({ ...currentParams, tab: activeTab }).filter(([key]) => key !== 'commission_month').map(([key, value]) => <input key={key} name={key} type="hidden" value={value} />)}
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">Commission month<input key={commissionMonth} className="input sm:w-48" type="month" name="commission_month" defaultValue={commissionMonth.slice(0, 7)} max={currentMonth.slice(0, 7)} required /></label>
          <button type="submit" className="btn-secondary">View month</button>
        </form>
        <div className="flex flex-wrap gap-2 text-sm font-medium">
          <Link className="payroll-shortcut" href={monthHref(addCommissionMonths(currentMonth, -1))}>Due this month</Link>
          <Link className="payroll-shortcut" href={monthHref(currentMonth)}>Accruing this month</Link>
        </div>
      </div>

      {error ? <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">Monthly commissions could not be loaded. Refresh before recording a payment.</p> : <>
        {visibleRows.length ? <div className="overflow-x-auto">
          <table className="payroll-payment-table payroll-commission-table w-full border-separate border-spacing-y-2 text-left text-sm">
            <thead><tr className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2">Salesperson</th><th className="px-4 py-2 text-right">Commission</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Payment</th>
            </tr></thead>
            <tbody>{visibleRows.map((row) => {
              const profile = profiles.get(row.salesProfileId ?? '');
              const isPaid = row.payout?.status === 'paid' || Boolean(row.payout?.paid_at);
              const payable = !isPaid && isDue && row.amountOwedCents > 0 && Boolean(row.salesProfileId);
              const status = isPaid ? 'Paid' : !row.amountOwedCents ? 'No commission due' : !isDue ? 'Accruing' : 'Due';
              return <tr key={row.salesProfileId ?? 'former'} className="bg-white/70 align-top">
                <td data-label="Salesperson" className="rounded-l-xl px-4 py-3"><p className="font-semibold text-slate-950">{label(row.salesProfileId)}</p><p className="mt-1 break-all text-xs text-slate-500">{profile?.email}</p>{profile?.is_active === false ? <p className="mt-1 text-xs text-slate-500">Inactive employee</p> : null}</td>
                <td data-label="Commission" className="px-4 py-3 text-right"><p className="font-semibold tabular-nums text-slate-950">{usd(Math.round(row.summary.commissionCents))}</p><p className="mt-1 text-xs text-slate-500">{row.summary.orderCount} shipped order{row.summary.orderCount === 1 ? '' : 's'}</p><details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer text-teal-800">Calculation details</summary><p className="mt-2">Sales: {usd(Math.round(row.summary.revenueCents))}</p><p>Gross profit: {usd(Math.round(row.summary.grossProfitCents))}</p><p className="mt-1">{row.payout ? 'Saved monthly payout amount.' : 'Uses the commission rate recorded for each shipped order.'}</p>{row.cogsEstimated && !row.payout ? <p className="mt-1 text-amber-800">Some order costs are estimated. Review before paying.</p> : null}</details></td>
                <td data-label="Status" className="px-4 py-3"><span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${isPaid ? 'bg-emerald-50 text-emerald-800' : payable ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{status}</span>{isPaid && row.payout?.paid_at ? <p className="mt-2 text-xs text-slate-500">{formatCentralDateTime(row.payout.paid_at)}</p> : null}{!isPaid && row.payout ? <p className="mt-2 text-xs text-slate-500">Amount locked</p> : null}</td>
                <td data-label="Payment" className="rounded-r-xl px-4 py-3">{payable && canEdit ? <form action={action}><input type="hidden" name="return_to" value={returnTo} /><input type="hidden" name="sales_profile_id" value={row.salesProfileId ?? ''} /><input type="hidden" name="commission_month" value={commissionMonth} /><PendingSubmitButton className="btn-primary w-full" label="Mark commission paid" pendingLabel="Saving..." /></form> : <span className="text-sm text-slate-500">{isPaid ? 'Payment recorded' : !row.salesProfileId ? 'Historical record' : !isDue && row.amountOwedCents > 0 ? `Pay on ${dueDateLabel}` : !canEdit ? 'View only' : 'Nothing to pay'}</span>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div> : <p className="text-sm text-slate-500">No salesperson commissions for this month.</p>}
        <p className="text-xs text-slate-500">Mark paid after paying the salesperson; this records the payment without transferring money. The commission month is independent of the weekly date and labor-tag filters{selectedAdmin ? '; the employee filter still applies' : ''}.</p>
      </>}
    </section>
  );
}

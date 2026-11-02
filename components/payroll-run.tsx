import type { ReactNode } from 'react';
import { ChevronDown, Check, Wallet } from 'lucide-react';
import PendingSubmitButton from '@/components/pending-submit-button';
import { hoursLabel } from '@/lib/time-clock';
import { usd } from '@/lib/utils';

export type PayrollRunRow = {
  id: string | null;
  name: string;
  minutes: number;
  overtimeMinutes: number;
  overtimePremiumCents: number;
  shiftCount: number;
  wagesCents: number;
  spiffCents: number;
  salaryCents: number;
  commissionCents: number;
  totalCents: number;
  paid: boolean;
  approvalCount: number;
  openCount: number;
  openBreakCount: number;
  heldSpiffCount: number;
  heldCommissionReason?: string | null;
  ready: boolean;
  snapshot: {
    profileId: string;
    entryIds: string[];
    spiffIds: string[];
    wagesCents: number;
    spiffCents: number;
    salaryCents: number;
    commissionCents: number;
    payrollMonth?: string;
    commissionMonth?: string;
  };
  shifts: ReactNode;
};

export default function PayrollRun({ rows, canEdit, loadError, from, to, salaryPeriod, commissionPeriod, returnTo, selectedAdmin, approveAction, paymentAction }: {
  rows: PayrollRunRow[];
  canEdit: boolean;
  loadError: boolean;
  from: string;
  to: string;
  salaryPeriod: string;
  commissionPeriod: string;
  returnTo: string;
  selectedAdmin: string;
  approveAction: (data: FormData) => Promise<void>;
  paymentAction: (data: FormData) => Promise<void>;
}) {
  const ready = rows.filter((row) => row.ready);
  const readyCents = ready.reduce((sum, row) => sum + row.totalCents, 0);
  const dueCents = rows.reduce((sum, row) => sum + row.totalCents, 0);
  const approvals = rows.reduce((sum, row) => sum + row.approvalCount, 0);
  const needsReview = rows.filter((row) => row.openCount || row.openBreakCount || row.approvalCount || row.heldCommissionReason).length;
  const correctionsUrl = new URL(returnTo, 'http://localhost');
  correctionsUrl.searchParams.set('tab', 'time');
  correctionsUrl.searchParams.delete('work_type');
  correctionsUrl.hash = 'time-corrections';
  const fields = <><input name="return_to" type="hidden" value={returnTo} /><input name="lock_start" type="hidden" value={from} /><input name="lock_end" type="hidden" value={to} /></>;
  const activeRows = rows.filter((row) => selectedAdmin || row.totalCents > 0 || row.approvalCount || row.openCount || row.openBreakCount || row.ready || row.heldCommissionReason);
  const settledRows = rows.filter((row) => !activeRows.includes(row));
  const renderRow = (row: PayrollRunRow) => {
          const employeeCorrectionsUrl = new URL(correctionsUrl);
          if (row.id) employeeCorrectionsUrl.searchParams.set('admin', row.id);
          const status = row.openCount ? `${row.openCount} open shift${row.openCount === 1 ? '' : 's'}` : row.openBreakCount ? 'Open break to close' : row.approvalCount ? `${row.approvalCount} to approve` : row.ready ? row.heldCommissionReason ? 'Ready — commission held' : 'Ready' : row.heldCommissionReason ? 'Commission needs review' : row.paid ? 'Paid' : row.totalCents > 0 ? row.id ? 'Needs review' : 'Historical record' : 'No pay due';
          return <article className="payroll-run-person" key={row.id ?? 'former'} aria-label={`${row.name} payroll`}>
            <div className="payroll-run-columns grid items-center gap-4">
              <div className="min-w-0"><h3 className="break-words font-semibold text-slate-950">{row.name}</h3><p className="mt-1 text-xs text-slate-500">{hoursLabel(row.minutes)} hours · {row.shiftCount} shift{row.shiftCount === 1 ? '' : 's'}{row.overtimeMinutes ? ` · ${hoursLabel(row.overtimeMinutes)} OT` : ''}</p><span className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${row.ready || row.paid ? 'text-teal-800' : 'text-amber-800'}`}>{row.paid ? <Check size={13} aria-hidden="true" /> : null}{status}</span></div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                <span>Hourly <strong className="font-medium text-slate-900">{usd(row.wagesCents)}</strong></span>
                <span>Incentives <strong className="font-medium text-slate-900">{usd(row.spiffCents)}</strong></span>
                <span>Salary <strong className="font-medium text-slate-900">{usd(row.salaryCents)}</strong></span>
                <span>Commission <strong className="font-medium text-slate-900">{usd(row.commissionCents)}</strong></span>
                {row.overtimePremiumCents > 0 ? <span className="col-span-2 text-teal-800">Includes {usd(row.overtimePremiumCents)} OT premium</span> : null}
                {row.heldSpiffCount > 0 ? <span className="col-span-2 text-amber-800">{row.heldSpiffCount} incentive{row.heldSpiffCount === 1 ? '' : 's'} awaiting invoice payment</span> : null}
                {row.heldCommissionReason ? <span className="col-span-2 text-amber-800">Commission held: {row.heldCommissionReason}</span> : null}
              </div>
              <p className="text-xl font-semibold tabular-nums text-slate-950 lg:text-right">{loadError ? '—' : usd(row.totalCents)}</p>
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {canEdit && row.approvalCount > 0 && row.id ? <form action={approveAction}>{fields}<input name="profile_id" type="hidden" value={row.id} /><PendingSubmitButton className="btn-secondary w-full" label="Approve shifts" pendingLabel="Approving…" /></form> : null}
                {canEdit && row.ready ? <form action={paymentAction}>{fields}<input name="payment_rows" type="hidden" value={JSON.stringify([row.snapshot])} /><PendingSubmitButton className="btn-primary w-full" label="Record paid" pendingLabel="Recording…" disabled={loadError} /></form> : !canEdit ? <span className="text-xs text-slate-500">View only</span> : row.openCount || row.openBreakCount ? <a className="text-sm font-medium text-teal-800 underline" href={`${employeeCorrectionsUrl.pathname}${employeeCorrectionsUrl.search}${employeeCorrectionsUrl.hash}`}>Correct time</a> : null}
              </div>
            </div>
            {row.shifts ? <details className="payroll-disclosure mt-3"><summary className="flex w-fit cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-600"><ChevronDown size={14} className="payroll-chevron" aria-hidden="true" />Review shifts</summary><div className="mt-3">{row.shifts}</div></details> : null}
          </article>;
  };
  return (
    <section id="pay-run" className="card payroll-run space-y-4" aria-labelledby="pay-run-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="pay-run-heading" className="text-xl font-semibold text-slate-950">Review & pay your team</h2>
          <p className="mt-1 text-sm text-slate-600">Approve shifts, then record each payment once.</p>
        </div>
        <div className="flex flex-wrap items-end gap-6">
          <div><p className="text-xs font-medium text-slate-500">Pay run total</p><p className="text-2xl font-semibold text-slate-950">{loadError ? 'Unavailable' : usd(dueCents)}</p></div>
          <div><p className="text-xs font-medium text-slate-500">Ready to record</p><p className="text-2xl font-semibold text-teal-800">{loadError ? 'Unavailable' : usd(readyCents)}</p></div>
          <div><p className="text-xs font-medium text-slate-500">Need review</p><p className="text-2xl font-semibold text-slate-950">{needsReview}</p></div>
        </div>
      </div>
      <div className="payroll-run-toolbar flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
        <p className="max-w-xl text-xs leading-5 text-slate-600">Record payments after sending them outside this app. All included pay types update together; no separate week completion is needed.</p>
        {canEdit ? <div className="flex flex-wrap gap-2">
          <form action={approveAction}>{fields}<input name="profile_id" type="hidden" value={selectedAdmin} />
            <PendingSubmitButton className="btn-secondary" disabled={!approvals} disabledLabel="Shifts approved" label={`Approve ${approvals} shift${approvals === 1 ? '' : 's'}`} pendingLabel="Approving…" />
          </form>
          <form action={paymentAction}>{fields}<input name="payment_rows" type="hidden" value={JSON.stringify(ready.map((row) => row.snapshot))} />
            <PendingSubmitButton className="btn-primary gap-2" disabled={!ready.length || loadError} disabledLabel={loadError ? 'Refresh payroll' : 'No payments ready'} label={`Record ${ready.length} payment${ready.length === 1 ? '' : 's'} · ${usd(readyCents)}`} pendingLabel="Recording…" />
          </form>
        </div> : <span className="text-sm text-slate-500">View only</span>}
      </div>
      {loadError ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Some payment data could not be loaded. Refresh payroll before recording payments so no pay is missed.</p> : null}
      <p className="text-xs leading-5 text-slate-500">Hourly + incentives (including mileage): selected dates, all tags. Salary: {salaryPeriod}. Commissions: {commissionPeriod}. Deferred lump sums are shown below with their payment-date and bank-match fields.</p>
      <div className="payroll-run-list">
        <div className="payroll-run-columns hidden gap-4 px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 lg:grid" aria-hidden="true"><span>Employee / shifts</span><span>Pay breakdown</span><span className="text-right">Amount owed</span><span>Action</span></div>
        {activeRows.map(renderRow)}
        {!activeRows.length && rows.length ? <p className="py-4 text-sm text-teal-800">All caught up for this period.</p> : null}
        {settledRows.length ? <details className="payroll-disclosure mt-3 border-t border-slate-200 pt-3"><summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600"><ChevronDown size={16} className="payroll-chevron" aria-hidden="true" />Paid & no pay due ({settledRows.length})</summary><div className="mt-3">{settledRows.map(renderRow)}</div></details> : null}
        {!rows.length ? <p className="py-8 text-center text-sm text-slate-500"><Wallet className="mx-auto mb-2 text-slate-400" size={24} aria-hidden="true" />No payroll items for this period.</p> : null}
      </div>
    </section>
  );
}

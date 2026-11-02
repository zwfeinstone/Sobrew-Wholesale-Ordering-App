import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import PayrollRun, { type PayrollRunRow } from '@/components/payroll-run';
import '@/app/globals.css';
import '@/app/admin/payroll/payroll.css';

type Call = { kind: 'approve' | 'payment'; status: 'pending' | 'complete'; fields: Record<string, string>; paymentRows?: PayrollRunRow['snapshot'][] };

function makeRows(): PayrollRunRow[] {
  const base = {
    overtimeMinutes: 0, overtimePremiumCents: 0, salaryCents: 0, commissionCents: 0,
    spiffCents: 0, paid: false, approvalCount: 0, openCount: 0, openBreakCount: 0,
    heldSpiffCount: 0, ready: false,
  };
  return [
    {
      ...base, id: 'alex', name: 'Alex Submitted', minutes: 2400, shiftCount: 2,
      wagesCents: 80000, spiffCents: 7500, salaryCents: 200000, commissionCents: 12500,
      totalCents: 300000, approvalCount: 2,
      snapshot: { profileId: 'alex', entryIds: ['alex-shift-1', 'alex-shift-2'], spiffIds: ['alex-incentive-1'], wagesCents: 80000, spiffCents: 7500, salaryCents: 200000, commissionCents: 12500, payrollMonth: '2026-10-01', commissionMonth: '2026-10-01' },
      shifts: <p>Two submitted shifts · 40.00 hours · $800.00 hourly + $75.00 incentives.</p>,
    },
    {
      ...base, id: 'blair', name: 'Blair Ready', minutes: 1200, shiftCount: 1,
      wagesCents: 40000, spiffCents: 2500, totalCents: 42500, ready: true,
      snapshot: { profileId: 'blair', entryIds: ['blair-shift-1'], spiffIds: ['blair-incentive-1'], wagesCents: 40000, spiffCents: 2500, salaryCents: 0, commissionCents: 0 },
      shifts: <p>One approved shift · 20.00 hours · $400.00 hourly + $25.00 incentives.</p>,
    },
    {
      ...base, id: 'casey', name: 'Casey Paid', minutes: 600, shiftCount: 1,
      wagesCents: 0, totalCents: 0, paid: true,
      snapshot: { profileId: 'casey', entryIds: [], spiffIds: [], wagesCents: 0, spiffCents: 0, salaryCents: 0, commissionCents: 0 },
      shifts: <p>Previously paid shift remains available for review.</p>,
    },
    {
      ...base, id: 'drew', name: 'Drew Open', minutes: 0, shiftCount: 1,
      wagesCents: 0, totalCents: 0, openCount: 1,
      snapshot: { profileId: 'drew', entryIds: [], spiffIds: [], wagesCents: 0, spiffCents: 0, salaryCents: 0, commissionCents: 0 },
      shifts: <p>Clocked in; close the open shift before approving and paying.</p>,
    },
  ];
}

// This bundle contains no application actions, Supabase client, or network requests.
function Fixture() {
  const [rows, setRows] = useState(makeRows);
  const [calls, setCalls] = useState<Call[]>([]);
  const [canEdit, setCanEdit] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hold, setHold] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const nextHold = useRef(false);

  async function run(kind: Call['kind'], data: FormData) {
    const fields = Object.fromEntries(Array.from(data.entries(), ([key, value]) => [key, String(value)]));
    const paymentRows = kind === 'payment' ? JSON.parse(fields.payment_rows) as PayrollRunRow['snapshot'][] : undefined;
    const call: Call = { kind, status: 'pending', fields, paymentRows };
    flushSync(() => setCalls((current) => [...current, call]));
    if (nextHold.current) {
      nextHold.current = false;
      flushSync(() => { setHold(false); setWaiting(true); });
      await new Promise<void>((resolve) => { release.current = resolve; });
      release.current = null;
      setWaiting(false);
    } else {
      await new Promise<void>((resolve) => setTimeout(resolve, 450));
    }
    if (kind === 'approve') {
      setRows((current) => current.map((row) => row.approvalCount && (!fields.profile_id || row.id === fields.profile_id)
        ? { ...row, approvalCount: 0, ready: !row.openCount && !row.openBreakCount && row.totalCents > 0 }
        : row));
    } else {
      const ids = new Set(paymentRows!.map((row) => row.profileId));
      setRows((current) => current.map((row) => row.id && ids.has(row.id)
        ? { ...row, wagesCents: 0, spiffCents: 0, salaryCents: 0, commissionCents: 0, totalCents: 0, ready: false, paid: true }
        : row));
    }
    setCalls((current) => current.map((item) => item === call ? { ...item, status: 'complete' } : item));
  }

  return <main className="payroll-workspace mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <header><p className="eyebrow">Payroll interaction QA</p><h1 className="page-title">Isolated payroll fixture</h1><p className="text-sm text-slate-600">Actual PayrollRun component and application styles. Synthetic employees; all actions update memory only.</p></header>
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3" aria-label="QA controls">
      <button type="button" className="btn-secondary" disabled={waiting} onClick={() => { setRows(makeRows()); setCalls([]); setCanEdit(true); setLoadError(false); setHold(false); nextHold.current = false; }}>Reset fixture</button>
      <label className="flex items-center gap-2"><input type="checkbox" checked={!canEdit} onChange={(event) => setCanEdit(!event.target.checked)} />View only</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={loadError} onChange={(event) => setLoadError(event.target.checked)} />Payment data error</label>
      <button type="button" className="btn-secondary" aria-pressed={hold} disabled={waiting} onClick={() => { nextHold.current = !hold; setHold(!hold); }}>{hold ? 'Next action will wait' : 'Hold next action'}</button>
      <button type="button" className="btn-secondary" disabled={!waiting} onClick={() => release.current?.()}>Release held action</button>
    </div>
    <PayrollRun rows={rows} canEdit={canEdit} loadError={loadError} from="2026-10-12" to="2026-10-18" salaryPeriod="October 2026" commissionPeriod="October 2026" returnTo="/admin/payroll?from=2026-10-12&to=2026-10-18" selectedAdmin="" approveAction={(data) => run('approve', data)} paymentAction={(data) => run('payment', data)} />
    <details className="rounded-xl border bg-white p-3" open><summary>QA action log ({calls.length})</summary><pre data-payroll-fixture-log className="mt-3 overflow-auto text-xs">{JSON.stringify({ calls, rows: rows.map(({ id, name, ready, paid, approvalCount, totalCents }) => ({ id, name, ready, paid, approvalCount, totalCents })) }, null, 2)}</pre></details>
  </main>;
}

createRoot(document.getElementById('fixture-root')!).render(<Fixture />);

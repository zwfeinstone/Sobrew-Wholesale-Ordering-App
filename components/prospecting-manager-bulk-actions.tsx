'use client';

import { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import ProspectingBulkSelectionControls from '@/components/prospecting-bulk-selection-controls';

type Props = {
  formId: string;
  pageCount: number;
  totalCount: number;
  filterSummary: string;
  reps: { id: string; label: string }[];
  stages?: readonly { id: string; label: string }[];
  disabled?: boolean;
};

export default function ProspectingManagerBulkActions({ formId, pageCount, totalCount, filterSummary, reps, stages, disabled }: Props) {
  const [action, setAction] = useState('');
  const [review, setReview] = useState<{ count: number; scope: string; action: string } | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const { pending } = useFormStatus();

  function reviewChanges() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form || !form.reportValidity()) return;
    const data = new FormData(form);
    const allFiltered = data.get('scope') === 'all_filtered';
    const count = allFiltered ? totalCount : data.getAll('lead_id').length;
    if (!count) { setError('Select at least one lead before reviewing changes.'); return; }
    const rep = reps.find((item) => item.id === data.get('sales_profile_id'));
    const stage = stages?.find((item) => item.id === data.get('target_stage'));
    setError('');
    const leadLabel = count === 1 ? 'lead' : 'leads';
    setReview({ count, scope: allFiltered ? `All ${count.toLocaleString()} ${leadLabel} matching these filters, including other pages` : `${count.toLocaleString()} selected ${leadLabel} on this page`, action: action === 'unassign' ? 'Remove the assigned sales rep' : action === 'move_stage' ? `Move to ${stage?.label}` : `Assign to ${rep?.label}` });
    dialog.current?.showModal();
  }

  return <div className="space-y-3 rounded-lg border border-slate-200 bg-white/70 p-3">
    <ProspectingBulkSelectionControls allowAllFiltered={!stages} formId={formId} pageCount={pageCount} totalCount={totalCount} />
    {!stages ? <div hidden><input type="radio" name="scope" value="selected" defaultChecked /><input type="radio" name="scope" value="all_filtered" /></div> : null}
    <div className="grid gap-3 md:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1.5fr)_auto] md:items-end">
      <label className="text-sm font-semibold text-slate-700">Action
        <select className="input mt-2" name="bulk_action" value={action} onChange={(event) => { setAction(event.target.value); setReview(null); }} required disabled={disabled}>
          <option value="">Choose action</option><option value="assign">Assign to rep</option><option value="unassign">Unassign</option>{stages ? <option value="move_stage">Move to stage</option> : null}
        </select>
      </label>
      {action === 'move_stage' ? <label className="text-sm font-semibold text-slate-700">Stage<select className="input mt-2" name="target_stage" defaultValue="" required><option value="">Choose stage</option>{stages?.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label> : action === 'assign' ? <label className="text-sm font-semibold text-slate-700">Sales rep<select className="input mt-2" name="sales_profile_id" defaultValue="" required><option value="">Choose rep</option>{reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.label}</option>)}</select></label> : <p className="text-sm text-slate-600">{action === 'unassign' ? 'Selected leads will return to the unassigned pool.' : 'Choose what to change, then review the affected leads.'}</p>}
      <button className="btn-primary" disabled={disabled || pending} type="button" onClick={reviewChanges}>{pending ? 'Applying…' : 'Review changes'}</button>
    </div>
    {error ? <p role="alert" className="text-sm font-semibold text-rose-700">{error}</p> : null}
    <input type="hidden" name="reviewed_count" value={review?.count ?? ''} />
    <dialog ref={dialog} className="w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-slate-200 p-6 shadow-xl backdrop:bg-slate-950/40" aria-labelledby={`${formId}-review-title`} onCancel={() => setReview(null)}>
      <h3 id={`${formId}-review-title`} className="text-xl font-semibold text-slate-950">Review bulk change</h3>
      <p className="mt-3 font-semibold text-slate-800">{review?.action}</p><p className="mt-2 text-sm text-slate-700">{review?.scope}.</p>
      <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Filters: {filterSummary}</p>
      {action === 'move_stage' ? <p className="mt-3 text-sm text-slate-600">Moving to a parked stage also removes the assigned rep. HubSpot queue status follows the selected stage.</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button className="btn-secondary" type="button" disabled={pending} onClick={() => { dialog.current?.close(); setReview(null); }}>Back</button><button className="btn-primary" type="submit" disabled={!review || pending} onClick={() => dialog.current?.close()} aria-busy={pending}>{pending ? 'Applying…' : `Apply to ${review?.count.toLocaleString() ?? 0} ${review?.count === 1 ? 'lead' : 'leads'}`}</button></div>
    </dialog>
  </div>;
}

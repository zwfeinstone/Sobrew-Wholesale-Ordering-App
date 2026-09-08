'use client';

import { Trash2, X } from 'lucide-react';
import { useRef } from 'react';
import { moveOrderToTrash } from '@/app/admin/orders/actions';
import PendingSubmitButton from '@/components/pending-submit-button';

export function OrderTrashDialog({ orderId, customerName, className = 'btn-secondary', hasRecurring = false }: { orderId: string; customerName: string; className?: string; hasRecurring?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <>
    <button className={className} type="button" onClick={() => dialog.current?.showModal()}><Trash2 aria-hidden="true" />Move to recently deleted</button>
    <dialog ref={dialog} className="workspace-dialog" aria-label="Move order to recently deleted" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="dialog-heading"><h2>Remove this order?</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={() => dialog.current?.close()}><X aria-hidden="true" /></button></div>
      <p className="text-sm font-semibold">{customerName}</p><p className="mt-2 text-sm text-slate-600">Items, notes, and history will be kept in Recently deleted. Shipped inventory will be returned to stock.</p>
      {hasRecurring ? <p className="workspace-notice mt-3">Linked recurring schedules will pause. Restoring the order will not resume them automatically.</p> : null}
      <form action={moveOrderToTrash} className="mt-5 space-y-4">
        <input type="hidden" name="id" value={orderId} />
        <label className="workspace-field">Reason<textarea className="input" name="reason" maxLength={1000} required rows={3} placeholder="For example, duplicate order or customer cancellation" /></label>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => dialog.current?.close()}>Keep order</button><PendingSubmitButton className="btn-primary" label="Move to recently deleted" pendingLabel="Moving..." /></div>
      </form>
    </dialog>
  </>;
}

'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export default function ProspectingDialog({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} className={`max-h-[90dvh] w-[calc(100%_-_2rem)] rounded-xl border border-slate-200 bg-white p-5 shadow-2xl backdrop:bg-slate-950/40 ${wide ? 'max-w-2xl' : 'max-w-md'}`}><h2 id={titleId} className="mb-4 text-xl font-semibold text-slate-950">{title}</h2>{children}</dialog>;
}

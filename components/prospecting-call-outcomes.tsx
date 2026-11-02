'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CALL_RESULTS } from '@/lib/prospecting';

const QUICK_CALL_RESULTS = ['No answer', 'Left voicemail', 'Reached gatekeeper'] as const satisfies readonly (typeof CALL_RESULTS)[number][];
const MORE_CALL_RESULTS = CALL_RESULTS.filter((result) => !QUICK_CALL_RESULTS.some((quick) => quick === result));

export default function ProspectingCallOutcomes({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const overflowSelected = Boolean(value && !QUICK_CALL_RESULTS.some((quick) => quick === value));

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function select(value: string) {
    onChange(value);
    setOpen(false);
  }

  return <div
    ref={rootRef}
    className="relative min-w-0"
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
        moreRef.current?.focus();
      }
    }}
  >
    <span id={`${id}-label`} className="text-sm font-medium text-slate-700">Outcome</span>
    <div className="mt-1 flex min-h-10 flex-wrap items-center gap-1.5" role="group" aria-labelledby={`${id}-label`}>
      {QUICK_CALL_RESULTS.map((result) => <button
        key={result}
        type="button"
        data-press-lock="off"
        aria-pressed={value === result}
        className={`inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-medium disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 ${value === result ? 'border-teal-600 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50/50'}`}
        onClick={() => select(value === result ? '' : result)}
      >{value === result ? <Check size={14} aria-hidden="true" /> : null}{result}</button>)}
      <button
        ref={moreRef}
        type="button"
        data-press-lock="off"
        aria-expanded={open}
        aria-controls={`${id}-more`}
        aria-pressed={overflowSelected}
        aria-label={overflowSelected ? `More outcomes: ${value}` : undefined}
        className={`inline-flex min-h-10 max-w-full items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 ${overflowSelected ? 'border-teal-600 bg-teal-50 text-teal-900' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}
        onClick={() => setOpen((previous) => !previous)}
      >
        {overflowSelected ? <Check size={14} className="shrink-0" aria-hidden="true" /> : null}
        <span>{overflowSelected ? value : 'More'}</span>
        <ChevronDown size={14} className="shrink-0" aria-hidden="true" />
      </button>
    </div>
    {open ? <div id={`${id}-more`} role="group" aria-label="More call outcomes" className="absolute right-0 top-full z-20 mt-1 max-h-80 w-56 max-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
      {[...MORE_CALL_RESULTS, ''].map((result) => <button
        type="button"
        data-press-lock="off"
        key={result}
        aria-pressed={value === result}
        className={`flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm disabled:opacity-50 [@media(pointer:coarse)]:min-h-11 ${value === result ? 'bg-teal-50 font-medium text-teal-900' : 'text-slate-700 hover:bg-slate-50'} ${result ? '' : 'mt-1 border-t border-slate-200'}`}
        onClick={() => { select(result); moreRef.current?.focus(); }}
      >{result || 'No outcome recorded'}{value === result ? <Check size={14} className="shrink-0" aria-hidden="true" /> : null}</button>)}
    </div> : null}
  </div>;
}

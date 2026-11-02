'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { AccountingPeriodPreset } from '@/lib/accounting-periods';

type AccountingPeriodFilterProps = {
  activeView: string;
  end: string;
  presets: AccountingPeriodPreset[];
  reviewCategory?: string;
  reviewSearch?: string;
  start: string;
};

export default function AccountingPeriodFilter({
  activeView,
  end,
  presets,
  reviewCategory,
  reviewSearch,
  start,
}: AccountingPeriodFilterProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rangeStart, setRangeStart] = useState(start);
  const [rangeEnd, setRangeEnd] = useState(end);
  const [period, setPeriod] = useState(activeView === 'pnl'
    ? presets.find((preset) => preset.start === start && preset.end === end)?.id ?? 'custom'
    : '');
  const startInput = useRef<HTMLInputElement>(null);

  function selectPeriod(value: string) {
    if (value === 'custom') {
      setPeriod(value);
      startInput.current?.focus();
      return;
    }

    const preset = presets.find((candidate) => candidate.id === value);
    if (!preset) return;
    setPeriod(preset.id);
    setRangeStart(preset.start);
    setRangeEnd(preset.end);
    const params = new URLSearchParams({ view: 'pnl', start: preset.start, end: preset.end });
    startTransition(() => router.push(`/admin/accounting?${params.toString()}`, { scroll: false }));
  }

  return (
    <form action="/admin/accounting" aria-label="Accounting report period" aria-busy={isPending} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white/60 p-3">
      <input name="view" type="hidden" value={activeView} />
      {activeView === 'review' && reviewCategory ? <input name="category" type="hidden" value={reviewCategory} /> : null}
      {activeView === 'review' && reviewSearch ? <input name="q" type="hidden" value={reviewSearch} /> : null}
      <fieldset disabled={isPending} className="flex min-w-0 flex-wrap items-end gap-3 disabled:opacity-60">
        <label className="w-full min-w-0 space-y-1 text-sm font-medium text-slate-700 sm:w-auto sm:min-w-[160px] sm:flex-1">
          <span>P&amp;L period</span>
          <select className="input" value={period} onChange={(event) => selectPeriod(event.currentTarget.value)}>
            <option value="" disabled>Choose a period</option>
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            <option value="custom">Custom dates</option>
          </select>
        </label>
        <label className="w-full min-w-0 space-y-1 text-sm font-medium text-slate-700 sm:w-auto sm:min-w-[140px] sm:flex-1">
          <span>Start date</span>
          <input ref={startInput} className="input min-w-0" name="start" type="date" required value={rangeStart} max={rangeEnd} onChange={(event) => { setRangeStart(event.currentTarget.value); setPeriod('custom'); }} />
        </label>
        <label className="w-full min-w-0 space-y-1 text-sm font-medium text-slate-700 sm:w-auto sm:min-w-[140px] sm:flex-1">
          <span>End date</span>
          <input className="input min-w-0" name="end" type="date" required value={rangeEnd} min={rangeStart} onChange={(event) => { setRangeEnd(event.currentTarget.value); setPeriod('custom'); }} />
        </label>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          <button className="btn-primary w-full sm:w-auto" type="submit">Update</button>
          <button className="btn-secondary w-full sm:w-auto" formAction="/admin/accounting/pnl-statement" type="submit">Download PDF</button>
        </div>
      </fieldset>
      {isPending ? <p className="mt-2 text-sm text-slate-500" role="status">Loading P&amp;L…</p> : null}
    </form>
  );
}

'use client';

import { useEffect, useState } from 'react';

type ProspectingBulkSelectionControlsProps = {
  formId: string;
  pageCount: number;
  totalCount: number;
};

function leadCheckboxes(form: HTMLFormElement) {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[data-lead-select="true"]'));
}

function setScope(form: HTMLFormElement, scope: 'selected' | 'all_filtered') {
  const scopeInput = form.querySelector<HTMLInputElement>(`input[name="scope"][value="${scope}"]`);
  if (scopeInput) scopeInput.checked = true;
}

export default function ProspectingBulkSelectionControls({
  formId,
  pageCount,
  totalCount,
}: ProspectingBulkSelectionControlsProps) {
  const [selectedCount, setSelectedCount] = useState(0);
  const [scope, setScopeState] = useState<'selected' | 'all_filtered'>('selected');

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return undefined;

    const refresh = () => {
      setSelectedCount(leadCheckboxes(form).filter((checkbox) => checkbox.checked).length);
      const checkedScope = form.querySelector<HTMLInputElement>('input[name="scope"]:checked')?.value;
      setScopeState(checkedScope === 'all_filtered' ? 'all_filtered' : 'selected');
    };

    refresh();
    form.addEventListener('change', refresh);
    return () => form.removeEventListener('change', refresh);
  }, [formId]);

  function updatePageSelection(checked: boolean) {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    leadCheckboxes(form).forEach((checkbox) => {
      checkbox.checked = checked;
    });
    setScope(form, 'selected');
    setSelectedCount(checked ? pageCount : 0);
    setScopeState('selected');
  }

  function useAllFiltered() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    setScope(form, 'all_filtered');
    setScopeState('all_filtered');
  }

  return (
    <div className="space-y-3 rounded-lg bg-white/70 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => updatePageSelection(true)}>
          Select page ({pageCount.toLocaleString()})
        </button>
        <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => updatePageSelection(false)}>
          Clear page
        </button>
        <button className="btn-secondary w-full sm:w-auto" type="button" onClick={useAllFiltered}>
          Use all filtered ({totalCount.toLocaleString()})
        </button>
      </div>
      <p className="text-sm font-semibold text-slate-700">
        {scope === 'all_filtered'
          ? `All ${totalCount.toLocaleString()} filtered leads will be assigned.`
          : `${selectedCount.toLocaleString()} selected on this page.`}
      </p>
    </div>
  );
}

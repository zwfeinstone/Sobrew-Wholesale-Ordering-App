'use client';

import { useEffect, useState } from 'react';

type AccountingBulkSelectionControlsProps = {
  formId: string;
  pageCount: number;
};

function transactionCheckboxes(formId: string) {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-accounting-transaction-select="true"][form="${formId}"]`));
}

export default function AccountingBulkSelectionControls({
  formId,
  pageCount,
}: AccountingBulkSelectionControlsProps) {
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setSelectedCount(transactionCheckboxes(formId).filter((checkbox) => checkbox.checked).length);
    };

    refresh();
    document.addEventListener('change', refresh);
    return () => document.removeEventListener('change', refresh);
  }, [formId]);

  function updatePageSelection(checked: boolean) {
    transactionCheckboxes(formId).forEach((checkbox) => {
      checkbox.checked = checked;
    });
    setSelectedCount(checked ? pageCount : 0);
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => updatePageSelection(true)}>
        Select page ({pageCount.toLocaleString()})
      </button>
      <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => updatePageSelection(false)}>
        Clear page
      </button>
      <p className="text-sm font-semibold text-slate-700">{selectedCount.toLocaleString()} selected</p>
    </div>
  );
}

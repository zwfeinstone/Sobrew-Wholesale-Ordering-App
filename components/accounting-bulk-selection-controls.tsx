'use client';

import { useEffect, useState } from 'react';

type AccountingBulkSelectionControlsProps = {
  formId: string;
  matchingCount: number;
  pageCount: number;
};

function transactionCheckboxes(formId: string) {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-accounting-transaction-select="true"][form="${formId}"]`));
}

export default function AccountingBulkSelectionControls({
  formId,
  matchingCount,
  pageCount,
}: AccountingBulkSelectionControlsProps) {
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);

  useEffect(() => {
    const refresh = (event?: Event) => {
      const target = event?.target;
      if (target instanceof HTMLInputElement && target.dataset.accountingTransactionSelect === 'true') {
        setAllMatchingSelected(false);
      }
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
    setAllMatchingSelected(false);
  }

  function selectAllMatching() {
    transactionCheckboxes(formId).forEach((checkbox) => {
      checkbox.checked = true;
    });
    setSelectedCount(pageCount);
    setAllMatchingSelected(true);
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <input name="select_all_matching" type="hidden" value={allMatchingSelected ? 'true' : 'false'} />
      <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => updatePageSelection(true)}>
        Select page ({pageCount.toLocaleString()})
      </button>
      {matchingCount > pageCount ? (
        <button className="btn-secondary w-full sm:w-auto" type="button" onClick={selectAllMatching}>
          Select all matching ({matchingCount.toLocaleString()})
        </button>
      ) : null}
      <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => updatePageSelection(false)}>
        Clear page
      </button>
      <p className="text-sm font-semibold text-slate-700">
        {allMatchingSelected
          ? `All ${matchingCount.toLocaleString()} matching selected`
          : `${selectedCount.toLocaleString()} selected`}
      </p>
    </div>
  );
}

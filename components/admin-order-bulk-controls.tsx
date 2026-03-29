'use client';

export function AdminOrderBulkControls() {
  const setCheckedState = (checked: boolean) => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[data-archivable-order-checkbox]');
    checkboxes.forEach((checkbox) => {
      if (!checkbox.disabled) checkbox.checked = checked;
    });
  };

  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
      <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => setCheckedState(true)}>
        Select all archivable
      </button>
      <button className="btn-secondary w-full sm:w-auto" type="button" onClick={() => setCheckedState(false)}>
        Clear selection
      </button>
    </div>
  );
}

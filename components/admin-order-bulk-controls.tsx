'use client';

export function AdminOrderBulkControls() {
  const setCheckedState = (checked: boolean) => {
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[data-archivable-order-checkbox]');
    checkboxes.forEach((checkbox) => {
      if (!checkbox.disabled) checkbox.checked = checked;
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn-secondary" type="button" onClick={() => setCheckedState(true)}>
        Select all archivable
      </button>
      <button className="btn-secondary" type="button" onClick={() => setCheckedState(false)}>
        Clear selection
      </button>
    </div>
  );
}

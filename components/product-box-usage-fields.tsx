'use client';

import { useRef, useState } from 'react';

export type ProductBoxInventoryOption = {
  id: string;
  label: string;
};

export type ProductBoxRequiredLine = {
  id: string;
  label: string;
};

type ProductBoxUsageRow = {
  id: string;
};

function makeRowId(index: number) {
  return `box-row-${index}`;
}

export function ProductBoxUsageFields({
  boxItems,
  recipeBoxCoveredLabels = [],
  requiredLines,
}: {
  boxItems: ProductBoxInventoryOption[];
  recipeBoxCoveredLabels?: string[];
  requiredLines: ProductBoxRequiredLine[];
}) {
  const [rows, setRows] = useState<ProductBoxUsageRow[]>(() => [{ id: makeRowId(0) }]);
  const nextRowIndex = useRef(1);

  function addRow() {
    const rowIndex = nextRowIndex.current;
    nextRowIndex.current += 1;
    setRows((currentRows) => [...currentRows, { id: makeRowId(rowIndex) }]);
  }

  function removeRow(rowId: string) {
    setRows((currentRows) => {
      if (currentRows.length <= 1) return currentRows;
      return currentRows.filter((candidate) => candidate.id !== rowId);
    });
  }

  if (!requiredLines.length) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-950">Applies to</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {requiredLines.map((line) => (
            <li key={line.id}>{line.label}</li>
          ))}
        </ul>
      </div>

      {recipeBoxCoveredLabels.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm leading-6 text-amber-900">
          Enter only the boxes used for the bag items listed above. These items already include boxes in their recipes: {recipeBoxCoveredLabels.join(', ')}.
        </div>
      ) : null}

      {!boxItems.length ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800">
          No active box materials are available. Carrier shipments still need an active box material; local deliveries can be shipped with 0 boxes after confirmation.
        </div>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/70 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-slate-950">Total product boxes for these bag items</p>
          <button
            className="btn-secondary w-full sm:w-auto"
            disabled={!boxItems.length}
            onClick={addRow}
            type="button"
          >
            Add box size
          </button>
        </div>
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Box size
                <select className="input" disabled={!boxItems.length} name="box_inventory_item_id">
                  <option value="">Select box</option>
                  {boxItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Total quantity
                <input
                  className="input"
                  disabled={!boxItems.length}
                  min="0"
                  name="box_quantity"
                  placeholder="0"
                  step="0.0001"
                  type="number"
                />
              </label>
              <button
                className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={rows.length <= 1}
                onClick={() => removeRow(row.id)}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

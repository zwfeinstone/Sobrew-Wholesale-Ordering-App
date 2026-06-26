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
  orderItemId: string;
};

function makeRowId(orderItemId: string, index: number) {
  return `${orderItemId}-${index}`;
}

export function ProductBoxUsageFields({
  boxItems,
  requiredLines,
}: {
  boxItems: ProductBoxInventoryOption[];
  requiredLines: ProductBoxRequiredLine[];
}) {
  const [rows, setRows] = useState<ProductBoxUsageRow[]>(() =>
    requiredLines.map((line, index) => ({ id: makeRowId(line.id, index), orderItemId: line.id }))
  );
  const nextRowIndex = useRef(requiredLines.length);
  const listedItems = requiredLines.map((line) => line.label).join(', ');

  function addRow(orderItemId: string) {
    const rowIndex = nextRowIndex.current;
    nextRowIndex.current += 1;
    setRows((currentRows) => [
      ...currentRows,
      { id: makeRowId(orderItemId, rowIndex), orderItemId },
    ]);
  }

  function removeRow(rowId: string) {
    setRows((currentRows) => {
      const row = currentRows.find((candidate) => candidate.id === rowId);
      if (!row) return currentRows;
      const lineRows = currentRows.filter((candidate) => candidate.orderItemId === row.orderItemId);
      if (lineRows.length <= 1) return currentRows;
      return currentRows.filter((candidate) => candidate.id !== rowId);
    });
  }

  if (!requiredLines.length) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm leading-6 text-amber-900">
        Product box counts only apply to the listed items: {listedItems}. Enter the shipping box sizes used for those items only. Do not include recipe boxes or boxes for other items on this order; those are already handled through product recipes when applicable.
      </div>

      {!boxItems.length ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800">
          No active box materials are available. Receive or create a box material before shipping this order.
        </div>
      ) : null}

      {requiredLines.map((line) => {
        const lineRows = rows.filter((row) => row.orderItemId === line.id);
        return (
          <div key={line.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white/70 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold text-slate-950">{line.label}</p>
              <button
                className="btn-secondary w-full sm:w-auto"
                disabled={!boxItems.length}
                onClick={() => addRow(line.id)}
                type="button"
              >
                Add box size
              </button>
            </div>
            <div className="space-y-3">
              {lineRows.map((row) => (
                <div key={row.id} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
                  <input name="box_order_item_id" type="hidden" value={line.id} />
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Box size
                    <select className="input" disabled={!boxItems.length} name="box_inventory_item_id" required>
                      <option value="">Select box</option>
                      {boxItems.map((item) => (
                        <option key={item.id} value={item.id}>{item.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm font-medium text-slate-700">
                    Quantity used
                    <input
                      className="input"
                      disabled={!boxItems.length}
                      min="0.0001"
                      name="box_quantity"
                      required
                      step="0.0001"
                      type="number"
                    />
                  </label>
                  <button
                    className="rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={lineRows.length <= 1}
                    onClick={() => removeRow(row.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

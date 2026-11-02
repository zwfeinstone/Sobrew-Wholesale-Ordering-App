'use client';

import { useState } from 'react';
import PendingSubmitButton from '@/components/pending-submit-button';
import { inventoryItemTypeLabel, type InventoryUnit } from '@/lib/inventory';
import { calculateReceiptCosts } from '@/lib/inventory-receiving';
import { usd } from '@/lib/utils';

type ReceivableItem = {
  id: string;
  name: string;
  sku: string | null;
  item_type: string;
  base_unit: InventoryUnit;
};

const unitCostFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export default function InventoryReceiptForm({
  action,
  items,
  receivedAt,
}: {
  action: (formData: FormData) => Promise<void>;
  items: ReceivableItem[];
  receivedAt: string;
}) {
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [totalItemCost, setTotalItemCost] = useState('');
  const [freightCost, setFreightCost] = useState('');
  const [miscellaneousCost, setMiscellaneousCost] = useState('');
  const selectedItem = items.find((item) => item.id === itemId);
  const unit = selectedItem?.base_unit;
  const isWeight = unit === 'lb' || unit === 'oz';
  const quantityLabel = unit ? `${isWeight ? 'Weight' : 'Quantity'} received (${unit})` : 'Weight or quantity received';
  const costLabel = unit ? `Cost per ${unit === 'each' ? 'item' : unit}` : 'Cost per unit';
  const costs = calculateReceiptCosts({ quantity, totalItemCost, freightCost, miscellaneousCost });

  return (
    <form action={action} className="card space-y-4">
      <div>
        <span className="eyebrow">Receive</span>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Receive purchased inventory</h2>
        <p className="mt-2 text-sm text-slate-500">Enter the shipment cost and weight or quantity. We calculate the cost per unit and add the lot to stock.</p>
      </div>
      <label className="block space-y-2 text-sm font-medium text-slate-700">
        <span>Item received</span>
        <select className="input" name="inventory_item_id" required value={itemId} onChange={(event) => setItemId(event.target.value)}>
          <option value="" disabled>Select inventory item</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}{item.sku ? ` (${item.sku})` : ''} - {inventoryItemTypeLabel(item.item_type)} - {item.base_unit}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <input className="input" name="supplier_reference" aria-label="Supplier batch or PO reference" placeholder="Supplier batch or PO reference" />
        <input className="input" name="received_at" aria-label="Date received" type="date" defaultValue={receivedAt} />
      </div>
      <input className="input" name="supplier" aria-label="Supplier" placeholder="Supplier" />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>{quantityLabel}</span>
          <input className="input" name="quantity" required min="0.0001" step="0.0001" type="number" placeholder="0" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
        </label>
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Shipment items total ($)</span>
          <input className="input" name="total_item_cost" aria-describedby="receipt-item-cost-help" required min="0" step="0.01" type="number" placeholder="0.00" value={totalItemCost} onChange={(event) => setTotalItemCost(event.target.value)} />
        </label>
      </div>
      <p id="receipt-item-cost-help" className="text-xs text-slate-500">Enter the total cost of the selected item, before freight and miscellaneous costs. If your total already includes those costs, leave the fields below blank.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Freight / shipping ($)</span>
          <input className="input" name="freight_cost" min="0" step="0.01" type="number" placeholder="0.00 (optional)" value={freightCost} onChange={(event) => setFreightCost(event.target.value)} />
        </label>
        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Miscellaneous ($)</span>
          <input className="input" name="other_cost" min="0" step="0.01" type="number" placeholder="0.00 (optional)" value={miscellaneousCost} onChange={(event) => setMiscellaneousCost(event.target.value)} />
        </label>
      </div>
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4" role="status" aria-live="polite" aria-atomic="true">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-slate-600">Total landed cost</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{costs ? usd(costs.totalLandedCostCents) : '—'}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">{costLabel} · includes all costs</dt>
            <dd className="mt-1 text-lg font-semibold text-emerald-800">{costs && unit ? `${unitCostFormat.format(costs.landedUnitCostCents / 100)} / ${unit}` : '—'}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-600">
          {costs && unit
            ? `(Items total + freight + miscellaneous) ÷ ${quantity} ${unit}`
            : 'Choose an item and enter its total cost and weight or quantity to see the cost per unit.'}
        </p>
      </div>
      <textarea className="input min-h-20" name="notes" aria-label="Receipt notes" placeholder="Receipt notes" />
      <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Receive lot" pendingLabel="Receiving..." disabled={!selectedItem || !costs} />
    </form>
  );
}

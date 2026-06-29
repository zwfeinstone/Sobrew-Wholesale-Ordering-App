import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  INVENTORY_ADJUSTMENT_TYPES,
  NON_STOCK_EXPENSE_TYPES,
  centsFromDollars,
  formatInventoryQuantity,
  inventoryItemTypeLabel,
  isInventoryAdjustmentType,
  isInventoryItemType,
  isNonStockExpenseType,
  normalizeInventoryNumber,
  type InventoryUnit,
} from '@/lib/inventory';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

type InventoryItemRow = {
  id: string;
  name: string;
  sku: string | null;
  item_type: string;
  base_unit: InventoryUnit;
  active: boolean;
};

function receivingHref(toast: string) {
  return `/admin/receiving?toast=${toast}`;
}

function itemDisplayName(item: InventoryItemRow | undefined | null) {
  if (!item) return 'Unknown item';
  return item.sku ? `${item.name} (${item.sku})` : item.name;
}

function parsePositiveNumber(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function createInventoryItem(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(receivingHref('admin_write_denied'), 'receiving');

  const supabase = await createClient();
  const itemType = String(formData.get('item_type') ?? '');
  const name = String(formData.get('name') ?? '').trim();
  const sku = String(formData.get('sku') ?? '').trim();
  const baseUnit = itemType === 'raw_coffee' ? 'lb' : 'each';

  if (!name || !isInventoryItemType(itemType) || itemType === 'finished_good') {
    redirect(receivingHref('item_error'));
  }

  const { error } = await supabase.from('inventory_items').insert({
    name,
    sku: sku || null,
    description: String(formData.get('description') ?? '').trim() || null,
    item_type: itemType,
    base_unit: baseUnit,
    active: true,
  });

  redirect(receivingHref(error ? 'item_error' : 'item_created'));
}

async function receiveInventory(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(receivingHref('admin_write_denied'), 'receiving');

  const supabase = await createClient();
  const itemId = String(formData.get('inventory_item_id') ?? '');
  const quantity = parsePositiveNumber(formData.get('quantity'));
  const itemUnitCostCents = centsFromDollars(String(formData.get('unit_cost') ?? '0'));
  const freightCents = centsFromDollars(String(formData.get('freight_cost') ?? '0'));
  const otherCostCents = centsFromDollars(String(formData.get('other_cost') ?? '0'));

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id,base_unit,item_type')
    .eq('id', itemId)
    .single();

  if (!item || item.item_type === 'finished_good' || quantity <= 0) redirect(receivingHref('receipt_error'));

  const landedUnitCostCents = ((quantity * itemUnitCostCents) + freightCents + otherCostCents) / quantity;
  const receivedAt = String(formData.get('received_at') ?? '') || new Date().toISOString();
  const lotCode = String(formData.get('lot_code') ?? '').trim() || `LOT-${new Date().toISOString().slice(0, 10)}`;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const { data: lot, error: lotError } = await supabase
    .from('inventory_lots')
    .insert({
      inventory_item_id: itemId,
      lot_code: lotCode,
      source_type: 'purchase',
      quantity_received: quantity,
      quantity_remaining: quantity,
      unit_cost_cents: landedUnitCostCents,
      received_at: receivedAt,
      notes,
    })
    .select('id')
    .single();

  if (lotError || !lot) redirect(receivingHref('receipt_error'));

  const { data: receipt, error: receiptError } = await supabase
    .from('inventory_receipts')
    .insert({
      inventory_item_id: itemId,
      lot_id: lot.id,
      supplier: String(formData.get('supplier') ?? '').trim() || null,
      quantity,
      unit: item.base_unit,
      item_unit_cost_cents: itemUnitCostCents,
      freight_cents: freightCents,
      other_cost_cents: otherCostCents,
      landed_unit_cost_cents: landedUnitCostCents,
      received_at: receivedAt,
      notes,
    })
    .select('id')
    .single();

  if (receiptError || !receipt) redirect(receivingHref('receipt_error'));

  const { error: movementError } = await supabase.from('inventory_movements').insert({
    inventory_item_id: itemId,
    lot_id: lot.id,
    receipt_id: receipt.id,
    movement_type: 'receipt',
    quantity_change: quantity,
    unit: item.base_unit,
    unit_cost_cents: landedUnitCostCents,
    notes: 'Inventory received',
  });

  redirect(receivingHref(movementError ? 'receipt_error' : 'receipt_created'));
}

async function adjustInventory(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(receivingHref('admin_write_denied'), 'receiving');

  const supabase = await createClient();
  const itemId = String(formData.get('inventory_item_id') ?? '');
  const adjustmentType = String(formData.get('adjustment_type') ?? '');
  const direction = String(formData.get('direction') ?? 'add');
  const quantity = parsePositiveNumber(formData.get('quantity'));
  const unitCostCents = centsFromDollars(String(formData.get('unit_cost') ?? '0'));
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id,base_unit,item_type')
    .eq('id', itemId)
    .single();

  if (!item || item.item_type === 'finished_good' || quantity <= 0 || !isInventoryAdjustmentType(adjustmentType)) {
    redirect(receivingHref('adjustment_error'));
  }

  const signedQuantity = direction === 'subtract' ? -quantity : quantity;
  let lotId: string | null = null;

  if (signedQuantity > 0) {
    const { data: lot, error: lotError } = await supabase
      .from('inventory_lots')
      .insert({
        inventory_item_id: itemId,
        lot_code: `ADJ-${new Date().toISOString().slice(0, 10)}`,
        source_type: 'adjustment',
        quantity_received: signedQuantity,
        quantity_remaining: signedQuantity,
        unit_cost_cents: unitCostCents,
        received_at: new Date().toISOString(),
        notes,
      })
      .select('id')
      .single();
    if (lotError || !lot) redirect(receivingHref('adjustment_error'));
    lotId = lot.id;
  } else {
    const { data: lots } = await supabase
      .from('inventory_lots')
      .select('id,quantity_remaining')
      .eq('inventory_item_id', itemId)
      .gt('quantity_remaining', 0)
      .order('received_at', { ascending: true });
    const available = (lots ?? []).reduce((sum: number, lot: any) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    let remaining = Math.abs(signedQuantity);
    if (available < remaining) redirect(receivingHref('adjustment_error'));
    for (const lot of lots ?? []) {
      if (remaining <= 0) break;
      const take = Math.min(normalizeInventoryNumber(lot.quantity_remaining), remaining);
      await supabase.from('inventory_lots').update({ quantity_remaining: normalizeInventoryNumber(lot.quantity_remaining) - take }).eq('id', lot.id);
      lotId = lot.id;
      remaining -= take;
    }
  }

  const { data: adjustment, error: adjustmentError } = await supabase
    .from('inventory_adjustments')
    .insert({
      inventory_item_id: itemId,
      lot_id: lotId,
      adjustment_type: adjustmentType,
      quantity_change: signedQuantity,
      unit: item.base_unit,
      unit_cost_cents: unitCostCents,
      notes,
      adjusted_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (adjustmentError || !adjustment) redirect(receivingHref('adjustment_error'));

  const { error: movementError } = await supabase.from('inventory_movements').insert({
    inventory_item_id: itemId,
    lot_id: lotId,
    movement_type: 'adjustment',
    quantity_change: signedQuantity,
    unit: item.base_unit,
    unit_cost_cents: unitCostCents,
    notes: notes || adjustmentType,
  });

  redirect(receivingHref(movementError ? 'adjustment_error' : 'adjustment_saved'));
}

async function recordExpense(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(receivingHref('admin_write_denied'), 'receiving');

  const supabase = await createClient();
  const expenseType = String(formData.get('expense_type') ?? '');
  const amountCents = centsFromDollars(String(formData.get('amount') ?? '0'));

  if (!isNonStockExpenseType(expenseType) || amountCents <= 0) {
    redirect(receivingHref('expense_error'));
  }

  const { error } = await supabase.from('non_inventory_expenses').insert({
    expense_type: expenseType,
    vendor: String(formData.get('vendor') ?? '').trim() || null,
    amount_cents: amountCents,
    spent_at: String(formData.get('spent_at') ?? '') || new Date().toISOString(),
    notes: String(formData.get('notes') ?? '').trim() || null,
  });

  redirect(receivingHref(error ? 'expense_error' : 'expense_saved'));
}

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const [{ data: items }, { data: receipts }, { data: expenses }] = await Promise.all([
    supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,active').neq('item_type', 'finished_good').eq('active', true).order('name', { ascending: true }),
    supabase.from('inventory_receipts').select('id,inventory_item_id,quantity,unit,landed_unit_cost_cents,received_at,supplier').order('received_at', { ascending: false }).limit(8),
    supabase.from('non_inventory_expenses').select('id,expense_type,vendor,amount_cents,spent_at').order('spent_at', { ascending: false }).limit(8),
  ]);
  const receivableItems = (items ?? []) as InventoryItemRow[];
  const itemById = new Map(receivableItems.map((item) => [item.id, item]));

  return (
    <div className="space-y-6">
      {toast === 'item_created' ? <StatusToast message="Inventory item created." tone="success" /> : null}
      {toast === 'item_error' ? <StatusToast message="Unable to create inventory item." tone="error" /> : null}
      {toast === 'receipt_created' ? <StatusToast message="Inventory received and added to stock." tone="success" /> : null}
      {toast === 'receipt_error' ? <StatusToast message="Unable to receive inventory." tone="error" /> : null}
      {toast === 'adjustment_saved' ? <StatusToast message="Inventory adjustment saved." tone="success" /> : null}
      {toast === 'adjustment_error' ? <StatusToast message="Unable to save inventory adjustment." tone="error" /> : null}
      {toast === 'expense_saved' ? <StatusToast message="Non-inventory expense recorded." tone="success" /> : null}
      {toast === 'expense_error' ? <StatusToast message="Unable to record that expense." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only superadmins can change admin data." tone="error" /> : null}

      <section className="panel">
        <span className="eyebrow">Receiving</span>
        <h1 className="page-title mt-4">Receive inputs and record supply expenses</h1>
        <p className="page-subtitle mt-3">Create raw coffee or materials/supplies, add stock from purchases or starting counts, and record tape or label spend without tracking those as inventory.</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <form action={createInventoryItem} className="card space-y-4">
          <div>
            <span className="eyebrow">Create Item</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Raw coffee or materials</h2>
            <p className="mt-2 text-sm text-slate-500">Coffee is stocked in pounds. Materials and supplies are stocked in units.</p>
          </div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Type
            <select className="input" name="item_type" required defaultValue="material_supply">
              <option value="raw_coffee">Raw Coffee</option>
              <option value="material_supply">Materials & Supplies</option>
            </select>
          </label>
          <input className="input" name="name" required placeholder="Item name" />
          <input className="input" name="sku" placeholder="SKU or internal code" />
          <textarea className="input min-h-24" name="description" placeholder="Supplier details, size, roast, or notes" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save inventory item" pendingLabel="Saving..." />
        </form>

        <form action={receiveInventory} className="card space-y-4">
          <div>
            <span className="eyebrow">Receive</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Receive purchased inventory</h2>
            <p className="mt-2 text-sm text-slate-500">Creates a lot, updates stock, and calculates landed unit cost.</p>
          </div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Item received
            <select className="input" name="inventory_item_id" required defaultValue="">
              <option value="" disabled>Select raw coffee or material</option>
              {receivableItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)} - {item.base_unit}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" name="lot_code" placeholder="Lot or batch code" />
            <input className="input" name="received_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <input className="input" name="supplier" placeholder="Supplier" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" name="quantity" required min="0.0001" step="0.0001" type="number" placeholder="Quantity received" />
            <input className="input" name="unit_cost" required min="0" step="0.0001" type="number" placeholder="Item cost per unit" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" name="freight_cost" min="0" step="0.01" type="number" placeholder="Freight/shipping total" />
            <input className="input" name="other_cost" min="0" step="0.01" type="number" placeholder="Other landed cost" />
          </div>
          <textarea className="input min-h-20" name="notes" placeholder="Receipt notes" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Receive lot" pendingLabel="Receiving..." />
        </form>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <form action={adjustInventory} className="card space-y-4">
          <div>
            <span className="eyebrow">Adjust</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Starting counts and corrections</h2>
            <p className="mt-2 text-sm text-slate-500">Use this for go-live counts, damaged inventory, samples, lost items, or count corrections.</p>
          </div>
          <select className="input" name="inventory_item_id" required defaultValue="">
            <option value="" disabled>Select item</option>
            {receivableItems.map((item) => <option key={item.id} value={item.id}>{itemDisplayName(item)} - {item.base_unit}</option>)}
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <select className="input" name="adjustment_type" defaultValue="starting_count">
              {INVENTORY_ADJUSTMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
            </select>
            <select className="input" name="direction" defaultValue="add">
              <option value="add">Add stock</option>
              <option value="subtract">Subtract stock</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" name="quantity" required min="0.0001" step="0.0001" type="number" placeholder="Quantity" />
            <input className="input" name="unit_cost" min="0" step="0.0001" type="number" placeholder="Unit cost for added stock" />
          </div>
          <textarea className="input min-h-20" name="notes" placeholder="Adjustment reason" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save adjustment" pendingLabel="Saving..." />
        </form>

        <form action={recordExpense} className="card space-y-4">
          <div>
            <span className="eyebrow">Expenses</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Non-inventory expenses</h2>
            <p className="mt-2 text-sm text-slate-500">Tape, shipping labels, and branding labels are recorded as spend without creating inventory stock.</p>
          </div>
          <select className="input" name="expense_type" defaultValue="tape">
            {NON_STOCK_EXPENSE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <input className="input" name="vendor" placeholder="Vendor" />
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" name="amount" required min="0.01" step="0.01" type="number" placeholder="Amount spent" />
            <input className="input" name="spent_at" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <textarea className="input min-h-20" name="notes" placeholder="Expense notes" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Record expense" pendingLabel="Recording..." />
        </form>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Recent Receipts</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Inventory received</h2>
          </div>
          <div className="space-y-3">
            {(receipts ?? []).map((receipt: any) => {
              const item = itemById.get(receipt.inventory_item_id);
              return (
                <div key={receipt.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                  <p className="font-semibold text-slate-950">{itemDisplayName(item)}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {formatInventoryQuantity(receipt.quantity, receipt.unit)} - {usd(Math.round(normalizeInventoryNumber(receipt.landed_unit_cost_cents)))} / {receipt.unit}
                  </p>
                </div>
              );
            })}
            {!receipts?.length ? <p className="text-sm text-slate-500">No receipts yet.</p> : null}
          </div>
        </div>

        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Recent Expenses</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Non-stock spend</h2>
          </div>
          <div className="space-y-3">
            {(expenses ?? []).map((expense: any) => (
              <div key={expense.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                <p className="font-semibold text-slate-950">{NON_STOCK_EXPENSE_TYPES.find((type) => type.value === expense.expense_type)?.label ?? 'Expense'}</p>
                <p className="mt-1 text-sm text-slate-500">{expense.vendor || 'No vendor'} - {usd(Math.round(normalizeInventoryNumber(expense.amount_cents)))}</p>
              </div>
            ))}
            {!expenses?.length ? <p className="text-sm text-slate-500">No non-inventory expenses yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

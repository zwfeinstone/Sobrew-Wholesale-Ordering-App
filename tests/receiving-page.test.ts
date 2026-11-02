import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; payload: Row }>,
  queryErrors: [] as Array<{ table: string; columns?: string; error: { code: string; message: string } }>,
  authorize: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/admin-permissions', () => ({
  requireAdminSectionView: async () => ({ isOwner: true }),
  requireAdminSectionEdit: vi.fn(),
}));
vi.mock('@/lib/admin-write-access', () => ({ requireAdminWriteAccess: state.authorize }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => state.createClient() }));
vi.mock('@/components/status-toast', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

class Query {
  private filters: Array<[string, unknown]> = [];
  private payload?: Row;
  private columns = '';
  private one = false;
  constructor(private table: string) {}
  select(columns: string) { this.columns = columns; return this; }
  eq(field: string, value: unknown) { this.filters.push([field, value]); return this; }
  order() { return this; }
  limit() { return this; }
  insert(payload: Row) { this.payload = payload; return this; }
  single() { this.one = true; return this; }
  result() {
    if (!this.payload) {
      const injectedError = state.queryErrors.find(({ table, columns }) => table === this.table && (!columns || columns === this.columns));
      if (injectedError) return { data: null, error: injectedError.error };
      // The production schema also connects these tables through packaging
      // substitutions, so bare embedding no longer identifies one relationship.
      if (this.table === 'inventory_items' && /(?:^|,)products\(/.test(this.columns)) {
        return { data: null, error: { code: 'PGRST201', message: 'More than one relationship was found between inventory_items and products.' } };
      }
    }
    const table = state.tables[this.table] ??= [];
    let rows = table.filter((row) => this.filters.every(([field, value]) => row[field] === value));
    if (this.payload) {
      state.writes.push({ table: this.table, payload: this.payload });
      const row = { id: `${this.table}-${table.length + 1}`, ...this.payload };
      table.push(row);
      rows = [row];
    }
    return { data: this.one ? rows[0] ?? null : rows, error: null };
  }
  then(resolve: (result: ReturnType<Query['result']>) => unknown) { return Promise.resolve(this.result()).then(resolve); }
}
const database = { from: (table: string) => new Query(table) };

import ReceivingPage from '@/app/admin/receiving/page';

type Action = (formData: FormData) => Promise<void>;
type ElementProps = { action?: Action; items?: Row[]; children?: ReactNode; role?: string; name?: string; value?: string };
function findElement(node: ReactNode, predicate: (element: ReactElement<ElementProps>) => boolean): ReactElement<ElementProps> | undefined {
  if (Array.isArray(node)) return node.map((child) => findElement(child, predicate)).find(Boolean);
  if (!isValidElement<ElementProps>(node)) return;
  if (predicate(node)) return node;
  return findElement(node.props.children, predicate);
}

function actionElement(node: ReactNode, actionName: string) {
  return findElement(node, (element) => typeof element.props.action === 'function' && element.props.action.name === actionName);
}

function textContent(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textContent).join(' ');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (isValidElement<ElementProps>(node)) return textContent(node.props.children);
  return '';
}

async function action() {
  const result = actionElement(await ReceivingPage({ searchParams: Promise.resolve({}) }), 'receiveInventory')?.props.action;
  expect(result).toBeTypeOf('function');
  state.createClient.mockClear();
  return result!;
}

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  Object.entries({
    inventory_item_id: 'coffee', quantity: '12.5', total_item_cost: '100.00',
    freight_cost: '20.00', other_cost: '5.00', supplier: 'Coffee supplier',
    supplier_reference: 'PO-123', received_at: '2026-10-01', notes: 'Checked on arrival',
    ...overrides,
  }).forEach(([key, value]) => data.set(key, value));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.tables = {
    inventory_items: [
      { id: 'coffee', name: 'House coffee', sku: 'RAW-HOUSE', item_type: 'raw_coffee', base_unit: 'lb', active: true },
      { id: 'bags', name: 'Coffee bags', sku: 'BAG', item_type: 'material_supply', base_unit: 'each', active: true },
      { id: 'cups', name: 'Cups', sku: 'CUPS', item_type: 'finished_good', base_unit: 'each', active: true, products: { receivable_finished_good: true } },
      { id: 'produced', name: 'Packaged coffee', item_type: 'finished_good', base_unit: 'each', active: true, products: { receivable_finished_good: false } },
      { id: 'inactive', name: 'Discontinued coffee', item_type: 'raw_coffee', base_unit: 'lb', active: false },
    ],
  };
  state.writes = [];
  state.queryErrors = [];
  state.authorize.mockResolvedValue({});
  state.createClient.mockResolvedValue(database);
});

describe('receiving inventory loading', () => {
  it('lists active coffee, materials and purchased finished goods when multiple product relationships exist', async () => {
    const page = await ReceivingPage({ searchParams: Promise.resolve({}) });
    const receipt = actionElement(page, 'receiveInventory');
    expect(receipt?.props.items?.map((item) => item.id)).toEqual(['coffee', 'bags', 'cups']);

    const adjustment = actionElement(page, 'adjustInventory');
    expect(adjustment).toBeDefined();
    for (const id of ['coffee', 'bags', 'cups']) {
      expect(findElement(adjustment, (element) => element.type === 'option' && element.props.value === id)).toBeDefined();
    }
    for (const id of ['produced', 'inactive']) {
      expect(findElement(adjustment, (element) => element.type === 'option' && element.props.value === id)).toBeUndefined();
    }
    expect(findElement(page, (element) => element.props.role === 'alert')).toBeUndefined();
  });

  it('shows a readable loading error instead of empty receiving and adjustment forms', async () => {
    state.queryErrors.push({ table: 'inventory_items', error: { code: '08006', message: 'Database connection failed' } });
    const page = await ReceivingPage({ searchParams: Promise.resolve({}) });
    const alert = findElement(page, (element) => element.props.role === 'alert');
    expect(textContent(alert)).toMatch(/unable to load inventory/i);
    expect(textContent(alert)).toMatch(/refresh|try again/i);
    expect(actionElement(page, 'receiveInventory')).toBeUndefined();
    expect(actionElement(page, 'adjustInventory')).toBeUndefined();
    expect(actionElement(page, 'createInventoryItem')).toBeDefined();
    expect(actionElement(page, 'recordExpense')).toBeDefined();
    expect(state.writes).toEqual([]);
  });

  it('can add a count adjustment using the direct product relationship', async () => {
    const page = await ReceivingPage({ searchParams: Promise.resolve({}) });
    const adjust = actionElement(page, 'adjustInventory')?.props.action;
    expect(adjust).toBeTypeOf('function');
    await expect(adjust!(form({ inventory_item_id: 'cups', adjustment_type: 'starting_count', direction: 'add', quantity: '10', unit_cost: '0.25' })))
      .rejects.toThrow('toast=adjustment_saved');
    expect(state.tables.inventory_adjustments).toEqual([expect.objectContaining({
      inventory_item_id: 'cups', quantity_change: 10, unit: 'each', unit_cost_cents: 25,
    })]);
    expect(state.tables.inventory_lots).toEqual([expect.objectContaining({
      inventory_item_id: 'cups', quantity_received: 10, quantity_remaining: 10, unit_cost_cents: 25,
    })]);
    expect(state.tables.inventory_movements).toEqual([expect.objectContaining({
      inventory_item_id: 'cups', movement_type: 'adjustment', quantity_change: 10, unit_cost_cents: 25,
    })]);
  });
});

describe('receiving shipment total server action', () => {
  it('derives per-pound costs from shipment totals and saves matching receipt, lot, and movement costs', async () => {
    const receive = await action();
    await expect(receive(form({ unit_cost: '99999', landed_unit_cost_cents: '1' })))
      .rejects.toThrow('REDIRECT /admin/receiving?toast=receipt_created');

    expect(state.authorize).toHaveBeenCalledWith('/admin/receiving?toast=admin_write_denied', 'receiving');
    expect(state.authorize.mock.invocationCallOrder[0]).toBeLessThan(state.createClient.mock.invocationCallOrder[0]);
    expect(state.tables.inventory_receipts).toEqual([expect.objectContaining({
      inventory_item_id: 'coffee', quantity: 12.5, unit: 'lb',
      item_unit_cost_cents: 800, freight_cents: 2000, other_cost_cents: 500, landed_unit_cost_cents: 1000,
      supplier: 'Coffee supplier', received_at: '2026-10-01',
    })]);
    const receipt = state.tables.inventory_receipts[0];
    expect(String(receipt.notes)).toContain('PO-123');
    expect(String(receipt.notes)).toContain('Checked on arrival');
    expect(state.tables.inventory_lots).toEqual([expect.objectContaining({
      id: receipt.lot_id, quantity_received: 12.5, quantity_remaining: 12.5, unit_cost_cents: 1000,
    })]);
    expect(state.tables.inventory_movements).toEqual([expect.objectContaining({
      receipt_id: receipt.id, lot_id: receipt.lot_id, movement_type: 'receipt',
      quantity_change: 12.5, unit: 'lb', unit_cost_cents: 1000,
    })]);
  });

  it('keeps fractional-cent item costs for count-based stock and treats empty extra costs as zero', async () => {
    const receive = await action();
    await expect(receive(form({ inventory_item_id: 'cups', quantity: '3', total_item_cost: '0.01', freight_cost: '', other_cost: '' })))
      .rejects.toThrow('toast=receipt_created');
    const receipt = state.tables.inventory_receipts[0];
    expect(receipt).toMatchObject({ quantity: 3, unit: 'each', freight_cents: 0, other_cost_cents: 0 });
    expect(receipt.item_unit_cost_cents).toBeCloseTo(1 / 3, 8);
    expect(receipt.landed_unit_cost_cents).toBeCloseTo(1 / 3, 8);
    expect(state.tables.inventory_lots[0].unit_cost_cents).toBeCloseTo(1 / 3, 8);
  });

  it('allows a zero item total while allocating freight and miscellaneous costs', async () => {
    const receive = await action();
    await expect(receive(form({ quantity: '10', total_item_cost: '0', freight_cost: '2.50', other_cost: '1.00' })))
      .rejects.toThrow('toast=receipt_created');
    expect(state.tables.inventory_receipts[0]).toMatchObject({ item_unit_cost_cents: 0, landed_unit_cost_cents: 35 });
  });

  it.each<Record<string, string>>([
    { quantity: '' }, { quantity: '0' }, { quantity: '-1' }, { quantity: '12junk' }, { quantity: 'Infinity' },
    { quantity: '1.12345' }, { total_item_cost: '' }, { total_item_cost: '-1' }, { total_item_cost: 'NaN' },
    { total_item_cost: '100junk' }, { total_item_cost: '1.234' }, { freight_cost: '-1' }, { other_cost: 'invalid' },
  ])('rejects invalid shipment input before writing inventory: %j', async (overrides) => {
    const receive = await action();
    await expect(receive(form(overrides))).rejects.toThrow('toast=receipt_error');
    expect(state.writes).toEqual([]);
  });

  it('requires the shipment total even if an old per-unit field is submitted', async () => {
    const receive = await action();
    const data = form({ unit_cost: '4.00' });
    data.delete('total_item_cost');
    await expect(receive(data)).rejects.toThrow('toast=receipt_error');
    expect(state.writes).toEqual([]);
  });

  it.each(['missing', 'produced'])('rejects unavailable or non-receivable item %s', async (itemId) => {
    const receive = await action();
    await expect(receive(form({ inventory_item_id: itemId }))).rejects.toThrow('toast=receipt_error');
    expect(state.writes).toEqual([]);
  });

  it('checks write permission before querying or creating inventory', async () => {
    const receive = await action();
    state.authorize.mockRejectedValueOnce(new Error('Write denied'));
    await expect(receive(form())).rejects.toThrow('Write denied');
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });
});

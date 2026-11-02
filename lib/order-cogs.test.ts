import { describe, expect, it } from 'vitest';
import { snapshotOrderCogsForShipment } from './order-cogs';

type Row = Record<string, any>;

function shipmentDatabase() {
  const tables: Record<string, Row[]> = {
    customer_stock_product_allocations: [],
    order_items: [
      { id: 'line-a', order_id: 'order', product_id: 'a', qty: 2, unit_price_cents: 500, line_total_cents: 1000, shipping_boxes_used: 2, cogs_snapshot_at: null },
      { id: 'line-b', order_id: 'order', product_id: 'b', qty: 4, unit_price_cents: 750, line_total_cents: 3000, shipping_boxes_used: 0, cogs_snapshot_at: null },
    ],
    inventory_items: [
      { id: 'finished-a', product_id: 'a', item_type: 'finished_good', base_unit: 'each' },
      { id: 'finished-b', product_id: 'b', item_type: 'finished_good', base_unit: 'each' },
    ],
    inventory_lots: [
      { id: 'goods-a', inventory_item_id: 'finished-a', quantity_remaining: 2, unit_cost_cents: 100, production_run_id: 'run-a' },
      { id: 'goods-b', inventory_item_id: 'finished-b', quantity_remaining: 4, unit_cost_cents: 200, production_run_id: 'run-b' },
      { id: 'small-box-lot', inventory_item_id: 'small-box', quantity_remaining: 1, unit_cost_cents: 40, production_run_id: null },
      { id: 'large-box-lot', inventory_item_id: 'large-box', quantity_remaining: 1, unit_cost_cents: 60, production_run_id: null },
    ],
    production_runs: [
      { id: 'run-a', product_id: 'a', quantity_produced: 10, actual_unit_cost_cents: 100, actual_labor_cost_cents: 0, fixed_cost_cents: 50, fixed_tape_cost_cents: 50 },
      { id: 'run-b', product_id: 'b', quantity_produced: 10, actual_unit_cost_cents: 200, actual_labor_cost_cents: 0, fixed_cost_cents: 0, fixed_tape_cost_cents: 0 },
    ],
    product_recipes: [],
    order_item_shipping_boxes: [
      { id: 'small-usage', order_id: 'order', order_item_id: 'line-a', inventory_item_id: 'small-box', quantity: 1, consumed_at: null },
      { id: 'large-usage', order_id: 'order', order_item_id: 'line-a', inventory_item_id: 'large-box', quantity: 1, consumed_at: null },
    ],
    inventory_movements: [],
  };
  const state = { failLotIdOnce: '', consumeBoxesInRpc: false };
  const writes: Array<{ table: string; values: Row }> = [];
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const client = {
    async rpc(name: string, args: { p_order_item_id: string }) {
      rpcCalls.push({ name, args: structuredClone(args) });
      const item = tables.order_items.find(row => row.id === args.p_order_item_id)!;
      const existing = tables.inventory_movements.find(row => row.order_item_id === item.id && row.held_stock);
      if (!existing) tables.inventory_movements.push({ order_item_id: item.id, quantity_change: -item.qty, held_stock: true });
      if (state.consumeBoxesInRpc) {
        for (const usage of tables.order_item_shipping_boxes.filter(row => !row.consumed_at)) {
          const lot = tables.inventory_lots.find(row => row.inventory_item_id === usage.inventory_item_id)!;
          lot.quantity_remaining -= usage.quantity;
          Object.assign(usage, {
            consumed_at: '2026-10-21T12:00:00Z', cogs_estimated: false,
            unit_cost_cents: lot.unit_cost_cents, total_cost_cents: usage.quantity * lot.unit_cost_cents,
          });
          tables.inventory_movements.push({
            inventory_item_id: usage.inventory_item_id, order_item_id: usage.order_item_id,
            quantity_change: -usage.quantity, unit_cost_cents: lot.unit_cost_cents, lot_id: lot.id,
          });
        }
      }
      return { data: item.qty, error: null };
    },
    from(table: string) {
      if (!tables[table]) throw new Error(`Unexpected table ${table}`);
      const predicates: Array<(row: Row) => boolean> = [];
      let values: Row | undefined;
      let inserted: Row | undefined;
      let executed: { data: Row[] | null; error: { message: string } | null } | undefined;
      const query = {
        select() { return query; },
        order() { return query; },
        eq(key: string, value: unknown) { predicates.push(row => row[key] === value); return query; },
        is(key: string, value: unknown) { predicates.push(row => (row[key] ?? null) === value); return query; },
        in(key: string, allowed: unknown[]) { predicates.push(row => allowed.includes(row[key])); return query; },
        gt(key: string, value: number) { predicates.push(row => Number(row[key]) > value); return query; },
        update(next: Row) { values = next; return query; },
        insert(next: Row) { inserted = next; return query; },
        then(resolve: (result: typeof executed) => unknown) {
          if (!executed) {
            const rows = tables[table].filter(row => predicates.every(predicate => predicate(row)));
            if (values && table === 'inventory_lots' && state.failLotIdOnce && rows.some(row => row.id === state.failLotIdOnce)) {
              state.failLotIdOnce = '';
              executed = { data: null, error: { message: 'Temporary lot update failure' } };
            } else {
              if (values) {
                writes.push({ table, values: structuredClone(values) });
                rows.forEach(row => Object.assign(row, values));
              }
              if (inserted) {
                writes.push({ table, values: structuredClone(inserted) });
                tables[table].push(structuredClone(inserted));
              }
              executed = { data: structuredClone(rows), error: null };
            }
          }
          return Promise.resolve(executed).then(resolve);
        },
      };
      return query;
    },
  };
  return { tables, client, state, writes, rpcCalls };
}

function snapshot(db: ReturnType<typeof shipmentDatabase>) {
  return snapshotOrderCogsForShipment({ orderId: 'order', shippingCostCents: 0, processingFeeCents: 0, supabase: db.client });
}

function boxMovements(db: ReturnType<typeof shipmentDatabase>) {
  return db.tables.inventory_movements.filter(row => row.inventory_item_id?.endsWith('-box'));
}

describe('shipment donation COGS', () => {
  it('consumes held stock once and records only actual boxes and shipping on releases', async () => {
    const db = shipmentDatabase();
    db.tables.customer_stock_product_allocations = [{ product_id: 'a', initial_order_id: 'original' }, { product_id: 'b', initial_order_id: 'original' }];
    db.tables.order_items.forEach(item => Object.assign(item, { unit_price_cents: 0, line_total_cents: 0 }));
    expect(await snapshotOrderCogsForShipment({ orderId: 'order', shippingCostCents: 1500, processingFeeCents: 30, donationCogsCents: 69, supabase: db.client })).toEqual({ error: null });
    expect(db.tables.order_items.reduce((sum, item) => sum + item.cogs_total_cents, 0)).toBe(1600);
    expect(db.tables.order_items.every(item => item.cogs_labor_cents === 0 && item.cogs_material_cents === 0 && item.cogs_tape_cents === 0 && item.cogs_processing_fee_cents === 0 && item.cogs_donation_cents === 0)).toBe(true);
    expect(db.tables.inventory_movements.filter(row => row.held_stock)).toHaveLength(2);
    expect(db.tables.inventory_lots.find(row => row.id === 'goods-a')?.quantity_remaining).toBe(2);
    expect(await snapshot(db)).toEqual({ error: null });
    expect(db.tables.inventory_movements.filter(row => row.held_stock)).toHaveLength(2);
  });

  it.each(['portal', 'shopify'])('releases mixed variants from the shared allocation without repeating inventory or batch costs (%s)', async (orderSource) => {
    const db = shipmentDatabase();
    db.tables.customer_stock_product_allocations = ['a', 'b'].map(product_id => ({
      product_id, allocation_id: 'shared-batch', inventory_product_id: 'a', initial_order_id: 'original',
    }));
    // The whole-bean variant has no independent finished-good item or recipe.
    db.tables.inventory_items = db.tables.inventory_items.filter(row => row.product_id !== 'b');
    db.state.consumeBoxesInRpc = true;
    db.tables.order_items.forEach(item => Object.assign(item, { unit_price_cents: 0, line_total_cents: 0 }));
    const input = { orderId: 'order', orderSource, shippingCostCents: 1500, processingFeeCents: 30, donationCogsCents: 69, supabase: db.client };
    expect(await snapshotOrderCogsForShipment(input)).toEqual({ error: null });
    expect(db.rpcCalls).toEqual(['line-a', 'line-b'].map(p_order_item_id => ({
      name: 'consume_customer_stock_for_order_item', args: { p_order_item_id, p_shipping_cost_cents: 1500 },
    })));
    expect(db.tables.inventory_movements.filter(row => row.held_stock).reduce((sum, row) => sum - row.quantity_change, 0)).toBe(6);
    expect(db.tables.order_items.reduce((sum, row) => sum + row.cogs_total_cents, 0)).toBe(1600);
    expect(db.tables.order_items.every(row => row.cogs_processing_fee_cents === 0 && row.cogs_donation_cents === 0 && row.cogs_material_cents === 0 && row.cogs_labor_cents === 0 && row.cogs_tape_cents === 0)).toBe(true);
    expect(boxMovements(db)).toHaveLength(2);
    expect(db.writes.filter(write => write.table === 'inventory_items')).toEqual([]);
    expect(db.writes.filter(write => ['inventory_lots', 'inventory_movements', 'order_item_shipping_boxes'].includes(write.table))).toEqual([]);
    expect(await snapshotOrderCogsForShipment(input)).toEqual({ error: null });
    expect(db.rpcCalls).toHaveLength(2);
    expect(boxMovements(db)).toHaveLength(2);
  });

  it('refuses to consume the initial billed-and-held sale without its approved batch snapshot', async () => {
    const db = shipmentDatabase();
    db.tables.customer_stock_product_allocations = [{ product_id: 'a', initial_order_id: 'order' }];
    expect(await snapshot(db)).toEqual({ error: 'held_stock_sale_requires_cost_snapshot' });
    expect(db.writes).toHaveLength(0);
  });
  it('assigns Shopify donations per bag at different prices and preserves them on retry', async () => {
    const db = shipmentDatabase();
    const input = { orderId: 'order', orderSource: 'shopify', donationCogsCents: 600, shippingCostCents: 0, supabase: db.client };
    expect(await snapshotOrderCogsForShipment(input)).toEqual({ error: null });
    const [a, b] = db.tables.order_items;
    expect([a.cogs_donation_cents, b.cogs_donation_cents]).toEqual([200, 400]);
    expect(a.cogs_processing_fee_cents + b.cogs_processing_fee_cents).toBe(150);
    expect(a.cogs_total_cents + b.cogs_total_cents).toBe(1860);
    const writes = db.writes.length;
    expect(await snapshotOrderCogsForShipment(input)).toEqual({ error: null });
    expect(db.writes).toHaveLength(writes);
  });

  it('keeps a donation on free Shopify bags and completes partial snapshots consistently', async () => {
    const db = shipmentDatabase();
    Object.assign(db.tables.order_items[0], { line_total_cents: 0, unit_price_cents: 0 });
    db.state.failLotIdOnce = 'goods-b';
    const input = { orderId: 'order', orderSource: 'shopify', donationCogsCents: 600, shippingCostCents: 0, supabase: db.client };
    expect(await snapshotOrderCogsForShipment(input)).toEqual({ error: 'lot_update_error' });
    expect(db.tables.order_items[0].cogs_donation_cents).toBe(200);
    const firstLine = structuredClone(db.tables.order_items[0]);
    expect(await snapshotOrderCogsForShipment(input)).toEqual({ error: null });
    expect(db.tables.order_items[0]).toEqual(firstLine);
    expect(db.tables.order_items[1].cogs_donation_cents).toBe(400);
  });

  it('keeps wholesale donations allocated by revenue', async () => {
    const db = shipmentDatabase();
    expect(await snapshotOrderCogsForShipment({ orderId: 'order', orderSource: 'portal', donationCogsCents: 40, shippingCostCents: 0, supabase: db.client })).toEqual({ error: null });
    const [a, b] = db.tables.order_items;
    expect([a.cogs_donation_cents, b.cogs_donation_cents]).toEqual([10, 30]);
    expect(a.cogs_total_cents + b.cogs_total_cents).toBe(1300);
  });
});

describe('shipment-entered box tape COGS', () => {
  it('adds five cents per actual box across sizes, not per bag, and keeps existing recipe tape and box costs separate', async () => {
    const db = shipmentDatabase();
    expect(await snapshot(db)).toEqual({ error: null });
    const [a, b] = db.tables.order_items;
    expect(a).toMatchObject({ cogs_tape_cents: 12.5, cogs_fixed_other_cents: 25, cogs_fixed_cents: 37.5, cogs_product_cents: 227.5, cogs_estimated: false, cogs_source: 'actual_fifo' });
    expect(b).toMatchObject({ cogs_tape_cents: 7.5, cogs_fixed_other_cents: 75, cogs_fixed_cents: 82.5, cogs_product_cents: 882.5, cogs_estimated: false, cogs_source: 'actual_fifo' });
    // Two shipping boxes add 10 cents; 10 cents of recipe tape already existed.
    expect(a.cogs_tape_cents + b.cogs_tape_cents).toBe(20);
    expect(a.cogs_total_cents + b.cogs_total_cents).toBe(1110);
    expect(boxMovements(db).map(row => [row.quantity_change, row.unit_cost_cents])).toEqual([[-1, 40], [-1, 60]]);
    expect(db.tables.order_item_shipping_boxes.map(row => row.total_cost_cents)).toEqual([40, 60]);
  });

  it('records tape even when box stock and purchase cost are missing, preserving the estimated flag', async () => {
    const db = shipmentDatabase();
    db.tables.inventory_lots = db.tables.inventory_lots.filter(row => !row.inventory_item_id.endsWith('-box'));
    expect(await snapshot(db)).toEqual({ error: null });
    const [a, b] = db.tables.order_items;
    expect(a).toMatchObject({ cogs_tape_cents: 12.5, cogs_fixed_other_cents: 0, cogs_product_cents: 202.5, cogs_estimated: true, cogs_source: 'partial_estimate' });
    expect(b).toMatchObject({ cogs_tape_cents: 7.5, cogs_fixed_other_cents: 0, cogs_product_cents: 807.5, cogs_estimated: true, cogs_source: 'partial_estimate' });
    expect(boxMovements(db).every(row => row.lot_id === null && row.unit_cost_cents === 0)).toBe(true);
  });

  it('uses consumed box quantities and the original allocation after a partial snapshot retry without consuming again', async () => {
    const db = shipmentDatabase();
    db.state.failLotIdOnce = 'goods-b';
    expect(await snapshot(db)).toEqual({ error: 'lot_update_error' });
    const firstLineSnapshot = structuredClone(db.tables.order_items[0]);
    const firstBoxMovements = structuredClone(boxMovements(db));
    expect(firstBoxMovements).toHaveLength(2);
    expect(db.tables.order_item_shipping_boxes.every(row => row.consumed_at)).toBe(true);

    expect(await snapshot(db)).toEqual({ error: null });
    expect(db.tables.order_items[0]).toEqual(firstLineSnapshot);
    expect(db.tables.order_items[1]).toMatchObject({ cogs_tape_cents: 7.5, cogs_fixed_other_cents: 75, cogs_product_cents: 882.5, cogs_estimated: false });
    expect(boxMovements(db)).toEqual(firstBoxMovements);
    const writes = db.writes.length;
    expect(await snapshot(db)).toEqual({ error: null });
    expect(db.writes).toHaveLength(writes);
  });

  it('adds no shipping tape when no boxes were entered, leaving recipe tape unchanged', async () => {
    const db = shipmentDatabase();
    db.tables.order_item_shipping_boxes = [];
    expect(await snapshot(db)).toEqual({ error: null });
    expect(db.tables.order_items[0]).toMatchObject({ cogs_tape_cents: 10, cogs_fixed_other_cents: 0, cogs_product_cents: 200 });
    expect(db.tables.order_items[1]).toMatchObject({ cogs_tape_cents: 0, cogs_fixed_other_cents: 0, cogs_product_cents: 800 });
    expect(boxMovements(db)).toHaveLength(0);
  });

  it('adds entered-box tape to recipe estimates without multiplying tape by bag quantity or recipe waste', async () => {
    const db = shipmentDatabase();
    db.tables.inventory_lots = db.tables.inventory_lots.filter(row => row.id !== 'goods-a');
    db.tables.production_runs = db.tables.production_runs.filter(row => row.product_id !== 'a');
    db.tables.inventory_lots.push(
      { id: 'coffee-lot', inventory_item_id: 'coffee', quantity_remaining: 10, unit_cost_cents: 1000 },
      { id: 'bag-lot', inventory_item_id: 'bag', quantity_remaining: 100, unit_cost_cents: 30 },
    );
    db.tables.product_recipes.push({
      product_id: 'a', output_qty: 1, waste_percent: 2, labor_minutes: 6, labor_rate_cents: 2200,
      shipping_label_qty: 1, branding_label_qty: 0,
      product_recipe_components: [
        { inventory_item_id: 'coffee', quantity: 12, unit: 'oz', component_role: 'raw_coffee', inventory_items: { id: 'coffee', base_unit: 'lb', sku: 'FD-COFFEE' } },
        { inventory_item_id: 'bag', quantity: 1, unit: 'each', component_role: 'bag', inventory_items: { id: 'bag', base_unit: 'each', sku: 'FD-BAG' } },
      ],
    });
    expect(await snapshot(db)).toEqual({ error: null });
    expect(db.tables.order_items[0]).toMatchObject({
      cogs_labor_cents: 440, cogs_shipping_label_cents: 4, cogs_tape_cents: 2.5,
      cogs_fixed_other_cents: 25, cogs_estimated: true, cogs_source: 'estimated_recipe',
    });
    expect(db.tables.order_items[0].cogs_material_cents).toBeCloseTo(1590);
    expect(db.tables.order_items[0].cogs_product_cents).toBeCloseTo(2061.5);
  });

  it('preserves estimated box costs and tape when completing a prior consumed snapshot', async () => {
    const db = shipmentDatabase();
    db.tables.order_items[0].cogs_snapshot_at = '2026-10-09T12:00:00Z';
    db.tables.order_item_shipping_boxes.forEach(row => Object.assign(row, { consumed_at: '2026-10-09T12:00:00Z', cogs_estimated: true, total_cost_cents: 40 }));
    expect(await snapshot(db)).toEqual({ error: null });
    expect(db.tables.order_items[1]).toMatchObject({ cogs_tape_cents: 7.5, cogs_fixed_other_cents: 60, cogs_product_cents: 867.5, cogs_estimated: true, cogs_source: 'partial_estimate' });
    expect(boxMovements(db)).toHaveLength(0);
  });
});

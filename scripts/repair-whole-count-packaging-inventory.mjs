import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const PAGE_SIZE = 1000;
const EPSILON = 0.000001;
const BAG_BOX_PATTERN = /BAG|BOX/i;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
}

async function fetchAll(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function numericValue(value) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value) {
  return Math.max(0, Math.round(numericValue(value)));
}

function hasFraction(value) {
  return Math.abs(numericValue(value) - Math.round(numericValue(value))) > EPSILON;
}

function absQuantity(value) {
  return Math.abs(numericValue(value));
}

function money(value) {
  return `$${(numericValue(value) / 100).toFixed(2)}`;
}

function qty(value) {
  return Number(numericValue(value).toFixed(4));
}

function itemLabel(item) {
  if (!item) return 'Unknown item';
  return item.sku ? `${item.name} (${item.sku})` : item.name;
}

function isBagOrBoxItem(item) {
  return item?.base_unit === 'each' && BAG_BOX_PATTERN.test(`${item.name ?? ''} ${item.sku ?? ''}`);
}

function isBoxItem(item) {
  return item?.base_unit === 'each' && /BOX/i.test(`${item.name ?? ''} ${item.sku ?? ''}`);
}

function groupKey(...parts) {
  return parts.map((part) => String(part ?? '')).join('::');
}

function indexById(rows) {
  return new Map(rows.map((row) => [row.id, row]));
}

function pushMapArray(map, key, value) {
  const rows = map.get(key) ?? [];
  rows.push(value);
  map.set(key, rows);
}

function addOrderItemDelta(deltaByOrderItemId, orderItemId, delta) {
  if (!orderItemId || Math.abs(delta.materialCents ?? 0) <= EPSILON && Math.abs(delta.fixedOtherCents ?? 0) <= EPSILON) return;
  const current = deltaByOrderItemId.get(orderItemId) ?? { fixedOtherCents: 0, materialCents: 0 };
  current.fixedOtherCents += delta.fixedOtherCents ?? 0;
  current.materialCents += delta.materialCents ?? 0;
  deltaByOrderItemId.set(orderItemId, current);
}

function allocateByRevenue(orderItems, amountCents) {
  const allocations = new Map();
  const totalRevenue = orderItems.reduce((sum, item) => sum + Math.max(0, numericValue(item.line_total_cents)), 0);
  const totalWeight = totalRevenue || orderItems.length || 1;
  let allocated = 0;
  orderItems.forEach((item, index) => {
    const weight = totalRevenue > 0 ? Math.max(0, numericValue(item.line_total_cents)) : 1;
    const amount = index === orderItems.length - 1 ? Math.max(0, amountCents - allocated) : (amountCents * weight) / totalWeight;
    allocated += amount;
    allocations.set(item.id, amount);
  });
  return allocations;
}

function calculateMovementCost(movements) {
  return movements.reduce((sum, movement) => sum + absQuantity(movement.quantity_change) * numericValue(movement.unit_cost_cents), 0);
}

async function setMovementQuantity({ apply, lotsById, movement, nextAbsQuantity, supabase }) {
  const oldAbsQuantity = absQuantity(movement.quantity_change);
  const deltaConsumed = nextAbsQuantity - oldAbsQuantity;
  if (Math.abs(deltaConsumed) <= EPSILON) return;

  const lot = movement.lot_id ? lotsById.get(movement.lot_id) : null;
  if (lot) {
    const nextRemaining = numericValue(lot.quantity_remaining) - deltaConsumed;
    if (nextRemaining < -EPSILON) {
      throw new Error(`Insufficient lot balance for movement ${movement.id}. Need ${qty(deltaConsumed)}, lot has ${qty(lot.quantity_remaining)}.`);
    }
    lot.quantity_remaining = Math.max(0, nextRemaining);
    if (apply) {
      const { error } = await supabase
        .from('inventory_lots')
        .update({ quantity_remaining: lot.quantity_remaining })
        .eq('id', lot.id);
      if (error) throw error;
    }
  }

  movement.quantity_change = -Math.max(0, nextAbsQuantity);
  if (apply) {
    const { error } = await supabase
      .from('inventory_movements')
      .update({ quantity_change: movement.quantity_change })
      .eq('id', movement.id);
    if (error) throw error;
  }
}

async function retargetConsumption({ apply, lotsById, movements, supabase, targetQuantity }) {
  const sorted = [...movements].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  const currentQuantity = sorted.reduce((sum, movement) => sum + absQuantity(movement.quantity_change), 0);
  let remainingDelta = targetQuantity - currentQuantity;

  if (Math.abs(remainingDelta) <= EPSILON) return { currentQuantity, targetQuantity };

  if (remainingDelta < 0) {
    let reduceBy = Math.abs(remainingDelta);
    for (const movement of [...sorted].reverse()) {
      if (reduceBy <= EPSILON) break;
      const currentAbs = absQuantity(movement.quantity_change);
      const takeBack = Math.min(currentAbs, reduceBy);
      await setMovementQuantity({
        apply,
        lotsById,
        movement,
        nextAbsQuantity: currentAbs - takeBack,
        supabase,
      });
      reduceBy -= takeBack;
    }
    if (reduceBy > EPSILON) throw new Error(`Unable to reduce enough movement quantity. Remaining ${qty(reduceBy)}.`);
    return { currentQuantity, targetQuantity };
  }

  let addBy = remainingDelta;
  const lastMovement = [...sorted].reverse().find((movement) => movement.lot_id);
  if (!lastMovement) throw new Error('Unable to add consumption because no lot-backed movement exists.');
  await setMovementQuantity({
    apply,
    lotsById,
    movement: lastMovement,
    nextAbsQuantity: absQuantity(lastMovement.quantity_change) + addBy,
    supabase,
  });
  addBy = 0;
  if (addBy > EPSILON) throw new Error(`Unable to add enough movement quantity. Remaining ${qty(addBy)}.`);

  return { currentQuantity, targetQuantity };
}

function summarizeChangedItems(changes) {
  const totals = new Map();
  for (const change of changes) {
    const current = totals.get(change.itemLabel) ?? { count: 0, quantityDelta: 0, costDelta: 0 };
    current.count += 1;
    current.quantityDelta += change.quantityDelta ?? 0;
    current.costDelta += change.costDelta ?? 0;
    totals.set(change.itemLabel, current);
  }
  return [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

async function main() {
  const apply = process.argv.includes('--apply');
  loadEnvFile('.env.local');
  loadEnvFile('.env');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  }

  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'} whole-count packaging repair`);

  const [
    inventoryItems,
    inventoryLots,
    productionRunInputs,
    productionRuns,
    inventoryMovements,
    shippingBoxRows,
    orderItems,
    commissionSnapshots,
    monthlyPayouts,
  ] = await Promise.all([
    fetchAll(() => supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,product_id')),
    fetchAll(() => supabase.from('inventory_lots').select('id,inventory_item_id,quantity_remaining,unit_cost_cents,production_run_id')),
    fetchAll(() => supabase.from('production_run_inputs').select('id,production_run_id,inventory_item_id,quantity_expected,quantity_used,cost_cents')),
    fetchAll(() => supabase.from('production_runs').select('id,product_id,finished_lot_id,quantity_produced,estimated_unit_cost_cents,actual_unit_cost_cents,fixed_cost_cents,expected_labor_cost_cents,actual_labor_cost_cents')),
    fetchAll(() => supabase.from('inventory_movements').select('id,inventory_item_id,lot_id,movement_type,quantity_change,unit_cost_cents,production_run_id,order_id,order_item_id,created_at')),
    fetchAll(() => supabase.from('order_item_shipping_boxes').select('id,order_id,order_item_id,inventory_item_id,quantity,unit_cost_cents,total_cost_cents,cogs_estimated,consumed_at,created_at')),
    fetchAll(() => supabase.from('order_items').select('id,order_id,qty,line_total_cents,cogs_material_cents,cogs_fixed_cents,cogs_fixed_other_cents,cogs_product_cents,cogs_shipping_cents,cogs_processing_fee_cents,cogs_donation_cents,cogs_total_cents,cogs_unit_cents,shipping_boxes_used')),
    fetchAll(() => supabase.from('order_commission_snapshots').select('id,order_id,sales_profile_id,commission_month,revenue_cents,product_cogs_cents,shipping_cogs_cents,processing_fee_cogs_cents,donation_cogs_cents,total_cogs_cents,gross_profit_cents,commission_percent,commission_cents')),
    fetchAll(() => supabase.from('monthly_commission_payouts').select('id,sales_profile_id,commission_month,status')),
  ]);

  const itemById = indexById(inventoryItems);
  const lotsById = indexById(inventoryLots);
  const runById = indexById(productionRuns);
  const orderItemsById = indexById(orderItems);
  const inputsByRunId = new Map();
  const productionMovementsByRunItem = new Map();
  const shipmentMovementsByOrderItem = new Map();
  const shipmentMovementsByOrderBoxItem = new Map();
  const orderItemsByOrderId = new Map();
  const snapshotByOrderId = new Map(commissionSnapshots.map((snapshot) => [snapshot.order_id, snapshot]));
  const payoutBySalesMonth = new Map(monthlyPayouts.map((payout) => [groupKey(payout.sales_profile_id, payout.commission_month), payout]));

  for (const input of productionRunInputs) pushMapArray(inputsByRunId, input.production_run_id, input);
  for (const item of orderItems) pushMapArray(orderItemsByOrderId, item.order_id, item);
  for (const movement of inventoryMovements) {
    if (movement.movement_type === 'production_consume') {
      pushMapArray(productionMovementsByRunItem, groupKey(movement.production_run_id, movement.inventory_item_id), movement);
    }
    if (movement.movement_type === 'shipment_consume') {
      if (movement.order_item_id) pushMapArray(shipmentMovementsByOrderItem, movement.order_item_id, movement);
      if (movement.order_id) pushMapArray(shipmentMovementsByOrderBoxItem, groupKey(movement.order_id, movement.inventory_item_id), movement);
    }
  }

  const orderItemDeltaById = new Map();
  const affectedRunIds = new Set();
  const productionChanges = [];

  for (const input of productionRunInputs) {
    const item = itemById.get(input.inventory_item_id);
    if (!isBagOrBoxItem(item)) continue;
    if (!hasFraction(input.quantity_expected) && !hasFraction(input.quantity_used)) continue;

    const movements = productionMovementsByRunItem.get(groupKey(input.production_run_id, input.inventory_item_id)) ?? [];
    if (!movements.length) continue;

    const oldCost = calculateMovementCost(movements);
    const targetUsed = rounded(input.quantity_used);
    const targetExpected = rounded(input.quantity_expected);
    const oldUsed = numericValue(input.quantity_used);
    await retargetConsumption({ apply, lotsById, movements, supabase, targetQuantity: targetUsed });
    const newCost = calculateMovementCost(movements);

    input.quantity_used = targetUsed;
    input.quantity_expected = targetExpected;
    input.cost_cents = newCost;
    affectedRunIds.add(input.production_run_id);
    productionChanges.push({
      costDelta: newCost - oldCost,
      itemLabel: itemLabel(item),
      quantityDelta: targetUsed - oldUsed,
      runId: input.production_run_id,
    });

    if (apply) {
      const { error } = await supabase
        .from('production_run_inputs')
        .update({
          cost_cents: newCost,
          quantity_expected: targetExpected,
          quantity_used: targetUsed,
        })
        .eq('id', input.id);
      if (error) throw error;
    }
  }

  const runUnitCostDeltaByFinishedLotId = new Map();
  const productionRunCostChanges = [];
  for (const runId of affectedRunIds) {
    const run = runById.get(runId);
    if (!run) continue;
    const runInputs = inputsByRunId.get(runId) ?? [];
    const materialCost = runInputs.reduce((sum, input) => sum + numericValue(input.cost_cents), 0);
    const quantityProduced = numericValue(run.quantity_produced) || 1;
    const oldUnitCost = numericValue(run.actual_unit_cost_cents);
    const newActualUnitCost = (materialCost + numericValue(run.fixed_cost_cents) + numericValue(run.actual_labor_cost_cents)) / quantityProduced;
    const newEstimatedUnitCost = (materialCost + numericValue(run.fixed_cost_cents) + numericValue(run.expected_labor_cost_cents)) / quantityProduced;
    const unitDelta = newActualUnitCost - oldUnitCost;

    productionRunCostChanges.push({
      runId,
      oldUnitCost,
      newActualUnitCost,
      unitDelta,
    });
    run.actual_unit_cost_cents = newActualUnitCost;
    run.estimated_unit_cost_cents = newEstimatedUnitCost;

    if (run.finished_lot_id && Math.abs(unitDelta) > EPSILON) {
      runUnitCostDeltaByFinishedLotId.set(run.finished_lot_id, {
        newUnitCost: newActualUnitCost,
        oldUnitCost,
        unitDelta,
      });
      const lot = lotsById.get(run.finished_lot_id);
      if (lot) lot.unit_cost_cents = newActualUnitCost;
    }

    if (apply) {
      const { error: runError } = await supabase
        .from('production_runs')
        .update({
          actual_unit_cost_cents: newActualUnitCost,
          estimated_unit_cost_cents: newEstimatedUnitCost,
        })
        .eq('id', runId);
      if (runError) throw runError;

      if (run.finished_lot_id) {
        const { error: lotError } = await supabase
          .from('inventory_lots')
          .update({ unit_cost_cents: newActualUnitCost })
          .eq('id', run.finished_lot_id);
        if (lotError) throw lotError;
      }
    }
  }

  for (const [finishedLotId, delta] of runUnitCostDeltaByFinishedLotId.entries()) {
    const shipmentMovements = inventoryMovements.filter((movement) => movement.movement_type === 'shipment_consume' && movement.lot_id === finishedLotId && movement.order_item_id);
    for (const movement of shipmentMovements) {
      addOrderItemDelta(orderItemDeltaById, movement.order_item_id, {
        materialCents: absQuantity(movement.quantity_change) * delta.unitDelta,
      });
      movement.unit_cost_cents = delta.newUnitCost;
      if (apply) {
        const { error } = await supabase
          .from('inventory_movements')
          .update({ unit_cost_cents: delta.newUnitCost })
          .eq('id', movement.id);
        if (error) throw error;
      }
    }
  }

  const shippingRowsByOrderBox = new Map();
  for (const row of shippingBoxRows) {
    const item = itemById.get(row.inventory_item_id);
    if (!isBoxItem(item)) continue;
    pushMapArray(shippingRowsByOrderBox, groupKey(row.order_id, row.inventory_item_id), row);
  }

  const shippingChanges = [];
  const affectedShippingOrderIds = new Set();
  for (const [key, rows] of shippingRowsByOrderBox.entries()) {
    const [orderId, inventoryItemId] = key.split('::');
    const currentQuantity = rows.reduce((sum, row) => sum + numericValue(row.quantity), 0);
    const targetQuantity = rounded(currentQuantity);
    if (!rows.some((row) => hasFraction(row.quantity)) && Math.abs(currentQuantity - targetQuantity) <= EPSILON) continue;

    const item = itemById.get(inventoryItemId);
    const movements = shipmentMovementsByOrderBoxItem.get(key) ?? [];
    const oldCost = rows.reduce((sum, row) => sum + numericValue(row.total_cost_cents), 0);
    const oldCostByOrderItem = new Map();
    for (const row of rows) {
      oldCostByOrderItem.set(row.order_item_id, (oldCostByOrderItem.get(row.order_item_id) ?? 0) + numericValue(row.total_cost_cents));
    }

    if (movements.length) {
      await retargetConsumption({ apply, lotsById, movements, supabase, targetQuantity });
    }
    const newCost = movements.length ? calculateMovementCost(movements) : oldCost;
    const orderRows = orderItemsByOrderId.get(orderId) ?? [];
    const newAllocation = allocateByRevenue(orderRows, newCost);
    for (const itemRow of orderRows) {
      addOrderItemDelta(orderItemDeltaById, itemRow.id, {
        fixedOtherCents: (newAllocation.get(itemRow.id) ?? 0) - (oldCostByOrderItem.get(itemRow.id) ?? 0),
      });
    }

    const primaryRow = [...rows].sort((a, b) => numericValue(b.quantity) - numericValue(a.quantity))[0];
    shippingChanges.push({
      costDelta: newCost - oldCost,
      itemLabel: itemLabel(item),
      orderId,
      quantityDelta: targetQuantity - currentQuantity,
    });
    affectedShippingOrderIds.add(orderId);

    if (apply && primaryRow) {
      const { error: updateError } = await supabase
        .from('order_item_shipping_boxes')
        .update({
          cogs_estimated: movements.some((movement) => !movement.lot_id),
          quantity: targetQuantity,
          total_cost_cents: newCost,
          unit_cost_cents: targetQuantity > 0 ? newCost / targetQuantity : 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', primaryRow.id);
      if (updateError) throw updateError;

      const extraIds = rows.filter((row) => row.id !== primaryRow.id).map((row) => row.id);
      if (extraIds.length) {
        const { error: deleteError } = await supabase
          .from('order_item_shipping_boxes')
          .delete()
          .in('id', extraIds);
        if (deleteError) throw deleteError;
      }
    }
  }

  const changedOrderIds = new Set();
  for (const [orderItemId, delta] of orderItemDeltaById.entries()) {
    const item = orderItemsById.get(orderItemId);
    if (!item) continue;
    const materialCents = Math.max(0, numericValue(item.cogs_material_cents) + delta.materialCents);
    const fixedOtherCents = Math.max(0, numericValue(item.cogs_fixed_other_cents) + delta.fixedOtherCents);
    const fixedCents = Math.max(0, numericValue(item.cogs_fixed_cents) + delta.fixedOtherCents);
    const productCogsCents = Math.max(0, numericValue(item.cogs_product_cents) + delta.materialCents + delta.fixedOtherCents);
    const totalCogsCents = Math.max(0, numericValue(item.cogs_total_cents) + delta.materialCents + delta.fixedOtherCents);
    const unitCogsCents = numericValue(item.qty) > 0 ? productCogsCents / numericValue(item.qty) : 0;
    Object.assign(item, {
      cogs_fixed_cents: fixedCents,
      cogs_fixed_other_cents: fixedOtherCents,
      cogs_material_cents: materialCents,
      cogs_product_cents: productCogsCents,
      cogs_total_cents: totalCogsCents,
      cogs_unit_cents: unitCogsCents,
    });
    changedOrderIds.add(item.order_id);

    if (apply) {
      const { error } = await supabase
        .from('order_items')
        .update({
          cogs_fixed_cents: fixedCents,
          cogs_fixed_other_cents: fixedOtherCents,
          cogs_material_cents: materialCents,
          cogs_product_cents: productCogsCents,
          cogs_total_cents: totalCogsCents,
          cogs_unit_cents: unitCogsCents,
        })
        .eq('id', orderItemId);
      if (error) throw error;
    }
  }

  if (apply && affectedShippingOrderIds.size) {
    for (const orderId of affectedShippingOrderIds) {
      const { data: rows, error: rowsError } = await supabase
        .from('order_item_shipping_boxes')
        .select('order_item_id,quantity')
        .eq('order_id', orderId);
      if (rowsError) throw rowsError;
      const totalsByOrderItem = new Map();
      for (const row of rows ?? []) {
        totalsByOrderItem.set(row.order_item_id, (totalsByOrderItem.get(row.order_item_id) ?? 0) + numericValue(row.quantity));
      }
      for (const item of orderItemsByOrderId.get(orderId) ?? []) {
        const { error } = await supabase
          .from('order_items')
          .update({ shipping_boxes_used: totalsByOrderItem.get(item.id) ?? 0 })
          .eq('id', item.id);
        if (error) throw error;
      }
    }
  }

  const commissionUpdates = [];
  const commissionSkipped = [];
  for (const orderId of changedOrderIds) {
    const snapshot = snapshotByOrderId.get(orderId);
    if (!snapshot) continue;
    const payout = payoutBySalesMonth.get(groupKey(snapshot.sales_profile_id, snapshot.commission_month));
    if (payout) {
      commissionSkipped.push({ orderId, payoutStatus: payout.status });
      continue;
    }
    const rows = orderItems.filter((item) => item.order_id === orderId);
    const productCogsCents = rows.reduce((sum, row) => sum + numericValue(row.cogs_product_cents), 0);
    const shippingCogsCents = rows.reduce((sum, row) => sum + numericValue(row.cogs_shipping_cents), 0) || numericValue(snapshot.shipping_cogs_cents);
    const processingFeeCogsCents = rows.reduce((sum, row) => sum + numericValue(row.cogs_processing_fee_cents), 0) || numericValue(snapshot.processing_fee_cogs_cents);
    const donationCogsCents = rows.reduce((sum, row) => sum + numericValue(row.cogs_donation_cents), 0) || numericValue(snapshot.donation_cogs_cents);
    const totalCogsCents = productCogsCents + shippingCogsCents + processingFeeCogsCents + donationCogsCents;
    const grossProfitCents = numericValue(snapshot.revenue_cents) - totalCogsCents;
    const commissionCents = Math.max(0, grossProfitCents) * (numericValue(snapshot.commission_percent) / 100);
    commissionUpdates.push({
      commissionDelta: commissionCents - numericValue(snapshot.commission_cents),
      orderId,
    });

    if (apply) {
      const { error } = await supabase
        .from('order_commission_snapshots')
        .update({
          commission_cents: commissionCents,
          gross_profit_cents: grossProfitCents,
          product_cogs_cents: productCogsCents,
          shipping_cogs_cents: shippingCogsCents,
          processing_fee_cogs_cents: processingFeeCogsCents,
          donation_cogs_cents: donationCogsCents,
          total_cogs_cents: totalCogsCents,
          updated_at: new Date().toISOString(),
        })
        .eq('id', snapshot.id);
      if (error) throw error;
    }
  }

  console.log('\nProduction packaging changes by item:');
  for (const [label, total] of summarizeChangedItems(productionChanges)) {
    console.log(`  ${label}: rows=${total.count}, qty delta=${qty(total.quantityDelta)}, COGS delta=${money(total.costDelta)}`);
  }
  if (!productionChanges.length) console.log('  none');

  console.log('\nShipped box changes by item:');
  for (const [label, total] of summarizeChangedItems(shippingChanges)) {
    console.log(`  ${label}: groups=${total.count}, qty delta=${qty(total.quantityDelta)}, COGS delta=${money(total.costDelta)}`);
  }
  if (!shippingChanges.length) console.log('  none');

  console.log('\nAffected production runs:', productionRunCostChanges.length);
  console.log('Affected order items:', orderItemDeltaById.size);
  console.log('Open commission snapshots to refresh:', commissionUpdates.length);
  console.log('Locked/paid commission snapshots skipped:', commissionSkipped.length);

  const topCommissionDeltas = commissionUpdates
    .filter((row) => Math.abs(row.commissionDelta) > EPSILON)
    .sort((a, b) => Math.abs(b.commissionDelta) - Math.abs(a.commissionDelta))
    .slice(0, 10);
  if (topCommissionDeltas.length) {
    console.log('\nLargest open commission deltas:');
    for (const row of topCommissionDeltas) {
      console.log(`  order ${row.orderId}: ${money(row.commissionDelta)}`);
    }
  }

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to write these repairs.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

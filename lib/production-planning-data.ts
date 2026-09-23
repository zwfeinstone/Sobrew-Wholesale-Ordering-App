import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeInventoryNumber, type InventoryUnit } from '@/lib/inventory';
import type { ProductionMaterialRecipe } from '@/lib/production-materials';
import {
  productionPlanningQueryWindow,
  type ProductionPlanningInput,
} from '@/lib/production-planning';
import { fetchAllByIds, fetchAllPages, type QueryError } from '@/lib/supabase/pagination';
import type { Database } from '@/lib/supabase/schema';

export type PlanningInventoryItem = {
  id: string;
  name: string;
  sku: string | null;
  item_type: string;
  base_unit: InventoryUnit;
  product_id: string | null;
  active: boolean;
};

export type PlanningRecipe = ProductionMaterialRecipe & {
  id: string;
  product_id: string;
  labor_minutes: number;
  labor_rate_cents: number;
  shipping_label_qty: number;
  branding_label_qty: number;
};

export type PlanningCenter = { id: string; name: string; is_active: boolean };
export type PlanningParLevel = {
  center_id: string;
  product_id: string;
  par_qty: number;
  minimum_qty: number;
  notes: string | null;
  center_active: boolean;
  customer_name: string;
};

export type ProductionPlanningData = {
  input: ProductionPlanningInput;
  items: PlanningInventoryItem[];
  recipes: PlanningRecipe[];
  centers: PlanningCenter[];
  parLevels: PlanningParLevel[];
  /** Recorded net inventory, including outstanding no-lot shipment deficits. */
  onHandByItemId: Record<string, number>;
  /** Positive lots that the production RPC can actually consume. */
  materialStockByItemId: Record<string, number>;
};

export type ProductionPlanningDataResult =
  | { data: ProductionPlanningData; error: null }
  | { data: null; error: QueryError };

const ORDER_SELECT = 'id,center_id,status,created_at,shipped_at,archived_at,recurring_order_id,recurring_scheduled_for';

function loadError(results: Array<{ name: string; error: QueryError | null }>): QueryError | null {
  const failures = results.filter((result) => result.error);
  if (!failures.length) return null;
  return {
    code: failures[0].error?.code,
    message: `Production planning could not load complete ${failures.map((result) => result.name).join(', ')} data. ${failures[0].error?.message ?? ''}`.trim(),
  };
}

function groupRows<T>(rows: T[], keyFor: (row: T) => string | null) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    if (key === null) continue;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return grouped;
}

/**
 * Load one complete planning snapshot using the caller's existing permissions.
 * Child collections are separate paginated queries: embedded Supabase rows can
 * otherwise truncate a large order or recipe without reporting an error.
 */
export async function loadProductionPlanningData(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<ProductionPlanningDataResult> {
  const window = productionPlanningQueryWindow(now);
  const [products, items, lots, recipes, openOrders, shippedOrders, legacyShippedOrders, schedules, centers, pars, deficits] = await Promise.all([
    fetchAllPages((from, to) => supabase.from('products')
      .select('id,name,sku,category,active').order('name').order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('inventory_items')
      .select('id,name,sku,item_type,base_unit,product_id,active').order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('inventory_lots')
      .select('id,inventory_item_id,quantity_remaining').order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('product_recipes')
      .select('id,product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,shipping_label_qty,branding_label_qty')
      .order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('orders').select(ORDER_SELECT)
      .in('status', ['New', 'Processing']).is('archived_at', null)
      .order('created_at').order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('orders').select(ORDER_SELECT)
      .eq('status', 'Shipped').gte('shipped_at', window.historyStart).lt('shipped_at', window.historyEnd)
      .order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('orders').select(ORDER_SELECT)
      .eq('status', 'Shipped').is('shipped_at', null)
      .gte('created_at', window.historyStart).lt('created_at', window.historyEnd)
      .order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('recurring_orders')
      .select('id,center_id,frequency,status,active,next_run_at')
      .eq('active', true).eq('status', 'active').order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('centers')
      .select('id,name,is_active').order('name').order('id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('inventory_center_par_levels')
      .select('center_id,product_id,par_qty,minimum_qty,notes').order('center_id').order('product_id').range(from, to)),
    fetchAllPages((from, to) => supabase.from('inventory_movements')
      .select('id,inventory_item_id,quantity_change')
      .in('movement_type', ['shipment_consume', 'sample_box_consume']).is('lot_id', null)
      .order('id').range(from, to)),
  ]);
  const parentError = loadError([
    { name: 'products', error: products.error }, { name: 'inventory items', error: items.error },
    { name: 'inventory lots', error: lots.error }, { name: 'recipes', error: recipes.error },
    { name: 'open orders', error: openOrders.error }, { name: 'shipped orders', error: shippedOrders.error },
    { name: 'legacy shipped orders', error: legacyShippedOrders.error }, { name: 'recurring schedules', error: schedules.error },
    { name: 'customers', error: centers.error }, { name: 'stock targets', error: pars.error },
    { name: 'inventory deficits', error: deficits.error },
  ]);
  if (parentError) return { data: null, error: parentError };

  const orders = [...new Map([...openOrders.data, ...shippedOrders.data, ...legacyShippedOrders.data]
    .map((order) => [order.id, order])).values()];
  const [orderItems, scheduleItems, recipeComponents, generatedOccurrences] = await Promise.all([
    fetchAllByIds(orders.map((order) => order.id), (ids, from, to) => supabase.from('order_items')
      .select('id,order_id,product_id,qty').in('order_id', ids).order('id').range(from, to)),
    fetchAllByIds(schedules.data.map((schedule) => schedule.id), (ids, from, to) => supabase.from('recurring_order_items')
      .select('id,recurring_order_id,product_id,qty').in('recurring_order_id', ids).order('id').range(from, to)),
    fetchAllByIds(recipes.data.map((recipe) => recipe.id), (ids, from, to) => supabase.from('product_recipe_components')
      .select('id,recipe_id,inventory_item_id,quantity,unit,component_role')
      .in('recipe_id', ids).order('id').range(from, to)),
    // All statuses matter: an occurrence already shipped/canceled must never be
    // projected again. Keep older keys so missed-cycle review can also dedupe.
    fetchAllByIds(schedules.data.map((schedule) => schedule.id), (ids, from, to) => supabase.from('orders')
      .select('id,recurring_order_id,recurring_scheduled_for').in('recurring_order_id', ids)
      .not('recurring_scheduled_for', 'is', null).lt('recurring_scheduled_for', window.outlookEnd)
      .order('id').range(from, to)),
  ]);
  const childError = loadError([
    { name: 'order items', error: orderItems.error }, { name: 'recurring items', error: scheduleItems.error },
    { name: 'recipe components', error: recipeComponents.error }, { name: 'generated recurring occurrences', error: generatedOccurrences.error },
  ]);
  if (childError) return { data: null, error: childError };

  const inventoryItems = items.data as PlanningInventoryItem[];
  const itemById = new Map(inventoryItems.map((item) => [item.id, item]));
  const centerById = new Map(centers.data.map((center) => [center.id, center]));
  const itemsByOrder = groupRows(orderItems.data, (item) => item.order_id);
  const itemsBySchedule = groupRows(scheduleItems.data, (item) => item.recurring_order_id);
  const componentsByRecipe = groupRows(recipeComponents.data, (component) => component.recipe_id);
  const onHandByItemId: Record<string, number> = {};
  const materialStockByItemId: Record<string, number> = {};
  for (const lot of lots.data) {
    const quantity = normalizeInventoryNumber(lot.quantity_remaining);
    onHandByItemId[lot.inventory_item_id] = (onHandByItemId[lot.inventory_item_id] ?? 0) + quantity;
    materialStockByItemId[lot.inventory_item_id] = (materialStockByItemId[lot.inventory_item_id] ?? 0) + Math.max(0, quantity);
  }
  for (const movement of deficits.data) {
    onHandByItemId[movement.inventory_item_id] = (onHandByItemId[movement.inventory_item_id] ?? 0)
      + normalizeInventoryNumber(movement.quantity_change);
  }
  const stockByProductId: Record<string, number> = {};
  for (const item of inventoryItems) {
    if (item.item_type !== 'finished_good' || !item.product_id) continue;
    stockByProductId[item.product_id] = (stockByProductId[item.product_id] ?? 0) + (onHandByItemId[item.id] ?? 0);
  }
  const parLevels: PlanningParLevel[] = pars.data.map((par) => ({
    ...par,
    center_active: centerById.get(par.center_id)?.is_active === true,
    customer_name: centerById.get(par.center_id)?.name || 'Unknown customer',
  }));
  return {
    data: {
      input: {
        now,
        products: products.data,
        stockByProductId,
        orders: orders.map((order) => ({
          ...order,
          customer_name: centerById.get(order.center_id ?? '')?.name || 'Unknown customer',
          order_items: itemsByOrder.get(order.id) ?? [],
        })),
        schedules: schedules.data.map((schedule) => ({
          ...schedule,
          center_active: centerById.get(schedule.center_id ?? '')?.is_active === true,
          customer_name: centerById.get(schedule.center_id ?? '')?.name || 'Unknown customer',
          recurring_order_items: itemsBySchedule.get(schedule.id) ?? [],
        })),
        pars: parLevels,
        generatedOccurrences: generatedOccurrences.data.flatMap((occurrence) =>
          occurrence.recurring_order_id && occurrence.recurring_scheduled_for
            ? [{ recurring_order_id: occurrence.recurring_order_id, recurring_scheduled_for: occurrence.recurring_scheduled_for }]
            : []),
      },
      items: inventoryItems,
      recipes: recipes.data.map((recipe) => ({
        ...recipe,
        product_recipe_components: (componentsByRecipe.get(recipe.id) ?? []).map((component) => ({
          ...component,
          unit: component.unit as InventoryUnit,
          inventory_items: itemById.get(component.inventory_item_id) ?? null,
        })),
      })),
      centers: centers.data.filter((center) => center.is_active === true),
      parLevels,
      onHandByItemId,
      materialStockByItemId,
    },
    error: null,
  };
}

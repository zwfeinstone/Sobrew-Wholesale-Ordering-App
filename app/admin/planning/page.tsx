import Link from 'next/link';
import { redirect } from 'next/navigation';
import PendingSubmitButton from '@/components/pending-submit-button';
import StatusToast from '@/components/status-toast';
import { requireAdminWriteAccess } from '@/lib/admin-write-access';
import {
  convertInventoryQuantity,
  formatInventoryQuantity,
  normalizeInventoryNumber,
  type InventoryUnit,
} from '@/lib/inventory';
import { recordRecipeProductionRun } from '@/lib/inventory-production';
import { daysForRecurringFrequency } from '@/lib/recurring';
import { createClient } from '@/lib/supabase/server';
import PlanningSubmitButton from './submit-button';

type ProductRow = {
  id: string;
  name: string | null;
  sku: string | null;
  active: boolean | null;
};

type InventoryItemRow = {
  id: string;
  name: string;
  sku: string | null;
  item_type: string;
  base_unit: InventoryUnit;
  product_id: string | null;
  active: boolean;
};

type InventoryMovementRow = {
  inventory_item_id: string;
  quantity_change: number | string | null;
};

type RecipeComponentRow = {
  id: string;
  inventory_item_id: string;
  quantity: number | string;
  unit: InventoryUnit;
  component_role: string | null;
  inventory_items?: InventoryItemRow | InventoryItemRow[] | null;
};

type RecipeRow = {
  product_id: string;
  output_qty: number | string;
  waste_percent: number | string;
  product_recipe_components?: RecipeComponentRow[] | null;
};

type CalendarDate = {
  day: number;
  month: number;
  year: number;
};

type RecurringOrderRow = {
  active: boolean | null;
  center_id: string | null;
  centers?: { is_active: boolean | null } | { is_active: boolean | null }[] | null;
  created_at: string | null;
  frequency: string;
  id: string;
  last_generated_at: string | null;
  recurring_order_items?: Array<{ product_id: string | null; qty: number | string | null }> | null;
  status: string | null;
};

type ShippedHistoryOrderRow = {
  created_at: string | null;
  id: string;
  order_items?: Array<{ product_id: string | null; qty: number | string | null }> | null;
  status: string | null;
};

type ForecastConfidence = 'High' | 'Medium' | 'Low';

const PLANNING_TIME_ZONE = 'America/Chicago';
const HISTORY_WEEK_COUNT = 8;

const centralDatePartsFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: '2-digit',
  timeZone: PLANNING_TIME_ZONE,
  year: 'numeric',
});

const centralDateTimePartsFormatter = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  timeZone: PLANNING_TIME_ZONE,
  year: 'numeric',
});

const weekLabelFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

function planningHref(params: Record<string, string | null | undefined> = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const search = query.toString();
  return `/admin/planning${search ? `?${search}` : ''}`;
}

function productName(product: ProductRow | undefined | null) {
  return product?.name?.trim() || 'Unnamed product';
}

function itemDisplayName(item: InventoryItemRow | undefined | null) {
  if (!item) return 'Unknown item';
  return item.sku ? `${item.name} (${item.sku})` : item.name;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function calendarDateForCentral(value: string | number | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = centralDatePartsFormatter.formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return year && month && day ? { day, month, year } : null;
}

function partsFor(date: Date, formatter: Intl.DateTimeFormat) {
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

function centralOffsetMs(date: Date) {
  const parts = partsFor(date, centralDateTimePartsFormatter);
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return localAsUtc - date.getTime();
}

function parseDateInput(value: string | null | undefined) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return { day: Number(day), month: Number(month), year: Number(year) };
}

function dateForCalendarDate(date: CalendarDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
}

function centralCalendarDateToUtc(date: CalendarDate) {
  const utcGuess = new Date(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0));
  return new Date(utcGuess.getTime() - centralOffsetMs(utcGuess));
}

function dateInputValue(date: CalendarDate) {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function addCalendarDays(date: CalendarDate, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12));
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate) {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
}

function sameCalendarDate(left: CalendarDate, right: CalendarDate) {
  return compareCalendarDates(left, right) === 0;
}

function calendarDaysBetween(later: CalendarDate, earlier: CalendarDate) {
  return Math.round((dateForCalendarDate(later).getTime() - dateForCalendarDate(earlier).getTime()) / (24 * 60 * 60 * 1000));
}

function centralWeekStart(date: CalendarDate) {
  const dayOfWeek = dateForCalendarDate(date).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return addCalendarDays(date, -daysSinceMonday);
}

function displayWeekRange(start: CalendarDate) {
  const end = addCalendarDays(start, 6);
  return `${weekLabelFormatter.format(dateForCalendarDate(start))} - ${weekLabelFormatter.format(dateForCalendarDate(end))}`;
}

function formatWholeEach(value: number) {
  const rounded = Math.round(value);
  return `${(Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US')} each`;
}

function formatRoundedInventoryQuantity(value: number, unit: InventoryUnit) {
  const rounded = Math.round(value);
  return formatInventoryQuantity(Object.is(rounded, -0) ? 0 : rounded, unit);
}

function addProductQty(map: Map<string, number>, productId: string | null | undefined, qty: number) {
  if (!productId || !Number.isFinite(qty)) return;
  map.set(productId, (map.get(productId) ?? 0) + qty);
}

function forecastConfidence(weeksWithSales: number, hasKnownDemand: boolean): ForecastConfidence {
  if (weeksWithSales >= 6) return 'High';
  if (weeksWithSales >= 3) return 'Medium';
  return hasKnownDemand ? 'Low' : 'Low';
}

function confidenceTone(confidence: ForecastConfidence) {
  if (confidence === 'High') return 'bg-teal-50 text-teal-800';
  if (confidence === 'Medium') return 'bg-amber-50 text-amber-800';
  return 'bg-slate-100 text-slate-700';
}

async function producePlannedInventory(formData: FormData) {
  'use server';

  const weekStartInput = String(formData.get('week_start') ?? '');
  const weekStart = parseDateInput(weekStartInput);
  const returnWeekStart = weekStart ? dateInputValue(centralWeekStart(weekStart)) : undefined;
  await requireAdminWriteAccess(planningHref({ toast: 'admin_write_denied', week_start: returnWeekStart }), 'planning');

  const supabase = await createClient();
  const productId = String(formData.get('product_id') ?? '');
  const quantityValue = Number.parseFloat(String(formData.get('quantity_produced') ?? ''));
  const quantityProduced = Number.isFinite(quantityValue) ? quantityValue : 0;
  if (!productId || !Number.isInteger(quantityProduced) || quantityProduced <= 0) {
    redirect(planningHref({ toast: 'invalid_quantity', week_start: returnWeekStart }));
  }

  const result = await recordRecipeProductionRun({
    notes: `Produced from planning forecast for week of ${returnWeekStart ?? 'current week'}.`,
    productId,
    quantityProduced,
    supabase,
  });

  redirect(planningHref({ toast: result.error ? result.error : 'production_recorded', week_start: returnWeekStart }));
}

async function updateCenterParLevel(formData: FormData) {
  'use server';
  await requireAdminWriteAccess(planningHref({ toast: 'admin_write_denied' }), 'planning');

  const supabase = await createClient();
  const centerId = String(formData.get('center_id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  const parQty = Math.max(0, Number.parseFloat(String(formData.get('par_qty') ?? '0')) || 0);
  const minimumQty = Math.max(0, Number.parseFloat(String(formData.get('minimum_qty') ?? '0')) || 0);

  if (!centerId || !productId) redirect(planningHref({ toast: 'par_error' }));

  const { error } = await supabase.from('inventory_center_par_levels').upsert(
    {
      center_id: centerId,
      product_id: productId,
      par_qty: parQty,
      minimum_qty: minimumQty,
      notes: String(formData.get('notes') ?? '').trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'center_id,product_id' }
  );

  redirect(planningHref({ toast: error ? 'par_error' : 'par_saved' }));
}

export default async function PlanningPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const supabase = await createClient();
  const toast = typeof searchParams?.toast === 'string' ? searchParams.toast : '';
  const requestedWeekStart = typeof searchParams?.week_start === 'string' ? parseDateInput(searchParams.week_start) : null;
  const currentCentralDate = calendarDateForCentral(new Date()) ?? { day: 1, month: 1, year: new Date().getUTCFullYear() };
  const currentWeekStart = centralWeekStart(currentCentralDate);
  const selectedWeekStart = requestedWeekStart ? centralWeekStart(requestedWeekStart) : currentWeekStart;
  const selectedWeekEnd = addCalendarDays(selectedWeekStart, 6);
  const selectedWeekEndExclusive = addCalendarDays(selectedWeekStart, 7);
  const selectedWeekStartInput = dateInputValue(selectedWeekStart);
  const isCurrentWeek = sameCalendarDate(selectedWeekStart, currentWeekStart);
  const nextWeekStart = addCalendarDays(selectedWeekStart, 7);
  const previousWeekStart = addCalendarDays(selectedWeekStart, -7);
  const currentNextWeekStart = addCalendarDays(currentWeekStart, 7);
  const historyAnchorWeekStart = compareCalendarDates(selectedWeekStart, currentWeekStart) > 0 ? currentWeekStart : selectedWeekStart;
  const historyLookbackStart = addCalendarDays(historyAnchorWeekStart, -(HISTORY_WEEK_COUNT * 7));
  const weekTitle = isCurrentWeek
    ? 'This week forecast'
    : sameCalendarDate(selectedWeekStart, currentNextWeekStart)
      ? 'Next week forecast'
      : 'Week forecast';
  const [
    productsResult,
    itemsResult,
    lotsResult,
    recipesResult,
    openOrdersResult,
    shippedHistoryOrdersResult,
    recurringOrdersResult,
    centersResult,
    parLevelsResult,
    shortageMovementsResult,
  ] = await Promise.all([
    supabase.from('products').select('id,name,sku,active').order('name', { ascending: true }),
    supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,product_id,active').order('name', { ascending: true }),
    supabase.from('inventory_lots').select('inventory_item_id,quantity_remaining').limit(50000),
    supabase.from('product_recipes').select('product_id,output_qty,waste_percent,product_recipe_components(id,inventory_item_id,quantity,unit,component_role,inventory_items(id,name,sku,item_type,base_unit,product_id,active))'),
    supabase.from('orders').select('id,status,order_items(product_id,qty)').in('status', ['New', 'Processing']).is('archived_at', null),
    supabase
      .from('orders')
      .select('id,status,created_at,order_items(product_id,qty)')
      .eq('status', 'Shipped')
      .gte('created_at', centralCalendarDateToUtc(historyLookbackStart).toISOString())
      .lt('created_at', centralCalendarDateToUtc(selectedWeekEndExclusive).toISOString()),
    supabase.from('recurring_orders').select('id,center_id,frequency,status,active,created_at,last_generated_at,recurring_order_items(product_id,qty),centers(is_active)').neq('status', 'canceled'),
    supabase.from('centers').select('id,name,is_active').eq('is_active', true).order('name', { ascending: true }),
    supabase.from('inventory_center_par_levels').select('center_id,product_id,par_qty,minimum_qty,notes,centers(name,is_active),products(name,active)'),
    supabase.from('inventory_movements').select('inventory_item_id,quantity_change').in('movement_type', ['shipment_consume', 'sample_box_consume']).is('lot_id', null).limit(50000),
  ]);

  const products = (productsResult.data ?? []) as ProductRow[];
  const activeProducts = products.filter((product) => product.active !== false);
  const items = (itemsResult.data ?? []) as InventoryItemRow[];
  const lots = (lotsResult.data ?? []) as any[];
  const recipes = (recipesResult.data ?? []) as RecipeRow[];
  const openOrders = (openOrdersResult.data ?? []) as any[];
  const shippedHistoryOrders = (shippedHistoryOrdersResult.data ?? []) as ShippedHistoryOrderRow[];
  const recurringOrders = (recurringOrdersResult.data ?? []) as RecurringOrderRow[];
  const centers = (centersResult.data ?? []) as any[];
  const parLevels = (parLevelsResult.data ?? []) as any[];
  const shortageMovements = shortageMovementsResult.error ? [] : ((shortageMovementsResult.data ?? []) as InventoryMovementRow[]);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const recipeByProductId = new Map(recipes.map((recipe) => [recipe.product_id, recipe]));
  const finishedItemByProductId = new Map(
    items
      .filter((item) => item.item_type === 'finished_good' && item.product_id)
      .map((item) => [item.product_id as string, item])
  );

  const onHandByItemId = new Map<string, number>();
  for (const lot of lots) {
    onHandByItemId.set(lot.inventory_item_id, (onHandByItemId.get(lot.inventory_item_id) ?? 0) + normalizeInventoryNumber(lot.quantity_remaining));
  }
  for (const movement of shortageMovements) {
    onHandByItemId.set(
      movement.inventory_item_id,
      (onHandByItemId.get(movement.inventory_item_id) ?? 0) + normalizeInventoryNumber(movement.quantity_change)
    );
  }

  const reservedQtyByProductId = new Map<string, number>();
  for (const order of openOrders) {
    for (const item of order.order_items ?? []) {
      addProductQty(reservedQtyByProductId, item.product_id, normalizeInventoryNumber(item.qty));
    }
  }

  const historyBucketsByProductId = new Map<string, number[]>();
  const selectedWeekShippedQtyByProductId = new Map<string, number>();
  for (const order of shippedHistoryOrders) {
    const orderDate = calendarDateForCentral(order.created_at);
    if (!orderDate) continue;
    const orderWeekStart = centralWeekStart(orderDate);
    const isHistoryWeek =
      compareCalendarDates(orderWeekStart, historyLookbackStart) >= 0 &&
      compareCalendarDates(orderWeekStart, historyAnchorWeekStart) < 0;
    const historyWeekIndex = isHistoryWeek ? Math.floor(calendarDaysBetween(orderWeekStart, historyLookbackStart) / 7) : -1;
    const isSelectedWeek = sameCalendarDate(orderWeekStart, selectedWeekStart);

    for (const item of order.order_items ?? []) {
      if (!item.product_id) continue;
      const qty = normalizeInventoryNumber(item.qty);
      if (historyWeekIndex >= 0 && historyWeekIndex < HISTORY_WEEK_COUNT) {
        const buckets = historyBucketsByProductId.get(item.product_id) ?? Array.from({ length: HISTORY_WEEK_COUNT }, () => 0);
        buckets[historyWeekIndex] += qty;
        historyBucketsByProductId.set(item.product_id, buckets);
      }
      if (isSelectedWeek) {
        addProductQty(selectedWeekShippedQtyByProductId, item.product_id, qty);
      }
    }
  }

  const recurringDueQtyByProductId = new Map<string, number>();
  for (const recurringOrder of recurringOrders) {
    const status = recurringOrder.status || (recurringOrder.active === false ? 'paused' : 'active');
    const center = relatedOne(recurringOrder.centers);
    const frequencyDays = daysForRecurringFrequency(recurringOrder.frequency);
    const anchorDate = calendarDateForCentral(recurringOrder.last_generated_at ?? recurringOrder.created_at);
    if (status !== 'active' || center?.is_active === false || !frequencyDays || !anchorDate) continue;

    let dueDate = addCalendarDays(anchorDate, frequencyDays);
    let guard = 0;
    while (compareCalendarDates(dueDate, selectedWeekStart) < 0 && guard < 260) {
      dueDate = addCalendarDays(dueDate, frequencyDays);
      guard += 1;
    }
    while (compareCalendarDates(dueDate, selectedWeekEnd) <= 0 && guard < 280) {
      for (const item of recurringOrder.recurring_order_items ?? []) {
        addProductQty(recurringDueQtyByProductId, item.product_id, normalizeInventoryNumber(item.qty));
      }
      dueDate = addCalendarDays(dueDate, frequencyDays);
      guard += 1;
    }
  }

  const parQtyByProductId = new Map<string, number>();
  const minimumQtyByProductId = new Map<string, number>();
  for (const parLevel of parLevels) {
    addProductQty(parQtyByProductId, parLevel.product_id, normalizeInventoryNumber(parLevel.par_qty));
    addProductQty(minimumQtyByProductId, parLevel.product_id, normalizeInventoryNumber(parLevel.minimum_qty));
  }

  const productionRows = activeProducts
    .map((product) => {
      const finishedItem = finishedItemByProductId.get(product.id);
      const onHand = finishedItem ? onHandByItemId.get(finishedItem.id) ?? 0 : 0;
      const reserved = reservedQtyByProductId.get(product.id) ?? 0;
      const available = onHand - reserved;
      const openOrderBacklog = isCurrentWeek ? reserved : 0;
      const recurringDueQty = recurringDueQtyByProductId.get(product.id) ?? 0;
      const historyBuckets = historyBucketsByProductId.get(product.id) ?? Array.from({ length: HISTORY_WEEK_COUNT }, () => 0);
      const historyWeeksWithSales = historyBuckets.filter((qty) => qty > 0).length;
      const historyWeeklyAverageQty = historyBuckets.reduce((sum, qty) => sum + qty, 0) / HISTORY_WEEK_COUNT;
      const selectedWeekShippedQty = selectedWeekShippedQtyByProductId.get(product.id) ?? 0;
      const historyForecastQty = isCurrentWeek
        ? Math.max(0, historyWeeklyAverageQty - selectedWeekShippedQty)
        : historyWeeklyAverageQty;
      const knownDemandQty = recurringDueQty + openOrderBacklog;
      const parQty = parQtyByProductId.get(product.id) ?? 0;
      const minimumQty = minimumQtyByProductId.get(product.id) ?? 0;
      const demandTargetQty = Math.max(knownDemandQty, historyForecastQty);
      const targetQty = Math.max(parQty, demandTargetQty, minimumQty);
      const suggestedProductionQty = Math.max(0, Math.ceil(targetQty - onHand));
      return {
        product,
        onHand,
        reserved,
        available,
        openOrderBacklog,
        recurringDueQty,
        historyForecastQty,
        historyWeeklyAverageQty,
        historyWeeksWithSales,
        selectedWeekShippedQty,
        knownDemandQty,
        parQty,
        minimumQty,
        demandTargetQty,
        targetQty,
        suggestedProductionQty,
        forecastConfidence: forecastConfidence(historyWeeksWithSales, knownDemandQty > 0),
        hasRecipe: recipeByProductId.has(product.id),
      };
    })
    .filter((row) => row.suggestedProductionQty || row.recurringDueQty || row.historyForecastQty || row.parQty || row.openOrderBacklog || row.minimumQty || row.onHand)
    .sort((a, b) => b.suggestedProductionQty - a.suggestedProductionQty || productName(a.product).localeCompare(productName(b.product)));

  const materialDemandByItemId = new Map<string, { item: InventoryItemRow; requiredQty: number; sourceProducts: Set<string> }>();
  for (const row of productionRows) {
    if (row.suggestedProductionQty <= 0) continue;
    const recipe = recipeByProductId.get(row.product.id);
    if (!recipe) continue;
    const outputQty = normalizeInventoryNumber(recipe.output_qty) || 1;
    const wasteMultiplier = 1 + normalizeInventoryNumber(recipe.waste_percent) / 100;
    for (const component of recipe.product_recipe_components ?? []) {
      const item = relatedOne(component.inventory_items) ?? itemsById.get(component.inventory_item_id);
      if (!item) continue;
      try {
        const recipeUnitQty = (normalizeInventoryNumber(component.quantity) / outputQty) * row.suggestedProductionQty * wasteMultiplier;
        const baseQty = convertInventoryQuantity(recipeUnitQty, component.unit, item.base_unit);
        const existing = materialDemandByItemId.get(item.id) ?? { item, requiredQty: 0, sourceProducts: new Set<string>() };
        existing.requiredQty += baseQty;
        existing.sourceProducts.add(row.product.id);
        materialDemandByItemId.set(item.id, existing);
      } catch {
        // Production validation will block unsupported conversions.
      }
    }
  }

  const materialRows = [...materialDemandByItemId.values()]
    .map((row) => {
      const onHand = onHandByItemId.get(row.item.id) ?? 0;
      return {
        ...row,
        onHand,
        shortageQty: Math.max(0, row.requiredQty - onHand),
      };
    })
    .sort((a, b) => b.shortageQty - a.shortageQty || itemDisplayName(a.item).localeCompare(itemDisplayName(b.item)));

  const totalSuggestedQty = productionRows.reduce((sum, row) => sum + row.suggestedProductionQty, 0);
  const totalRecurringDueQty = productionRows.reduce((sum, row) => sum + row.recurringDueQty, 0);
  const totalBacklogQty = productionRows.reduce((sum, row) => sum + row.openOrderBacklog, 0);
  const totalHistoryForecastQty = productionRows.reduce((sum, row) => sum + row.historyForecastQty, 0);
  const totalKnownDemandQty = productionRows.reduce((sum, row) => sum + row.knownDemandQty, 0);
  const productsToMake = productionRows.filter((row) => row.suggestedProductionQty > 0).length;

  return (
    <div className="space-y-6">
      {toast === 'production_recorded' ? <StatusToast message="Forecasted production was recorded and inventory updated." tone="success" /> : null}
      {toast === 'production_error' || toast === 'recipe_error' ? <StatusToast message="Unable to produce that item. Check recipe setup and available materials." tone="error" /> : null}
      {toast === 'insufficient_inventory' ? <StatusToast message="Unable to produce that item because one or more recipe materials do not have enough inventory." tone="error" /> : null}
      {toast === 'unit_error' ? <StatusToast message="A recipe component uses units that cannot be converted." tone="error" /> : null}
      {toast === 'invalid_quantity' ? <StatusToast message="Enter a whole number greater than zero before adding production." tone="error" /> : null}
      {toast === 'par_saved' ? <StatusToast message="Par target saved." tone="success" /> : null}
      {toast === 'par_error' ? <StatusToast message="Unable to save par target." tone="error" /> : null}
      {toast === 'admin_write_denied' ? <StatusToast message="Only superadmins can change admin data." tone="error" /> : null}

      <section className="panel">
        <span className="eyebrow">Planning</span>
        <h1 className="page-title mt-4">Production planning</h1>
        <p className="page-subtitle mt-3">Forecast production week by week from shipped order history, recurring schedules, open order backlog, and center par targets.</p>
      </section>

      <section className="card space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <span className="eyebrow">{weekTitle}</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{displayWeekRange(selectedWeekStart)}</h2>
            <p className="mt-2 text-sm text-slate-500">Finished products may go negative in availability, but raw coffee and materials still need stock before production can record.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isCurrentWeek ? <Link className="btn-secondary" href={planningHref({ week_start: dateInputValue(currentWeekStart) })}>This Week</Link> : null}
            {!isCurrentWeek ? <Link className="btn-secondary" href={planningHref({ week_start: dateInputValue(previousWeekStart) })}>Previous Week</Link> : null}
            <Link className="btn-primary" href={planningHref({ week_start: dateInputValue(nextWeekStart) })}>Next Week</Link>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Suggested</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatWholeEach(totalSuggestedQty)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Known Demand</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatWholeEach(totalKnownDemandQty)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Recurring Due</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatWholeEach(totalRecurringDueQty)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Open Backlog</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatWholeEach(totalBacklogQty)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">History Forecast</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatWholeEach(totalHistoryForecastQty)}</p>
          </div>
          <div className="stat-card">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Products</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{productsToMake.toLocaleString('en-US')}</p>
          </div>
        </div>
        <div className="space-y-3">
          {productionRows.map((row) => (
            <div key={row.product.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(30rem,0.95fr)]">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">{productName(row.product)}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Target {formatWholeEach(row.targetQty)} - On hand {formatWholeEach(row.onHand)} - Available {formatWholeEach(row.available)}
                  </p>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-3 xl:grid-cols-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Suggested</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatWholeEach(row.suggestedProductionQty)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Recurring</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatWholeEach(row.recurringDueQty)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Open Orders</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatWholeEach(row.openOrderBacklog)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">History</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatWholeEach(row.historyForecastQty)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Avg {formatWholeEach(row.historyWeeklyAverageQty)} / {row.historyWeeksWithSales}/8 weeks
                    </p>
                    {isCurrentWeek && row.selectedWeekShippedQty > 0 ? (
                      <p className="mt-1 text-xs text-slate-500">Shipped this week {formatWholeEach(row.selectedWeekShippedQty)}</p>
                    ) : null}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Confidence</p>
                    <span className={`mt-1 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${confidenceTone(row.forecastConfidence)}`}>{row.forecastConfidence}</span>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Par / Min</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatWholeEach(row.parQty)} / {formatWholeEach(row.minimumQty)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Stock</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatWholeEach(row.onHand)}</p>
                    <p className="mt-1 text-xs text-slate-500">Reserved {formatWholeEach(row.reserved)} / Available {formatWholeEach(row.available)}</p>
                  </div>
                </div>
              </div>
              <form action={producePlannedInventory} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)] sm:items-end">
                <input type="hidden" name="product_id" value={row.product.id} />
                <input type="hidden" name="week_start" value={selectedWeekStartInput} />
                <label className="space-y-2 text-sm font-medium text-slate-700">
                  Quantity produced
                  <input
                    className="input"
                    defaultValue={Math.max(1, row.suggestedProductionQty)}
                    disabled={!row.hasRecipe || row.suggestedProductionQty <= 0}
                    min="1"
                    name="quantity_produced"
                    step="1"
                    type="number"
                  />
                </label>
                <PlanningSubmitButton disabled={!row.hasRecipe || row.suggestedProductionQty <= 0} />
              </form>
              {!row.hasRecipe ? <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">Save a recipe on this product before production can be recorded.</p> : null}
            </div>
          ))}
          {!productionRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No production suggestions for this week.</p> : null}
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Materials To Prep</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Recipe inputs needed</h2>
            <p className="mt-2 text-sm text-slate-500">Projected raw coffee and materials needed for this week&apos;s suggested production quantity.</p>
          </div>
          <div className="space-y-3">
            {materialRows.map((row) => (
              <div key={row.item.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-950">{itemDisplayName(row.item)}</p>
                    <p className="mt-1 text-sm text-slate-500">{row.sourceProducts.size} source product{row.sourceProducts.size === 1 ? '' : 's'}</p>
                  </div>
                  <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${row.shortageQty > 0 ? 'bg-rose-50 text-rose-700' : 'bg-teal-50 text-teal-800'}`}>
                    {row.shortageQty > 0 ? 'Short' : 'Covered'}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Needed</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatRoundedInventoryQuantity(row.requiredQty, row.item.base_unit)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">On hand</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatRoundedInventoryQuantity(row.onHand, row.item.base_unit)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Short</p>
                    <p className={`mt-1 font-semibold ${row.shortageQty > 0 ? 'text-rose-700' : 'text-slate-950'}`}>{formatRoundedInventoryQuantity(row.shortageQty, row.item.base_unit)}</p>
                  </div>
                </div>
              </div>
            ))}
            {!materialRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">Material needs appear after suggested products have recipes.</p> : null}
          </div>
        </div>

        <form action={updateCenterParLevel} className="card h-fit space-y-4">
          <div>
            <span className="eyebrow">Par Targets</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Set customer par</h2>
            <p className="mt-2 text-sm text-slate-500">Use par levels when you want planning to keep extra product ready for a center.</p>
          </div>
          <select className="input" name="center_id" required defaultValue="">
            <option value="" disabled>Select customer</option>
            {centers.map((center: any) => <option key={center.id} value={center.id}>{center.name || 'Unnamed center'}</option>)}
          </select>
          <select className="input" name="product_id" required defaultValue="">
            <option value="" disabled>Select product</option>
            {activeProducts.map((product) => <option key={product.id} value={product.id}>{productName(product)}</option>)}
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" name="par_qty" min="0" step="1" type="number" placeholder="Par quantity" />
            <input className="input" name="minimum_qty" min="0" step="1" type="number" placeholder="Minimum quantity" />
          </div>
          <textarea className="input min-h-20" name="notes" placeholder="Notes" />
          <PendingSubmitButton className="btn-primary w-full sm:w-auto" label="Save par target" pendingLabel="Saving..." />
        </form>
      </section>
    </div>
  );
}

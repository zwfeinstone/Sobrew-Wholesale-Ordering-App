import { daysForRecurringFrequency } from '@/lib/recurring';
import { parseCentralDateInput } from '@/lib/time-clock';

export const PRODUCTION_PLANNING_TIME_ZONE = 'America/Chicago';
export const PRODUCTION_PLANNING_HISTORY_WEEKS = 8;

export type PlanningConfidence = 'High' | 'Medium' | 'Low';
export type PlanningProductInput = { id: string; name: string | null; sku?: string | null; active?: boolean | null; category?: string | null };
export type PlanningLineInput = { product_id: string | null; qty: number | string | null };
export type PlanningOrderInput = {
  id: string;
  center_id?: string | null;
  status: string | null;
  created_at: string | null;
  shipped_at?: string | null;
  archived_at?: string | null;
  recurring_order_id?: string | null;
  recurring_scheduled_for?: string | null;
  customer_name?: string | null;
  order_items?: PlanningLineInput[] | null;
};
export type PlanningScheduleInput = {
  id: string;
  center_id?: string | null;
  status: string | null;
  active?: boolean | null;
  frequency: string;
  next_run_at: string | null;
  center_active?: boolean | null;
  customer_name?: string | null;
  recurring_order_items?: PlanningLineInput[] | null;
};
export type PlanningParInput = {
  product_id: string | null;
  center_id?: string | null;
  par_qty: number | string | null;
  minimum_qty: number | string | null;
  center_active?: boolean | null;
};
export type PlanningOccurrenceInput = { recurring_order_id: string | null; recurring_scheduled_for: string | null };
export type ProductionPlanningInput = {
  now: string | Date;
  products: PlanningProductInput[];
  stockByProductId: Record<string, number>;
  orders: PlanningOrderInput[];
  schedules: PlanningScheduleInput[];
  pars: PlanningParInput[];
  generatedOccurrences?: PlanningOccurrenceInput[];
};

export type ProductionDemandEvent = {
  id: string;
  productId: string;
  source: 'order' | 'recurring';
  customerName: string;
  quantity: number;
  shortageQty: number;
  orderId: string | null;
  recurringOrderId: string | null;
  scheduledFor: string | null;
  orderDate: string | null;
  scheduledDate: string | null;
  prepareDate: string;
  isRecurring: boolean;
  isOverdue: boolean;
  isNow: boolean;
  needsReview: boolean;
};

export type ProductionScheduleReview = {
  scheduleId: string;
  customerName: string;
  reason: 'missing_date' | 'invalid_frequency' | 'missed_cycles' | 'missing_items';
  message: string;
  missedOccurrenceCount: number;
  affectedProductIds: string[];
};

export type ProductionPlanningProduct = {
  product: PlanningProductInput;
  onHand: number;
  availableAfterOpenOrders: number;
  openOrderQty: number;
  recurringNowQty: number;
  nowDemandQty: number;
  makeNowQty: number;
  stockCorrectionQty: number;
  parQty: number;
  minimumQty: number;
  historyWeeklyAverageQty: number;
  historyWeeksWithSales: number;
  shippedThisWeekQty: number;
  historyRemainingQty: number;
  confidence: PlanningConfidence;
  replenishmentTargetQty: number;
  replenishmentQty: number;
  explicitReplenishmentQty: number;
  historyReplenishmentQty: number;
  actionableReplenishmentQty: number;
  reviewReplenishmentQty: number;
  outlookQty: number;
  reviewRecurringQty: number;
  nextPrepareDate: string | null;
  nextScheduledDate: string | null;
  hasRecurring: boolean;
  events: ProductionDemandEvent[];
  makeNowReason: string;
  replenishmentReason: string;
};

export type ProductionPlan = {
  today: string;
  horizonEnd: string;
  historyStart: string;
  currentWeekStart: string;
  products: ProductionPlanningProduct[];
  scheduleReviews: ProductionScheduleReview[];
};

const centralDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PRODUCTION_PLANNING_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
});

function numeric(value: number | string | null | undefined) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function positive(value: number | string | null | undefined) {
  return Math.max(0, numeric(value));
}

/** Chicago calendar date, except date-only values which already name a calendar day. */
export function planningDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const checked = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(checked.getTime()) || checked.toISOString().slice(0, 10) !== value ? null : value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = centralDateFormatter.formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addPlanningDays(date: string, days: number) {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function subtractPlanningBusinessDays(date: string, days = 2) {
  let result = date;
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    result = addPlanningDays(result, -1);
    const weekday = new Date(`${result}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return result;
}

export function planningWeekStart(date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addPlanningDays(date, -((weekday + 6) % 7));
}

export function productionPlanningQueryWindow(now: string | Date) {
  const today = planningDateKey(now);
  if (!today) throw new Error('Production planning requires a valid current date.');
  const weekStart = planningWeekStart(today);
  const midnight = (date: string) => {
    const parsed = parseCentralDateInput(date);
    if (!parsed) throw new Error('Invalid production planning date.');
    return parsed.toISOString();
  };
  return {
    historyStart: midnight(addPlanningDays(weekStart, -7 * PRODUCTION_PLANNING_HISTORY_WEEKS)),
    historyEnd: midnight(addPlanningDays(weekStart, 7)),
    outlookEnd: midnight(addPlanningDays(today, 14)),
  };
}

function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
}

function occurrenceKey(scheduleId: string | null | undefined, timestamp: string | null | undefined) {
  if (!scheduleId || !timestamp) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : `${scheduleId}:${parsed.toISOString()}`;
}

function groupedLines(lines: PlanningLineInput[] | null | undefined) {
  const quantities = new Map<string, number>();
  for (const item of lines ?? []) {
    if (!item.product_id || positive(item.qty) <= 0) continue;
    quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + positive(item.qty));
  }
  return quantities;
}

function compareEvents(left: ProductionDemandEvent, right: ProductionDemandEvent) {
  if (left.source !== right.source) return left.source === 'order' ? -1 : 1;
  const leftDate = left.source === 'order' ? left.orderDate ?? left.prepareDate : left.scheduledDate ?? left.prepareDate;
  const rightDate = right.source === 'order' ? right.orderDate ?? right.prepareDate : right.scheduledDate ?? right.prepareDate;
  return leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id);
}

function confidenceFor(weeksWithSales: number): PlanningConfidence {
  return weeksWithSales >= 6 ? 'High' : weeksWithSales >= 3 ? 'Medium' : 'Low';
}

export function buildProductionPlan(input: ProductionPlanningInput): ProductionPlan {
  const today = planningDateKey(input.now);
  if (!today) throw new Error('Production planning requires a valid current date.');
  const horizonEnd = addPlanningDays(today, 13);
  const currentWeekStart = planningWeekStart(today);
  const historyStart = addPlanningDays(currentWeekStart, -7 * PRODUCTION_PLANNING_HISTORY_WEEKS);
  const currentWeekEnd = addPlanningDays(currentWeekStart, 7);
  const openOrderProductIds = new Set(input.orders
    .filter((order) => (order.status === 'New' || order.status === 'Processing') && !order.archived_at)
    .flatMap((order) => [...groupedLines(order.order_items).keys()]));
  const activeProductIds = new Set(input.products.filter((product) => product.active !== false).map((product) => product.id));
  // Removing a product from the catalog must not hide work already promised
  // to a customer. Only speculative replenishment follows catalog availability.
  const products = input.products.filter((product) => product.active !== false || openOrderProductIds.has(product.id));
  const productIds = new Set(products.map((product) => product.id));
  const eventsByProduct = new Map<string, ProductionDemandEvent[]>();
  const historyByProduct = new Map<string, number[]>();
  const shippedByProduct = new Map<string, number>();
  const scheduleReviews: ProductionScheduleReview[] = [];
  const generated = new Set<string>();
  for (const occurrence of [...input.orders, ...(input.generatedOccurrences ?? [])]) {
    const key = occurrenceKey(occurrence.recurring_order_id, occurrence.recurring_scheduled_for);
    if (key) generated.add(key);
  }
  const addEvent = (event: ProductionDemandEvent) => {
    if (!productIds.has(event.productId)) return;
    const entries = eventsByProduct.get(event.productId) ?? [];
    entries.push(event);
    eventsByProduct.set(event.productId, entries);
  };

  const seenOrders = new Set<string>();
  for (const order of input.orders) {
    if (seenOrders.has(order.id)) continue;
    seenOrders.add(order.id);
    const lines = groupedLines(order.order_items);
    if ((order.status === 'New' || order.status === 'Processing') && !order.archived_at) {
      for (const [productId, quantity] of lines) {
        addEvent({
          id: `order:${order.id}:${productId}`, productId, source: 'order', quantity,
          customerName: order.customer_name?.trim() || 'Customer order', shortageQty: 0,
          orderId: order.id, recurringOrderId: order.recurring_order_id ?? null,
          scheduledFor: order.recurring_scheduled_for ?? null,
          orderDate: planningDateKey(order.created_at), scheduledDate: planningDateKey(order.recurring_scheduled_for),
          prepareDate: today, isRecurring: Boolean(order.recurring_order_id),
          isOverdue: false, isNow: true, needsReview: false,
        });
      }
    }
    if (order.status !== 'Shipped') continue;
    const shipmentDate = planningDateKey(order.shipped_at) ?? planningDateKey(order.created_at);
    if (!shipmentDate || shipmentDate >= currentWeekEnd) continue;
    for (const [productId, quantity] of lines) {
      if (shipmentDate >= currentWeekStart) {
        shippedByProduct.set(productId, (shippedByProduct.get(productId) ?? 0) + quantity);
      } else if (shipmentDate >= historyStart) {
        const bucket = Math.floor(daysBetween(historyStart, shipmentDate) / 7);
        const history = historyByProduct.get(productId) ?? Array<number>(PRODUCTION_PLANNING_HISTORY_WEEKS).fill(0);
        history[bucket] += quantity;
        historyByProduct.set(productId, history);
      }
    }
  }

  for (const schedule of input.schedules) {
    if (schedule.status !== 'active' || schedule.active === false || schedule.center_active === false) continue;
    const lines = groupedLines(schedule.recurring_order_items);
    const affectedProductIds = [...lines.keys()].filter((id) => productIds.has(id));
    const customerName = schedule.customer_name?.trim() || 'Recurring customer';
    const review = (reason: ProductionScheduleReview['reason'], message: string, missedOccurrenceCount = 0) => {
      scheduleReviews.push({ scheduleId: schedule.id, customerName, reason, message, missedOccurrenceCount, affectedProductIds });
    };
    const firstDate = planningDateKey(schedule.next_run_at);
    if (!firstDate) {
      review('missing_date', 'This active recurring order has no valid next order date. Check its schedule before producing.');
      continue;
    }
    const frequencyDays = daysForRecurringFrequency(schedule.frequency);
    if (!frequencyDays) {
      review('invalid_frequency', 'This recurring order has an unsupported repeat interval. Check its schedule before producing.');
      continue;
    }
    if (!lines.size) {
      review('missing_items', 'This recurring order has no usable product quantities. Check its items before producing.');
      continue;
    }
    if ((schedule.recurring_order_items ?? []).some((item) => positive(item.qty) > 0 && (!item.product_id || !activeProductIds.has(item.product_id)))) {
      review('missing_items', 'This recurring order includes an inactive or unavailable product. Review those items before producing; only available products appear in the forecast.');
    }
    if (firstDate > horizonEnd) continue;
    const occurrences: Array<{ date: string; timestamp: string }> = [];
    const count = Math.floor(daysBetween(firstDate, horizonEnd) / frequencyDays) + 1;
    for (let index = 0; index < count; index += 1) {
      const date = addPlanningDays(firstDate, index * frequencyDays);
      const timestamp = index === 0 ? schedule.next_run_at! : `${date}T12:00:00.000Z`;
      const key = occurrenceKey(schedule.id, timestamp);
      if (key && !generated.has(key)) occurrences.push({ date, timestamp });
    }
    const missedCount = occurrences.filter((occurrence) => occurrence.date < today).length;
    if (missedCount > 1) review('missed_cycles', `${missedCount} past recurring dates need review. Confirm catch-up quantities before producing them.`, missedCount);
    for (const occurrence of occurrences) {
      const prepareDate = subtractPlanningBusinessDays(occurrence.date);
      const isOverdue = occurrence.date < today;
      const needsReview = missedCount > 1 && isOverdue;
      for (const [productId, quantity] of lines) {
        if (!activeProductIds.has(productId)) continue;
        addEvent({
          id: `recurring:${schedule.id}:${occurrence.timestamp}:${productId}`, productId,
          source: 'recurring', customerName, quantity, shortageQty: 0,
          orderId: null, recurringOrderId: schedule.id, scheduledFor: occurrence.timestamp,
          orderDate: null, scheduledDate: occurrence.date, prepareDate,
          isRecurring: true, isOverdue, isNow: !needsReview && prepareDate <= today, needsReview,
        });
      }
    }
  }

  const pars = new Map<string, { par: number; minimum: number }>();
  for (const entry of input.pars) {
    if (!entry.product_id || entry.center_active === false) continue;
    const aggregate = pars.get(entry.product_id) ?? { par: 0, minimum: 0 };
    aggregate.par += positive(entry.par_qty);
    aggregate.minimum += positive(entry.minimum_qty);
    pars.set(entry.product_id, aggregate);
  }

  const rows = products.map((product): ProductionPlanningProduct => {
    const onHand = numeric(input.stockByProductId[product.id]);
    const events = (eventsByProduct.get(product.id) ?? []).sort(compareEvents);
    let remainingStock = Math.max(0, onHand);
    for (const event of events) {
      if (event.needsReview) continue;
      const covered = Math.min(remainingStock, event.quantity);
      event.shortageQty = event.quantity - covered;
      remainingStock -= covered;
    }
    const openOrderQty = events.filter((event) => event.source === 'order').reduce((sum, event) => sum + event.quantity, 0);
    const recurringNowQty = events.filter((event) => event.source === 'recurring' && event.isNow).reduce((sum, event) => sum + event.quantity, 0);
    const nowDemandQty = openOrderQty + recurringNowQty;
    const makeNowQty = Math.max(0, Math.ceil(nowDemandQty - onHand));
    const stockCorrectionQty = Math.max(0, -onHand);
    const history = historyByProduct.get(product.id) ?? Array<number>(PRODUCTION_PLANNING_HISTORY_WEEKS).fill(0);
    const historyWeeklyAverageQty = history.reduce((sum, quantity) => sum + quantity, 0) / PRODUCTION_PLANNING_HISTORY_WEEKS;
    const historyWeeksWithSales = history.filter((quantity) => quantity > 0).length;
    const shippedThisWeekQty = shippedByProduct.get(product.id) ?? 0;
    const historyRemainingQty = product.active === false ? 0 : Math.max(0, historyWeeklyAverageQty - shippedThisWeekQty);
    const confidence = confidenceFor(historyWeeksWithSales);
    const par = product.active === false ? { par: 0, minimum: 0 } : pars.get(product.id) ?? { par: 0, minimum: 0 };
    const explicitTarget = Math.max(par.par, par.minimum);
    const replenishmentTargetQty = Math.max(explicitTarget, historyRemainingQty);
    // Make-now output covers overlapping targets; signed stock prevents debt units
    // from being incorrectly counted as stock available for replenishment.
    const afterMakeNow = onHand + makeNowQty;
    const replenishmentQty = Math.max(0, Math.ceil(replenishmentTargetQty - afterMakeNow));
    const explicitReplenishmentQty = Math.max(0, Math.ceil(explicitTarget - afterMakeNow));
    const historyReplenishmentQty = Math.max(0, replenishmentQty - explicitReplenishmentQty);
    const reviewReplenishmentQty = confidence === 'Low' ? historyReplenishmentQty : 0;
    const actionableReplenishmentQty = replenishmentQty - reviewReplenishmentQty;
    const outlook = events.filter((event) => !event.isNow && !event.needsReview);
    const upcomingShortages = events.filter((event) => !event.needsReview && event.shortageQty > 0);
    const nextPrepareDate = upcomingShortages.map((event) => event.prepareDate).sort()[0] ?? (stockCorrectionQty > 0 ? today : null);
    const nextScheduledDate = events.filter((event) => !event.needsReview && event.scheduledDate)
      .map((event) => event.scheduledDate!).sort()[0] ?? null;
    const reasonParts = [
      openOrderQty > 0 ? `${openOrderQty} for open orders` : '',
      recurringNowQty > 0 ? `${recurringNowQty} for recurring orders ready to prepare` : '',
      stockCorrectionQty > 0 ? `${stockCorrectionQty} to clear the inventory shortfall` : '',
    ].filter(Boolean);
    return {
      product, onHand, availableAfterOpenOrders: onHand - openOrderQty,
      openOrderQty, recurringNowQty, nowDemandQty, makeNowQty, stockCorrectionQty,
      parQty: par.par, minimumQty: par.minimum,
      historyWeeklyAverageQty, historyWeeksWithSales, shippedThisWeekQty, historyRemainingQty, confidence,
      replenishmentTargetQty, replenishmentQty, explicitReplenishmentQty, historyReplenishmentQty,
      actionableReplenishmentQty, reviewReplenishmentQty,
      outlookQty: outlook.reduce((sum, event) => sum + event.shortageQty, 0),
      reviewRecurringQty: events.filter((event) => event.needsReview).reduce((sum, event) => sum + event.quantity, 0),
      nextPrepareDate, nextScheduledDate, hasRecurring: events.some((event) => event.isRecurring), events,
      makeNowReason: makeNowQty > 0
        ? `${reasonParts.join('; ')}. Recorded stock: ${onHand}. Make ${makeNowQty} to cover the gap.`
        : nowDemandQty > 0 ? 'Recorded stock covers orders ready to prepare.' : 'No customer orders need production now.',
      replenishmentReason: replenishmentQty > 0
        ? `Target ${replenishmentTargetQty} total units from ${explicitTarget >= historyRemainingQty ? 'saved stock targets' : 'the remaining weekly history estimate'}, with ${afterMakeNow} covered by recorded stock and make-now production.`
        : 'Recorded stock and make-now production cover the weekly replenishment target.',
    };
  });
  return { today, horizonEnd, historyStart, currentWeekStart, products: rows, scheduleReviews };
}

export type ProductionPlanningSort = 'priority' | 'confidence' | 'quantity' | 'name';

export function sortProductionPlanningProducts(rows: ProductionPlanningProduct[], sort: ProductionPlanningSort = 'priority') {
  const confidenceRank: Record<PlanningConfidence, number> = { High: 0, Medium: 1, Low: 2 };
  const name = (row: ProductionPlanningProduct) => row.product.name?.trim() || 'Unnamed product';
  const byName = (left: ProductionPlanningProduct, right: ProductionPlanningProduct) => name(left).localeCompare(name(right)) || left.product.id.localeCompare(right.product.id);
  return [...rows].sort((left, right) => {
    if (sort === 'name') return byName(left, right);
    if (sort === 'confidence') return confidenceRank[left.confidence] - confidenceRank[right.confidence] || byName(left, right);
    if (sort === 'quantity') return (right.makeNowQty + right.actionableReplenishmentQty) - (left.makeNowQty + left.actionableReplenishmentQty) || byName(left, right);
    const group = (row: ProductionPlanningProduct) => row.makeNowQty > 0 ? 0 : row.outlookQty > 0 ? 1 : row.actionableReplenishmentQty > 0 ? 2 : 3;
    return group(left) - group(right)
      || (left.nextPrepareDate ?? '9999').localeCompare(right.nextPrepareDate ?? '9999')
      || confidenceRank[left.confidence] - confidenceRank[right.confidence]
      || byName(left, right);
  });
}

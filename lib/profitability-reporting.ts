const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type ProfitabilityOrderRow = {
  id: string;
  center_id: string | null;
  status: string | null;
  subtotal_cents: number | string | null;
  donation_cogs_cents?: number | string | null;
  processing_fee_cents?: number | string | null;
  shipping_cost_cents?: number | string | null;
  created_at: string | null;
  shipped_at?: string | null;
};

export type ProfitabilityOrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name_snapshot: string | null;
  qty: number | string | null;
  unit_price_cents: number | string | null;
  line_total_cents: number | string | null;
  shipping_boxes_used?: number | string | null;
  cogs_material_cents?: number | string | null;
  cogs_labor_cents?: number | string | null;
  cogs_fixed_cents?: number | string | null;
  cogs_tape_cents?: number | string | null;
  cogs_shipping_label_cents?: number | string | null;
  cogs_branding_label_cents?: number | string | null;
  cogs_fixed_other_cents?: number | string | null;
  cogs_product_cents?: number | string | null;
  cogs_shipping_cents?: number | string | null;
  cogs_processing_fee_cents?: number | string | null;
  cogs_donation_cents?: number | string | null;
  cogs_total_cents?: number | string | null;
  cogs_unit_cents?: number | string | null;
  cogs_source?: string | null;
  cogs_estimated?: boolean | null;
  cogs_snapshot_at?: string | null;
};

export type ProfitabilityCenterRow = {
  id: string;
  name: string;
  revenueCents: number;
  materialCents: number;
  laborCents: number;
  fixedCents: number;
  productCogsCents: number;
  shippingCogsCents: number;
  processingFeeCogsCents: number;
  donationCogsCents: number;
  totalCogsCents: number;
  grossProfitCents: number;
  marginPercent: number;
  orderCount: number;
  averageOrderValueCents: number;
  estimatedLineCount: number;
};

export type ProfitabilityItemRow = {
  id: string;
  name: string;
  unitsSold: number;
  revenueCents: number;
  revenuePerUnitCents: number;
  productCogsCents: number;
  productCogsPerUnitCents: number;
  shippingCogsCents: number;
  processingFeeCogsCents: number;
  donationCogsCents: number;
  grossProfitBeforeShippingCents: number;
  grossProfitAfterShippingCents: number;
  marginBeforeShippingPercent: number;
  marginAfterShippingPercent: number;
  orderCount: number;
  estimatedLineCount: number;
};

export type ProfitabilityTotals = {
  revenueCents: number;
  materialCents: number;
  laborCents: number;
  fixedCents: number;
  tapeCents: number;
  shippingLabelCents: number;
  brandingLabelCents: number;
  fixedOtherCents: number;
  productCogsCents: number;
  shippingCogsCents: number;
  processingFeeCogsCents: number;
  donationCogsCents: number;
  totalCogsCents: number;
  grossProfitCents: number;
  marginPercent: number;
  orderCount: number;
  unitsSold: number;
  snapshotLineCount: number;
  estimatedLineCount: number;
};

export type MarginBridgeRow = {
  label: string;
  effectCents: number;
  detail: string;
};

export type MarginHealthValueFormat = 'currency' | 'number' | 'percent';

export type MarginHealthMetricRow = {
  id: string;
  label: string;
  currentValue: number;
  baselineValue: number;
  previousValue: number;
  changeValue: number;
  estimatedImpactCents: number;
  format: MarginHealthValueFormat;
  detail: string;
};

export type MarginLeakRow = {
  id: string;
  label: string;
  currentRevenueCents: number;
  currentMarginPercent: number;
  baselineMarginPercent: number | null;
  marginPointChange: number | null;
  estimatedImpactCents: number;
  status: 'declined' | 'improved' | 'flat' | 'new';
};

export type CogsTimingSummary = {
  shippedProductCogsCents: number;
  shippedTotalCogsCents: number;
  shippedLaborCogsCents: number;
  productionActualCogsCents: number;
  productionLaborCogsCents: number;
  inventoryFinishedValueCents: number;
  inventoryFinishedLaborCents: number;
  positiveFinishedUnits: number;
  netFinishedUnits: number;
  lotlessShortageUnits: number;
  hasEstimatedInventoryLabor: boolean;
};

export type MarginHealthSummary = {
  baselineRange: {
    previousEndExclusive: Date;
    previousStart: Date;
    trailingEndExclusive: Date;
    trailingStart: Date;
  };
  salesMetrics: MarginHealthMetricRow[];
  unitEconomicsRows: MarginHealthMetricRow[];
  productLeaks: MarginLeakRow[];
  centerLeaks: MarginLeakRow[];
  cogsTiming: CogsTimingSummary;
};

export type ProductionCogsRow = {
  id: string;
  productId: string;
  productName: string;
  producedAt: Date | null;
  quantityProduced: number;
  estimatedCostCents: number;
  actualCostCents: number;
  materialCostCents: number;
  laborCostCents: number;
  fixedCostCents: number;
  varianceCents: number;
  unitCostCents: number;
  materialUsageVarianceQty: number;
};

export type InventoryValueRow = {
  id: string;
  name: string;
  itemType: string;
  quantityOnHand: number;
  unitLabel: string;
  valueCents: number;
  averageUnitCostCents: number;
};

export type NonInventoryExpenseRow = {
  type: string;
  label: string;
  amountCents: number;
  count: number;
};

export type FixedExpenseComparisonRow = {
  label: string;
  imputedCogsCents: number;
  expenseSpendCents: number;
  varianceCents: number;
};

export type ProfitabilityDashboard = {
  current: ProfitabilityTotals;
  previous: ProfitabilityTotals;
  centerRows: ProfitabilityCenterRow[];
  itemRows: ProfitabilityItemRow[];
  marginHealth: MarginHealthSummary;
  marginBridgeRows: MarginBridgeRow[];
  productionRows: ProductionCogsRow[];
  productionSummary: {
    actualCostCents: number;
    estimatedCostCents: number;
    fixedCostCents: number;
    laborCostCents: number;
    materialCostCents: number;
    quantityProduced: number;
    runCount: number;
    varianceCents: number;
  };
  inventoryRows: InventoryValueRow[];
  inventorySummary: {
    rawCoffeeValueCents: number;
    materialSupplyValueCents: number;
    sellableValueCents: number;
    negativeSellableCount: number;
  };
  expenseRows: NonInventoryExpenseRow[];
  fixedExpenseComparisonRows: FixedExpenseComparisonRow[];
};

type CenterRow = {
  id: string;
  name: string | null;
};

type ProductRow = {
  id: string;
  name: string | null;
  sku?: string | null;
};

type ProductionRunRow = {
  id: string;
  product_id: string;
  quantity_produced: number | string | null;
  quantity_voided?: number | string | null;
  status?: string | null;
  estimated_unit_cost_cents: number | string | null;
  actual_unit_cost_cents: number | string | null;
  actual_labor_cost_cents?: number | string | null;
  fixed_cost_cents?: number | string | null;
  fixed_tape_cost_cents?: number | string | null;
  fixed_shipping_label_cost_cents?: number | string | null;
  fixed_branding_label_cost_cents?: number | string | null;
  fixed_other_cost_cents?: number | string | null;
  produced_at: string | null;
};

type ProductionRunInputRow = {
  production_run_id: string;
  quantity_expected: number | string | null;
  quantity_used: number | string | null;
  cost_cents: number | string | null;
};

type InventoryItemRow = {
  id: string;
  name: string;
  item_type: string;
  base_unit: string;
  product_id: string | null;
};

type InventoryLotRow = {
  inventory_item_id: string;
  production_run_id?: string | null;
  quantity_remaining: number | string | null;
  unit_cost_cents?: number | string | null;
};

type InventoryMovementRow = {
  inventory_item_id: string;
  quantity_change: number | string | null;
  unit_cost_cents?: number | string | null;
};

type NonInventoryExpenseInputRow = {
  expense_type: string;
  amount_cents: number | string | null;
  spent_at: string | null;
};

type NormalizedLine = {
  centerId: string | null;
  date: Date;
  estimated: boolean;
  fixedCents: number;
  fixedOtherCents: number;
  brandingLabelCents: number;
  donationCogsCents: number;
  id: string;
  laborCents: number;
  materialCents: number;
  orderId: string;
  productCogsCents: number;
  productId: string | null;
  productName: string;
  qty: number;
  revenueCents: number;
  shippingCogsCents: number;
  processingFeeCogsCents: number;
  shippingLabelCents: number;
  snapshot: boolean;
  tapeCents: number;
  totalCogsCents: number;
};

function numericValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function emptyTotals(): ProfitabilityTotals {
  return {
    brandingLabelCents: 0,
    donationCogsCents: 0,
    estimatedLineCount: 0,
    fixedCents: 0,
    fixedOtherCents: 0,
    grossProfitCents: 0,
    laborCents: 0,
    marginPercent: 0,
    materialCents: 0,
    orderCount: 0,
    processingFeeCogsCents: 0,
    productCogsCents: 0,
    revenueCents: 0,
    shippingCogsCents: 0,
    shippingLabelCents: 0,
    snapshotLineCount: 0,
    tapeCents: 0,
    totalCogsCents: 0,
    unitsSold: 0,
  };
}

function finalizeTotals(totals: ProfitabilityTotals, orderIds: Set<string>) {
  totals.orderCount = orderIds.size;
  totals.productCogsCents = totals.materialCents + totals.laborCents + totals.fixedCents;
  totals.totalCogsCents = totals.productCogsCents + totals.shippingCogsCents + totals.processingFeeCogsCents + totals.donationCogsCents;
  totals.grossProfitCents = totals.revenueCents - totals.totalCogsCents;
  totals.marginPercent = percent(totals.grossProfitCents, totals.revenueCents);
  return totals;
}

function lineRevenue(item: ProfitabilityOrderItemRow) {
  const explicit = numericValue(item.line_total_cents);
  if (explicit > 0) return explicit;
  return numericValue(item.qty) * numericValue(item.unit_price_cents);
}

function activeProductionQuantity(run: ProductionRunRow) {
  if (run.status === 'void' || run.status === 'voided') return 0;
  return Math.max(0, numericValue(run.quantity_produced) - numericValue(run.quantity_voided));
}

function allocateShipping(items: ProfitabilityOrderItemRow[], orderShippingCents: number) {
  const allocations = new Map<string, number>();
  const totalBoxes = items.reduce((sum, item) => sum + Math.max(0, numericValue(item.shipping_boxes_used)), 0);
  const totalRevenue = items.reduce((sum, item) => sum + Math.max(0, lineRevenue(item)), 0);
  const useBoxes = totalBoxes > 0 && items.every((item) => numericValue(item.shipping_boxes_used) > 0);
  const totalWeight = useBoxes ? totalBoxes : totalRevenue || items.length || 1;
  let allocated = 0;

  items.forEach((item, index) => {
    const weight = useBoxes
      ? Math.max(0, numericValue(item.shipping_boxes_used))
      : totalRevenue > 0
        ? Math.max(0, lineRevenue(item))
        : 1;
    const amount = index === items.length - 1 ? Math.max(0, orderShippingCents - allocated) : (orderShippingCents * weight) / totalWeight;
    allocated += amount;
    allocations.set(item.id, amount);
  });

  return allocations;
}

function productName(product: ProductRow | undefined, snapshot?: string | null) {
  return product?.name?.trim() || snapshot?.trim() || product?.sku?.trim() || 'Unknown product';
}

function centerName(center: CenterRow | undefined) {
  return center?.name?.trim() || 'Unknown center';
}

function runBreakdown(run: ProductionRunRow | undefined | null) {
  if (!run) {
    return {
      brandingLabelUnitCents: 0,
      fixedOtherUnitCents: 0,
      fixedUnitCents: 0,
      laborUnitCents: 0,
      materialUnitCents: 0,
      shippingLabelUnitCents: 0,
      tapeUnitCents: 0,
      unitCents: 0,
    };
  }
  const quantity = numericValue(run.quantity_produced) || 1;
  const unitCents = numericValue(run.actual_unit_cost_cents);
  const laborUnitCents = numericValue(run.actual_labor_cost_cents) / quantity;
  const fixedUnitCents = numericValue(run.fixed_cost_cents) / quantity;
  const tapeUnitCents = numericValue(run.fixed_tape_cost_cents) / quantity;
  const shippingLabelUnitCents = numericValue(run.fixed_shipping_label_cost_cents) / quantity;
  const brandingLabelUnitCents = numericValue(run.fixed_branding_label_cost_cents) / quantity;
  const explicitOtherUnitCents = numericValue(run.fixed_other_cost_cents) / quantity;
  const fixedOtherUnitCents = explicitOtherUnitCents || Math.max(0, fixedUnitCents - tapeUnitCents - shippingLabelUnitCents - brandingLabelUnitCents);

  return {
    brandingLabelUnitCents,
    fixedOtherUnitCents,
    fixedUnitCents,
    laborUnitCents,
    materialUnitCents: Math.max(0, unitCents - laborUnitCents - fixedUnitCents),
    shippingLabelUnitCents,
    tapeUnitCents,
    unitCents,
  };
}

function normalizeLines({
  orders,
  orderItems,
  products,
  productionRuns,
}: {
  orders: ProfitabilityOrderRow[];
  orderItems: ProfitabilityOrderItemRow[];
  products: ProductRow[];
  productionRuns: ProductionRunRow[];
}) {
  const productById = new Map(products.map((product) => [product.id, product]));
  const itemsByOrderId = new Map<string, ProfitabilityOrderItemRow[]>();
  const latestRunByProductId = new Map<string, ProductionRunRow>();

  for (const run of productionRuns) {
    if (!latestRunByProductId.has(run.product_id) && activeProductionQuantity(run) > 0 && numericValue(run.actual_unit_cost_cents) > 0) {
      latestRunByProductId.set(run.product_id, run);
    }
  }

  for (const item of orderItems) {
    const existing = itemsByOrderId.get(item.order_id) ?? [];
    existing.push(item);
    itemsByOrderId.set(item.order_id, existing);
  }

  const lines: NormalizedLine[] = [];

  for (const order of orders) {
    if (order.status !== 'Shipped') continue;
    const orderDate = validDate(order.shipped_at) ?? validDate(order.created_at);
    if (!orderDate) continue;
    const items = itemsByOrderId.get(order.id) ?? [];
    const shippingAllocations = allocateShipping(items, numericValue(order.shipping_cost_cents));

    for (const item of items) {
      const qty = numericValue(item.qty);
      if (qty <= 0) continue;
      const revenueCents = lineRevenue(item);
      const product = item.product_id ? productById.get(item.product_id) : undefined;
      const hasSnapshot = Boolean(item.cogs_snapshot_at);
      const latestBreakdown = item.product_id ? runBreakdown(latestRunByProductId.get(item.product_id)) : runBreakdown(null);
      const materialCents = hasSnapshot ? numericValue(item.cogs_material_cents) : latestBreakdown.materialUnitCents * qty;
      const laborCents = hasSnapshot ? numericValue(item.cogs_labor_cents) : latestBreakdown.laborUnitCents * qty;
      const fixedCents = hasSnapshot ? numericValue(item.cogs_fixed_cents) : latestBreakdown.fixedUnitCents * qty;
      const tapeCents = hasSnapshot ? numericValue(item.cogs_tape_cents) : latestBreakdown.tapeUnitCents * qty;
      const shippingLabelCents = hasSnapshot ? numericValue(item.cogs_shipping_label_cents) : latestBreakdown.shippingLabelUnitCents * qty;
      const brandingLabelCents = hasSnapshot ? numericValue(item.cogs_branding_label_cents) : latestBreakdown.brandingLabelUnitCents * qty;
      const fixedOtherCents = hasSnapshot ? numericValue(item.cogs_fixed_other_cents) : latestBreakdown.fixedOtherUnitCents * qty;
      const productCogsCents = hasSnapshot ? numericValue(item.cogs_product_cents) || materialCents + laborCents + fixedCents : materialCents + laborCents + fixedCents;
      const shippingCogsCents = hasSnapshot ? numericValue(item.cogs_shipping_cents) : shippingAllocations.get(item.id) ?? 0;
      const processingFeeCogsCents = hasSnapshot ? numericValue(item.cogs_processing_fee_cents) : 0;
      const donationCogsCents = hasSnapshot ? numericValue(item.cogs_donation_cents) : 0;
      const snapshottedTotalCogsCents = numericValue(item.cogs_total_cents);

      lines.push({
        brandingLabelCents,
        centerId: order.center_id,
        date: orderDate,
        donationCogsCents,
        estimated: hasSnapshot ? Boolean(item.cogs_estimated) : true,
        fixedCents,
        fixedOtherCents,
        id: item.id,
        laborCents,
        materialCents,
        orderId: order.id,
        productCogsCents,
        productId: item.product_id,
        productName: productName(product, item.product_name_snapshot),
        qty,
        revenueCents,
        shippingCogsCents,
        processingFeeCogsCents,
        shippingLabelCents,
        snapshot: hasSnapshot,
        tapeCents,
        totalCogsCents: snapshottedTotalCogsCents || productCogsCents + shippingCogsCents + processingFeeCogsCents + donationCogsCents,
      });
    }
  }

  return lines;
}

function totalsForLines(lines: NormalizedLine[]) {
  const totals = emptyTotals();
  const orderIds = new Set<string>();

  for (const line of lines) {
    orderIds.add(line.orderId);
    totals.brandingLabelCents += line.brandingLabelCents;
    totals.donationCogsCents += line.donationCogsCents;
    totals.estimatedLineCount += line.estimated ? 1 : 0;
    totals.fixedCents += line.fixedCents;
    totals.fixedOtherCents += line.fixedOtherCents;
    totals.laborCents += line.laborCents;
    totals.materialCents += line.materialCents;
    totals.processingFeeCogsCents += line.processingFeeCogsCents;
    totals.revenueCents += line.revenueCents;
    totals.shippingCogsCents += line.shippingCogsCents;
    totals.shippingLabelCents += line.shippingLabelCents;
    totals.snapshotLineCount += line.snapshot ? 1 : 0;
    totals.tapeCents += line.tapeCents;
    totals.unitsSold += line.qty;
  }

  return finalizeTotals(totals, orderIds);
}

function filterLines(lines: NormalizedLine[], start: Date, endExclusive: Date, productId?: string, centerId?: string) {
  return lines.filter((line) => {
    if (line.date < start || line.date >= endExclusive) return false;
    if (productId && line.productId !== productId) return false;
    if (centerId && line.centerId !== centerId) return false;
    return true;
  });
}

function buildCenterRows(lines: NormalizedLine[], centers: CenterRow[]) {
  const centerById = new Map(centers.map((center) => [center.id, center]));
  const grouped = new Map<string, NormalizedLine[]>();
  for (const line of lines) {
    const key = line.centerId ?? 'unknown';
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  }

  return [...grouped.entries()].map(([centerId, centerLines]) => {
    const totals = totalsForLines(centerLines);
    return {
      id: centerId,
      name: centerName(centerById.get(centerId)),
      revenueCents: totals.revenueCents,
      materialCents: totals.materialCents,
      laborCents: totals.laborCents,
      fixedCents: totals.fixedCents,
      donationCogsCents: totals.donationCogsCents,
      productCogsCents: totals.productCogsCents,
      processingFeeCogsCents: totals.processingFeeCogsCents,
      shippingCogsCents: totals.shippingCogsCents,
      totalCogsCents: totals.totalCogsCents,
      grossProfitCents: totals.grossProfitCents,
      marginPercent: totals.marginPercent,
      orderCount: totals.orderCount,
      averageOrderValueCents: totals.orderCount ? totals.revenueCents / totals.orderCount : 0,
      estimatedLineCount: totals.estimatedLineCount,
    };
  }).sort((a, b) => b.grossProfitCents - a.grossProfitCents || b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));
}

function buildItemRows(lines: NormalizedLine[]) {
  const grouped = new Map<string, NormalizedLine[]>();
  for (const line of lines) {
    const key = line.productId ?? line.productName;
    grouped.set(key, [...(grouped.get(key) ?? []), line]);
  }

  return [...grouped.entries()].map(([productId, productLines]) => {
    const totals = totalsForLines(productLines);
    const orderCount = new Set(productLines.map((line) => line.orderId)).size;
    const name = productLines[0]?.productName ?? 'Unknown product';
    const grossProfitBeforeShippingCents = totals.revenueCents - totals.productCogsCents;
    return {
      id: productId,
      name,
      unitsSold: totals.unitsSold,
      revenueCents: totals.revenueCents,
      revenuePerUnitCents: totals.unitsSold ? totals.revenueCents / totals.unitsSold : 0,
      productCogsCents: totals.productCogsCents,
      productCogsPerUnitCents: totals.unitsSold ? totals.productCogsCents / totals.unitsSold : 0,
      donationCogsCents: totals.donationCogsCents,
      processingFeeCogsCents: totals.processingFeeCogsCents,
      shippingCogsCents: totals.shippingCogsCents,
      grossProfitBeforeShippingCents,
      grossProfitAfterShippingCents: totals.grossProfitCents,
      marginBeforeShippingPercent: percent(grossProfitBeforeShippingCents, totals.revenueCents),
      marginAfterShippingPercent: totals.marginPercent,
      orderCount,
      estimatedLineCount: totals.estimatedLineCount,
    };
  }).sort((a, b) => b.grossProfitAfterShippingCents - a.grossProfitAfterShippingCents || b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));
}

function buildMarginBridge(current: ProfitabilityTotals, previous: ProfitabilityTotals): MarginBridgeRow[] {
  return [
    {
      label: 'Revenue',
      effectCents: current.revenueCents - previous.revenueCents,
      detail: 'More revenue lifts gross profit before cost changes.',
    },
    {
      label: 'Material COGS',
      effectCents: -(current.materialCents - previous.materialCents),
      detail: 'Coffee, bags, boxes, and tracked recipe inputs.',
    },
    {
      label: 'Labor COGS',
      effectCents: -(current.laborCents - previous.laborCents),
      detail: 'Snapshotted labor minutes and hourly rate from production.',
    },
    {
      label: 'Packaging & Fixed',
      effectCents: -(current.fixedCents - previous.fixedCents),
      detail: 'Tape, shipping labels, branding labels, and legacy fixed packaging.',
    },
    {
      label: 'Shipping COGS',
      effectCents: -(current.shippingCogsCents - previous.shippingCogsCents),
      detail: 'Order-level shipping cost allocated to shipped lines.',
    },
    {
      label: 'Processing Fees',
      effectCents: -(current.processingFeeCogsCents - previous.processingFeeCogsCents),
      detail: 'Payment processing fee at 2.99% plus 30 cents per shipped order.',
    },
    {
      label: 'Donation COGS',
      effectCents: -(current.donationCogsCents - previous.donationCogsCents),
      detail: 'Fixed 1% donation COGS allocated by line revenue.',
    },
  ];
}

function periodDays(start: Date, endExclusive: Date) {
  return Math.max(1, Math.round((endExclusive.getTime() - start.getTime()) / DAY_IN_MS));
}

function centsRate(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function perUnit(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function buildBaselineRanges(rangeStart: Date, rangeEndExclusive: Date) {
  const days = periodDays(rangeStart, rangeEndExclusive);
  const previousEndExclusive = rangeStart;
  const previousStart = new Date(rangeStart.getTime() - days * DAY_IN_MS);
  const trailingEndExclusive = rangeStart;
  const trailingStart = new Date(rangeStart.getTime() - 56 * DAY_IN_MS);

  return {
    previousEndExclusive,
    previousStart,
    trailingEndExclusive,
    trailingStart,
  };
}

function metricRow({
  baselineValue,
  currentValue,
  detail,
  estimatedImpactCents,
  format,
  id,
  label,
  previousValue,
}: Omit<MarginHealthMetricRow, 'changeValue'>): MarginHealthMetricRow {
  return {
    baselineValue,
    changeValue: currentValue - baselineValue,
    currentValue,
    detail,
    estimatedImpactCents,
    format,
    id,
    label,
    previousValue,
  };
}

export function buildNormalizedMarginBridge(
  current: ProfitabilityTotals,
  baseline: ProfitabilityTotals,
  previous: ProfitabilityTotals = emptyTotals(),
  currentDays = 1,
  baselineDays = 1,
  previousDays = 1
) {
  const baselineMarginRate = baseline.revenueCents > 0 ? baseline.grossProfitCents / baseline.revenueCents : current.revenueCents > 0 ? current.grossProfitCents / current.revenueCents : 0;
  const baselineAov = perUnit(baseline.revenueCents, baseline.orderCount);
  const baselineRevenuePerUnit = perUnit(baseline.revenueCents, baseline.unitsSold);

  const currentRevenuePerDay = current.revenueCents / currentDays;
  const baselineRevenuePerDay = baseline.revenueCents / baselineDays;
  const previousRevenuePerDay = previous.revenueCents / previousDays;
  const currentOrdersPerDay = current.orderCount / currentDays;
  const baselineOrdersPerDay = baseline.orderCount / baselineDays;
  const previousOrdersPerDay = previous.orderCount / previousDays;
  const currentAov = perUnit(current.revenueCents, current.orderCount);
  const previousAov = perUnit(previous.revenueCents, previous.orderCount);
  const currentUnitsPerOrder = perUnit(current.unitsSold, current.orderCount);
  const baselineUnitsPerOrder = perUnit(baseline.unitsSold, baseline.orderCount);
  const previousUnitsPerOrder = perUnit(previous.unitsSold, previous.orderCount);
  const currentRevenuePerUnit = perUnit(current.revenueCents, current.unitsSold);
  const previousRevenuePerUnit = perUnit(previous.revenueCents, previous.unitsSold);

  const salesMetrics: MarginHealthMetricRow[] = [
    metricRow({
      id: 'revenue_per_day',
      label: 'Revenue / day',
      currentValue: currentRevenuePerDay,
      baselineValue: baselineRevenuePerDay,
      previousValue: previousRevenuePerDay,
      estimatedImpactCents: (currentRevenuePerDay - baselineRevenuePerDay) * currentDays * baselineMarginRate,
      format: 'currency',
      detail: 'Normalizes revenue for date ranges of different lengths.',
    }),
    metricRow({
      id: 'orders_per_day',
      label: 'Orders / day',
      currentValue: currentOrdersPerDay,
      baselineValue: baselineOrdersPerDay,
      previousValue: previousOrdersPerDay,
      estimatedImpactCents: (currentOrdersPerDay - baselineOrdersPerDay) * currentDays * baselineAov * baselineMarginRate,
      format: 'number',
      detail: 'Shows demand pace without letting month length distort the read.',
    }),
    metricRow({
      id: 'average_order_value',
      label: 'Average order value',
      currentValue: currentAov,
      baselineValue: baselineAov,
      previousValue: previousAov,
      estimatedImpactCents: (currentAov - baselineAov) * current.orderCount * baselineMarginRate,
      format: 'currency',
      detail: 'Revenue quality per shipped order.',
    }),
    metricRow({
      id: 'units_per_order',
      label: 'Units / order',
      currentValue: currentUnitsPerOrder,
      baselineValue: baselineUnitsPerOrder,
      previousValue: previousUnitsPerOrder,
      estimatedImpactCents: (currentUnitsPerOrder - baselineUnitsPerOrder) * current.orderCount * baselineRevenuePerUnit * baselineMarginRate,
      format: 'number',
      detail: 'Order density before product mix and pricing effects.',
    }),
  ];

  const rateRow = (
    id: string,
    label: string,
    currentCents: number,
    baselineCents: number,
    previousCents: number,
    detail: string,
    sign: 1 | -1
  ) => {
    const currentRate = centsRate(currentCents, current.revenueCents);
    const baselineRate = centsRate(baselineCents, baseline.revenueCents);
    const previousRate = centsRate(previousCents, previous.revenueCents);
    return metricRow({
      id,
      label,
      currentValue: currentRate,
      baselineValue: baselineRate,
      previousValue: previousRate,
      estimatedImpactCents: sign * ((currentRate - baselineRate) / 100) * current.revenueCents,
      format: 'percent',
      detail,
    });
  };

  const unitEconomicsRows: MarginHealthMetricRow[] = [
    metricRow({
      id: 'revenue_per_order',
      label: 'Revenue / order',
      currentValue: currentAov,
      baselineValue: baselineAov,
      previousValue: previousAov,
      estimatedImpactCents: (currentAov - baselineAov) * current.orderCount * baselineMarginRate,
      format: 'currency',
      detail: 'Pricing and order-size signal at the shipped-order level.',
    }),
    metricRow({
      id: 'revenue_per_unit',
      label: 'Revenue / unit',
      currentValue: currentRevenuePerUnit,
      baselineValue: baselineRevenuePerUnit,
      previousValue: previousRevenuePerUnit,
      estimatedImpactCents: (currentRevenuePerUnit - baselineRevenuePerUnit) * current.unitsSold * baselineMarginRate,
      format: 'currency',
      detail: 'Pricing and product-mix signal per unit shipped.',
    }),
    rateRow('material_rate', 'Material COGS rate', current.materialCents, baseline.materialCents, previous.materialCents, 'Coffee, bags, boxes, and tracked recipe inputs as a share of revenue.', -1),
    rateRow('labor_rate', 'Labor COGS rate', current.laborCents, baseline.laborCents, previous.laborCents, 'Snapshotted production labor as a share of shipped revenue.', -1),
    rateRow('fixed_rate', 'Fixed packaging rate', current.fixedCents, baseline.fixedCents, previous.fixedCents, 'Tape, labels, and fixed packaging as a share of revenue.', -1),
    rateRow('shipping_rate', 'Shipping COGS rate', current.shippingCogsCents, baseline.shippingCogsCents, previous.shippingCogsCents, 'Carrier/local delivery COGS as a share of revenue.', -1),
    rateRow('processing_rate', 'Processing fee rate', current.processingFeeCogsCents, baseline.processingFeeCogsCents, previous.processingFeeCogsCents, 'Payment processing fees as a share of revenue.', -1),
    rateRow('donation_rate', 'Donation rate', current.donationCogsCents, baseline.donationCogsCents, previous.donationCogsCents, 'Donation COGS as a share of revenue.', -1),
  ];

  return { salesMetrics, unitEconomicsRows };
}

function buildMarginLeakRows({
  baselineLines,
  centers,
  currentLines,
  groupBy,
}: {
  baselineLines: NormalizedLine[];
  centers: CenterRow[];
  currentLines: NormalizedLine[];
  groupBy: 'center' | 'product';
}): MarginLeakRow[] {
  const centerById = new Map(centers.map((center) => [center.id, center]));
  const group = (lines: NormalizedLine[]) => {
    const grouped = new Map<string, { label: string; lines: NormalizedLine[] }>();
    for (const line of lines) {
      const id = groupBy === 'product' ? line.productId ?? line.productName : line.centerId ?? 'unknown';
      const label = groupBy === 'product' ? line.productName : centerName(centerById.get(id));
      const existing = grouped.get(id) ?? { label, lines: [] };
      existing.lines.push(line);
      grouped.set(id, existing);
    }
    return grouped;
  };

  const currentGroups = group(currentLines);
  const baselineGroups = group(baselineLines);

  return [...currentGroups.entries()]
    .map(([id, currentGroup]) => {
      const currentTotals = totalsForLines(currentGroup.lines);
      const baselineGroup = baselineGroups.get(id);
      if (!baselineGroup) {
        return {
          id,
          label: currentGroup.label,
          currentRevenueCents: currentTotals.revenueCents,
          currentMarginPercent: currentTotals.marginPercent,
          baselineMarginPercent: null,
          marginPointChange: null,
          estimatedImpactCents: 0,
          status: 'new' as const,
        };
      }

      const baselineTotals = totalsForLines(baselineGroup.lines);
      const marginPointChange = currentTotals.marginPercent - baselineTotals.marginPercent;
      const estimatedImpactCents = (marginPointChange / 100) * currentTotals.revenueCents;
      return {
        id,
        label: currentGroup.label,
        currentRevenueCents: currentTotals.revenueCents,
        currentMarginPercent: currentTotals.marginPercent,
        baselineMarginPercent: baselineTotals.marginPercent,
        marginPointChange,
        estimatedImpactCents,
        status: marginPointChange < -0.01 ? 'declined' as const : marginPointChange > 0.01 ? 'improved' as const : 'flat' as const,
      };
    })
    .sort((a, b) => {
      if (a.status === 'new' && b.status !== 'new') return 1;
      if (b.status === 'new' && a.status !== 'new') return -1;
      return a.estimatedImpactCents - b.estimatedImpactCents || b.currentRevenueCents - a.currentRevenueCents || a.label.localeCompare(b.label);
    });
}

function buildProductionRows({
  inputs,
  productById,
  productionRuns,
  rangeEndExclusive,
  rangeStart,
}: {
  inputs: ProductionRunInputRow[];
  productById: Map<string, ProductRow>;
  productionRuns: ProductionRunRow[];
  rangeEndExclusive: Date;
  rangeStart: Date;
}) {
  const inputsByRunId = new Map<string, ProductionRunInputRow[]>();
  for (const input of inputs) {
    inputsByRunId.set(input.production_run_id, [...(inputsByRunId.get(input.production_run_id) ?? []), input]);
  }

  return productionRuns
    .map((run) => ({ run, producedAt: validDate(run.produced_at) }))
    .filter(({ run, producedAt }) => producedAt && producedAt >= rangeStart && producedAt < rangeEndExclusive && activeProductionQuantity(run) > 0)
    .map(({ run, producedAt }) => {
      const originalQuantityProduced = numericValue(run.quantity_produced);
      const quantityProduced = activeProductionQuantity(run);
      const activeRatio = originalQuantityProduced > 0 ? quantityProduced / originalQuantityProduced : 0;
      const actualCostCents = quantityProduced * numericValue(run.actual_unit_cost_cents);
      const estimatedCostCents = quantityProduced * numericValue(run.estimated_unit_cost_cents);
      const laborCostCents = numericValue(run.actual_labor_cost_cents) * activeRatio;
      const fixedCostCents = numericValue(run.fixed_cost_cents) * activeRatio;
      const runInputs = inputsByRunId.get(run.id) ?? [];
      const materialCostCents = runInputs.reduce((sum, input) => sum + numericValue(input.cost_cents), 0) * activeRatio;
      const materialUsageVarianceQty = runInputs.reduce((sum, input) => sum + numericValue(input.quantity_used) - numericValue(input.quantity_expected), 0) * activeRatio;
      const product = productById.get(run.product_id);

      return {
        id: run.id,
        productId: run.product_id,
        productName: productName(product),
        producedAt,
        quantityProduced,
        estimatedCostCents,
        actualCostCents,
        materialCostCents,
        laborCostCents,
        fixedCostCents,
        varianceCents: actualCostCents - estimatedCostCents,
        unitCostCents: numericValue(run.actual_unit_cost_cents),
        materialUsageVarianceQty,
      };
    })
    .sort((a, b) => (b.producedAt?.getTime() ?? 0) - (a.producedAt?.getTime() ?? 0));
}

function buildInventoryRows({
  inventoryItems,
  inventoryLots,
  shortageMovements,
}: {
  inventoryItems: InventoryItemRow[];
  inventoryLots: InventoryLotRow[];
  shortageMovements: InventoryMovementRow[];
}) {
  const valueByItemId = new Map<string, { quantity: number; valueCents: number }>();
  for (const item of inventoryItems) {
    valueByItemId.set(item.id, { quantity: 0, valueCents: 0 });
  }
  for (const lot of inventoryLots) {
    const existing = valueByItemId.get(lot.inventory_item_id);
    if (!existing) continue;
    const quantity = numericValue(lot.quantity_remaining);
    existing.quantity += quantity;
    existing.valueCents += quantity * numericValue(lot.unit_cost_cents);
  }
  for (const movement of shortageMovements) {
    const existing = valueByItemId.get(movement.inventory_item_id);
    if (!existing) continue;
    const quantity = numericValue(movement.quantity_change);
    existing.quantity += quantity;
    existing.valueCents += quantity * numericValue(movement.unit_cost_cents);
  }

  return inventoryItems.map((item) => {
    const summary = valueByItemId.get(item.id) ?? { quantity: 0, valueCents: 0 };
    return {
      id: item.id,
      name: item.name,
      itemType: item.item_type,
      quantityOnHand: summary.quantity,
      unitLabel: item.base_unit,
      valueCents: summary.valueCents,
      averageUnitCostCents: summary.quantity > 0 ? summary.valueCents / summary.quantity : 0,
    };
  }).sort((a, b) => a.itemType.localeCompare(b.itemType) || a.name.localeCompare(b.name));
}

function buildCogsTimingSummary({
  current,
  inventoryItems,
  inventoryLots,
  productId,
  productionRuns,
  rangeEndExclusive,
  rangeStart,
  shortageMovements,
}: {
  current: ProfitabilityTotals;
  inventoryItems: InventoryItemRow[];
  inventoryLots: InventoryLotRow[];
  productId?: string;
  productionRuns: ProductionRunRow[];
  rangeEndExclusive: Date;
  rangeStart: Date;
  shortageMovements: InventoryMovementRow[];
}): CogsTimingSummary {
  const finishedItemsById = new Map(
    inventoryItems
      .filter((item) => item.item_type === 'finished_good' && (!productId || item.product_id === productId))
      .map((item) => [item.id, item])
  );
  const runById = new Map(productionRuns.map((run) => [run.id, run]));
  const positiveLaborByItemId = new Map<string, { laborCents: number; units: number }>();
  let inventoryFinishedValueCents = 0;
  let inventoryFinishedLaborCents = 0;
  let positiveFinishedUnits = 0;
  let netFinishedUnits = 0;
  let lotlessShortageUnits = 0;
  let hasEstimatedInventoryLabor = false;

  for (const lot of inventoryLots) {
    const item = finishedItemsById.get(lot.inventory_item_id);
    if (!item) continue;
    const quantity = numericValue(lot.quantity_remaining);
    const unitCostCents = numericValue(lot.unit_cost_cents);
    inventoryFinishedValueCents += quantity * unitCostCents;
    netFinishedUnits += quantity;
    if (quantity > 0) positiveFinishedUnits += quantity;

    const run = lot.production_run_id ? runById.get(lot.production_run_id) : undefined;
    const laborUnitCents = run && numericValue(run.quantity_produced) > 0
      ? numericValue(run.actual_labor_cost_cents) / numericValue(run.quantity_produced)
      : 0;
    const laborCents = quantity * laborUnitCents;
    inventoryFinishedLaborCents += laborCents;

    if (quantity > 0 && laborUnitCents > 0) {
      const existing = positiveLaborByItemId.get(item.id) ?? { laborCents: 0, units: 0 };
      existing.laborCents += laborCents;
      existing.units += quantity;
      positiveLaborByItemId.set(item.id, existing);
    }
  }

  for (const movement of shortageMovements) {
    const item = finishedItemsById.get(movement.inventory_item_id);
    if (!item) continue;
    const quantity = numericValue(movement.quantity_change);
    if (quantity >= 0) continue;

    inventoryFinishedValueCents += quantity * numericValue(movement.unit_cost_cents);
    netFinishedUnits += quantity;
    lotlessShortageUnits += Math.abs(quantity);

    const itemLabor = positiveLaborByItemId.get(item.id);
    if (itemLabor && itemLabor.units > 0) {
      inventoryFinishedLaborCents += quantity * (itemLabor.laborCents / itemLabor.units);
    }
    hasEstimatedInventoryLabor = true;
  }

  const productionRows = productionRuns
    .map((run) => ({ run, producedAt: validDate(run.produced_at) }))
    .filter(({ run, producedAt }) => {
      if (!producedAt || producedAt < rangeStart || producedAt >= rangeEndExclusive) return false;
      if (productId && run.product_id !== productId) return false;
      return activeProductionQuantity(run) > 0;
    });
  const productionActualCogsCents = productionRows.reduce((sum, { run }) => sum + activeProductionQuantity(run) * numericValue(run.actual_unit_cost_cents), 0);
  const productionLaborCogsCents = productionRows.reduce((sum, { run }) => {
    const quantityProduced = numericValue(run.quantity_produced);
    const activeRatio = quantityProduced > 0 ? activeProductionQuantity(run) / quantityProduced : 0;
    return sum + numericValue(run.actual_labor_cost_cents) * activeRatio;
  }, 0);

  return {
    hasEstimatedInventoryLabor,
    inventoryFinishedLaborCents,
    inventoryFinishedValueCents,
    lotlessShortageUnits,
    netFinishedUnits,
    positiveFinishedUnits,
    productionActualCogsCents,
    productionLaborCogsCents,
    shippedLaborCogsCents: current.laborCents,
    shippedProductCogsCents: current.productCogsCents,
    shippedTotalCogsCents: current.totalCogsCents,
  };
}

function expenseLabel(type: string) {
  if (type === 'shipping_label') return 'Shipping labels';
  if (type === 'branding_label') return 'Branding labels';
  if (type === 'tape') return 'Tape';
  return 'Other';
}

function buildExpenseRows(expenses: NonInventoryExpenseInputRow[], rangeStart: Date, rangeEndExclusive: Date) {
  const grouped = new Map<string, { amountCents: number; count: number }>();
  for (const expense of expenses) {
    const spentAt = validDate(expense.spent_at);
    if (!spentAt || spentAt < rangeStart || spentAt >= rangeEndExclusive) continue;
    const existing = grouped.get(expense.expense_type) ?? { amountCents: 0, count: 0 };
    existing.amountCents += numericValue(expense.amount_cents);
    existing.count += 1;
    grouped.set(expense.expense_type, existing);
  }

  return [...grouped.entries()].map(([type, row]) => ({
    type,
    label: expenseLabel(type),
    amountCents: row.amountCents,
    count: row.count,
  })).sort((a, b) => b.amountCents - a.amountCents || a.label.localeCompare(b.label));
}

function previousRangeFor(rangeStart: Date, rangeEndExclusive: Date) {
  const days = Math.max(1, Math.round((rangeEndExclusive.getTime() - rangeStart.getTime()) / DAY_IN_MS));
  return {
    previousEndExclusive: rangeStart,
    previousStart: new Date(rangeStart.getTime() - days * DAY_IN_MS),
  };
}

export function buildProfitabilityDashboard({
  centerId,
  centers,
  inventoryItems,
  inventoryLots,
  nonInventoryExpenses,
  orderItems,
  orders,
  productId,
  productionRunInputs,
  productionRuns,
  products,
  rangeEndExclusive,
  rangeStart,
  shortageMovements,
}: {
  centerId?: string;
  centers: CenterRow[];
  inventoryItems: InventoryItemRow[];
  inventoryLots: InventoryLotRow[];
  nonInventoryExpenses: NonInventoryExpenseInputRow[];
  orderItems: ProfitabilityOrderItemRow[];
  orders: ProfitabilityOrderRow[];
  productId?: string;
  productionRunInputs: ProductionRunInputRow[];
  productionRuns: ProductionRunRow[];
  products: ProductRow[];
  rangeEndExclusive: Date;
  rangeStart: Date;
  shortageMovements: InventoryMovementRow[];
}): ProfitabilityDashboard {
  const productById = new Map(products.map((product) => [product.id, product]));
  const allLines = normalizeLines({ orderItems, orders, products, productionRuns });
  const currentLines = filterLines(allLines, rangeStart, rangeEndExclusive, productId, centerId);
  const previousRange = previousRangeFor(rangeStart, rangeEndExclusive);
  const baselineRange = buildBaselineRanges(rangeStart, rangeEndExclusive);
  const previousLines = filterLines(allLines, previousRange.previousStart, previousRange.previousEndExclusive, productId, centerId);
  const trailingLines = filterLines(allLines, baselineRange.trailingStart, baselineRange.trailingEndExclusive, productId, centerId);
  const current = totalsForLines(currentLines);
  const previous = totalsForLines(previousLines);
  const trailing = totalsForLines(trailingLines);
  const normalizedBridge = buildNormalizedMarginBridge(
    current,
    trailing,
    previous,
    periodDays(rangeStart, rangeEndExclusive),
    periodDays(baselineRange.trailingStart, baselineRange.trailingEndExclusive),
    periodDays(previousRange.previousStart, previousRange.previousEndExclusive)
  );
  const productionRows = buildProductionRows({
    inputs: productionRunInputs,
    productById,
    productionRuns,
    rangeEndExclusive,
    rangeStart,
  });
  const productionSummary = productionRows.reduce(
    (summary, row) => {
      summary.actualCostCents += row.actualCostCents;
      summary.estimatedCostCents += row.estimatedCostCents;
      summary.fixedCostCents += row.fixedCostCents;
      summary.laborCostCents += row.laborCostCents;
      summary.materialCostCents += row.materialCostCents;
      summary.quantityProduced += row.quantityProduced;
      summary.runCount += 1;
      summary.varianceCents += row.varianceCents;
      return summary;
    },
    {
      actualCostCents: 0,
      estimatedCostCents: 0,
      fixedCostCents: 0,
      laborCostCents: 0,
      materialCostCents: 0,
      quantityProduced: 0,
      runCount: 0,
      varianceCents: 0,
    }
  );
  const inventoryRows = buildInventoryRows({ inventoryItems, inventoryLots, shortageMovements });
  const inventorySummary = inventoryRows.reduce(
    (summary, row) => {
      if (row.itemType === 'raw_coffee') summary.rawCoffeeValueCents += row.valueCents;
      if (row.itemType === 'material_supply') summary.materialSupplyValueCents += row.valueCents;
      if (row.itemType === 'finished_good') {
        summary.sellableValueCents += row.valueCents;
        if (row.quantityOnHand < 0) summary.negativeSellableCount += 1;
      }
      return summary;
    },
    {
      materialSupplyValueCents: 0,
      negativeSellableCount: 0,
      rawCoffeeValueCents: 0,
      sellableValueCents: 0,
    }
  );
  const expenseRows = buildExpenseRows(nonInventoryExpenses, rangeStart, rangeEndExclusive);
  const expenseByType = new Map(expenseRows.map((row) => [row.type, row.amountCents]));

  return {
    current,
    previous,
    centerRows: buildCenterRows(currentLines, centers),
    itemRows: buildItemRows(currentLines),
    marginHealth: {
      baselineRange,
      centerLeaks: buildMarginLeakRows({ baselineLines: trailingLines, centers, currentLines, groupBy: 'center' }),
      cogsTiming: buildCogsTimingSummary({
        current,
        inventoryItems,
        inventoryLots,
        productId,
        productionRuns,
        rangeEndExclusive,
        rangeStart,
        shortageMovements,
      }),
      productLeaks: buildMarginLeakRows({ baselineLines: trailingLines, centers, currentLines, groupBy: 'product' }),
      salesMetrics: normalizedBridge.salesMetrics,
      unitEconomicsRows: normalizedBridge.unitEconomicsRows,
    },
    marginBridgeRows: buildMarginBridge(current, previous),
    productionRows,
    productionSummary,
    inventoryRows,
    inventorySummary,
    expenseRows,
    fixedExpenseComparisonRows: [
      { label: 'Tape', imputedCogsCents: current.tapeCents, expenseSpendCents: expenseByType.get('tape') ?? 0, varianceCents: (expenseByType.get('tape') ?? 0) - current.tapeCents },
      { label: 'Shipping labels', imputedCogsCents: current.shippingLabelCents, expenseSpendCents: expenseByType.get('shipping_label') ?? 0, varianceCents: (expenseByType.get('shipping_label') ?? 0) - current.shippingLabelCents },
      { label: 'Branding labels', imputedCogsCents: current.brandingLabelCents, expenseSpendCents: expenseByType.get('branding_label') ?? 0, varianceCents: (expenseByType.get('branding_label') ?? 0) - current.brandingLabelCents },
      { label: 'Other packaging and Product Boxes', imputedCogsCents: current.fixedOtherCents, expenseSpendCents: expenseByType.get('other') ?? 0, varianceCents: (expenseByType.get('other') ?? 0) - current.fixedOtherCents },
    ],
  };
}

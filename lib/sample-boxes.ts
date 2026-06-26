import {
  convertInventoryQuantity,
  normalizeInventoryNumber,
  type InventoryUnit,
} from '@/lib/inventory';

export const SAMPLE_BOX_DEFAULT_KEY = 'default_sample_box';

type SupabaseLike = {
  from: (table: string) => any;
};

type Related<T> = T | T[] | null | undefined;

type InventoryItemRow = {
  active: boolean | null;
  base_unit: InventoryUnit;
  id: string;
  item_type: string;
  name: string | null;
  product_id: string | null;
  sku: string | null;
};

type InventoryLotRow = {
  created_at?: string | null;
  id: string;
  inventory_item_id: string;
  quantity_remaining: number | string;
  received_at?: string | null;
  unit_cost_cents: number | string | null;
};

type ProductRow = {
  active: boolean | null;
  id: string;
  name: string | null;
  sku: string | null;
};

type TemplateItemRow = {
  id: string;
  inventory_item_id: string | null;
  inventory_items?: Related<InventoryItemRow>;
  item_kind: 'inventory_item' | 'product';
  label: string | null;
  product_id: string | null;
  products?: Related<ProductRow>;
  quantity: number | string;
  sort_order: number | null;
  unit: InventoryUnit;
};

type TemplateRow = {
  active: boolean | null;
  fixed_misc_cents: number | string | null;
  fixed_shipping_cents: number | string | null;
  id: string;
  name: string;
  sample_box_template_items?: TemplateItemRow[] | null;
};

type WorkLine = {
  allowNegative: boolean;
  bucket: 'inventory' | 'product';
  inventoryItemId: string;
  itemKind: 'inventory_item' | 'product';
  itemType: string;
  label: string;
  productId: string | null;
  quantity: number;
  unit: InventoryUnit;
};

export type SampleBoxAddOn = {
  productId: string;
  quantity: number;
};

export type RecordSampleBoxResult = {
  error:
    | 'config_error'
    | 'insert_error'
    | 'insufficient_inventory'
    | 'inventory_error'
    | 'schema_error'
    | 'template_error'
    | 'unit_error'
    | null;
  runId?: string;
};

function relatedOne<T>(value: Related<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function itemLabel(item: InventoryItemRow | null | undefined) {
  if (!item) return 'Unknown item';
  return item.sku ? `${item.name || 'Inventory item'} (${item.sku})` : item.name || 'Inventory item';
}

function productLabel(product: ProductRow | null | undefined) {
  if (!product) return 'Unknown product';
  return product.sku ? `${product.name || 'Product'} (${product.sku})` : product.name || 'Product';
}

async function ensureFinishedInventoryItem({
  product,
  supabase,
}: {
  product: ProductRow;
  supabase: SupabaseLike;
}) {
  const existing = await supabase
    .from('inventory_items')
    .select('id,name,sku,item_type,base_unit,product_id,active')
    .eq('product_id', product.id)
    .maybeSingle();

  if (existing.data) return existing.data as InventoryItemRow;

  const skuSeed = product.sku?.trim() || product.id.slice(0, 8);
  const inserted = await supabase
    .from('inventory_items')
    .insert({
      active: true,
      base_unit: 'each',
      item_type: 'finished_good',
      name: product.name || 'Finished good',
      product_id: product.id,
      sku: `FIN-${skuSeed}`,
    })
    .select('id,name,sku,item_type,base_unit,product_id,active')
    .maybeSingle();

  if (inserted.data) return inserted.data as InventoryItemRow;

  const refetched = await supabase
    .from('inventory_items')
    .select('id,name,sku,item_type,base_unit,product_id,active')
    .eq('product_id', product.id)
    .maybeSingle();

  return (refetched.data ?? null) as InventoryItemRow | null;
}

function buildAvailabilityMap(lots: InventoryLotRow[]) {
  const availableByItemId = new Map<string, number>();
  for (const lot of lots) {
    availableByItemId.set(
      lot.inventory_item_id,
      (availableByItemId.get(lot.inventory_item_id) ?? 0) + normalizeInventoryNumber(lot.quantity_remaining)
    );
  }
  return availableByItemId;
}

function latestCostByItemId(lots: InventoryLotRow[]) {
  const costs = new Map<string, number>();
  for (const lot of lots) {
    const cost = normalizeInventoryNumber(lot.unit_cost_cents);
    if (cost > 0 && !costs.has(lot.inventory_item_id)) {
      costs.set(lot.inventory_item_id, cost);
    }
  }
  return costs;
}

function appendTemplateInventoryLine({
  item,
  line,
  quantityBoxes,
  workLines,
}: {
  item: InventoryItemRow | null;
  line: TemplateItemRow;
  quantityBoxes: number;
  workLines: WorkLine[];
}) {
  if (!item?.id) return false;
  const quantity = convertInventoryQuantity(
    normalizeInventoryNumber(line.quantity) * quantityBoxes,
    line.unit,
    item.base_unit
  );
  if (quantity <= 0) return false;
  const isFinishedGood = item.item_type === 'finished_good';
  workLines.push({
    allowNegative: isFinishedGood,
    bucket: isFinishedGood ? 'product' : 'inventory',
    inventoryItemId: item.id,
    itemKind: isFinishedGood ? 'product' : 'inventory_item',
    itemType: item.item_type,
    label: line.label?.trim() || itemLabel(item),
    productId: item.product_id,
    quantity,
    unit: item.base_unit,
  });
  return true;
}

export async function recordSampleBoxRun({
  addOns = [],
  centerId,
  createdBy,
  notes,
  prospectName,
  quantityBoxes,
  salesProfileId,
  sentAt,
  supabase,
  templateId,
}: {
  addOns?: SampleBoxAddOn[];
  centerId?: string | null;
  createdBy: string;
  notes?: string | null;
  prospectName?: string | null;
  quantityBoxes: number;
  salesProfileId?: string | null;
  sentAt?: string | null;
  supabase: SupabaseLike;
  templateId: string;
}): Promise<RecordSampleBoxResult> {
  const safeQuantityBoxes = Math.max(0, normalizeInventoryNumber(quantityBoxes));
  if (!templateId || safeQuantityBoxes <= 0) return { error: 'config_error' };

  const templateResult = await supabase
    .from('sample_box_templates')
    .select('id,name,active,fixed_shipping_cents,fixed_misc_cents,sample_box_template_items(id,item_kind,inventory_item_id,product_id,quantity,unit,label,sort_order,inventory_items(id,name,sku,item_type,base_unit,product_id,active),products(id,name,sku,active))')
    .eq('id', templateId)
    .maybeSingle();

  if (templateResult.error) {
    return templateResult.error.code === '42P01' ? { error: 'schema_error' } : { error: 'template_error' };
  }

  const template = templateResult.data as TemplateRow | null;
  if (!template?.id || template.active === false) return { error: 'template_error' };

  const templateItems = [...(template.sample_box_template_items ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const productIds = new Set<string>();
  for (const item of templateItems) {
    if (item.item_kind === 'product' && item.product_id) productIds.add(item.product_id);
  }
  for (const addOn of addOns) {
    if (addOn.productId && addOn.quantity > 0) productIds.add(addOn.productId);
  }

  const productsResult = productIds.size
    ? await supabase
        .from('products')
        .select('id,name,sku,active')
        .in('id', [...productIds])
    : { data: [] as ProductRow[], error: null };

  if (productsResult.error) return { error: 'config_error' };

  const productsById = new Map(((productsResult.data ?? []) as ProductRow[]).map((product) => [product.id, product]));
  const finishedItemByProductId = new Map<string, InventoryItemRow>();
  for (const productId of productIds) {
    const product = productsById.get(productId);
    if (!product || product.active === false) return { error: 'config_error' };
    const finishedItem = await ensureFinishedInventoryItem({ product, supabase });
    if (!finishedItem) return { error: 'inventory_error' };
    finishedItemByProductId.set(productId, finishedItem);
  }

  const workLines: WorkLine[] = [];

  try {
    for (const line of templateItems) {
      if (line.item_kind === 'inventory_item') {
        const item = relatedOne(line.inventory_items);
        if (!appendTemplateInventoryLine({ item, line, quantityBoxes: safeQuantityBoxes, workLines })) {
          return { error: 'config_error' };
        }
      } else {
        const product = productsById.get(line.product_id ?? '');
        const item = finishedItemByProductId.get(line.product_id ?? '');
        if (!product || !item) return { error: 'config_error' };
        const quantity = normalizeInventoryNumber(line.quantity) * safeQuantityBoxes;
        if (quantity <= 0) return { error: 'config_error' };
        workLines.push({
          allowNegative: true,
          bucket: 'product',
          inventoryItemId: item.id,
          itemKind: 'product',
          itemType: 'finished_good',
          label: line.label?.trim() || productLabel(product),
          productId: product.id,
          quantity,
          unit: 'each',
        });
      }
    }
  } catch {
    return { error: 'unit_error' };
  }

  for (const addOn of addOns) {
    const quantity = Math.max(0, normalizeInventoryNumber(addOn.quantity)) * safeQuantityBoxes;
    if (!addOn.productId || quantity <= 0) continue;
    const product = productsById.get(addOn.productId);
    const item = finishedItemByProductId.get(addOn.productId);
    if (!product || !item) return { error: 'config_error' };
    workLines.push({
      allowNegative: true,
      bucket: 'product',
      inventoryItemId: item.id,
      itemKind: 'product',
      itemType: 'finished_good',
      label: `Add-on: ${productLabel(product)}`,
      productId: product.id,
      quantity,
      unit: 'each',
    });
  }

  if (!workLines.length) return { error: 'config_error' };

  const inventoryItemIds = [...new Set(workLines.map((line) => line.inventoryItemId))];
  const [availableLotsResult, latestLotsResult, productionRunsResult] = await Promise.all([
    supabase
      .from('inventory_lots')
      .select('id,inventory_item_id,quantity_remaining,unit_cost_cents,received_at,created_at')
      .in('inventory_item_id', inventoryItemIds)
      .gt('quantity_remaining', 0)
      .order('received_at', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('inventory_lots')
      .select('id,inventory_item_id,quantity_remaining,unit_cost_cents,received_at,created_at')
      .in('inventory_item_id', inventoryItemIds)
      .order('received_at', { ascending: false })
      .order('created_at', { ascending: false }),
    productIds.size
      ? supabase
          .from('production_runs')
          .select('product_id,actual_unit_cost_cents,produced_at')
          .in('product_id', [...productIds])
          .order('produced_at', { ascending: false })
      : { data: [], error: null },
  ]);

  if (availableLotsResult.error || latestLotsResult.error || productionRunsResult.error) {
    return { error: 'inventory_error' };
  }

  const lotQueuesByItemId = new Map<string, InventoryLotRow[]>();
  for (const lot of (availableLotsResult.data ?? []) as InventoryLotRow[]) {
    const queue = lotQueuesByItemId.get(lot.inventory_item_id) ?? [];
    queue.push(lot);
    lotQueuesByItemId.set(lot.inventory_item_id, queue);
  }

  const availableByItemId = buildAvailabilityMap((availableLotsResult.data ?? []) as InventoryLotRow[]);
  const requiredByItemId = new Map<string, number>();
  for (const line of workLines) {
    if (line.allowNegative) continue;
    requiredByItemId.set(line.inventoryItemId, (requiredByItemId.get(line.inventoryItemId) ?? 0) + line.quantity);
  }

  for (const [itemId, required] of requiredByItemId) {
    if ((availableByItemId.get(itemId) ?? 0) + 0.0001 < required) {
      return { error: 'insufficient_inventory' };
    }
  }

  const latestLotCostByItemId = latestCostByItemId((latestLotsResult.data ?? []) as InventoryLotRow[]);
  const latestProductionCostByProductId = new Map<string, number>();
  for (const run of (productionRunsResult.data ?? []) as Array<{ actual_unit_cost_cents: number | string | null; product_id: string }>) {
    const cost = normalizeInventoryNumber(run.actual_unit_cost_cents);
    if (cost > 0 && !latestProductionCostByProductId.has(run.product_id)) {
      latestProductionCostByProductId.set(run.product_id, cost);
    }
  }

  const fixedShippingCents = normalizeInventoryNumber(template.fixed_shipping_cents) * safeQuantityBoxes;
  const fixedMiscCents = normalizeInventoryNumber(template.fixed_misc_cents) * safeQuantityBoxes;
  const runResult = await supabase
    .from('sample_box_runs')
    .insert({
      center_id: centerId || null,
      created_by: createdBy,
      fixed_misc_cents: fixedMiscCents,
      fixed_shipping_cents: fixedShippingCents,
      notes: notes?.trim() || null,
      prospect_name: prospectName?.trim() || null,
      quantity_boxes: safeQuantityBoxes,
      sales_profile_id: salesProfileId || createdBy,
      sent_at: sentAt || new Date().toISOString(),
      template_id: template.id,
    })
    .select('id')
    .maybeSingle();

  if (runResult.error || !runResult.data?.id) {
    return runResult.error?.code === '42P01' ? { error: 'schema_error' } : { error: 'insert_error' };
  }

  const runId = runResult.data.id as string;
  let inventoryCogsCents = 0;
  let productCogsCents = 0;
  let estimated = false;

  for (const line of workLines) {
    const runItemResult = await supabase
      .from('sample_box_run_items')
      .insert({
        inventory_item_id: line.inventoryItemId,
        item_kind: line.itemKind,
        label: line.label,
        product_id: line.productId,
        quantity: line.quantity,
        run_id: runId,
        unit: line.unit,
      })
      .select('id')
      .maybeSingle();

    if (runItemResult.error || !runItemResult.data?.id) return { error: 'insert_error', runId };

    const runItemId = runItemResult.data.id as string;
    const lotQueue = lotQueuesByItemId.get(line.inventoryItemId) ?? [];
    let remaining = line.quantity;
    let totalCostCents = 0;
    let lineEstimated = false;

    for (const lot of lotQueue) {
      if (remaining <= 0) break;
      const lotRemaining = normalizeInventoryNumber(lot.quantity_remaining);
      if (lotRemaining <= 0) continue;
      const take = Math.min(lotRemaining, remaining);
      const nextRemaining = lotRemaining - take;
      const updateResult = await supabase
        .from('inventory_lots')
        .update({ quantity_remaining: nextRemaining })
        .eq('id', lot.id);

      if (updateResult.error) return { error: 'inventory_error', runId };

      lot.quantity_remaining = nextRemaining;
      const unitCostCents = normalizeInventoryNumber(lot.unit_cost_cents);
      totalCostCents += take * unitCostCents;

      const movementResult = await supabase.from('inventory_movements').insert({
        inventory_item_id: line.inventoryItemId,
        lot_id: lot.id,
        movement_type: 'sample_box_consume',
        notes: 'Sample box consumption',
        quantity_change: -take,
        sample_box_run_id: runId,
        sample_box_run_item_id: runItemId,
        unit: line.unit,
        unit_cost_cents: unitCostCents,
      });

      if (movementResult.error) return { error: 'inventory_error', runId };

      remaining -= take;
    }

    if (remaining > 0) {
      if (!line.allowNegative) return { error: 'insufficient_inventory', runId };

      const fallbackUnitCost =
        latestLotCostByItemId.get(line.inventoryItemId) ??
        (line.productId ? latestProductionCostByProductId.get(line.productId) : undefined) ??
        0;
      lineEstimated = true;
      totalCostCents += remaining * fallbackUnitCost;

      const movementResult = await supabase.from('inventory_movements').insert({
        inventory_item_id: line.inventoryItemId,
        lot_id: null,
        movement_type: 'sample_box_consume',
        notes: 'Sample box consumed below available finished stock',
        quantity_change: -remaining,
        sample_box_run_id: runId,
        sample_box_run_item_id: runItemId,
        unit: line.unit,
        unit_cost_cents: fallbackUnitCost,
      });

      if (movementResult.error) return { error: 'inventory_error', runId };
    }

    const updateRunItemResult = await supabase
      .from('sample_box_run_items')
      .update({
        cogs_estimated: lineEstimated,
        total_cost_cents: totalCostCents,
        unit_cost_cents: line.quantity > 0 ? totalCostCents / line.quantity : 0,
      })
      .eq('id', runItemId);

    if (updateRunItemResult.error) return { error: 'insert_error', runId };

    if (line.bucket === 'product') {
      productCogsCents += totalCostCents;
    } else {
      inventoryCogsCents += totalCostCents;
    }
    estimated = estimated || lineEstimated;
  }

  const totalCogsCents = inventoryCogsCents + productCogsCents + fixedShippingCents + fixedMiscCents;
  const runUpdateResult = await supabase
    .from('sample_box_runs')
    .update({
      cogs_estimated: estimated,
      inventory_cogs_cents: inventoryCogsCents,
      product_cogs_cents: productCogsCents,
      total_cogs_cents: totalCogsCents,
    })
    .eq('id', runId);

  if (runUpdateResult.error) return { error: 'insert_error', runId };

  return { error: null, runId };
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  convertInventoryQuantity,
  fixedRecipeCostCents,
  formatInventoryQuantity,
  inventoryItemTypeLabel,
  laborCostCents,
  normalizeInventoryNumber,
  type InventoryUnit,
} from '@/lib/inventory';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

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

type InventoryLotRow = {
  inventory_item_id: string;
  quantity_remaining: number | string;
  unit_cost_cents: number | string;
};

type InventoryMovementRow = {
  inventory_item_id: string;
  quantity_change: number | string;
  unit_cost_cents: number | string | null;
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
  labor_minutes: number | string;
  labor_rate_cents: number | string;
  shipping_label_qty: number | string;
  branding_label_qty: number | string;
  product_recipe_components?: RecipeComponentRow[] | null;
};

type ProductionRunRow = {
  product_id: string;
  actual_unit_cost_cents: number | string | null;
};

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

function isBoxComponent(component: RecipeComponentRow) {
  const item = relatedOne(component.inventory_items);
  return component.component_role === 'box' || Boolean(item?.sku?.startsWith('BOX-'));
}

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function StockCard({
  costLabel,
  detail,
  name,
  quantity,
  tone = 'default',
}: {
  costLabel: string;
  detail: string;
  name: string;
  quantity: string;
  tone?: 'default' | 'short';
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-semibold text-slate-950">{name}</p>
          <p className="mt-1 text-sm text-slate-500">{detail}</p>
        </div>
        <div className="text-left sm:text-right">
          <p className={`font-semibold ${tone === 'short' ? 'text-rose-700' : 'text-slate-950'}`}>{quantity}</p>
          <p className="mt-1 text-sm text-slate-500">{costLabel}</p>
        </div>
      </div>
    </div>
  );
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const requestedTab = typeof searchParams?.tab === 'string' ? searchParams.tab : '';
  if (requestedTab === 'setup') redirect('/admin/receiving');
  if (requestedTab === 'planning') redirect('/admin/planning');
  if (requestedTab === 'production') redirect('/admin/production');

  const supabase = await createClient();
  const [
    productsResult,
    itemsResult,
    lotsResult,
    recipesResult,
    runsResult,
    openOrdersResult,
    shortageMovementsResult,
  ] = await Promise.all([
    supabase.from('products').select('id,name,sku,active').order('name', { ascending: true }),
    supabase.from('inventory_items').select('id,name,sku,item_type,base_unit,product_id,active').order('name', { ascending: true }),
    supabase.from('inventory_lots').select('inventory_item_id,quantity_remaining,unit_cost_cents').limit(50000),
    supabase.from('product_recipes').select('product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,shipping_label_qty,branding_label_qty,product_recipe_components(id,inventory_item_id,quantity,unit,component_role,inventory_items(id,name,sku,item_type,base_unit,product_id,active))'),
    supabase.from('production_runs').select('product_id,actual_unit_cost_cents').order('produced_at', { ascending: false }).limit(500),
    supabase.from('orders').select('id,status,order_items(product_id,qty)').in('status', ['New', 'Processing']).is('archived_at', null),
    supabase.from('inventory_movements').select('inventory_item_id,quantity_change,unit_cost_cents').eq('movement_type', 'shipment_consume').is('lot_id', null).limit(50000),
  ]);

  if (itemsResult.error) {
    return (
      <div className="space-y-6">
        <section className="panel">
          <span className="eyebrow">Inventory</span>
          <h1 className="page-title mt-4">Inventory</h1>
          <p className="page-subtitle mt-3">Apply the inventory migrations before using this page.</p>
        </section>
        <section className="card text-sm text-slate-600">Missing inventory schema. Apply migrations through `db/migrations/023_inventory_cogs_shipping_labor.sql`.</section>
      </div>
    );
  }

  const products = (productsResult.data ?? []) as ProductRow[];
  const items = (itemsResult.data ?? []) as InventoryItemRow[];
  const lots = (lotsResult.data ?? []) as InventoryLotRow[];
  const recipes = (recipesResult.data ?? []) as RecipeRow[];
  const runs = (runsResult.data ?? []) as ProductionRunRow[];
  const openOrders = (openOrdersResult.data ?? []) as any[];
  const shortageMovements = shortageMovementsResult.error ? [] : ((shortageMovementsResult.data ?? []) as InventoryMovementRow[]);
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const lotSummaryByItem = new Map<string, { remaining: number; avgCostCents: number; valueCents: number }>();
  for (const item of items) {
    const itemLots = lots.filter((lot) => lot.inventory_item_id === item.id);
    const remaining = itemLots.reduce((sum, lot) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    const valueCents = itemLots.reduce((sum, lot) => sum + normalizeInventoryNumber(lot.quantity_remaining) * normalizeInventoryNumber(lot.unit_cost_cents), 0);
    lotSummaryByItem.set(item.id, {
      remaining,
      valueCents,
      avgCostCents: remaining > 0 ? valueCents / remaining : 0,
    });
  }
  for (const movement of shortageMovements) {
    const existing = lotSummaryByItem.get(movement.inventory_item_id);
    if (!existing) continue;
    const quantityChange = normalizeInventoryNumber(movement.quantity_change);
    existing.remaining += quantityChange;
    existing.valueCents += quantityChange * normalizeInventoryNumber(movement.unit_cost_cents);
    existing.avgCostCents = existing.remaining > 0 ? existing.valueCents / existing.remaining : 0;
  }

  const reservedQtyByProductId = new Map<string, number>();
  for (const order of openOrders) {
    for (const item of order.order_items ?? []) {
      if (!item.product_id) continue;
      reservedQtyByProductId.set(item.product_id, (reservedQtyByProductId.get(item.product_id) ?? 0) + normalizeInventoryNumber(item.qty));
    }
  }

  const latestActualCostByProductId = new Map<string, number>();
  for (const run of runs) {
    const actual = normalizeInventoryNumber(run.actual_unit_cost_cents);
    if (actual > 0 && !latestActualCostByProductId.has(run.product_id)) {
      latestActualCostByProductId.set(run.product_id, actual);
    }
  }

  function estimateRecipeUnitCost(recipe: RecipeRow | undefined) {
    if (!recipe) return 0;
    const outputQty = normalizeInventoryNumber(recipe.output_qty) || 1;
    const wasteMultiplier = 1 + normalizeInventoryNumber(recipe.waste_percent) / 100;
    const materialCost = (recipe.product_recipe_components ?? []).reduce((sum, component) => {
      const item = relatedOne(component.inventory_items) ?? itemsById.get(component.inventory_item_id);
      if (!item) return sum;
      try {
        const baseQuantity = convertInventoryQuantity(normalizeInventoryNumber(component.quantity) * wasteMultiplier, component.unit, item.base_unit);
        return sum + baseQuantity * (lotSummaryByItem.get(component.inventory_item_id)?.avgCostCents ?? 0);
      } catch {
        return sum;
      }
    }, 0);
    const boxQty = (recipe.product_recipe_components ?? []).filter(isBoxComponent).reduce((sum, component) => sum + normalizeInventoryNumber(component.quantity), 0);
    const fixedCost = fixedRecipeCostCents({
      boxQty,
      shippingLabelQty: recipe.shipping_label_qty,
      brandingLabelQty: recipe.branding_label_qty,
    });
    const laborCost = laborCostCents(recipe.labor_minutes, recipe.labor_rate_cents);
    return (materialCost + fixedCost + laborCost) / outputQty;
  }

  const recipeByProductId = new Map(recipes.map((recipe) => [recipe.product_id, recipe]));
  const finishedItemByProductId = new Map(
    items
      .filter((item) => item.item_type === 'finished_good' && item.product_id)
      .map((item) => [item.product_id as string, item])
  );

  const rawCoffeeItems = items.filter((item) => item.active && item.item_type === 'raw_coffee');
  const materialSupplyItems = items.filter((item) => item.active && item.item_type === 'material_supply');
  const sellableRows = products
    .filter((product) => product.active !== false)
    .map((product) => {
      const finishedItem = finishedItemByProductId.get(product.id);
      const finishedSummary = finishedItem ? lotSummaryByItem.get(finishedItem.id) : undefined;
      const onHand = finishedSummary?.remaining ?? 0;
      const reserved = reservedQtyByProductId.get(product.id) ?? 0;
      const available = onHand - reserved;
      const latestCost = latestActualCostByProductId.get(product.id) ?? 0;
      const averageFinishedCost = finishedSummary?.avgCostCents ?? 0;
      const estimatedRecipeCost = estimateRecipeUnitCost(recipeByProductId.get(product.id));
      return {
        product,
        onHand,
        reserved,
        available,
        costCents: latestCost || averageFinishedCost || estimatedRecipeCost,
        costSource: latestCost ? 'Latest production COGS' : averageFinishedCost ? 'Average finished stock COGS' : estimatedRecipeCost ? 'Recipe estimate' : 'No COGS yet',
      };
    });

  return (
    <div className="space-y-6">
      <section className="panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="eyebrow">Inventory</span>
            <h1 className="page-title mt-4">Stock and COGS</h1>
            <p className="page-subtitle mt-3">Raw coffee, materials and supplies, and finished sellable inventory are separated so counts do not get mixed together.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/admin/receiving" className="btn-secondary w-full sm:w-auto">Receive inventory</Link>
            <Link href="/admin/production" className="btn-primary w-full sm:w-auto">Add production</Link>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <SectionHeading eyebrow="Raw Coffee" title="Coffee inventory" subtitle="Coffee is received and consumed in pounds." />
        <div className="grid gap-3 lg:grid-cols-2">
          {rawCoffeeItems.map((item) => {
            const summary = lotSummaryByItem.get(item.id);
            return (
              <StockCard
                key={item.id}
                name={itemDisplayName(item)}
                detail={`${inventoryItemTypeLabel(item.item_type)} - stocked in ${item.base_unit}`}
                quantity={formatInventoryQuantity(summary?.remaining ?? 0, item.base_unit)}
                costLabel={`Avg ${usd(Math.round(summary?.avgCostCents ?? 0))} / ${item.base_unit}`}
              />
            );
          })}
          {!rawCoffeeItems.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No raw coffee items have been created yet.</p> : null}
        </div>
      </section>

      <section className="card space-y-4">
        <SectionHeading eyebrow="Materials & Supplies" title="Packaging and production inputs" subtitle="These are received in units and consumed by recipes. Tape, shipping labels, and branding labels are non-stock expenses." />
        <div className="grid gap-3 lg:grid-cols-2">
          {materialSupplyItems.map((item) => {
            const summary = lotSummaryByItem.get(item.id);
            return (
              <StockCard
                key={item.id}
                name={itemDisplayName(item)}
                detail={`${inventoryItemTypeLabel(item.item_type)} - stocked in ${item.base_unit}`}
                quantity={formatInventoryQuantity(summary?.remaining ?? 0, item.base_unit)}
                costLabel={`Avg ${usd(Math.round(summary?.avgCostCents ?? 0))} / ${item.base_unit}`}
              />
            );
          })}
          {!materialSupplyItems.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No materials or supplies have been created yet.</p> : null}
        </div>
      </section>

      <section className="card space-y-4">
        <SectionHeading eyebrow="Sellable Inventory" title="Finished goods available to sell" subtitle="On hand comes from production. Available stock subtracts open New and Processing orders and can go negative." />
        <div className="space-y-3">
          {sellableRows.map((row) => (
            <div key={row.product.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-slate-950">{productName(row.product)}</p>
                  <p className="mt-1 text-sm text-slate-500">{row.product.sku || 'No SKU'} - {row.costSource}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 xl:min-w-[34rem]">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">On hand</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.onHand, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Reserved</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatInventoryQuantity(row.reserved, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Available</p>
                    <p className={`mt-1 font-semibold ${row.available < 0 ? 'text-rose-700' : 'text-slate-950'}`}>{formatInventoryQuantity(row.available, 'each')}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Unit COGS</p>
                    <p className="mt-1 font-semibold text-slate-950">{usd(Math.round(row.costCents))}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {!sellableRows.length ? <p className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">No active products found.</p> : null}
        </div>
      </section>
    </div>
  );
}

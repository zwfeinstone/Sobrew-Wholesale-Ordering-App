import {
  chooseProductCostCents,
  historicalShippingByProduct,
  priceRangeCents,
  recipeUnitCostEstimateCents,
  targetMarginPriceCents,
  type SalesPriceGuideCostSource,
  type SalesPriceGuideOrderItemRow,
  type SalesPriceGuideOrderRow,
  type SalesPriceGuideRecipeRow,
  type SalesPriceGuideShippingSummary,
} from '@/lib/sales-price-guide';
import { requireAdminSectionView } from '@/lib/admin-permissions';
import { normalizeInventoryNumber, type InventoryUnit } from '@/lib/inventory';
import {
  productCategoryGroupKey,
  productCategoryLabel,
  productCategorySortRank,
  type ProductCategoryGroup,
} from '@/lib/product-categories';
import { createClient } from '@/lib/supabase/server';
import { usd } from '@/lib/utils';

type ProductRow = {
  active: boolean | null;
  category: string | null;
  id: string;
  name: string | null;
  sku: string | null;
};

type InventoryItemRow = {
  active: boolean | null;
  base_unit: InventoryUnit;
  id: string;
  item_type: string;
  product_id: string | null;
};

type InventoryLotRow = {
  inventory_item_id: string;
  quantity_remaining: number | string;
  unit_cost_cents: number | string;
};

type ProductionRunRow = {
  actual_unit_cost_cents: number | string | null;
  product_id: string;
  quantity_produced?: number | string | null;
  quantity_voided?: number | string | null;
  status?: string | null;
};

type PriceRow = {
  price_cents: number | string;
  product_id: string;
};

type GuideRow = {
  costSource: SalesPriceGuideCostSource;
  currentPriceRange: ReturnType<typeof priceRangeCents>;
  price30Cents: number;
  price40Cents: number;
  price50Cents: number;
  product: ProductRow;
  productCostCents: number;
  shippingSummary: SalesPriceGuideShippingSummary | null;
  totalCostCents: number;
};

const TARGET_MARGINS = [
  { key: 'price30Cents', label: '30%' },
  { key: 'price40Cents', label: '40%' },
  { key: 'price50Cents', label: '50%' },
] as const;

const COST_SOURCE_LABELS: Record<SalesPriceGuideCostSource, string> = {
  finished_stock: 'Finished stock',
  latest_production: 'Latest production',
  missing_cost: 'Missing cost',
  recipe_estimate: 'Recipe estimate',
};

function activeProductionQuantity(run: ProductionRunRow) {
  if (run.status === 'void' || run.status === 'voided') return 0;
  return Math.max(0, normalizeInventoryNumber(run.quantity_produced) - normalizeInventoryNumber(run.quantity_voided));
}

function productDisplayName(product: ProductRow) {
  return product.name?.trim() || product.sku?.trim() || 'Unnamed product';
}

function sourceTone(source: SalesPriceGuideCostSource) {
  if (source === 'latest_production') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (source === 'finished_stock') return 'border-teal-200 bg-teal-50 text-teal-800';
  if (source === 'recipe_estimate') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-rose-200 bg-rose-50 text-rose-700';
}

function formatMoney(value: number) {
  return usd(Math.round(value));
}

function formatRange(range: GuideRow['currentPriceRange']) {
  if (!range) return 'No prices';
  if (range.minCents === range.maxCents) return formatMoney(range.medianCents);
  return `${formatMoney(range.minCents)} / ${formatMoney(range.medianCents)} / ${formatMoney(range.maxCents)}`;
}

function formatTargetPrice(row: GuideRow, value: number) {
  return row.costSource === 'missing_cost' || value <= 0 ? '-' : formatMoney(value);
}

function shippingDetail(summary: SalesPriceGuideShippingSummary | null) {
  if (!summary || summary.unitsSold <= 0) return 'No shipping history';
  const unitLabel = summary.unitsSold === 1 ? 'unit' : 'units';
  const orderLabel = summary.orderCount === 1 ? 'order' : 'orders';
  return `${formatMoney(summary.averageShippingCents)} avg from ${summary.unitsSold.toLocaleString()} ${unitLabel}, ${summary.orderCount.toLocaleString()} ${orderLabel}`;
}

function groupRows(rows: GuideRow[]) {
  const groups: Array<{ category: ProductCategoryGroup; rows: GuideRow[] }> = [];
  for (const row of rows) {
    const category = productCategoryGroupKey(row.product.category);
    const current = groups[groups.length - 1];
    if (current?.category === category) {
      current.rows.push(row);
    } else {
      groups.push({ category, rows: [row] });
    }
  }
  return groups;
}

export default async function SalesPriceGuidePage() {
  await requireAdminSectionView('sales');
  const supabase = await createClient();
  const [
    productsResult,
    pricesResult,
    inventoryItemsResult,
    inventoryLotsResult,
    recipesResult,
    productionRunsResult,
    shippedOrdersResult,
    shippedOrderItemsResult,
  ] = await Promise.all([
    supabase.from('products').select('id,name,sku,category,active').eq('active', true).order('name', { ascending: true }),
    supabase.from('user_product_prices').select('product_id,price_cents').limit(50000),
    supabase.from('inventory_items').select('id,item_type,base_unit,product_id,active').eq('active', true).limit(50000),
    supabase.from('inventory_lots').select('inventory_item_id,quantity_remaining,unit_cost_cents').limit(50000),
    supabase.from('product_recipes').select('product_id,output_qty,waste_percent,labor_minutes,labor_rate_cents,shipping_label_qty,branding_label_qty,product_recipe_components(inventory_item_id,quantity,unit,component_role,inventory_items(id,base_unit,sku))').limit(50000),
    supabase.from('production_runs').select('product_id,quantity_produced,quantity_voided,status,actual_unit_cost_cents,produced_at').order('produced_at', { ascending: false }).limit(50000),
    supabase.from('orders').select('id,status,shipping_cost_cents').eq('status', 'Shipped').limit(50000),
    supabase.from('order_items').select('id,order_id,product_id,qty,unit_price_cents,line_total_cents,shipping_boxes_used,cogs_shipping_cents,cogs_snapshot_at').limit(50000),
  ]);

  const products = (productsResult.data ?? []) as ProductRow[];
  const prices = (pricesResult.data ?? []) as PriceRow[];
  const inventoryItems = (inventoryItemsResult.data ?? []) as InventoryItemRow[];
  const inventoryLots = (inventoryLotsResult.data ?? []) as InventoryLotRow[];
  const recipes = (recipesResult.data ?? []) as SalesPriceGuideRecipeRow[];
  const productionRuns = (productionRunsResult.data ?? []) as ProductionRunRow[];
  const shippedOrders = (shippedOrdersResult.data ?? []) as SalesPriceGuideOrderRow[];
  const shippedOrderItems = (shippedOrderItemsResult.data ?? []) as SalesPriceGuideOrderItemRow[];

  const avgCostByInventoryItemId = new Map<string, number>();
  for (const item of inventoryItems) {
    const lots = inventoryLots.filter((lot) => lot.inventory_item_id === item.id);
    const remaining = lots.reduce((sum, lot) => sum + normalizeInventoryNumber(lot.quantity_remaining), 0);
    const valueCents = lots.reduce((sum, lot) => sum + normalizeInventoryNumber(lot.quantity_remaining) * normalizeInventoryNumber(lot.unit_cost_cents), 0);
    avgCostByInventoryItemId.set(item.id, remaining > 0 ? valueCents / remaining : 0);
  }

  const latestProductionCostByProductId = new Map<string, number>();
  for (const run of productionRuns) {
    const actualCost = normalizeInventoryNumber(run.actual_unit_cost_cents);
    if (actualCost > 0 && activeProductionQuantity(run) > 0 && !latestProductionCostByProductId.has(run.product_id)) {
      latestProductionCostByProductId.set(run.product_id, actualCost);
    }
  }

  const finishedItemByProductId = new Map(
    inventoryItems
      .filter((item) => item.item_type === 'finished_good' && item.product_id)
      .map((item) => [item.product_id as string, item])
  );
  const recipesByProductId = new Map(recipes.map((recipe) => [recipe.product_id, recipe]));
  const shippingByProductId = historicalShippingByProduct({ orderItems: shippedOrderItems, orders: shippedOrders });
  const pricesByProductId = new Map<string, Array<number | string>>();
  for (const price of prices) {
    const values = pricesByProductId.get(price.product_id) ?? [];
    values.push(price.price_cents);
    pricesByProductId.set(price.product_id, values);
  }

  const rows = products
    .map((product) => {
      const finishedItem = finishedItemByProductId.get(product.id);
      const costChoice = chooseProductCostCents({
        averageFinishedStockCostCents: finishedItem ? avgCostByInventoryItemId.get(finishedItem.id) ?? 0 : 0,
        latestProductionCostCents: latestProductionCostByProductId.get(product.id) ?? 0,
        recipeEstimateCostCents: recipeUnitCostEstimateCents(recipesByProductId.get(product.id), avgCostByInventoryItemId),
      });
      const shippingSummary = shippingByProductId.get(product.id) ?? null;
      const totalCostCents = costChoice.costCents + (shippingSummary?.averageShippingCents ?? 0);

      return {
        costSource: costChoice.source,
        currentPriceRange: priceRangeCents(pricesByProductId.get(product.id) ?? []),
        price30Cents: costChoice.source === 'missing_cost' ? 0 : targetMarginPriceCents(totalCostCents, 30),
        price40Cents: costChoice.source === 'missing_cost' ? 0 : targetMarginPriceCents(totalCostCents, 40),
        price50Cents: costChoice.source === 'missing_cost' ? 0 : targetMarginPriceCents(totalCostCents, 50),
        product,
        productCostCents: costChoice.costCents,
        shippingSummary,
        totalCostCents,
      } satisfies GuideRow;
    })
    .sort((a, b) => {
      const categoryComparison = productCategorySortRank(a.product.category) - productCategorySortRank(b.product.category);
      if (categoryComparison !== 0) return categoryComparison;
      return productDisplayName(a.product).localeCompare(productDisplayName(b.product), 'en-US', { numeric: true, sensitivity: 'base' });
    });
  const groupedRows = groupRows(rows);
  const missingCostCount = rows.filter((row) => row.costSource === 'missing_cost').length;
  const productsWithShippingHistory = rows.filter((row) => row.shippingSummary).length;

  return (
    <div className="space-y-6">
      <section className="panel">
        <span className="eyebrow">Growth</span>
        <h1 className="page-title mt-4">Sales Price Guide</h1>
        <p className="page-subtitle mt-3 max-w-3xl">
          Reference product cost, historical shipping, and clean quote prices for 30%, 40%, and 50% gross margins.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Active products</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{rows.length.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Shipping history</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{productsWithShippingHistory.toLocaleString()}</p>
          <p className="mt-1 text-sm text-slate-500">Products with shipped-order data.</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Needs cost</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{missingCostCount.toLocaleString()}</p>
          <p className="mt-1 text-sm text-slate-500">Products missing production, stock, or recipe cost.</p>
        </div>
      </section>

      {groupedRows.map((group) => (
        <section key={group.category} className="card space-y-4">
          <div>
            <span className="eyebrow">{productCategoryLabel(group.category)}</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{productCategoryLabel(group.category)} pricing</h2>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <th className="px-3 py-3">Product</th>
                  <th className="px-3 py-3 text-right">Product Cost</th>
                  <th className="px-3 py-3 text-right">Avg Shipping</th>
                  <th className="px-3 py-3 text-right">Total Cost</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3 text-right">Current Range</th>
                  {TARGET_MARGINS.map((margin) => (
                    <th key={margin.key} className="px-3 py-3 text-right">{margin.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {group.rows.map((row) => (
                  <tr key={row.product.id} className="align-top">
                    <td className="px-3 py-4">
                      <p className="font-semibold text-slate-950">{productDisplayName(row.product)}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.product.sku || 'No SKU'}</p>
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-950">{row.costSource === 'missing_cost' ? '-' : formatMoney(row.productCostCents)}</td>
                    <td className="px-3 py-4 text-right">
                      <p className="font-semibold text-slate-950">{formatMoney(row.shippingSummary?.averageShippingCents ?? 0)}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.shippingSummary ? `${row.shippingSummary.unitsSold.toLocaleString()} units` : 'No history'}</p>
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-slate-950">{row.costSource === 'missing_cost' ? '-' : formatMoney(row.totalCostCents)}</td>
                    <td className="px-3 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceTone(row.costSource)}`}>
                        {COST_SOURCE_LABELS[row.costSource]}
                      </span>
                    </td>
                    <td className="px-3 py-4 text-right text-slate-700">{formatRange(row.currentPriceRange)}</td>
                    {TARGET_MARGINS.map((margin) => (
                      <td key={margin.key} className="px-3 py-4 text-right text-lg font-semibold text-slate-950">
                        {formatTargetPrice(row, row[margin.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {group.rows.map((row) => (
              <div key={row.product.id} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-950">{productDisplayName(row.product)}</p>
                    <p className="mt-1 text-xs text-slate-500">{row.product.sku || 'No SKU'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceTone(row.costSource)}`}>
                    {COST_SOURCE_LABELS[row.costSource]}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Product Cost</p>
                    <p className="mt-1 font-semibold text-slate-950">{row.costSource === 'missing_cost' ? '-' : formatMoney(row.productCostCents)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Avg Shipping</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatMoney(row.shippingSummary?.averageShippingCents ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Total Cost</p>
                    <p className="mt-1 font-semibold text-slate-950">{row.costSource === 'missing_cost' ? '-' : formatMoney(row.totalCostCents)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Current Range</p>
                    <p className="mt-1 font-semibold text-slate-950">{formatRange(row.currentPriceRange)}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-500">{shippingDetail(row.shippingSummary)}</p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {TARGET_MARGINS.map((margin) => (
                    <div key={margin.key} className="rounded-xl border border-slate-200 bg-white p-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{margin.label}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-950">{formatTargetPrice(row, row[margin.key])}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {!rows.length ? (
        <section className="card text-sm text-slate-500">No active products were found.</section>
      ) : null}
    </div>
  );
}

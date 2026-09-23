import Link from 'next/link';
import type { ReactNode } from 'react';
import { PRODUCT_CATEGORY_OPTIONS, productCategoryGroupKey, productCategoryLabel } from '@/lib/product-categories';
import { buildProductionMaterialPreview, SAMPLE_BOX_FALLBACK_BOX_SKUS, type ProductionMaterialLine, type ProductionMaterialPreview } from '@/lib/production-materials';
import type { ProductionPlan, ProductionPlanningProduct, ProductionDemandEvent } from '@/lib/production-planning';
import type { ProductionPlanningData } from '@/lib/production-planning-data';
import { PLANNING_SORTS, type PlanningView } from '@/lib/production-planning-view';
import { producePlannedInventory } from './actions';
import ProductionForm from './production-form';

type Section = 'now' | 'upcoming' | 'replenishment' | 'covered';
type Row = ProductionPlanningProduct & { preview: ProductionMaterialPreview; materialQty: number; attention: string[] };
type Material = ProductionMaterialLine & { name: string; productNames: Set<string>; productIds: Set<string> };

const number = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const units = (value: number) => `${number(value)} unit${value === 1 ? '' : 's'}`;
const name = (row: ProductionPlanningProduct) => row.product.name?.trim() || 'Unnamed product';
function dateLabel(value: string | null) {
  return value ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : 'Date unavailable';
}
function materialQuantity(value: number, unit: string) {
  if (value > 0 && value < 0.001) return `<0.001 ${unit}`;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`;
}
function firstEvent(row: ProductionPlanningProduct, section: Section) {
  return row.events.find((event) => !event.needsReview && event.shortageQty > 0 && (section === 'upcoming' ? !event.isNow : event.isNow));
}
function rowQuantity(row: ProductionPlanningProduct, section: Section) {
  return section === 'now' ? row.makeNowQty : section === 'upcoming' ? row.outlookQty : section === 'replenishment' ? row.replenishmentQty : 0;
}

export function sortWorkspaceRows<T extends ProductionPlanningProduct>(rows: T[], sort: PlanningView['sort'], section: Section): T[] {
  const confidence = { High: 3, Medium: 2, Low: 1 };
  const byName = (a: T, b: T) => name(a).localeCompare(name(b), 'en-US', { numeric: true }) || a.product.id.localeCompare(b.product.id);
  const firstDate = (row: T) => {
    const event = firstEvent(row, section);
    return event ? event.source === 'order' && sort === 'priority' ? event.orderDate ?? event.prepareDate : event.prepareDate : '9999';
  };
  const priority = (row: T) => section === 'now' ? firstEvent(row, section)?.source === 'order' ? 0 : firstEvent(row, section)?.source === 'recurring' ? 1 : 2 : section === 'replenishment' ? row.explicitReplenishmentQty > 0 ? 0 : row.actionableReplenishmentQty > 0 ? 1 : 2 : 0;
  return [...rows].sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'quantity') return rowQuantity(b, section) - rowQuantity(a, section) || byName(a, b);
    if (sort.startsWith('confidence_')) return (confidence[b.confidence] - confidence[a.confidence]) * (sort === 'confidence_desc' ? 1 : -1) || byName(a, b);
    return (sort === 'priority' ? priority(a) - priority(b) : 0) || firstDate(a).localeCompare(firstDate(b)) || byName(a, b);
  });
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'rose' }) {
  const colors = { neutral: 'bg-slate-100 text-slate-700', green: 'bg-teal-50 text-teal-900', amber: 'bg-amber-50 text-amber-950', rose: 'bg-rose-50 text-rose-900' };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${colors[tone]}`}>{children}</span>;
}

function DemandDetail({ event }: { event: ProductionDemandEvent }) {
  return <li className="rounded-lg border border-slate-200 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-slate-900">{event.customerName}</span><span>{units(event.quantity)}</span></div>
    <p className="mt-1 text-xs leading-relaxed text-slate-600">{event.source === 'order' ? `Open order since ${dateLabel(event.orderDate)}` : `Prepare from ${dateLabel(event.prepareDate)} · Scheduled order ${dateLabel(event.scheduledDate)}`}{event.source === 'order' && event.scheduledDate ? ` · Recurring order scheduled ${dateLabel(event.scheduledDate)}` : ''}</p>
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
      {event.needsReview ? <strong className="text-amber-900">Missed cycle: review before making; excluded from automatic quantities</strong> : <span>{units(event.quantity - event.shortageQty)} covered by recorded stock · {units(event.shortageQty)} uncovered</span>}
      {event.orderId ? <Link className="font-semibold text-teal-800 underline" href={`/admin/orders/${encodeURIComponent(event.orderId)}`}>View order</Link> : <Link className="font-semibold text-teal-800 underline" href="/admin/recurring-orders">View recurring schedules</Link>}
    </div>
  </li>;
}

function ProductCard({ row, section, data, canEdit, returnTo, today }: { row: Row; section: Section; data: ProductionPlanningData; canEdit: boolean; returnTo: string; today: string }) {
  const event = firstEvent(row, section);
  const baseQty = section === 'now' ? row.makeNowQty : section === 'replenishment' ? row.actionableReplenishmentQty : 0;
  const actionable = (section === 'now' || section === 'replenishment') && (baseQty > 0 || row.reviewReplenishmentQty > 0);
  const quantity = rowQuantity(row, section);
  const recipe = data.recipes.find((item) => item.product_id === row.product.id);
  const cardMaterialQty = section === 'upcoming' ? row.outlookQty : row.materialQty;
  const preview = section === 'upcoming' ? buildProductionMaterialPreview({ recipe, productCategory: row.product.category, quantity: cardMaterialQty, onHandByItemId: new Map(Object.entries(data.materialStockByItemId)), fallbackItems: data.items }) : row.preview;
  const componentItemIds = new Set(recipe?.product_recipe_components?.map((component) => component.inventory_item_id));
  const materialItems = data.items.filter((item) => componentItemIds.has(item.id) || (row.product.category === 'sample_boxes' && SAMPLE_BOX_FALLBACK_BOX_SKUS.includes(item.sku ?? '')));
  const materialStockByItemId = Object.fromEntries(materialItems.map((item) => [item.id, data.materialStockByItemId[item.id] ?? 0]));
  const reason = section === 'now' ? row.makeNowReason : section === 'replenishment' ? `Based on ${row.explicitReplenishmentQty > 0 ? 'saved customer stock targets' : 'the remaining weekly shipment estimate'}: ${units(row.replenishmentTargetQty)} total target, with ${units(row.onHand + row.makeNowQty)} already covered. Additional production is rounded up to whole units.` : section === 'upcoming' ? 'Later recurring requirements after allocating recorded stock to earlier customer work.' : 'Recorded stock covers the current recommendations for this product.';
  const invalidRecipe = row.preview.missingRecipe || row.preview.invalidRecipe || row.preview.invalidUnit;
  const relevantEvents = section === 'upcoming' ? row.events.filter((item) => !item.isNow) : row.events;
  const heading = section === 'now' ? `Make ${units(quantity)}` : section === 'upcoming' ? `${units(quantity)} short with recorded stock` : section === 'covered' ? 'Covered by stock' : baseQty > 0 ? `Replenish ${units(baseQty)}` : `Review ${units(row.reviewReplenishmentQty)} before making`;
  const dateText = event ? section === 'now' && event.source === 'order' ? `Open order since ${dateLabel(event.orderDate)}` : `Prepare from ${dateLabel(event.prepareDate)}${event.prepareDate === today ? ' · Today' : ''}` : section === 'now' && row.stockCorrectionQty > 0 ? 'Restore the recorded stock balance' : null;
  return <article id={`${section}-${row.product.id}`} className={`rounded-2xl border bg-white p-4 sm:p-5 ${section === 'now' ? 'border-teal-200' : 'border-slate-200'}`}>
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge>{productCategoryLabel(row.product.category)}</Badge>
          {row.product.active === false ? <Badge tone="amber">Inactive product · existing orders only</Badge> : null}
          {row.hasRecurring ? <Badge tone="green">Recurring</Badge> : null}
          {row.events.some((item) => item.source === 'order') ? <Badge tone="green">Confirmed order</Badge> : null}
          <Badge tone={row.confidence === 'High' ? 'green' : row.confidence === 'Medium' ? 'amber' : 'neutral'}>Forecast: {row.confidence}</Badge>
          {row.reviewReplenishmentQty > 0 && section === 'replenishment' ? <Badge tone="amber">Review forecast</Badge> : null}
        </div>
        <h3 className="text-lg font-semibold tracking-tight text-slate-950">{name(row)}</h3>
        {row.product.sku ? <p className="mt-1 text-xs font-medium text-slate-500">{row.product.sku}</p> : null}
      </div>
      <div className="lg:max-w-sm lg:text-right"><p className={`text-xl font-bold tracking-tight ${section === 'now' ? 'text-teal-900' : 'text-slate-950'}`}>{heading}</p>{dateText ? <p className="mt-1 text-sm font-medium text-slate-700">{dateText}</p> : null}{event?.scheduledDate ? <p className="mt-1 text-xs text-slate-600">Scheduled order {dateLabel(event.scheduledDate)}</p> : null}</div>
    </div>
    <p className="mt-4 text-sm leading-relaxed text-slate-700">{reason}</p>
    {row.attention.length ? <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{row.attention.map((message) => <li key={message}>{message}</li>)}</ul> : null}
    <details className="my-4 rounded-lg bg-slate-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">Why this item is here · stock, customers &amp; materials</summary>
      <div className="mt-4 space-y-4 text-sm text-slate-700">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Recorded stock</dt><dd className="mt-1 font-semibold">{units(row.onHand)}</dd></div>
          <div><dt className="text-xs text-slate-500">Committed to open orders</dt><dd className="mt-1 font-semibold">{units(row.openOrderQty)}</dd></div>
          <div><dt className="text-xs text-slate-500">After open orders</dt><dd className="mt-1 font-semibold">{units(row.availableAfterOpenOrders)}</dd></div>
          <div><dt className="text-xs text-slate-500">Par / minimum target</dt><dd className="mt-1 font-semibold">{number(row.parQty)} / {number(row.minimumQty)} units</dd></div>
        </dl>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">Forecast confidence</span><Badge tone={row.confidence === 'High' ? 'green' : row.confidence === 'Medium' ? 'amber' : 'neutral'}>{row.confidence}</Badge></div>
          <p className="mt-2">Average {units(row.historyWeeklyAverageQty)} per week; shipped in {row.historyWeeksWithSales} of the last 8 weeks.</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">The average includes weeks with no shipments. Shipped this week: {units(row.shippedThisWeekQty)}. Remaining weekly estimate: {units(row.historyRemainingQty)}. High = 6–8 weeks with shipments; Medium = 3–5; Low = 0–2. Confidence describes history, not confirmed orders.</p>
        </div>
        {row.makeNowQty > 0 ? <p><strong>Make now calculation:</strong> {units(row.nowDemandQty)} needed now − ({units(row.onHand)} recorded stock) = {units(row.makeNowQty)} to make, rounded up.</p> : null}
        {row.replenishmentQty > 0 ? <p><strong>Replenishment calculation:</strong> Target {units(row.replenishmentTargetQty)} − ({units(row.onHand)} stock + {units(row.makeNowQty)} to make now) = {units(row.replenishmentQty)} additional. Targets overlap demand.</p> : null}
        {relevantEvents.length ? <div><h4 className="mb-2 font-semibold">Customer requirements</h4><ul className="space-y-2">{relevantEvents.map((item) => <DemandDetail key={item.id} event={item} />)}</ul></div> : null}
        {preview.lines.length && (!actionable || !canEdit) ? <div><h4 className="font-semibold">Material estimate for {units(cardMaterialQty)}</h4><p className="mt-1 text-xs text-slate-600">Uses current stock for this run alone. Other runs use the same materials; additions or a different actual quantity change these needs.</p><ul className="mt-2 space-y-2">{preview.lines.map((line) => <li key={line.inventoryItemId} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white p-2"><span>{data.items.find((item) => item.id === line.inventoryItemId)?.name ?? 'Unknown material'}</span><span>Need {materialQuantity(line.requiredQty, line.unit)} · {line.shortageQty > 0 ? <strong className="text-rose-800">Short {materialQuantity(line.shortageQty, line.unit)}</strong> : `${materialQuantity(line.availableQty, line.unit)} on hand`}</span></li>)}</ul></div> : null}
      </div>
    </details>
    {section === 'upcoming' && row.makeNowQty > 0 ? <p className="text-sm text-slate-600">This product also has work in <a href={`#now-${row.product.id}`} className="font-semibold text-teal-800 underline">Make now</a>. Record completed production there before reassessing later shortages.</p> : null}
    {actionable && canEdit ? <ProductionForm key={`${section}-${row.product.id}-${baseQty}-${row.replenishmentQty}`} productId={row.product.id} quantity={baseQty} optionalQty={section === 'now' ? row.actionableReplenishmentQty : 0} reviewQty={row.reviewReplenishmentQty} returnTo={returnTo} disabled={invalidRecipe} action={producePlannedInventory} recipe={recipe ? { output_qty: recipe.output_qty, waste_percent: recipe.waste_percent, product_recipe_components: recipe.product_recipe_components } : null} productCategory={row.product.category ?? null} materialStockByItemId={materialStockByItemId} materialItems={materialItems} /> : null}
  </article>;
}

export default function ProductionPlanningWorkspace({ data, plan, view, canEdit, returnTo }: { data: ProductionPlanningData; plan: ProductionPlan; view: PlanningView; canEdit: boolean; returnTo: string }) {
  const recipes = new Map(data.recipes.map((recipe) => [recipe.product_id, recipe]));
  const materialStock = new Map(Object.entries(data.materialStockByItemId));
  const rows: Row[] = plan.products.map((row) => {
    const materialQty = row.makeNowQty || row.actionableReplenishmentQty || row.reviewReplenishmentQty || row.outlookQty || row.reviewRecurringQty;
    const preview = buildProductionMaterialPreview({ recipe: recipes.get(row.product.id), productCategory: row.product.category, quantity: materialQty, onHandByItemId: materialStock, fallbackItems: data.items });
    const attention: string[] = [];
    if (materialQty > 0 && preview.missingRecipe) attention.push('Recipe missing. Save a product recipe before recording production.');
    else if (materialQty > 0 && preview.invalidRecipe) attention.push('Recipe needs attention. Check its output quantity and components.');
    else if (materialQty > 0 && preview.invalidUnit) attention.push('Recipe units need attention. A material cannot be converted.');
    if (preview.hasShortages) {
      for (const line of preview.lines.filter((item) => item.shortageQty > 0)) attention.push(`Material short: ${data.items.find((item) => item.id === line.inventoryItemId)?.name ?? 'Unknown material'} — ${materialQuantity(line.shortageQty, line.unit)} for ${units(materialQty)}.`);
    }
    if (row.stockCorrectionQty > 0) attention.push(`Recorded stock is ${units(row.onHand)}. Make now includes ${units(row.stockCorrectionQty)} once to restore that balance.`);
    if (plan.scheduleReviews.some((review) => review.affectedProductIds.includes(row.product.id))) attention.push('Review recurring schedule. Ungenerated missed cycles requiring review are excluded from automatic production.');
    if (row.reviewReplenishmentQty > 0) attention.push(`${units(row.reviewReplenishmentQty)} of additional history-based replenishment need review because forecast confidence is low.`);
    return { ...row, preview, materialQty, attention };
  });
  const materialTotals = new Map<string, Material>();
  let remaining = new Map(materialStock);
  let materialEstimateIncomplete = false;
  for (const row of sortWorkspaceRows(rows.filter((item) => item.makeNowQty > 0), 'priority', 'now')) {
    const preview = buildProductionMaterialPreview({ recipe: recipes.get(row.product.id), productCategory: row.product.category, quantity: row.makeNowQty, onHandByItemId: remaining, fallbackItems: data.items });
    if (preview.missingRecipe || preview.invalidRecipe || preview.invalidUnit) materialEstimateIncomplete = true;
    remaining = preview.remainingOnHandByItemId;
    for (const line of preview.lines) {
      const total = materialTotals.get(line.inventoryItemId) ?? { ...line, requiredQty: 0, expectedQty: 0, availableQty: materialStock.get(line.inventoryItemId) ?? 0, shortageQty: 0, name: data.items.find((item) => item.id === line.inventoryItemId)?.name ?? 'Unknown material', productNames: new Set<string>(), productIds: new Set<string>() };
      total.requiredQty += line.requiredQty;
      total.expectedQty += line.expectedQty;
      total.shortageQty = Math.max(0, total.requiredQty - total.availableQty);
      total.productNames.add(name(row));
      total.productIds.add(row.product.id);
      materialTotals.set(line.inventoryItemId, total);
    }
  }
  const materials = [...materialTotals.values()].sort((a, b) => Number(b.shortageQty > 0) - Number(a.shortageQty > 0) || a.name.localeCompare(b.name));
  for (const material of materials.filter((item) => item.shortageQty > 0)) {
    for (const row of rows.filter((item) => material.productIds.has(item.product.id))) {
      row.attention.push(`Shared material shortage: the full Make now queue is short ${materialQuantity(material.shortageQty, material.unit)} of ${material.name}. Coordinate runs before using this shared stock.`);
    }
  }
  const matches = (row: Row) => (!view.q || [name(row), row.product.sku ?? ''].some((value) => value.toLocaleLowerCase().includes(view.q.toLocaleLowerCase())))
    && (view.category === 'all' || productCategoryGroupKey(row.product.category) === view.category)
    && (view.focus !== 'recurring' || row.hasRecurring || plan.scheduleReviews.some((review) => review.affectedProductIds.includes(row.product.id)))
    && (view.focus !== 'attention' || row.attention.length > 0);
  const filtered = rows.filter(matches);
  const nowRows = filtered.filter((row) => row.makeNowQty > 0);
  const upcomingRows = filtered.filter((row) => row.outlookQty > 0);
  const replenishmentRows = filtered.filter((row) => row.makeNowQty <= 0 && row.replenishmentQty > 0);
  const coveredRows = filtered.filter((row) => row.makeNowQty <= 0 && row.outlookQty <= 0 && row.replenishmentQty <= 0 && (row.events.some((event) => !event.needsReview) || row.replenishmentTargetQty > 0 || row.onHand > 0));
  const attentionRows = filtered.filter((row) => row.attention.length > 0);
  const relevantReviews = plan.scheduleReviews.filter((review) => review.affectedProductIds.length === 0 ? !view.q && view.category === 'all' : filtered.some((row) => review.affectedProductIds.includes(row.product.id)));
  const allNowRows = rows.filter((row) => row.makeNowQty > 0);
  const attentionCount = rows.filter((row) => row.attention.length > 0).length + plan.scheduleReviews.filter((review) => review.affectedProductIds.length === 0).length;
  const filteredActive = Boolean(view.q || view.category !== 'all' || view.focus !== 'all');

  const sections: Array<{ id: Section; title: string; description: string; rows: Row[]; empty: string }> = [
    { id: 'now', title: 'Make now', description: 'Confirmed open-order shortages first, then recurring work ready to prepare. Quantities already account for recorded stock.', rows: nowRows, empty: 'No immediate production needed for this view.' },
    { id: 'upcoming', title: 'Upcoming · 14-day outlook', description: `${dateLabel(plan.today)} – ${dateLabel(plan.horizonEnd)}. Shortages use recorded stock only. Today’s recommendations count after production is recorded and may reduce these amounts.`, rows: upcomingRows, empty: 'No later recurring shortages in this view.' },
    { id: 'replenishment', title: 'Replenishment', description: 'Consider after customer work. Saved targets come first; weak history needs review. Extras for products in Make now are included as optional additions on those cards.', rows: replenishmentRows, empty: 'No separate replenishment needed for this view.' },
    ...(view.covered ? [{ id: 'covered' as const, title: 'Covered by stock', description: 'Recorded stock covers these products. No additional production is recommended.', rows: coveredRows, empty: 'No covered products in this view.' }] : []),
  ];

  return <>
    <div className="grid gap-3 sm:grid-cols-3">
      <a href="#make-now" className="stat-card"><p className="text-sm font-semibold text-slate-600">Make now</p><p className="mt-2 text-3xl font-bold text-teal-900">{allNowRows.length} <span className="text-base font-medium">products</span></p><p className="mt-1 text-xs text-slate-600">{units(allNowRows.reduce((sum, row) => sum + row.makeNowQty, 0))} across all immediate work</p></a>
      <a href="#upcoming" className="stat-card"><p className="text-sm font-semibold text-slate-600">Upcoming shortages</p><p className="mt-2 text-3xl font-bold text-slate-950">{rows.filter((row) => row.outlookQty > 0).length} <span className="text-base font-medium">products</span></p><p className="mt-1 text-xs text-slate-600">Next 14 days · reviewed separately from replenishment</p></a>
      <a href="#needs-attention" className="stat-card"><p className="text-sm font-semibold text-slate-600">Needs attention</p><p className={`mt-2 text-3xl font-bold ${attentionCount ? 'text-amber-900' : 'text-slate-950'}`}>{attentionCount} <span className="text-base font-medium">items</span></p><p className="mt-1 text-xs text-slate-600">Materials, recipes, stock balances, and reviews</p></a>
    </div>
    <form key={returnTo} method="get" action="/admin/planning" className="card space-y-3" aria-label="Filter production plan">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm font-medium"><span>Find product</span><input className="input" type="search" name="q" placeholder="Product name or SKU" defaultValue={view.q} /></label>
        <label className="space-y-1 text-sm font-medium"><span>Production category</span><select className="input" name="category" defaultValue={view.category}><option value="all">All categories</option>{PRODUCT_CATEGORY_OPTIONS.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}<option value="uncategorized">Needs category</option></select></label>
        <label className="space-y-1 text-sm font-medium"><span>Show</span><select className="input" name="focus" defaultValue={view.focus}><option value="all">All work</option><option value="recurring">Recurring products</option><option value="attention">Needs attention</option></select></label>
        <label className="space-y-1 text-sm font-medium"><span>Sort within each section</span><select className="input" name="sort" defaultValue={view.sort}>{PLANNING_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm"><input className="h-4 w-4" type="checkbox" name="covered" value="1" defaultChecked={view.covered} />Show covered items</label><button className="btn-primary" type="submit">Apply view</button><Link className="text-sm font-semibold text-slate-600 underline" href="/admin/planning">Reset</Link></div>
      {filteredActive ? <p className="text-xs text-slate-600">Product lists are filtered. Summary counts and Make now material totals describe the full plan.</p> : null}
    </form>
    <section id="needs-attention" className="card scroll-mt-4">
      <h2 className="text-xl font-semibold text-slate-950">Needs attention</h2>
      {!attentionRows.length && !relevantReviews.length && !materials.some((material) => material.shortageQty > 0) ? <p className="mt-2 text-sm text-slate-600">No planning issues in this view.</p> : null}
      {attentionRows.length ? <details className="mt-3" open={view.focus === 'attention'}><summary className="cursor-pointer text-sm font-semibold text-amber-950">{attentionRows.length} products to check</summary><ul className="mt-3 space-y-3">{attentionRows.map((row) => <li key={row.product.id} className="rounded-lg bg-amber-50 p-3 text-sm"><p className="font-semibold">{name(row)}</p><ul className="mt-1 space-y-1 text-amber-950">{row.attention.map((message) => <li key={message}>{message}</li>)}</ul></li>)}</ul></details> : null}
      {relevantReviews.map((review) => <details key={`${review.scheduleId}:${review.reason}`} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-amber-950">Review recurring schedule · {review.customerName}</summary><p className="mt-2 text-sm">{review.message}</p><ul className="mt-2 space-y-1 text-sm">{filtered.flatMap((row) => row.events.filter((event) => event.needsReview && event.recurringOrderId === review.scheduleId).map((event) => <li key={event.id}>{name(row)} · {units(event.quantity)} · Missed {dateLabel(event.scheduledDate)}</li>))}</ul><Link className="mt-3 inline-block text-sm font-semibold text-teal-800 underline" href="/admin/recurring-orders">Review recurring orders</Link></details>)}
      {materials.some((material) => material.shortageQty > 0) ? <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">The full Make now queue exceeds stock for {materials.filter((material) => material.shortageQty > 0).map((material) => material.name).join(', ')}. <a href="#materials" className="font-semibold underline">Check material totals</a> before starting runs.</p> : null}
    </section>
    {sections.map((section) => <section key={section.id} id={section.id === 'now' ? 'make-now' : section.id} className="space-y-3 scroll-mt-4">
      <div className="flex items-center gap-3"><h2 className="text-2xl font-semibold tracking-tight text-slate-950">{section.title}</h2><Badge>{section.rows.length}</Badge></div>
      <p className="max-w-4xl text-sm leading-relaxed text-slate-600">{section.description}</p>
      {sortWorkspaceRows(section.rows, view.sort, section.id).map((row) => <ProductCard key={row.product.id} row={row} section={section.id} data={data} canEdit={canEdit} returnTo={returnTo} today={plan.today} />)}
      {!section.rows.length ? <p className="rounded-xl border border-dashed border-slate-300 bg-white/50 p-5 text-sm text-slate-600">{section.empty}</p> : null}
    </section>)}
    <section id="materials" className="card scroll-mt-4">
      <h2 className="text-xl font-semibold text-slate-950">Materials for Make now</h2>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">Full queue in production-priority order, including shared materials and eligible packaging substitutions. These are estimates, not reservations. Upcoming work and optional replenishment are excluded.</p>
      {materialEstimateIncomplete ? <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">This estimate is incomplete because a Make now product has a missing or invalid recipe. Resolve the recipe warnings before using these totals.</p> : null}
      {materials.length ? <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-200 text-slate-600"><th className="p-2">Material / products</th><th className="p-2">Needed</th><th className="p-2">On hand</th><th className="p-2">Short</th></tr></thead><tbody>{materials.map((material) => <tr key={material.inventoryItemId} className="border-b border-slate-100"><td className="p-2"><p className="font-semibold">{material.name}</p><p className="mt-1 text-xs text-slate-500">{[...material.productNames].join(', ')}</p></td><td className="whitespace-nowrap p-2">{materialQuantity(material.requiredQty, material.unit)}</td><td className="whitespace-nowrap p-2">{materialQuantity(material.availableQty, material.unit)}</td><td className={`whitespace-nowrap p-2 font-semibold ${material.shortageQty > 0 ? 'text-rose-800' : 'text-teal-800'}`}>{material.shortageQty > 0 ? materialQuantity(material.shortageQty, material.unit) : 'Covered'}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-sm text-slate-600">No material requirements calculated for the current Make now queue.</p>}
    </section>
  </>;
}

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProductionForm from '@/app/admin/planning/production-form';
import { buildProductionMaterialPreview, type ProductionMaterialItem, type ProductionMaterialRecipe } from '@/lib/production-materials';
import '@/app/globals.css';

type ProductChoice = 'regular' | 'sample' | 'filter_pack';
type StockScenario = 'covered' | 'mixed' | 'depleted' | 'short';
type Submission = { product: ProductChoice; quantity: number; recorded: boolean; materials: Array<{ id: string; quantity: number }> };

declare global {
  interface Window {
    materialFallbackFixture: { submissions: Submission[]; navigation: string[] };
  }
}
window.materialFallbackFixture = { submissions: [], navigation: [] };
// No native submissions can leave this synthetic fixture, even on a regression.
document.addEventListener('submit', (event) => event.preventDefault());

const roll: ProductionMaterialItem = { id: 'roll-stock', name: 'Roll Stock Fraction Pack Bag', sku: 'MAT-FRAC-ROLL', item_type: 'material_supply', base_unit: 'each', active: true };
const regular: ProductionMaterialItem = { id: 'regular-bag', name: 'Fraction Pack Bag', sku: 'MAT-FRAC-BAG', item_type: 'material_supply', base_unit: 'each', active: true };
const sixOunce: ProductionMaterialItem = { id: 'six-ounce-bag', name: '6 oz Fraction Pack Bag', sku: 'MAT-FRAC-6OZ', item_type: 'material_supply', base_unit: 'each', active: true };
const filterRoll: ProductionMaterialItem = { id: 'filter-roll-stock', name: 'Filter Pack Bag - Roll Stock', sku: 'MAT-FILTER-ROLL', item_type: 'material_supply', base_unit: 'each', active: true };
const filterBag: ProductionMaterialItem = { id: 'filter-bag', name: 'Filter Pack Bag', sku: 'MAT-FILTER-BAG', item_type: 'material_supply', base_unit: 'each', active: true };
const coffee: ProductionMaterialItem = { id: 'coffee', name: 'Roasted Coffee', sku: 'RAW-COFFEE', item_type: 'raw_material', base_unit: 'lb', active: true };
const carton: ProductionMaterialItem = { id: 'carton', name: 'Sample Box 12 × 7 × 4', sku: 'BOX-12X7X4', item_type: 'material_supply', base_unit: 'each', active: true };
const fallbackCarton: ProductionMaterialItem = { id: 'fallback-carton', name: 'Sample Box 12 × 6 × 4', sku: 'MAT-BOX-12X6X4', item_type: 'material_supply', base_unit: 'each', active: true };

function stockFor(product: ProductChoice, scenario: StockScenario) {
  const count = product === 'sample' ? 2 : product === 'filter_pack' ? 40 : 100;
  if (scenario === 'covered') return { primary: product === 'filter_pack' ? 5882 : count * 2, fallback: count * 2 };
  if (scenario === 'mixed') return { primary: product === 'sample' ? 1 : product === 'filter_pack' ? 20 : 60, fallback: count * 2 };
  if (scenario === 'depleted') return { primary: 0, fallback: count * 2 };
  if (product === 'filter_pack') return { primary: 10, fallback: 20 };
  return { primary: product === 'sample' ? 0 : 20, fallback: product === 'sample' ? 1 : 30 };
}

function MaterialFallbackFixture() {
  const query = new URLSearchParams(location.search);
  const initialProduct: ProductChoice = query.get('product') === 'sample' ? 'sample' : query.get('product') === 'filter_pack' ? 'filter_pack' : 'regular';
  const initialScenario: StockScenario = ['covered', 'mixed', 'depleted', 'short'].includes(query.get('scenario') ?? '') ? query.get('scenario') as StockScenario : 'mixed';
  const [product, setProduct] = useState(initialProduct);
  const [scenario, setScenario] = useState(initialScenario);
  const initialStock = stockFor(initialProduct, initialScenario);
  const [primaryStock, setPrimaryStock] = useState(String(initialStock.primary));
  const [fallbackStock, setFallbackStock] = useState(String(initialStock.fallback));
  const [fallbackActive, setFallbackActive] = useState(true);
  const [result, setResult] = useState('');
  const primary = product === 'filter_pack' ? filterRoll : roll;
  const fallback = { ...(product === 'sample' ? sixOunce : product === 'filter_pack' ? filterBag : regular), active: fallbackActive };
  const bagsPerUnit = product === 'sample' ? 2 : product === 'filter_pack' ? 40 : 100;
  const productCategory = product === 'sample' ? 'sample_boxes' : product === 'filter_pack' ? 'filter_packs' : 'fraction_packs';
  const items = [primary, fallback, coffee, carton, fallbackCarton];
  const recipe: ProductionMaterialRecipe = {
    output_qty: 1,
    waste_percent: 0,
    material_fallbacks: [{ primary_inventory_item_id: primary.id, fallback_inventory_item_id: fallback.id }],
    product_recipe_components: [
      { id: 'coffee-component', inventory_item_id: coffee.id, quantity: product === 'sample' ? 0.75 : product === 'filter_pack' ? 5 : 12.5, unit: 'lb', component_role: 'raw_coffee', inventory_items: coffee },
      { id: 'bag-component', inventory_item_id: primary.id, quantity: bagsPerUnit, unit: 'each', component_role: product === 'filter_pack' ? 'filter_pack' : 'fraction_bag', inventory_items: primary },
      ...(product === 'sample' ? [{ id: 'carton-component', inventory_item_id: carton.id, quantity: 1, unit: 'each' as const, component_role: 'box', inventory_items: carton }] : []),
    ],
  };
  const stock = { [primary.id]: Math.max(0, Number(primaryStock) || 0), [fallback.id]: Math.max(0, Number(fallbackStock) || 0), [coffee.id]: 500, [carton.id]: 0, [fallbackCarton.id]: 1000 };
  const previewFor = (quantity: number) => buildProductionMaterialPreview({ recipe, productCategory, quantity, onHandByItemId: new Map(Object.entries(stock)), fallbackItems: items });
  const invalidRecipe = previewFor(1).invalidRecipe;

  function choose(nextProduct: ProductChoice, nextScenario: StockScenario) {
    const nextStock = stockFor(nextProduct, nextScenario);
    setProduct(nextProduct);
    setScenario(nextScenario);
    setPrimaryStock(String(nextStock.primary));
    setFallbackStock(String(nextStock.fallback));
    setFallbackActive(true);
    setResult('');
  }

  async function record(data: FormData) {
    const quantity = Number(data.get('quantity_produced'));
    const preview = previewFor(quantity);
    const recorded = !preview.hasShortages && !preview.invalidRecipe && !preview.invalidUnit && !preview.missingRecipe;
    window.materialFallbackFixture.submissions.push({ product, quantity, recorded, materials: preview.lines.map((line) => ({ id: line.inventoryItemId, quantity: line.requiredQty })) });
    setResult(recorded ? `Simulated run accepted: ${quantity} ${product === 'sample' ? 'sample boxes' : 'cases'}. No live inventory changed.` : 'Simulated run rejected: check material availability. No live inventory changed.');
  }

  return <main className="mx-auto w-full max-w-5xl space-y-5 px-3 py-6 sm:px-6">
    <header className="panel">
      <span className="eyebrow">Isolated browser QA</span>
      <h1 className="page-title mt-4">{product === 'filter_pack' ? 'Filter-pack packaging' : 'Fraction-pack packaging'}</h1>
      <p className="page-subtitle mt-3">Real production form and shared material calculation, using synthetic stock. All actions stay in this page.</p>
    </header>
    <section className="card space-y-4" aria-labelledby="fixture-controls">
      <h2 id="fixture-controls" className="text-xl font-semibold">Test setup</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold">Recipe<select className="input" value={product} onChange={(event) => choose(event.target.value as ProductChoice, scenario)}>
          <option value="regular">Regular case · 100 × 2 oz packs</option><option value="sample">Sample box · 2 × 6 oz packs</option><option value="filter_pack">Filter pack case · 40 bags</option>
        </select></label>
        <label className="space-y-1 text-sm font-semibold">Stock scenario<select className="input" value={scenario} onChange={(event) => choose(product, event.target.value as StockScenario)}>
          <option value="covered">Primary stock covers the run</option><option value="mixed">Mixed roll stock and older bags</option><option value="depleted">Roll stock depleted</option><option value="short">Combined stock shortage</option>
        </select></label>
        <label className="space-y-1 text-sm font-semibold">Roll-stock bags on hand<input className="input" type="number" min="0" step="1" value={primaryStock} onChange={(event) => setPrimaryStock(event.target.value)} /></label>
        <label className="space-y-1 text-sm font-semibold">Fallback bags on hand<input className="input" type="number" min="0" step="1" value={fallbackStock} onChange={(event) => setFallbackStock(event.target.value)} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={fallbackActive} onChange={(event) => setFallbackActive(event.target.checked)} />Fallback material is active</label>
      <p className="text-sm text-slate-600">Fallback: {fallback.name}. {product === 'sample' ? 'Each sample box uses two bags. Its existing 12 × 6 × 4 carton alternative is also available.' : `Each case uses ${bagsPerUnit} bags.`}</p>
    </section>
    <section className="card space-y-4" aria-labelledby="production-heading">
      <h2 id="production-heading" className="text-xl font-semibold">{product === 'sample' ? 'Sample box production' : product === 'filter_pack' ? 'Filter pack production' : 'Regular case production'}</h2>
      <ProductionForm key={`${product}-${scenario}`} productId={`fixture-${product}`} quantity={1} optionalQty={0} reviewQty={0} recipe={recipe} productCategory={productCategory} materialStockByItemId={stock} materialItems={items} returnTo="/admin/planning" disabled={invalidRecipe} action={record} />
      {result ? <p role="status" className="rounded-lg bg-slate-100 p-3 text-sm">{result}</p> : null}
    </section>
  </main>;
}

createRoot(document.getElementById('fixture-root')!).render(<MaterialFallbackFixture />);

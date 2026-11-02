import type { ProductionPlanningData } from '@/lib/production-planning-data';
import type { ProductionMaterialComponent } from '@/lib/production-materials';
import type { ProductionPlan, ProductionPlanningProduct } from '@/lib/production-planning';

export type MachineBagType = 'fraction' | 'filter' | 'sample';
export type MachineBagSummarySource = {
  productId: string;
  productName: string;
  unitsToMake: number;
  bagCount: number;
};
export type MachineBagSummaryRow = {
  key: string;
  bagType: MachineBagType;
  sizeOz: number;
  roast: string;
  bagCount: number;
  /** Coffee packed in the bags; recipe waste is not part of the fill weight. */
  coffeeLb: number;
  sources: MachineBagSummarySource[];
};
export type MachineBagSummary = {
  today: string;
  horizonEnd: string;
  rows: MachineBagSummaryRow[];
  totalBags: number;
  issues: { productId: string; productName: string; message: string }[];
  reviewMessages: string[];
  includeForecast: boolean;
};

// User-confirmed production packout: every finished sample box contains one
// 6 oz ground dark bag and one 6 oz ground medium bag, including whole-bean boxes.
// These packet counts cannot be inferred from sample recipes, which also include
// whole-bean coffee and K-cups. This changes reporting only, never recipe stock.
export const SAMPLE_BOX_MACHINE_PACKOUT = [
  { roast: 'Dark Roast', sizeOz: 6, bagsPerUnit: 1 },
  { roast: 'Medium Roast', sizeOz: 6, bagsPerUnit: 1 },
] as const;

const ROAST_NAMES = [
  { expression: /\bdecaf(?:feinated)?\b/i, label: 'Decaf' },
  { expression: /\bespresso\b/i, label: 'Espresso Roast' },
  { expression: /\bfrench\b/i, label: 'French Roast' },
  { expression: /\bmedium\b/i, label: 'Medium Roast' },
  { expression: /\bdark\b/i, label: 'Dark Roast' },
  { expression: /\blight\b/i, label: 'Light Roast' },
] as const;

function namedRoast(name: string) {
  // Decaf is a distinct machine run even when its name also says dark roast.
  if (ROAST_NAMES[0].expression.test(name)) return 'Decaf';
  const matches = ROAST_NAMES.slice(1).filter((entry) => entry.expression.test(name));
  return matches.length === 1 ? matches[0].label : null;
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanCoffeeLabel(name: string) {
  return name.replace(/^raw\s+coffee\s*[-:]?\s*/i, '').trim();
}

function positiveCeil(value: number) {
  // Avoid an extra bag caused solely by binary arithmetic at an integer edge.
  return Math.max(0, Math.ceil(value - Number.EPSILON * Math.max(1, Math.abs(value)) * 4));
}

function targetQuantity(row: ProductionPlanningProduct, includeForecast: boolean) {
  const knownDemand = row.events.filter((event) => !event.needsReview)
    .reduce((sum, event) => sum + event.quantity, 0);
  const forecast = includeForecast && row.product.active !== false && row.confidence !== 'Low'
    ? row.historyWeeklyAverageQty * 2 : 0;
  const par = includeForecast && row.product.active !== false ? Math.max(row.parQty, row.minimumQty) : 0;
  return positiveCeil(Math.max(knownDemand, forecast, par) - row.onHand);
}

/** Convert net finished-product demand into physical machine bags for 14 days. */
export function buildMachineBagSummary(
  data: ProductionPlanningData,
  plan: ProductionPlan,
  includeForecast = true,
): MachineBagSummary {
  const summary: MachineBagSummary = {
    today: plan.today, horizonEnd: plan.horizonEnd, rows: [], totalBags: 0,
    issues: [], reviewMessages: [], includeForecast,
  };
  const rows = new Map<string, MachineBagSummaryRow>();
  const itemById = new Map(data.items.map((item) => [item.id, item]));
  const selected = plan.products.filter((row) => ['fraction_packs', 'filter_packs', 'sample_boxes'].includes(row.product.category ?? ''));
  const selectedIds = new Set(selected.map((row) => row.product.id));

  for (const review of plan.scheduleReviews) {
    if (!review.affectedProductIds.some((id) => selectedIds.has(id))) continue;
    summary.reviewMessages.push(`${review.customerName}: ${review.message}`);
  }

  for (const row of selected) {
    const productId = row.product.id;
    const productName = row.product.name?.trim() || 'Unnamed product';
    const issue = (message: string) => summary.issues.push({ productId, productName, message });
    const demandNumbers = [row.onHand, row.historyWeeklyAverageQty, row.parQty, row.minimumQty,
      ...row.events.filter((event) => !event.needsReview).map((event) => event.quantity)];
    if (!demandNumbers.every(Number.isFinite) || demandNumbers.slice(1).some((value) => value < 0)) {
      issue('Demand or recorded stock is invalid. Check this product before planning bags.');
      continue;
    }
    if (includeForecast && row.product.active !== false && row.confidence === 'Low' && row.historyWeeklyAverageQty > 0) {
      summary.reviewMessages.push(`${productName}: history has fewer than three weeks with sales; its forecast is excluded. Orders and saved stock targets still count.`);
    }
    const unitsToMake = targetQuantity(row, includeForecast);
    if (!Number.isSafeInteger(unitsToMake)) {
      issue('The required production quantity is too large to calculate reliably.');
      continue;
    }
    if (unitsToMake === 0) continue;

    const add = (bagType: MachineBagType, sizeOz: number, roast: string, bagCount: number, roastIdentity = roast) => {
      const key = `${bagType}:${Number(sizeOz.toFixed(8))}:${roastIdentity}`;
      const existing = rows.get(key) ?? { key, bagType, sizeOz, roast, bagCount: 0, coffeeLb: 0, sources: [] };
      existing.bagCount += bagCount;
      existing.coffeeLb += bagCount * sizeOz / 16;
      existing.sources.push({ productId, productName, unitsToMake, bagCount });
      rows.set(key, existing);
    };

    if (row.product.category === 'sample_boxes') {
      for (const packet of SAMPLE_BOX_MACHINE_PACKOUT) {
        add('sample', packet.sizeOz, packet.roast, unitsToMake * packet.bagsPerUnit);
      }
      continue;
    }

    const recipes = data.recipes.filter((recipe) => recipe.product_id === productId);
    if (recipes.length !== 1) {
      issue(recipes.length ? 'Multiple recipes need review before converting this product into bags.' : 'No recipe is available to convert this product into bags.');
      continue;
    }
    const recipe = recipes[0];
    const outputQty = positiveNumber(recipe.output_qty);
    const bagType = row.product.category === 'filter_packs' ? 'filter' : 'fraction';
    const packagingRole = bagType === 'filter' ? 'filter_pack' : 'fraction_bag';
    const components = recipe.product_recipe_components ?? [];
    const packaging = components.filter((component) => component.component_role === packagingRole);
    const coffee = components.filter((component) => component.component_role === 'raw_coffee');
    if (!outputQty || !packaging.length || !coffee.length) {
      issue('The recipe needs a positive output, coffee weight, and inner bag count.');
      continue;
    }
    if (packaging.some((component) => component.unit !== 'each' || !positiveNumber(component.quantity))
      || new Set(packaging.map((component) => component.inventory_item_id)).size !== 1) {
      issue('Inner bag quantities or mixed packaging need review before calculating a fill size.');
      continue;
    }

    const ingredients = new Map<string, { label: string; oz: number }>();
    const relatedItem = (component: ProductionMaterialComponent) => {
      const related = Array.isArray(component.inventory_items) ? component.inventory_items[0] : component.inventory_items;
      return itemById.get(component.inventory_item_id) ?? related;
    };
    let invalidCoffee = false;
    for (const component of coffee) {
      const quantity = positiveNumber(component.quantity);
      const item = relatedItem(component);
      if (!quantity || !component.inventory_item_id || !item?.name?.trim() || !['oz', 'lb'].includes(component.unit)) {
        invalidCoffee = true;
        break;
      }
      const oz = quantity * (component.unit === 'lb' ? 16 : 1);
      const current = ingredients.get(component.inventory_item_id);
      ingredients.set(component.inventory_item_id, {
        label: cleanCoffeeLabel(item.name), oz: (current?.oz ?? 0) + oz,
      });
    }
    if (invalidCoffee) {
      issue('Coffee weight or roast metadata is missing or uses an unsupported unit.');
      continue;
    }
    const totalCoffeeOz = [...ingredients.values()].reduce((sum, ingredient) => sum + ingredient.oz, 0);
    const bagsPerRecipe = packaging.reduce((sum, component) => sum + Number(component.quantity), 0);
    const sizeOz = totalCoffeeOz / bagsPerRecipe;
    const bagCount = positiveCeil(unitsToMake * bagsPerRecipe / outputQty);
    if (!Number.isFinite(sizeOz) || sizeOz <= 0 || !Number.isSafeInteger(bagCount) || bagCount <= 0
      || !Number.isFinite(bagCount * sizeOz / 16)) {
      issue('The recipe cannot be converted to a valid bag count and fill weight.');
      continue;
    }

    const labelledPack = productName.match(/\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*oz\b/i);
    if (labelledPack && (Math.abs(Number(labelledPack[2]) - sizeOz) > 0.00001
      || Math.abs(Number(labelledPack[1]) - bagsPerRecipe / outputQty) > 0.00001)) {
      issue('The recipe bag count or fill weight conflicts with the product label. Confirm the pack size before production.');
      continue;
    }

    const productRoast = namedRoast(productName);
    let roast: string;
    let roastIdentity: string;
    if (ingredients.size > 1) {
      const sorted = [...ingredients.entries()].sort(([left], [right]) => left.localeCompare(right));
      const composition = sorted.map(([, ingredient]) => `${Number((ingredient.oz / totalCoffeeOz * 100).toFixed(1))}% ${ingredient.label}`).join(' + ');
      roast = `${productRoast ? `${productRoast} blend` : 'Blend'} (${composition})`;
      roastIdentity = `${productRoast ?? 'blend'}:${sorted.map(([id, ingredient]) => `${id}@${(ingredient.oz / totalCoffeeOz).toFixed(8)}`).join('+')}`;
    } else {
      const [rawId, ingredient] = [...ingredients.entries()][0];
      if (!productRoast && ROAST_NAMES.slice(1).filter((entry) => entry.expression.test(productName)).length > 1) {
        issue('The product names multiple roasts but its recipe does not identify a blend. Confirm the roast before production.');
        continue;
      }
      roast = productRoast ?? namedRoast(ingredient.label) ?? ingredient.label;
      if (!roast) {
        issue('The recipe does not identify a roast for this machine run.');
        continue;
      }
      roastIdentity = productRoast ?? namedRoast(ingredient.label) ?? `${rawId}:${roast}`;
      const rawRoast = namedRoast(ingredient.label);
      if ((productRoast === 'Medium Roast' && rawRoast === 'Dark Roast')
        || (productRoast === 'Dark Roast' && rawRoast === 'Medium Roast')) {
        summary.reviewMessages.push(`${productName}: the product says ${productRoast}, but its recipe uses ${ingredient.label}. Bags are listed under the product roast; verify the recipe before production.`);
      }
    }
    add(bagType, sizeOz, roast, bagCount, roastIdentity);
  }

  summary.rows = [...rows.values()].sort((left, right) => left.bagType.localeCompare(right.bagType)
    || left.sizeOz - right.sizeOz || left.roast.localeCompare(right.roast));
  summary.totalBags = summary.rows.reduce((sum, row) => sum + row.bagCount, 0);
  summary.reviewMessages = [...new Set(summary.reviewMessages)];
  return summary;
}

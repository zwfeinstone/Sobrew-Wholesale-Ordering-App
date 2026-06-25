export type PlanningConfidence = 'High' | 'Medium' | 'Low';
export type PlanningStatus = 'Make / Order Now' | 'Watch' | 'No Action';

export type InventoryPlanningRules = {
  actionVerb?: 'Make' | 'Order';
  actionThresholdQty?: number;
  minimumActionQty?: number;
  orderMultiple?: number;
  safetyStockQty?: number;
  unitLabel?: string;
  watchThresholdQty?: number;
};

export type InventoryPlanningRecommendation = {
  actionLabel: string;
  actionVerb: 'Make' | 'Order';
  displayProjectedQty: number;
  rawNeededQty: number;
  reason: string;
  recommendedQty: number;
  status: PlanningStatus;
};

function cleanPositive(value: number | null | undefined) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

export function roundUpToMultiple(value: number, multiple: number) {
  const normalizedValue = cleanPositive(value);
  const normalizedMultiple = cleanPositive(multiple) || 1;
  if (normalizedValue <= 0) return 0;
  return Math.ceil(normalizedValue / normalizedMultiple) * normalizedMultiple;
}

export function recommendInventoryAction({
  availableQty,
  confidence,
  expectedDemandQty,
  likelyCustomerCount,
  rules = {},
}: {
  availableQty: number;
  confidence: PlanningConfidence;
  expectedDemandQty: number;
  likelyCustomerCount: number;
  rules?: InventoryPlanningRules;
}): InventoryPlanningRecommendation {
  const actionVerb = rules.actionVerb ?? 'Make';
  const expectedDemand = cleanPositive(expectedDemandQty);
  const available = cleanPositive(availableQty);
  const safetyStockQty = cleanPositive(rules.safetyStockQty);
  const minimumActionQty = Math.max(1, cleanPositive(rules.minimumActionQty) || 1);
  const orderMultiple = Math.max(1, cleanPositive(rules.orderMultiple) || 1);
  const unitLabel = rules.unitLabel ?? 'each';
  const actionThresholdQty = cleanPositive(rules.actionThresholdQty) || Math.max(0.75, minimumActionQty * 0.5);
  const watchThresholdQty = cleanPositive(rules.watchThresholdQty) || 0.25;
  const rawNeededQty = Math.max(0, expectedDemand + safetyStockQty - available);
  const displayProjectedQty = expectedDemand >= 0.5 ? Math.ceil(expectedDemand) : 0;

  if (rawNeededQty <= 0 && expectedDemand > 0) {
    return {
      actionLabel: 'No action',
      actionVerb,
      displayProjectedQty,
      rawNeededQty,
      reason: 'No action: current available stock covers the expected demand.',
      recommendedQty: 0,
      status: 'No Action',
    };
  }

  const demandClearsActionThreshold = rawNeededQty >= actionThresholdQty;
  const confidenceSupportsAction = confidence !== 'Low' || rawNeededQty >= actionThresholdQty * 2 || likelyCustomerCount >= 2;

  if (demandClearsActionThreshold && confidenceSupportsAction) {
    const recommendedQty = roundUpToMultiple(Math.max(minimumActionQty, rawNeededQty), orderMultiple);
    return {
      actionLabel: `${actionVerb} ${recommendedQty}`,
      actionVerb,
      displayProjectedQty,
      rawNeededQty,
      reason: `${actionVerb} ${recommendedQty}: expected demand clears the planning threshold for this ${unitLabel}.`,
      recommendedQty,
      status: 'Make / Order Now',
    };
  }

  if (rawNeededQty >= watchThresholdQty || expectedDemand >= watchThresholdQty || likelyCustomerCount > 0) {
    const lowConfidenceReason = confidence === 'Low'
      ? 'Watch: possible demand exists, but confidence is too low to make inventory now.'
      : 'Watch: possible demand exists, but it is below the action threshold.';
    return {
      actionLabel: 'Watch',
      actionVerb,
      displayProjectedQty,
      rawNeededQty,
      reason: lowConfidenceReason,
      recommendedQty: 0,
      status: 'Watch',
    };
  }

  return {
    actionLabel: 'No action',
    actionVerb,
    displayProjectedQty,
    rawNeededQty,
    reason: 'No action: forecast is below the planning threshold.',
    recommendedQty: 0,
    status: 'No Action',
  };
}

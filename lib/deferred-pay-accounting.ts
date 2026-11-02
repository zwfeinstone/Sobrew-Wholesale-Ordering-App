import { calculateDeferredPay, type DeferredPayEntry, type DeferredPayPlan, type DeferredPaySummary } from '@/lib/deferred-pay';
import { calculatePayrollWages } from '@/lib/payroll-wages';
import { formatCentralDateInput, normalizeWorkType, parseCentralDateInput, workTypeLabel } from '@/lib/time-clock';

export type DeferredPayAllocation = { time_entry_id: string; work_type: string | null; minutes: number | string | null };
export type DeferredPayWorkTypeSummary = { workType: string; label: string; eligibleHours: number; accruedCents: number; paidCents: number };
type PeriodAmounts = {
  eligibleHours: number;
  openingLiabilityCents: number;
  accruedCents: number;
  paidCents: number;
  closingLiabilityCents: number;
  productionAccruedCents: number;
  operatingAccruedCents: number;
  byWorkType: DeferredPayWorkTypeSummary[];
};
export type DeferredPayAccountingPlanSummary = PeriodAmounts & {
  plan: DeferredPayPlan;
  summary: DeferredPaySummary;
  employeeName: string;
};
export type DeferredPayAccountingSummary = PeriodAmounts & {
  periodStartDate: string;
  periodEndDate: string;
  asOf: string;
  plans: DeferredPayAccountingPlanSummary[];
  /** Complete settlement links, including plans earned outside the period. */
  settlementTransactionIds: string[];
};

export function deferredPayPeriodBounds(start: string, end: string) {
  const from = parseCentralDateInput(start);
  const last = parseCentralDateInput(end);
  if (!from || !last || formatCentralDateInput(from) !== start || formatCentralDateInput(last) !== end || last < from) {
    throw new RangeError('Deferred pay report dates must be valid and ordered.');
  }
  const next = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: from, endExclusive: parseCentralDateInput(next)! };
}

function allocateCents(cents: number, weights: readonly number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) return weights.map(() => 0);
  const raw = weights.map((weight) => cents * weight / total);
  const result = raw.map(Math.floor);
  const remaining = cents - result.reduce((sum, amount) => sum + amount, 0);
  const ordered = raw.map((amount, index) => ({ index, remainder: amount - result[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remaining; index += 1) result[ordered[index].index] += 1;
  return result;
}

/**
 * Earned expense follows Central work dates. Cumulative rounded earnings at
 * each boundary prevent monthly penny drift and reconcile to Week Hours.
 * Settlement reduces the liability, never the earned expense. Signed balances
 * expose overpayments after a time correction instead of concealing them.
 */
export function buildDeferredPayAccountingSummary({
  plans, entries, allocations = [], employeeNames = {}, start, end, now = new Date(),
}: {
  plans: readonly DeferredPayPlan[];
  entries: readonly DeferredPayEntry[];
  allocations?: readonly DeferredPayAllocation[];
  employeeNames?: Readonly<Record<string, string>>;
  start: string;
  end: string;
  now?: Date;
}): DeferredPayAccountingSummary {
  const bounds = deferredPayPeriodBounds(start, end);
  const wageMinutes = calculatePayrollWages(entries);
  const allocationsByEntry = new Map<string, DeferredPayAllocation[]>();
  for (const row of allocations) {
    const rows = allocationsByEntry.get(row.time_entry_id) ?? [];
    rows.push(row);
    allocationsByEntry.set(row.time_entry_id, rows);
  }
  function weightsFor(summary: DeferredPaySummary, before?: DeferredPaySummary) {
    const previous = new Map(before?.entries.map((row) => [row.entryId, row.eligibleMilliseconds]));
    const byType = new Map<string, number>();
    for (const row of summary.entries) {
      const milliseconds = row.eligibleMilliseconds - (previous.get(row.entryId) ?? 0);
      if (milliseconds <= 0) continue;
      const parts = (allocationsByEntry.get(row.entryId) ?? []).map((allocation) => ({
        type: normalizeWorkType(allocation.work_type),
        minutes: Math.max(0, Number(allocation.minutes) || 0),
      }));
      const allocatedMinutes = parts.reduce((sum, part) => sum + part.minutes, 0);
      const remaining = Math.max(0, (wageMinutes.get(row.entryId)?.minutes ?? 0) - allocatedMinutes);
      parts.push({ type: normalizeWorkType(row.workType), minutes: remaining });
      const totalMinutes = parts.reduce((sum, part) => sum + part.minutes, 0);
      if (!totalMinutes) parts.push({ type: normalizeWorkType(row.workType), minutes: 1 });
      for (const part of parts) {
        const weight = milliseconds * part.minutes / (totalMinutes || 1);
        if (weight) byType.set(part.type, (byType.get(part.type) ?? 0) + weight);
      }
    }
    return byType;
  }
  const planRows = plans.map((plan): DeferredPayAccountingPlanSummary => {
    const summary = calculateDeferredPay(plan, entries, now);
    const opening = calculateDeferredPay(plan, entries, now, { earnedBefore: bounds.start });
    const closing = calculateDeferredPay(plan, entries, now, { earnedBefore: bounds.endExclusive });
    const paidAt = plan.paid_at ? Date.parse(plan.paid_at) : NaN;
    const actualPaid = paidAt <= now.getTime() ? (plan.paid_amount_cents ?? 0) : 0;
    const paidBefore = paidAt < bounds.start.getTime() ? actualPaid : 0;
    const paidThrough = paidAt < bounds.endExclusive.getTime() ? actualPaid : 0;
    const paidCents = paidThrough - paidBefore;
    const accruedCents = closing.accruedCents - opening.accruedCents;
    const periodWeights = weightsFor(closing, opening);
    const openingWeights = weightsFor(opening);
    const closingWeights = weightsFor(closing);
    const lifetimeWeights = weightsFor(summary);
    const types = [...new Set([...closingWeights.keys(), ...(paidCents ? lifetimeWeights.keys() : [])])].sort();
    const openingByType = allocateCents(opening.accruedCents, types.map((type) => openingWeights.get(type) ?? 0));
    const closingByType = allocateCents(closing.accruedCents, types.map((type) => closingWeights.get(type) ?? 0));
    // Difference cumulative category balances too, so monthly COGS/OpEx add to
    // annual totals exactly. A cent correction may move between labor tags.
    const accruedByType = closingByType.map((cents, index) => cents - openingByType[index]);
    const paidByType = allocateCents(paidCents, types.map((type) => lifetimeWeights.get(type) ?? 0));
    // Retain a payment even when corrections have removed all eligible hours.
    if (paidCents && !types.length) { types.push('unassigned'); accruedByType.push(0); paidByType.push(paidCents); }
    const byWorkType = types.map((workType, index) => ({
      workType, label: workTypeLabel(workType), eligibleHours: (periodWeights.get(workType) ?? 0) / 3_600_000,
      accruedCents: accruedByType[index], paidCents: paidByType[index],
    }));
    const productionAccruedCents = byWorkType.find((row) => row.workType === 'production')?.accruedCents ?? 0;
    return {
      plan, summary, employeeName: employeeNames[plan.profile_id] || 'Employee',
      eligibleHours: closing.eligibleHours - opening.eligibleHours,
      openingLiabilityCents: opening.accruedCents - paidBefore,
      accruedCents, paidCents, closingLiabilityCents: closing.accruedCents - paidThrough,
      productionAccruedCents, operatingAccruedCents: accruedCents - productionAccruedCents, byWorkType,
    };
  });
  const byWorkType = new Map<string, DeferredPayWorkTypeSummary>();
  for (const plan of planRows) {
    for (const row of plan.byWorkType) {
      const aggregate = byWorkType.get(row.workType) ?? { ...row, eligibleHours: 0, accruedCents: 0, paidCents: 0 };
      aggregate.eligibleHours += row.eligibleHours;
      aggregate.accruedCents += row.accruedCents;
      aggregate.paidCents += row.paidCents;
      byWorkType.set(row.workType, aggregate);
    }
  }
  const sum = (key: keyof Omit<PeriodAmounts, 'byWorkType'>) => planRows.reduce((total, row) => total + row[key], 0);
  return {
    periodStartDate: start, periodEndDate: end, asOf: now.toISOString(), plans: planRows,
    eligibleHours: sum('eligibleHours'), openingLiabilityCents: sum('openingLiabilityCents'),
    accruedCents: sum('accruedCents'), paidCents: sum('paidCents'), closingLiabilityCents: sum('closingLiabilityCents'),
    productionAccruedCents: sum('productionAccruedCents'), operatingAccruedCents: sum('operatingAccruedCents'),
    byWorkType: [...byWorkType.values()].sort((a, b) => a.label.localeCompare(b.label)),
    settlementTransactionIds: [...new Set(plans.filter((plan) => plan.paid_at && Date.parse(plan.paid_at) <= now.getTime())
      .flatMap((plan) => plan.accounting_transaction_id ? [plan.accounting_transaction_id] : []))],
  };
}
